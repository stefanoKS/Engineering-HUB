/**
 * Real PostgreSQL test server.
 *
 * The integration tests run against a genuine PostgreSQL 18 instance started from the binaries
 * that the test dependency ships, because mocks cannot prove locking, constraints or triggers.
 * When the binaries are unavailable the suite reports the tests as skipped instead of passing.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

export type TestServer = {
  url: string;
  binDir: string;
  database: string;
  stop: () => Promise<void>;
};

function platformPackage(): string {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  return `@embedded-postgres/${platform}-${arch}`;
}

function freePort(): Promise<number> {
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

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${code}): ${output.slice(0, 1500)}`));
    });
  });
}

/**
 * Starts pg_ctl without pipes. On Windows the forked server process inherits the parent's
 * stdio handles, so a piped spawn never sees `close` even though PostgreSQL is already up.
 */
function runDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${code})`));
    });
  });
}

async function waitForServer(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'not started';
  while (Date.now() < deadline) {
    const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      lastError = (error as Error).message;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`PostgreSQL did not become ready: ${lastError}`);
}

export async function startEmbeddedPostgres(database = 'eh_test'): Promise<TestServer> {
  const moduleName = platformPackage();
  let binaries: { initdb: string; pg_ctl: string };
  try {
    binaries = (await import(moduleName)) as { initdb: string; pg_ctl: string };
  } catch {
    throw new Error(`EMBEDDED_POSTGRES_UNAVAILABLE: ${moduleName}`);
  }
  const binDir = join(binaries.initdb, '..');
  const directory = await mkdtemp(join(tmpdir(), 'eh-pg-'));
  const dataDir = join(directory, 'data');
  const logFile = join(directory, 'postgres.log');
  const port = await freePort();

  await run(binaries.initdb, ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  await runDetached(binaries.pg_ctl, [
    '-D',
    dataDir,
    '-l',
    logFile,
    '-o',
    `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=on -c synchronous_commit=on`,
    'start'
  ]);
  await waitForServer(port);

  const admin = new pg.Client({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    database: 'postgres'
  });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${database}`);
  } finally {
    await admin.end();
  }

  const url = `postgresql://postgres@127.0.0.1:${port}/${database}`;
  return {
    url,
    binDir,
    database,
    stop: async () => {
      try {
        await runDetached(binaries.pg_ctl, ['-D', dataDir, '-m', 'immediate', 'stop']);
      } catch {
        const log = await readFile(logFile, 'utf8').catch(() => '');
        process.stderr.write(`embedded postgres did not stop cleanly: ${log.slice(-800)}\n`);
      }
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  };
}
