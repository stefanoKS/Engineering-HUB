#!/usr/bin/env node
/**
 * Local browser verification for the member-creation / shared-presentation / reopening release.
 *
 * It starts an isolated embedded PostgreSQL cluster, migrates, seeds a realistic fixture, starts
 * the built API (which also serves the built web), and drives real Chromium journeys as ADMIN,
 * MANAGER, MEMBER and VIEWER in Japanese and English. Evidence screenshots are written to
 * work/screenshots/. Nothing here touches a real deployment or operational data.
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

function log(message) {
  process.stdout.write(`${message}\n`);
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
    child.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(`${command} failed (${code}):\n${output}`))));
  });
}

async function startEmbedded() {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  const binaries = await import(`@embedded-postgres/${platform}-${arch}`);
  const directory = await mkdtemp(join(tmpdir(), 'eh-verify-pg-'));
  const dataDir = join(directory, 'data');
  const logFile = join(directory, 'postgres.log');
  const port = await freePort();
  await run(binaries.initdb, ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'], process.env);
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
        const child = spawn(binaries.pg_ctl, ['-D', dataDir, '-m', 'immediate', 'stop'], { stdio: 'ignore', windowsHide: true });
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
  date.setUTCDate(date.getUTCDate() + offset);
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
    `INSERT INTO responsibilities(responsibility_id,name,owner_member_id,color_hex) VALUES
      ('RSP-A','設計','MEM-MANAGER','#2563EB'),('RSP-B','製造','MEM-MANAGER','#0D9488')`
  );
  await client.query(
    `INSERT INTO projects(project_id,project_name,description,responsibility_id,project_owner_id,status,priority,
                          planned_start,committed_deadline,dashboard_visibility,next_action)
     VALUES
      ('PRJ-1','新規筐体の設計','車載バッテリー筐体の設計','RSP-A','MEM-MANAGER','Active','High',$1,$2,'INTERNAL','試作評価の準備'),
      ('PRJ-2','製造ライン改善','組立ラインの段取り改善','RSP-B','MEM-MANAGER','Active','Medium',$1,$2,'INTERNAL',''),
      ('PRJ-R','機密案件','社外秘の検討','RSP-A','MEM-MANAGER','Active','Medium',$1,$2,'RESTRICTED','')`,
    [day(-10), day(14)]
  );
  await client.query(
    `INSERT INTO subprojects(subproject_id,project_id,subproject_name,owner_id,status,deadline)
     VALUES('SUB-1','PRJ-1','試作評価','MEM-MANAGER','Active',$1)`,
    [day(10)]
  );
  await client.query(
    `INSERT INTO tasks(task_id,project_id,subproject_id,task_name,status,priority,owner_member_id,due_date,progress_percent,completed_at)
     VALUES
      ('TSK-OPEN','PRJ-1','SUB-1','試作図の作成','In Progress','High','MEM-MEMBER',$1,20,null),
      ('TSK-LATE','PRJ-1','SUB-1','材料手配','In Progress','Medium','MEM-MEMBER',$2,40,null),
      ('TSK-DIRECT','PRJ-1',null,'見積の確認','Not Started','Low','MEM-MEMBER',$1,0,null),
      ('TSK-DONE','PRJ-1',null,'仕様の確定','Done','Medium','MEM-MEMBER',$2,100,now()),
      ('TSK-B','PRJ-2',null,'段取り手順書','In Progress','Medium','MEM-MEMBER',$1,10,null)`,
    [day(5), day(-3)]
  );
  await client.query(
    `INSERT INTO task_requests(request_id,request_type,task_id,project_id,requester_name,status,
                               task_revision_at_submission,due_date_at_submission,snapshot_version,
                               requester_member_id,decided_at,accepted_completion_at,completion_note)
     VALUES('REQ-HISTORY','COMPLETION_REPORT','TSK-DONE','PRJ-1','佐藤 一郎','APPROVED','1',$1,'1',
            'MEM-MEMBER', now(), now(), '仕様を確定しました')`,
    [day(-3)]
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
    await run('node', ['apps/api/dist/migrate.js'], { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'production' });
    await seed(client);
    log('PASS  isolated database migrated and seeded (4 roles, 3 projects, 5 tasks)');

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
    const toEnglish = async (page) => {
      await page.getByRole('button', { name: 'English', exact: true }).click();
    };
    const toJapanese = async (page) => {
      await page.getByRole('button', { name: '日本語', exact: true }).click();
    };

    /* ---------------------------------------------------------------- MEMBER */
    const member = await newPage();
    await signIn(member, '0002');
    log('PASS  MEMBER signed in with local credentials');

    // The member overview is the shared presentation, not a wall of task cards.
    await member.locator('.app-nav').getByRole('link', { name: '概要', exact: true }).click();
    await expect(member.getByText('社内公開プロジェクトのうち、閲覧が許可された範囲の集計です。')).toBeVisible();
    await expect(member.getByRole('button', { name: /未完了の作業: \d+/ })).toBeVisible();
    await expect(member.getByRole('heading', { name: '分野', exact: true })).toBeVisible();
    await expect(member.getByRole('heading', { name: '自分の担当タスク', exact: true })).toBeVisible();
    await expect(member.getByRole('link', { name: '機密案件', exact: true })).toHaveCount(0);
    await capture(member, 'member-overview-ja');
    await toEnglish(member);
    await expect(member.getByText('Counts cover only the internal projects you may read; they are not organization-wide totals.')).toBeVisible();
    await capture(member, 'member-overview-en');
    await toJapanese(member);
    log('PASS  MEMBER overview shares the KPI, responsibility and work sections in both languages');

    // Projects: the same table, plus a member-only creation control.
    await member.locator('.app-nav').getByRole('link', { name: 'プロジェクト', exact: true }).click();
    await expect(member.getByRole('heading', { name: 'プロジェクト', exact: true })).toBeVisible();
    await expect(member.getByRole('columnheader', { name: /名称/ })).toBeVisible();
    await expect(member.getByRole('button', { name: '新規プロジェクト', exact: true })).toBeVisible();
    await expect(member.getByRole('link', { name: '機密案件', exact: true })).toHaveCount(0);
    await expect(member.getByRole('button', { name: '編集', exact: true })).toHaveCount(0);
    await capture(member, 'member-projects-ja');

    await member.getByRole('button', { name: '新規プロジェクト', exact: true }).click();
    const projectDialog = member.locator('dialog.modal');
    await expect(projectDialog).toBeVisible();
    await expect(projectDialog.getByLabel('プロジェクト名')).toBeFocused();
    await expect(projectDialog.getByText(/あなたになります/)).toBeVisible();
    /* A native modal correctly makes the background inert, so the language switch is only
       reachable outside it: the Japanese dialog is captured before submitting. */
    await capture(member, 'member-project-dialog-ja');
    await projectDialog.getByLabel('プロジェクト名').fill('ブラウザ検証プロジェクト');
    await projectDialog.getByLabel('分野').selectOption({ label: '設計' });
    await projectDialog.getByLabel('終了日').fill(day(30));
    await projectDialog.getByRole('button', { name: 'プロジェクトを作成', exact: true }).click();
    await expect(member.getByText(/プロジェクト「ブラウザ検証プロジェクト」を作成しました/)).toBeVisible({ timeout: 20000 });
    await expect(member.getByRole('link', { name: 'ブラウザ検証プロジェクト', exact: true })).toBeVisible();
    await capture(member, 'member-project-created-ja');
    log('PASS  MEMBER created a project from the shared table through the dialog');

    // Project detail: contextual creation with the destination shown.
    await member.getByRole('link', { name: '新規筐体の設計', exact: true }).click();
    await expect(member.getByRole('heading', { name: /新規筐体の設計/ })).toBeVisible();
    await expect(member.getByRole('button', { name: '編集', exact: true })).toHaveCount(0);
    const subprojectRow = member.locator('li', { hasText: '試作評価' }).first();
    await subprojectRow.getByRole('button', { name: '新規タスク', exact: true }).first().click();
    const taskDialog = member.locator('dialog.modal');
    await expect(taskDialog).toBeVisible();
    await expect(taskDialog.getByText('作成先: 新規筐体の設計 / 試作評価')).toBeVisible();
    await expect(taskDialog.getByLabel('タスク名')).toBeFocused();
    await capture(member, 'member-task-dialog-ja');
    await member.keyboard.press('Escape');
    await expect(taskDialog).toHaveCount(0);
    log('PASS  MEMBER opened the contextual task dialog with its destination and closed it with Escape');

    // My Work: request dialogs, never on finished work.
    await member.locator('.app-nav').getByRole('link', { name: '自分の担当タスク', exact: true }).click();
    await expect(member.getByText('試作図の作成', { exact: true })).toBeVisible();
    await expect(member.getByText('完了・取消済みのため申請できません。')).toHaveCount(0);
    const openRow = member.locator('.my-work-row', { hasText: '試作図の作成' });
    await openRow.getByRole('button', { name: '完了報告', exact: true }).click();
    const reportDialog = member.locator('dialog.modal');
    await expect(reportDialog).toBeVisible();
    await expect(reportDialog.getByText('試作図の作成', { exact: true })).toBeVisible();
    await expect(reportDialog.getByText('新規筐体の設計', { exact: true })).toBeVisible();
    await capture(member, 'member-completion-dialog-ja');
    await reportDialog.getByLabel('完了メモ（任意）').fill('図面を更新し、上司の確認を得ました。');
    await reportDialog.getByRole('button', { name: '申請を送信', exact: true }).click();
    await expect(member.getByText(/受付完了/)).toBeVisible({ timeout: 20000 });
    await expect(member.locator('dialog.modal')).toHaveCount(0);
    await capture(member, 'member-completion-received-ja');
    log('PASS  MEMBER filed a completion report from a modal dialog and saw the durable receipt');

    const lateRow = member.locator('.my-work-row', { hasText: '材料手配' });
    await lateRow.getByRole('button', { name: '納期変更を申請', exact: true }).click();
    const extensionDialog = member.locator('dialog.modal');
    await expect(extensionDialog).toBeVisible();
    await expect(extensionDialog.getByText('希望期限', { exact: true })).toBeVisible();
    await capture(member, 'member-extension-dialog-ja');
    await member.setViewportSize({ width: 390, height: 844 });
    await expect(extensionDialog.getByLabel('希望期限')).toBeVisible();
    expect(await member.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await capture(member, 'member-extension-dialog-mobile-ja');
    await member.setViewportSize({ width: 1440, height: 1000 });
    await member.keyboard.press('Escape');
    await expect(member.locator('dialog.modal')).toHaveCount(0);
    log('PASS  MEMBER opened the extension dialog, including on a narrow viewport, and escaped it cleanly');

    /* ---------------------------------------------------------------- VIEWER */
    const viewer = await newPage();
    await signIn(viewer, '0003');
    await viewer.locator('.app-nav').getByRole('link', { name: 'プロジェクト', exact: true }).click();
    await expect(viewer.getByRole('heading', { name: 'プロジェクト', exact: true })).toBeVisible();
    await expect(viewer.getByRole('button', { name: '新規プロジェクト', exact: true })).toHaveCount(0);
    await viewer.getByRole('link', { name: '新規筐体の設計', exact: true }).click();
    await expect(viewer.getByRole('heading', { name: /新規筐体の設計/ })).toBeVisible();
    await expect(viewer.getByRole('button', { name: '新規タスク', exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: '新規サブプロジェクト', exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: '編集', exact: true })).toHaveCount(0);
    await capture(viewer, 'viewer-project-detail-ja');
    log('PASS  VIEWER sees the shared presentation with no creation, edit or delete control');

    /* ---------------------------------------------------------------- MANAGER */
    const manager = await newPage();
    await signIn(manager, '0004');
    await manager.locator('.app-nav').getByRole('link', { name: 'プロジェクト', exact: true }).click();
    await expect(manager.getByRole('table')).toBeVisible();
    await expect(manager.getByRole('button', { name: '編集', exact: true }).first()).toBeVisible();
    await capture(manager, 'manager-projects-ja');
    await manager.getByRole('link', { name: '仕様の確定', exact: true }).click().catch(async () => {
      // The task is reached through its project when the list does not show completed work.
      await manager.goto(`${origin}/#/project/PRJ-1`);
      await manager.getByRole('link', { name: '仕様の確定', exact: true }).click();
    });
    await expect(manager.getByRole('heading', { name: '仕様の確定', exact: true })).toBeVisible();
    await expect(manager.getByRole('button', { name: '完了を取り消す', exact: true })).toHaveCount(0);
    await capture(manager, 'manager-task-detail-ja');
    log('PASS  MANAGER keeps management actions and never receives the ADMIN reopening action');

    /* ---------------------------------------------------------------- ADMIN */
    const admin = await newPage();
    await signIn(admin, '0001');
    await admin.goto(`${origin}/#/task/TSK-DONE`);
    await expect(admin.getByRole('heading', { name: '仕様の確定', exact: true })).toBeVisible();
    await expect(admin.getByRole('button', { name: '完了を取り消す', exact: true })).toBeVisible();
    await capture(admin, 'admin-task-completed-ja');
    await admin.getByRole('button', { name: '完了を取り消す', exact: true }).click();
    const reopenDialog = admin.locator('dialog.modal');
    await expect(reopenDialog).toBeVisible();
    await expect(reopenDialog.getByText(/過去の申請・承認・監査の記録は変更せずに保持されます/)).toBeVisible();
    await expect(reopenDialog.getByText(/進行中・進捗 0%/)).toBeVisible();
    await expect(reopenDialog.getByText(/REQ-HISTORY|完了日時/).first()).toBeVisible();
    await capture(admin, 'admin-reopen-dialog-ja');
    await reopenDialog.getByLabel(/REOPEN TSK-DONE/).fill('REOPEN TSK-DONE');
    await reopenDialog.getByRole('textbox').first().fill('誤って完了にしたため取り消します');
    await reopenDialog.getByRole('button', { name: '確認', exact: true }).click();
    await expect(admin.getByText(/完了を取り消しました/)).toBeVisible({ timeout: 20000 });
    await expect(admin.getByRole('button', { name: '完了を取り消す', exact: true })).toHaveCount(0);
    await capture(admin, 'admin-task-reopened-ja');
    log('PASS  ADMIN reopened a completed task through the confirmed dialog');

    const auditRow = await client.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'TASK_REOPENED' AND entity_id = 'TSK-DONE'");
    if (auditRow.rows[0].count !== 1) throw new Error('TASK_REOPENED audit row missing');
    const taskRow = await client.query("SELECT status, progress_percent, completed_at FROM tasks WHERE task_id = 'TSK-DONE'");
    if (taskRow.rows[0].status !== 'In Progress' || Number(taskRow.rows[0].progress_percent) !== 0 || taskRow.rows[0].completed_at !== null) {
      throw new Error(`Unexpected reopened state: ${JSON.stringify(taskRow.rows[0])}`);
    }
    const history = await client.query("SELECT status FROM task_requests WHERE request_id = 'REQ-HISTORY'");
    if (history.rows[0].status !== 'APPROVED') throw new Error('The original approval was not preserved');
    log('PASS  the reopened state, the corrective audit row and the preserved approval were verified in the database');

    await browser.close();
    if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(' | ')}`);
    log('BROWSER VERIFICATION: PASS');
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (api) {
      await new Promise((resolve) => {
        api.once('close', resolve);
        api.kill('SIGTERM');
        setTimeout(resolve, 8000);
      });
    }
    await client.end().catch(() => undefined);
    await server.stop();
  }
}

main().catch((error) => {
  fail(error.stack ?? error.message);
});
