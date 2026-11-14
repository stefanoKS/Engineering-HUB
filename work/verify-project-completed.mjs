#!/usr/bin/env node
/**
 * Local browser verification for the active/completed project structure.
 *
 * Starts an isolated embedded PostgreSQL cluster, migrates, seeds one realistic project with
 * mixed unfinished, completed, cancelled and container work, serves the built API/web, and drives
 * real Chromium as an ADMIN and a MEMBER. Nothing here touches a deployment or operational data.
 * Screenshots are written to work/screenshots/.
 */
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import pg from 'pg';
import { chromium, expect } from '@playwright/test';

const root = process.cwd();
const password = 'Verify-local-password-123';
const shots = join(root, 'work', 'screenshots');
const results = [];
const failures = [];

function log(message) {
  process.stdout.write(`${message}\n`);
  results.push(message);
}

function recordFailure(message) {
  process.stderr.write(`FAIL: ${message}\n`);
  failures.push(message);
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
  const directory = await mkdtemp(join(tmpdir(), 'eh-project-completed-pg-'));
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
  const deadline = Date.now() + 60000;
  for (;;) {
    const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
    try {
      await client.connect();
      await client.query('CREATE DATABASE eh_verify');
      await client.end();
      break;
    } catch (error) {
      await client.end().catch(() => undefined);
      if (Date.now() > deadline) {
        const log = await readFile(logFile, 'utf8').catch(() => '');
        throw new Error(`PostgreSQL did not become ready: ${error.message}\n${log.slice(-800)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return {
    url: `postgresql://postgres@127.0.0.1:${port}/eh_verify`,
    stop: async () => {
      await new Promise((resolve) => {
        const child = spawn(binaries.pg_ctl, ['-D', dataDir, '-m', 'immediate', 'stop'], {
          stdio: 'ignore',
          windowsHide: true
        });
        child.on('close', resolve);
        child.on('error', resolve);
      });
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  };
}

async function waitFor(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function day(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function seed(client) {
  const salt = randomBytes(16).toString('hex');
  const hash = await promisify(scrypt)(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 });
  const stored = ['scrypt', salt, hash.toString('hex')].join('$');
  await client.query(
    `INSERT INTO members(member_id,name,role) VALUES
      ('MEM-ADMIN','管理 太郎','ADMIN'),('MEM-MANAGER','管理 花子','MANAGER'),
      ('MEM-MEMBER','佐藤 一郎','MEMBER'),('MEM-VIEW','閲覧 次郎','VIEWER')`
  );
  await client.query(
    `INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES
      ('MEM-ADMIN','0001',$1,false),('MEM-MANAGER','0004',$1,false),
      ('MEM-MEMBER','0002',$1,false),('MEM-VIEW','0003',$1,false)`,
    [stored]
  );
  await client.query(
    `INSERT INTO divisions(division_id,name,status,sort_order,revision)
     VALUES ('DIV-A','設計・開発課','Active',1,1)`
  );
  await client.query(
    `INSERT INTO member_divisions(relationship_id,member_id,division_id,access_kind) VALUES
      ('MD-1','MEM-ADMIN','DIV-A','WORK'),('MD-2','MEM-MANAGER','DIV-A','WORK'),
      ('MD-3','MEM-MEMBER','DIV-A','WORK'),('MD-4','MEM-VIEW','DIV-A','READ')`
  );
  await client.query(
    `INSERT INTO responsibilities(responsibility_id,name,owner_member_id,color_hex,division_id) VALUES
      ('RSP-A','設計','MEM-MANAGER','#2563EB','DIV-A')`
  );
  await client.query(
    `INSERT INTO projects(project_id,project_name,description,responsibility_id,project_owner_id,status,priority,
                          planned_start,committed_deadline,dashboard_visibility,next_action,division_id)
     VALUES
      ('PRJ-1','新規筐体の設計','車載バッテリー筐体の設計','RSP-A','MEM-MANAGER','Active','High',$1,$2,'INTERNAL','試作評価の準備','DIV-A')`,
    [day(-10), day(14)]
  );
  await client.query(
    `INSERT INTO subprojects(subproject_id,project_id,subproject_name,owner_id,status,deadline)
     VALUES('SUB-1','PRJ-1','試作評価','MEM-MANAGER','Active',$1)`,
    [day(10)]
  );
  await client.query(
    `INSERT INTO tasks(task_id,project_id,subproject_id,parent_task_id,task_name,status,priority,owner_member_id,
                       due_date,progress_percent,completed_at)
     VALUES
      ('TSK-OPEN','PRJ-1','SUB-1',null,'試作図の作成','In Progress','High','MEM-MEMBER',$1,20,null),
      ('TSK-SUB-DONE','PRJ-1','SUB-1',null,'試作図の承認','Done','Medium','MEM-MEMBER',$2,100,now()),
      ('TSK-CANCEL','PRJ-1','SUB-1',null,'取消タスク','Cancelled','Low','MEM-MEMBER',$1,0,null),
      ('TSK-DIRECT-OPEN','PRJ-1',null,null,'見積の確認','Not Started','Low','MEM-MEMBER',$1,0,null),
      ('TSK-DIRECT-DONE','PRJ-1',null,null,'仕様の確定','Done','Medium','MEM-MEMBER',$2,100,now()),
      ('TSK-CONTAINER','PRJ-1',null,null,'コンテナ作業','Done','Medium','MEM-MEMBER',$1,50,null),
      ('TSK-C1','PRJ-1',null,'TSK-CONTAINER','コンテナ子タスク進行中','In Progress','Medium','MEM-MEMBER',$1,20,null),
      ('TSK-C2','PRJ-1',null,'TSK-CONTAINER','コンテナ子タスク完了','Done','Medium','MEM-MEMBER',$2,100,now())`,
    [day(5), day(-3)]
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
  const browserErrors = [];
  try {
    await client.connect();
    await run('node', ['apps/api/dist/migrate.js'], {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production'
    });
    await seed(client);
    log('PASS  isolated database migrated and seeded (4 roles, one project, 8 tasks)');

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
    log('PASS  built API and built web are served');

    browser = await chromium.launch({ headless: true });
    const newPage = async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
      await expect(page.locator('.app-nav')).toBeVisible({ timeout: 20000 });
    };
    const capture = async (page, name) => {
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
    };

    /* ---------------------------------------------------------------- MEMBER */
    const member = await newPage();
    await signIn(member, '0002');
    await member.goto(`${origin}/#/project/PRJ-1`);
    await expect(member.getByRole('heading', { name: /新規筐体の設計/ })).toBeVisible();
    await expect(member.getByText('試作図の作成', { exact: true })).toBeVisible();
    await expect(member.getByText('見積の確認', { exact: true })).toBeVisible();
    // Completed leaf work is not interleaved with the active structure.
    await expect(member.getByText('仕様の確定', { exact: true })).toHaveCount(0);
    await expect(member.getByText('試作図の承認', { exact: true })).toHaveCount(0);
    const completedToggle = member.getByRole('button', { name: '完了したタスク (3)', exact: true });
    await expect(completedToggle).toBeVisible();
    await expect(completedToggle).toHaveAttribute('aria-expanded', 'false');
    await capture(member, 'project-completed-active-ja-1440');
    log('PASS  active structure keeps unfinished work and hides completed work by default');

    // The subproject completed count opens the section and reveals that subproject's group.
    await member.getByRole('button', { name: '試作評価 の完了タスク 1 件を表示', exact: true }).click();
    await expect(completedToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(member.locator('#completed-group-sub\\:SUB-1')).toBeVisible();
    await expect(member.locator('#completed-group-direct')).toBeVisible();
    await expect(member.getByText('仕様の確定', { exact: true })).toBeVisible();
    await expect(member.getByText('試作図の承認', { exact: true })).toBeVisible();
    // A container is context in both presentations and is never counted as work.
    await expect(member.getByText('コンテナ作業', { exact: true })).toHaveCount(2);
    await capture(member, 'project-completed-expanded-ja-1440');
    log('PASS  completed section opens from the subproject count and groups by original subproject');

    // Task search finds hidden completed work and offers an explicit Show action. The disclosure
    // is collapsed first, so the collapsed-state hint is exercised.
    await completedToggle.click();
    await expect(completedToggle).toHaveAttribute('aria-expanded', 'false');
    await member.getByRole('searchbox', { name: 'タスク名で検索', exact: true }).fill('仕様');
    await expect(
      member.getByRole('button', { name: '完了したタスク（一致 1 / 全 3）', exact: true })
    ).toBeVisible();
    await expect(member.locator('.hierarchy-completed-hint')).toContainText(
      '完了したタスクに 1 件一致しています。'
    );
    await expect(member.getByText(/一致 1 件（進行中 0 · 完了 1）\/ 全体 6 件/)).toBeVisible();
    await member.getByRole('button', { name: '表示', exact: true }).click();
    await expect(member.getByText('仕様の確定', { exact: true })).toBeVisible();
    await expect(member.getByText('試作図の承認', { exact: true })).toHaveCount(0);
    await capture(member, 'project-completed-search-ja-1440');
    log('PASS  search finds hidden completed work, reports matches vs total and reveals on request');

    await member.getByRole('button', { name: '絞り込みを解除', exact: true }).first().click();
    await expect(member.getByRole('searchbox', { name: 'タスク名で検索', exact: true })).toHaveValue('');
    await member.getByRole('button', { name: 'English', exact: true }).click();
    await expect(member.getByRole('button', { name: 'Completed tasks (3)', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(member.getByRole('columnheader', { name: 'Task', exact: true }).first()).toBeVisible();
    await capture(member, 'project-completed-en-1440');
    await member.getByRole('button', { name: '日本語', exact: true }).click();
    log('PASS  language switch keeps the disclosure and the visible structure');

    // Wide and narrow layouts: no horizontal overflow and no clipped menu.
    await member.setViewportSize({ width: 390, height: 844 });
    await expect(member.getByRole('button', { name: '完了したタスク (3)', exact: true })).toBeVisible();
    const narrowOverflow = await member.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    if (narrowOverflow) recordFailure('narrow project structure overflows horizontally');
    const wideOverflow = await member
      .locator('.hierarchy-table')
      .first()
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    if (wideOverflow > 1) recordFailure(`hierarchy table overflows its container (${wideOverflow}px)`);
    const filterGap = await member.evaluate(() => {
      const search = document.querySelector('.hierarchy-filters .search-field');
      const assignee = document.querySelector('.hierarchy-assignee-filter');
      return Math.round(assignee.getBoundingClientRect().top - search.getBoundingClientRect().bottom);
    });
    if (filterGap > 40) recordFailure(`narrow filters leave a ${filterGap}px vertical gap`);
    await capture(member, 'project-completed-narrow-ja-390');
    await member.setViewportSize({ width: 1440, height: 1000 });
    log('PASS  1440 and 390 px layouts have no horizontal overflow');

    /* ---------------------------------------------------------------- ADMIN */
    const admin = await newPage();
    await signIn(admin, '0001');
    await admin.goto(`${origin}/#/project/PRJ-1`);
    await expect(admin.getByRole('heading', { name: /新規筐体の設計/ })).toBeVisible();
    const subprojectRow = admin.locator('.hierarchy-group-row').filter({ hasText: '試作評価' });
    await subprojectRow.getByRole('button', { name: '試作評価 の操作', exact: true }).click();
    await expect(admin.getByRole('menuitem', { name: '編集', exact: true })).toBeVisible();
    await expect(admin.getByRole('menuitem', { name: '一覧から削除', exact: true })).toBeVisible();
    await capture(admin, 'project-completed-menu-ja-1440');
    await admin.keyboard.press('Escape');
    await admin.getByRole('checkbox', { name: '取消・アーカイブを表示', exact: true }).check();
    await expect(admin.getByText('取消タスク', { exact: true })).toBeVisible();
    // Cancelled work is not completed work, even when it is shown.
    await expect(admin.getByRole('button', { name: '完了したタスク (3)', exact: true })).toBeVisible();
    await capture(admin, 'project-completed-inactive-ja-1440');
    log('PASS  ADMIN row menu and cancelled-work control behave as before');

    if (browserErrors.length) {
      recordFailure(`browser page errors: ${browserErrors.join(' | ')}`);
    }
    if (!failures.length) {
      log('PASS  no browser page errors');
    }
  } catch (error) {
    recordFailure(error instanceof Error ? error.message : String(error));
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (api) api.kill();
    await client.end().catch(() => undefined);
    await server.stop();
  }
  process.stdout.write(`\n${results.join('\n')}\n`);
  if (failures.length) {
    process.stderr.write(`\n${failures.length} check(s) failed.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('\nAll local browser checks passed.\n');
  }
}

await main();
