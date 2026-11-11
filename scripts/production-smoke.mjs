#!/usr/bin/env node
/**
 * Production-artifact smoke test.
 *
 * Proves the *built* artifacts work, not `tsx` from source:
 *   1. `apps/api/dist/migrate.js` applies the reviewed SQL,
 *   2. `apps/api/dist/main.js` starts, answers liveness and readiness,
 *   3. the development fixture authenticates against a real session,
 *   4. an authorized read and an authorized mutation succeed through real HTTP,
 *   5. SIGTERM stops the process cleanly.
 *
 * The database is an isolated instance: TEST_DATABASE_URL when supplied (CI service container),
 * otherwise a temporary embedded PostgreSQL cluster that is destroyed afterwards. A missing
 * database is a failure, never a silent skip.
 */
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import pg from 'pg';

const root = process.cwd();
const localMode = process.argv.includes('--local');
const localPassword = 'Smoke-local-password-123';
const ADMIN_EMAIL = 'smoke-admin@example.co.jp';
const MEMBER_EMAIL = 'smoke-member@example.co.jp';
const MANAGER_EMAIL = 'smoke-manager@example.co.jp';
const VIEWER_EMAIL = 'smoke-viewer@example.co.jp';
/** Role fixtures the browser smoke signs in as; employee IDs are the local-mode login. */
const ROLE_FIXTURES = {
  manager: { email: MANAGER_EMAIL, employeeId: '0004' },
  member: { email: MEMBER_EMAIL, employeeId: '0002' },
  viewer: { email: VIEWER_EMAIL, employeeId: '0003' }
};

function log(message) {
  process.stdout.write(`${message}\n`);
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
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(' ')} failed (${code}):\n${output}`));
    });
  });
}

async function startEmbedded() {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  const moduleName = `@embedded-postgres/${platform}-${arch}`;
  let binaries;
  try {
    binaries = await import(moduleName);
  } catch {
    throw new Error(
      `No PostgreSQL available: set TEST_DATABASE_URL (preferred) or install ${moduleName}.`
    );
  }
  const directory = await mkdtemp(join(tmpdir(), 'eh-smoke-pg-'));
  const dataDir = join(directory, 'data');
  const logFile = join(directory, 'postgres.log');
  const port = await freePort();
  await run(binaries.initdb, ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'], process.env);
  await new Promise((resolve, reject) => {
    const child = spawn(
      binaries.pg_ctl,
      ['-D', dataDir, '-l', logFile, '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=on -c synchronous_commit=on`, 'start'],
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
      await client.query('CREATE DATABASE eh_smoke');
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
    url: `postgresql://postgres@127.0.0.1:${port}/eh_smoke`,
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

async function waitFor(url, timeoutMs = 30_000) {
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

async function seed(client) {
 await client.query("INSERT INTO members(member_id,name,email,role,active) VALUES('MEM-SMOKE','Smoke Admin',$1,'ADMIN',true) ON CONFLICT(email) DO UPDATE SET role='ADMIN',active=true",[ADMIN_EMAIL]);
 await client.query("INSERT INTO members(member_id,name,email,role,active) VALUES('MEM-SMOKE-MANAGER','Smoke Manager',$1,'MANAGER',true) ON CONFLICT(email) DO UPDATE SET role='MANAGER',active=true",[MANAGER_EMAIL]);
 await client.query("INSERT INTO members(member_id,name,email,role,active) VALUES('MEM-SMOKE-MEMBER','Smoke Member',$1,'MEMBER',true) ON CONFLICT(email) DO UPDATE SET role='MEMBER',active=true",[MEMBER_EMAIL]);
 await client.query("INSERT INTO members(member_id,name,email,role,active) VALUES('MEM-SMOKE-VIEWER','Smoke Viewer',$1,'VIEWER',true) ON CONFLICT(email) DO UPDATE SET role='VIEWER',active=true",[VIEWER_EMAIL]);
 if(localMode){
  const salt=randomBytes(16).toString('hex');
  const hash=await promisify(scrypt)(localPassword,salt,64,{N:131072,r:8,p:1,maxmem:160*1024*1024});
  const stored=['scrypt',salt,hash.toString('hex')].join('$');
  await client.query("INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES('MEM-SMOKE','0001',$1,false) ON CONFLICT(member_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,must_change_password=false",[stored]);
  await client.query("INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES('MEM-SMOKE-MANAGER','0004',$1,false) ON CONFLICT(member_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,must_change_password=false",[stored]);
  await client.query("INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES('MEM-SMOKE-MEMBER','0002',$1,false) ON CONFLICT(member_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,must_change_password=false",[stored]);
  await client.query("INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES('MEM-SMOKE-VIEWER','0003',$1,false) ON CONFLICT(member_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,must_change_password=false",[stored]);
 }
 await client.query("INSERT INTO responsibilities(responsibility_id,name,owner_member_id) VALUES('RSP-SMOKE','Smoke area','MEM-SMOKE') ON CONFLICT(responsibility_id) DO NOTHING");
 // A production artifact smoke run needs one explicit division: the schema seeds none, and a
 // project cannot be published or created without one.
 await client.query("INSERT INTO divisions(division_id,name,sort_order) VALUES('DIV-SMOKE','Smoke division',1) ON CONFLICT(division_id) DO NOTHING");
 await client.query("INSERT INTO member_divisions(relationship_id,member_id,division_id,access_kind,assigned_by) VALUES('MD-SMOKE-ADMIN','MEM-SMOKE','DIV-SMOKE','WORK','smoke') ON CONFLICT DO NOTHING");
 await client.query("INSERT INTO member_divisions(relationship_id,member_id,division_id,access_kind,assigned_by) VALUES('MD-SMOKE-MANAGER','MEM-SMOKE-MANAGER','DIV-SMOKE','WORK','smoke') ON CONFLICT DO NOTHING");
 await client.query("UPDATE responsibilities SET division_id='DIV-SMOKE' WHERE responsibility_id='RSP-SMOKE' AND division_id IS NULL");
}

async function main() {
  const buildTools = ['apps/api/dist/main.js', 'apps/api/dist/migrate.js'];
  for (const artifact of buildTools) {
    try {
      await readFile(join(root, artifact));
    } catch {
      throw new Error(`Missing ${artifact}. Run "npm run build" before the smoke test.`);
    }
  }

  const external = process.env.TEST_DATABASE_URL;
  const server = external ? null : await startEmbedded();
  let databaseUrl = external ?? server.url;
  let externalAdmin = null;
  const isolatedName = 'eh_smoke_' + Date.now();
  if(external){
    externalAdmin=new pg.Client({connectionString:external});await externalAdmin.connect();
    await externalAdmin.query('CREATE DATABASE '+isolatedName);
    const isolatedUrl=new URL(external);isolatedUrl.pathname='/'+isolatedName;databaseUrl=isolatedUrl.toString();
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  let api = null;
  let worker = null;
  try {
    await client.connect();
    log('PASS  isolated PostgreSQL is reachable');

    const migrateOutput = await run('node', ['apps/api/dist/migrate.js'], {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production'
    });
    log(`PASS  built migration CLI applied the schema (${migrateOutput.trim()})`);

    await seed(client);
    log('PASS  smoke fixture seeded');

    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    api = spawn('node', ['apps/api/dist/main.js'], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: localMode ? 'production' : 'development',
        APP_ENV: localMode ? 'PRODUCTION' : 'DEVELOPMENT',
        AUTH_MODE: localMode ? 'local' : 'google',
        ALLOW_INSECURE_LAN_HTTP: localMode ? 'true' : 'false',
        HOST: '127.0.0.1',
        PORT: String(port),
        DATABASE_URL: databaseUrl,
        MANAGER_WEB_ALLOWED_DOMAINS: 'example.co.jp',
        DEV_AUTH_ENABLED: localMode ? 'false' : 'true',
        DEV_AUTH_EMAILS: [ADMIN_EMAIL, MANAGER_EMAIL, MEMBER_EMAIL, VIEWER_EMAIL].join(','),
        PUBLIC_ORIGIN: origin,
        WEB_ROOT: join(root, 'apps', 'web', 'dist'),
        LOG_LEVEL: 'silent',
        RATE_LIMIT_MAX: '10000'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let apiError = '';
    api.stderr.on('data', (chunk) => {
      apiError += chunk.toString();
    });

    await waitFor(`${origin}/healthz`);
    log('PASS  built API answered /healthz');

    const ready = await (await fetch(`${origin}/readyz`)).json();
    if (ready?.data?.status !== 'ready') throw new Error(`/readyz was not ready: ${JSON.stringify(ready)}`);
    log(`PASS  built API answered /readyz (schema ${ready.data.schemaVersion})`);

    const sessionResponse = await fetch(`${origin}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(localMode ? {employeeId:'0001',password:localPassword} : { devEmail: ADMIN_EMAIL })
    });
    if (sessionResponse.status !== 200) {
      throw new Error(`session fixture failed (${sessionResponse.status}): ${await sessionResponse.text()}`);
    }
    const cookie = String(sessionResponse.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const session = await sessionResponse.json();
    const csrf = session.data.csrfToken;
    log('PASS  '+(localMode ? 'production local employee credentials' : 'development fixture')+' authenticated and issued a session');

    const overview = await fetch(`${origin}/api/manager/overview`, { headers: { cookie } });
    if (overview.status !== 200) throw new Error(`overview failed (${overview.status}): ${await overview.text()}`);
    log('PASS  authorized manager read succeeded');

    const created = await fetch(`${origin}/api/manager/projects`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf, origin },
      body: JSON.stringify({
        idempotencyKey: 'smoke-project-0001',
        projectName: 'Smoke project',
        divisionId: 'DIV-SMOKE',
        responsibilityId: 'RSP-SMOKE'
      })
    });
    if (created.status !== 200) throw new Error(`project mutation failed (${created.status}): ${await created.text()}`);
    const project = (await created.json()).data.project;
    log(`PASS  authorized mutation created ${project.projectId}`);

    const listed = await fetch(`${origin}/api/manager/projects?query=Smoke`, { headers: { cookie } });
    const listBody = await listed.json();
    const rows = listBody?.data?.items ?? listBody?.data?.projects ?? [];
    if (!Array.isArray(rows) || !rows.some((row) => row.projectId === project.projectId)) {
      throw new Error(`created project is not readable through the list: ${JSON.stringify(listBody).slice(0, 400)}`);
    }
    log('PASS  the created project is readable through the authorized list');

    worker = spawn('node', ['apps/worker/dist/main.js'], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATABASE_URL: databaseUrl, APP_ENV: 'DEVELOPMENT', SCHEDULE_ENABLED: 'false',
        WORKER_ID: 'smoke-worker', POLL_INTERVAL_MS: '1000', GOOGLE_SERVICE_ACCOUNT_JSON: '', GMAIL_SENDER: '', CALENDAR_ID: '' }
    });
    worker.stdout.resume(); worker.stderr.resume();
    await client.query("INSERT INTO outbox_jobs (kind, dedupe_key, payload) VALUES ('maintenance.sessions', 'smoke-maintenance', '{}') ON CONFLICT DO NOTHING");
    const workerDeadline = Date.now() + 20000;
    for (;;) {
      const result = await client.query("SELECT status FROM outbox_jobs WHERE dedupe_key = 'smoke-maintenance'");
      if (result.rows[0]?.status === 'DONE') break;
      if (Date.now() > workerDeadline || worker.exitCode !== null) throw new Error('Built worker did not complete its smoke job');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    log('PASS  built worker claimed and completed an outbox job');
    if (process.argv.includes('--browser')) {
      const { browserSmoke } = await import('./browser-smoke.mjs');
      await browserSmoke(origin, ADMIN_EMAIL, localMode ? {employeeId:'0001',password:localPassword} : null, {
        localMode,
        password: localPassword,
        roles: ROLE_FIXTURES
      });
    }


    const stopped = await new Promise((resolve) => {
      api.on('close', (code, signal) => resolve({ code, signal }));
      api.kill('SIGTERM');
      setTimeout(() => {
        api.kill('SIGKILL');
        resolve({ code: -1, signal: 'TIMEOUT' });
      }, 15_000).unref();
    });
    // Windows has no SIGTERM: Node terminates the child and reports a null code with the signal.
    // A POSIX host must exit with 0, which proves the shutdown handler ran.
    const clean =
      stopped.code === 0 || (process.platform === 'win32' && stopped.signal === 'SIGTERM');
    if (!clean) throw new Error(`API did not stop cleanly (${JSON.stringify(stopped)})\n${apiError}`);
    api = null;
    log('PASS  built API stopped on the shutdown signal');
    log('PRODUCTION SMOKE: PASS');
  } finally {
    if (api) api.kill('SIGKILL');
    if (worker) {
      await new Promise(resolve => { worker.once('close', resolve); worker.kill('SIGTERM'); });
    }
    await client.end().catch(() => undefined);
    if (server) await server.stop();
    if(externalAdmin){await externalAdmin.query('DROP DATABASE '+isolatedName+' WITH (FORCE)');await externalAdmin.end();}
  }
}

main().catch((error) => {
  fail(error.message);
});
