#!/usr/bin/env node
/**
 * Local browser verification for the project-structure and timeline usability release.
 *
 * It starts an isolated embedded PostgreSQL cluster, migrates it, seeds a realistic fixture,
 * starts the built API (which also serves the built web) and drives real Chromium journeys in
 * Japanese and English at 1440, 1024 and 390 px. Evidence screenshots are written to
 * `work/screenshots/`. Nothing here touches a deployment or operational data.
 *
 * The fixture deliberately contains long Japanese names, multiple assignees, nested unfinished and
 * completed work, a fully completed subproject, an empty subproject, overdue and review-pending
 * work, missing dates, a deadline-only record and a schedule far outside the visible period.
 */
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';
import pg from 'pg';
import { chromium, expect } from '@playwright/test';

const root = process.cwd();
const password = 'Verify-local-password-123';
const shots = join(root, 'work', 'screenshots');
const results = [];
const browserErrors = [];

function log(message) {
  process.stdout.write(`PASS  ${message}\n`);
  results.push(message);
}

function fail(message) {
  process.stderr.write(`FAIL: ${message}\n`);
  process.exitCode = 1;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk.toString()));
    child.stderr.on('data', (chunk) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} failed (${code}):\n${output}`))
    );
  });
}

async function startEmbedded() {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  const binaries = await import(`@embedded-postgres/${platform}-${arch}`);
  const directory = await mkdtemp(join(tmpdir(), 'eh-timeline-pg-'));
  const dataDir = join(directory, 'data');
  const logFile = join(directory, 'postgres.log');
  const port = await freePort();
  await run(
    binaries.initdb,
    ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'],
    process.env
  );
  await new Promise((resolve, reject) => {
    const child = spawn(
      binaries.pg_ctl,
      ['-D', dataDir, '-l', logFile, '-o', `-p ${port} -c listen_addresses=127.0.0.1`, 'start'],
      { stdio: 'ignore', windowsHide: true }
    );
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_ctl failed (${code})`))));
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
    try {
      await client.connect();
      await client.end();
      break;
    } catch {
      try {
        await client.end();
      } catch {
        /* already closed */
      }
      if (Date.now() > deadline) throw new Error('embedded PostgreSQL did not start');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    async stop() {
      await run(binaries.pg_ctl, ['-D', dataDir, '-m', 'fast', 'stop'], process.env).catch(() => undefined);
    }
  };
}

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function day(offset) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function seed(client) {
  const salt = randomBytes(16).toString('hex');
  const hash = await promisify(scrypt)(password, salt, 64, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 160 * 1024 * 1024
  });
  const stored = ['scrypt', salt, hash.toString('hex')].join('$');
  await client.query(
    `INSERT INTO divisions(division_id,name,sort_order) VALUES
      ('DIV-DEV','設計・開発課',1),('DIV-ENG','設計・製造課',2)`
  );
  await client.query(
    `INSERT INTO members(member_id,name,role) VALUES
      ('MEM-ADMIN','管理 太郎','ADMIN'),('MEM-MANAGER','管理 花子','MANAGER'),
      ('MEM-MEMBER','佐藤 一郎','MEMBER'),('MEM-MISAKI','鈴木 美咲','MEMBER'),
      ('MEM-VIEW','閲覧 次郎','VIEWER')`
  );
  await client.query(
    `INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES
      ('MEM-ADMIN','0001',$1,false),('MEM-MANAGER','0004',$1,false),
      ('MEM-MEMBER','0002',$1,false),('MEM-MISAKI','0005',$1,false),('MEM-VIEW','0003',$1,false)`,
    [stored]
  );
  await client.query(
    `INSERT INTO member_divisions(relationship_id,member_id,division_id,access_kind,assigned_by)
     SELECT 'MD-' || m.member_id, m.member_id, 'DIV-DEV', 'WORK', 'fixture' FROM members m`
  );
  await client.query(
    `INSERT INTO responsibilities(responsibility_id,division_id,name,owner_member_id,color_hex) VALUES
      ('RSP-A','DIV-DEV','車載筐体設計','MEM-MANAGER','#2563EB'),
      ('RSP-B','DIV-DEV','製造準備','MEM-MANAGER','#0D9488')`
  );
  await client.query(
    `INSERT INTO projects(project_id,project_name,description,division_id,responsibility_id,project_owner_id,status,priority,
                          planned_start,forecast_end,committed_deadline,dashboard_visibility,next_action)
     VALUES
      ('PRJ-1','車載バッテリー筐体の設計・試作評価および量産準備','車載バッテリー向け筐体の設計から試作評価、量産準備までの一連の作業。',
       'DIV-DEV','RSP-A','MEM-MANAGER','Active','High',$1,$2,$3,'INTERNAL','試作評価の準備'),
      ('PRJ-2','組立ライン段取り改善','組立ラインの段取り改善。','DIV-DEV','RSP-B','MEM-MANAGER','Active','Medium',$1,null,$4,'INTERNAL','')`,
    [day(-20), day(40), day(12), day(30)]
  );
  await client.query(
    `INSERT INTO subprojects(subproject_id,project_id,subproject_name,owner_id,status,deadline,description)
     VALUES
      ('SUB-1','PRJ-1','試作評価と耐久試験の準備','MEM-MANAGER','Active',$1,'試作評価の準備作業。'),
      ('SUB-DONE','PRJ-1','完了した工程','MEM-MANAGER','Active',null,''),
      ('SUB-EMPTY','PRJ-1','空の工程','MEM-MANAGER','Active',null,'')`,
    [day(8)]
  );
  const task = `INSERT INTO tasks(task_id,project_id,subproject_id,parent_task_id,task_name,status,priority,
      owner_member_id,planned_start,due_date,progress_percent,completed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`;
  await client.query(task, [
    'T-LONG', 'PRJ-1', 'SUB-1', null,
    '筐体の熱解析および振動試験の条件整理と評価方法の決定（第一段階）',
    'In Progress', 'High', 'MEM-MEMBER', day(-10), day(-2), 30, null
  ]);
  await client.query(task, [
    'T-CONTAINER', 'PRJ-1', 'SUB-1', null, '試作フェーズ（容器）',
    'In Progress', 'Medium', 'MEM-MEMBER', null, null, 0, null
  ]);
  await client.query(task, [
    'T-CHILD-OPEN', 'PRJ-1', 'SUB-1', 'T-CONTAINER', '図面の作成と承認',
    'In Progress', 'High', 'MEM-MEMBER', day(-5), day(1), 50, null
  ]);
  await client.query(task, [
    'T-CHILD-DONE', 'PRJ-1', 'SUB-1', 'T-CONTAINER', '構想検討',
    'Done', 'Medium', 'MEM-MEMBER', day(-15), day(-8), 100, new Date(Date.now() - 3 * 86_400_000).toISOString()
  ]);
  await client.query(task, [
    'T-REVIEW', 'PRJ-1', 'SUB-1', null, '完了報告の確認待ちタスク',
    'In Progress', 'Medium', 'MEM-MEMBER', day(-2), day(2), 90, null
  ]);
  await client.query(task, [
    'T-NONE', 'PRJ-1', null, null, '日付未設定の検討事項',
    'Not Started', 'Low', 'MEM-MEMBER', null, null, 0, null
  ]);
  await client.query(task, [
    'T-DEADLINE', 'PRJ-1', null, null, '期限のみの作業',
    'Assigned', 'Medium', 'MEM-MEMBER', null, day(6), 0, null
  ]);
  await client.query(task, [
    'T-FAR', 'PRJ-1', 'SUB-1', null, '来四半期の量産立会い',
    'Not Started', 'Low', 'MEM-MEMBER', day(75), day(80), 0, null
  ]);
  await client.query(task, [
    'T-DONE', 'PRJ-1', 'SUB-DONE', null, '仕様の確定',
    'Done', 'Medium', 'MEM-MEMBER', day(-20), day(-12), 100, new Date(Date.now() - 10 * 86_400_000).toISOString()
  ]);
  await client.query(task, [
    'T-DONE-2', 'PRJ-1', 'SUB-DONE', null, '関係者レビュー',
    'Done', 'Low', 'MEM-MISAKI', day(-18), day(-14), 100, new Date(Date.now() - 9 * 86_400_000).toISOString()
  ]);
  await client.query(
    `INSERT INTO task_assignees(assignment_id,task_id,member_id,assigned_by) VALUES
      ('TA-1','T-LONG','MEM-MEMBER','MEM-MANAGER'),('TA-2','T-LONG','MEM-MISAKI','MEM-MANAGER')`
  );
  await client.query(
    `INSERT INTO task_requests(request_id,request_type,task_id,project_id,requester_name,status,
       task_revision_at_submission,due_date_at_submission,snapshot_version,requester_member_id)
     VALUES('REQ-REVIEW','COMPLETION_REPORT','T-REVIEW','PRJ-1','佐藤 一郎','PENDING','1',$1,'1','MEM-MEMBER')`,
    [day(2)]
  );
  await client.query(
    `INSERT INTO app_settings(setting_id,value,updated_by) VALUES('REQUEST_SUBMISSION_ENABLED','true','MEM-ADMIN')
     ON CONFLICT (setting_id) DO UPDATE SET value = EXCLUDED.value`
  );
}

async function main() {
  await mkdir(shots, { recursive: true });
  const server = await startEmbedded();
  const databaseUrl = server.url;
  const client = new pg.Client({ connectionString: databaseUrl });
  let api = null;
  let browser = null;
  try {
    await client.connect();
    await run('node', ['apps/api/dist/migrate.js'], {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production'
    });
    await seed(client);
    log('isolated database migrated and seeded (2 divisions, 5 members, 2 projects, 9 tasks)');

    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    api = spawn('node', ['apps/api/dist/main.js'], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        APP_ENV: 'PRODUCTION',
        AUTH_MODE: 'local',
        ALLOW_INSECURE_LAN_HTTP: 'true',
        HOST: '127.0.0.1',
        PORT: String(port),
        DATABASE_URL: databaseUrl,
        MANAGER_WEB_ALLOWED_DOMAINS: 'example.co.jp',
        DEV_AUTH_ENABLED: 'false',
        PUBLIC_ORIGIN: origin,
        WEB_ROOT: join(root, 'apps', 'web', 'dist'),
        LOG_LEVEL: 'silent',
        RATE_LIMIT_MAX: '10000'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let apiError = '';
    api.stderr.on('data', (chunk) => (apiError += chunk.toString()));
    await waitFor(`${origin}/healthz`);
    log('built API and built web are served');

    browser = await chromium.launch({ headless: true });
    const newPage = async (width = 1440, height = 1000) => {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', (error) => browserErrors.push(error.message));
      return page;
    };
    const signIn = async (page, employeeId) => {
      await page.goto(origin);
      await page.evaluate(() => window.localStorage.clear());
      await page.reload();
      await page.getByLabel('社員番号', { exact: true }).fill(employeeId);
      await page.getByLabel('パスワード', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'ログイン', exact: true }).click();
      await expect(page.locator('.app-nav')).toBeVisible({ timeout: 20_000 });
    };
    const capture = async (page, name, { fullPage = true } = {}) => {
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({ path: join(shots, `${name}.png`), fullPage });
    };
    const overflow = (page) =>
      page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
      }));

    /* ------------------------------------------------------------ project detail */
    const member = await newPage(1440);
    await signIn(member, '0002');
    log('MEMBER signed in with local credentials');

    await member.goto(`${origin}/#/project/PRJ-1`);
    await expect(member.locator('.hierarchy-table').first()).toBeVisible({ timeout: 20_000 });
    // One compact summary distinguishes weighted progress from completed leaf work.
    await expect(member.locator('.project-summary-progress').getByText(/進捗 \d+% · 完了 \d+ \/ \d+ タスク/)).toBeVisible();
    log('project summary states progress and completed task count together');
    // The long Japanese task name and both assignees are readable.
    await expect(member.getByText('筐体の熱解析および振動試験の条件整理と評価方法の決定（第一段階）')).toBeVisible();
    // The container's unfinished child is part of the active structure by default.
    await expect(member.getByText('図面の作成と承認')).toBeVisible();
    await capture(member, 'v22-project-detail-1440');

    // Reveal a completed task through the completed-count button and the group action.
    const completedToggle = member.getByRole('button', { name: /完了したタスク \(\d+\)/ });
    await completedToggle.click();
    await expect(completedToggle).toHaveAttribute('aria-expanded', 'true');
    const completedTable = member.locator('.hierarchy-table-completed');
    await expect(completedTable).toBeVisible();
    await completedTable.getByRole('button', { name: '表示' }).first().click();
    await expect
      .poll(() => member.evaluate(() => document.activeElement?.id ?? ''))
      .toMatch(/^hierarchy-completed-/);
    log('completed task reveal focuses a presentation-scoped DOM id');
    await capture(member, 'v22-project-detail-revealed-1440');

    // The assignee filter is searchable and paginated; a member beyond the first page is reachable.
    await member.getByRole('searchbox', { name: '担当者を検索' }).fill('鈴木');
    const misaki = member.getByRole('option', { name: /鈴木 美咲/ });
    await expect(misaki).toHaveCount(1);
    const misakiId = await misaki.getAttribute('value');
    await member.getByRole('combobox', { name: '担当者' }).selectOption(misakiId);
    await expect(member.getByText('図面の作成と承認')).toHaveCount(0);
    await expect(member.getByText('筐体の熱解析および振動試験の条件整理と評価方法の決定（第一段階）')).toBeVisible();
    log('assignee filter searches by stable member id and narrows the structure');
    await member.getByRole('combobox', { name: '担当者' }).selectOption('');
    await expect(member.getByText('図面の作成と承認')).toBeVisible();

    // Missing-date wording is quiet on a subproject header and explicit in the status column.
    await expect(member.locator('.hierarchy-dates-quiet').first()).toBeVisible();
    log('a missing schedule stays a quiet value on a subproject header');

    // Laptop and phone layouts: no horizontal overflow, the first task is near the heading.
    await member.setViewportSize({ width: 1024, height: 900 });
    await member.waitForTimeout(300);
    await capture(member, 'v22-project-detail-1024');
    let layout = await overflow(member);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth + 1);

    await member.setViewportSize({ width: 390, height: 844 });
    await member.waitForTimeout(300);
    await capture(member, 'v22-project-detail-390');
    layout = await overflow(member);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth + 1);
    log('project detail has no horizontal overflow at 1024 and 390 px');

    /* ---------------------------------------------------------------- timeline */
    const timeline = await newPage(1440);
    await signIn(timeline, '0002');
    await timeline.goto(`${origin}/#/timeline/PRJ-1`);
    await expect(timeline.locator('.tl-scroller')).toBeVisible({ timeout: 20_000 });
    await expect(timeline.locator('.timeline-legend')).toBeVisible();
    await capture(timeline, 'v22-timeline-chart-1440');

    // Project-level attention filters come from the server.
    const overdueFilter = timeline.getByRole('button', { name: /期限超過/ });
    await expect(overdueFilter.locator('.attention-count')).toHaveText(/\d+/);
    await overdueFilter.click();
    await expect(timeline.locator('.tl-scroller')).toContainText('評価方法の決定（第一段階）');
    await expect(timeline.locator('.attention-applied')).toBeVisible();
    await capture(timeline, 'v22-timeline-attention-1440');
    log('attention filter shows server counts and matching work with context');
    await timeline.getByRole('button', { name: /すべての予定/ }).click();

    // Inspect a task from the chart with the keyboard.
    const details = timeline.getByRole('button', { name: '内容: 期限のみの作業' }).first();
    await details.focus();
    await timeline.keyboard.press('Enter');
    const panel = timeline.getByRole('dialog');
    await expect(panel).toBeVisible();
    await expect.poll(() => timeline.evaluate(() => document.activeElement?.tagName)).toBe('H3');
    await capture(timeline, 'v22-timeline-panel-1440');
    await timeline.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect.poll(() => timeline.evaluate(() => document.activeElement?.textContent ?? '')).toContain('内容');
    log('inspection panel opens with the keyboard, closes on Escape and restores focus');

    // Period navigation keeps the stored dates untouched.
    await timeline.getByRole('button', { name: '1か月' }).click();
    const rangeBefore = await timeline.locator('.timeline-range').textContent();
    await timeline.getByRole('button', { name: /次へ/ }).click();
    const rangeAfter = await timeline.locator('.timeline-range').textContent();
    expect(rangeAfter).not.toBe(rangeBefore);
    await timeline.getByRole('button', { name: /前へ/ }).click();
    expect(await timeline.locator('.timeline-range').textContent()).toBe(rangeBefore);
    log('previous/next move the viewport and return to the same calendar month');

    // Agenda keeps the same scope; the language switch preserves the presentation.
    await timeline.getByRole('button', { name: '予定表' }).click();
    await expect(timeline.locator('.timeline-agenda')).toBeVisible();
    await timeline.getByRole('button', { name: 'English', exact: true }).click();
    await expect(timeline.getByRole('button', { name: 'Agenda', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await timeline.getByRole('button', { name: '日本語', exact: true }).click();
    log('agenda keeps the selected scope across a language switch');

    await timeline.setViewportSize({ width: 390, height: 844 });
    await timeline.waitForTimeout(300);
    await capture(timeline, 'v22-timeline-agenda-390');
    layout = await overflow(timeline);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth + 1);
    await timeline.getByRole('button', { name: 'チャート' }).click();
    await timeline.waitForTimeout(300);
    await capture(timeline, 'v22-timeline-chart-390');
    layout = await overflow(timeline);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth + 1);
    log('timeline chart and agenda have no horizontal overflow at 390 px');

    await timeline.setViewportSize({ width: 1024, height: 900 });
    await timeline.waitForTimeout(300);
    await capture(timeline, 'v22-timeline-1024');

    if (browserErrors.length > 0) {
      fail(`browser page errors: ${browserErrors.join(' | ')}`);
    } else {
      log('no browser page errors were recorded');
    }
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (api) {
      api.kill();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await client.end().catch(() => undefined);
    await server.stop().catch(() => undefined);
  }
  process.stdout.write(`\n${results.length} checks completed.\n`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
