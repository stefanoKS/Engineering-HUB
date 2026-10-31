/**
 * Local measurement harness.
 *
 * Seeds three PostgreSQL datasets through the real schema (triggers included), then calls the
 * real API routes in-process with `app.inject`. It reports p50/p95/p99 latency, database calls
 * per request and response bytes. It reports nothing that could identify a record: the numbers
 * are timings, counts and sizes only.
 *
 *   npm run benchmark
 *   npm run benchmark -- --dataset medium --iterations 30
 *
 * This is a local measurement, not a claim about production latency.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { cpus, totalmem, platform, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { createPool, Database, runMigrations } from '@eh/db';
import { startEmbeddedPostgres, type TestServer } from '../../../packages/db/test/support/server';
import { buildApp } from '../../../apps/api/src/app';
import { loadConfig } from '../../../apps/api/src/config';
import { NullInboxSource } from '../../../apps/api/src/inbox';
import { seed } from './seed';

type DatasetSize = 'small' | 'medium' | 'large';

const SIZES: Record<DatasetSize, { projects: number; members: number }> = {
  small: { projects: 20, members: 20 },
  medium: { projects: 200, members: 50 },
  large: { projects: 1000, members: 120 }
};

const ADMIN = 'bench-admin@example.co.jp';
const MEMBER = 'bench-member-2@example.co.jp';

type Sample = { ms: number; dbCalls: number; bytes: number };

type EndpointResult = {
  name: string;
  method: string;
  url: string;
  coldMs: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  dbCalls: number;
  bytes: number;
};

type DatasetResult = {
  dataset: DatasetSize;
  rows: { projects: number; tasks: number; members: number };
  endpoints: EndpointResult[];
};

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function signIn(app: FastifyInstance, email: string): Promise<{ cookie: string; csrf: string }> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { devEmail: email } });
  if (response.statusCode !== 200) {
    throw new Error(`Sign-in for a benchmark member failed: ${response.statusCode} ${response.body.slice(0, 300)}`);
  }
  const cookie = String(response.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const body = response.json() as { data: { csrfToken: string } };
  return { cookie, csrf: body.data.csrfToken };
}

async function measure(
  app: FastifyInstance,
  auth: { cookie: string; csrf: string },
  endpoint: { name: string; method: 'GET' | 'POST'; url: string; payload?: () => unknown },
  iterations: number
): Promise<EndpointResult> {
  const headers: Record<string, string> = { cookie: auth.cookie };
  const run = async (payload?: unknown): Promise<Sample> => {
    const started = performance.now();
    const response = await app.inject({
      method: endpoint.method,
      url: endpoint.url,
      headers: endpoint.method === 'POST' ? { ...headers, 'x-csrf-token': auth.csrf } : headers,
      payload: payload as never
    });
    const ms = performance.now() - started;
    if (response.statusCode >= 400) {
      throw new Error(`${endpoint.name} failed: ${response.statusCode} ${response.body.slice(0, 300)}`);
    }
    let dbCalls = 0;
    try {
      dbCalls = Number((response.json() as { meta?: { dbCalls?: number } }).meta?.dbCalls ?? 0);
    } catch {
      dbCalls = 0;
    }
    return { ms, dbCalls, bytes: Buffer.byteLength(response.body) };
  };

  const cold = await run(endpoint.payload?.());
  const samples: Sample[] = [];
  for (let index = 0; index < iterations; index += 1) {
    samples.push(await run(endpoint.payload?.()));
  }
  const sorted = samples.map((sample) => sample.ms).sort((left, right) => left - right);
  return {
    name: endpoint.name,
    method: endpoint.method,
    url: endpoint.url.replace(/\?.*$/, ''),
    coldMs: round(cold.ms),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1] ?? 0),
    dbCalls: Math.max(...samples.map((sample) => sample.dbCalls)),
    bytes: Math.max(...samples.map((sample) => sample.bytes))
  };
}

async function measureDataset(
  server: TestServer,
  database: string,
  size: DatasetSize,
  iterations: number
): Promise<DatasetResult> {
  const url = new URL(server.url);
  url.pathname = `/${database}`;
  const admin = createPool({ connectionString: server.url.replace(/\/[^/]+$/, '/postgres'), max: 2 });
  await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();

  const pool = createPool({ connectionString: url.toString(), max: 10, applicationName: 'eh-benchmark' });
  await runMigrations(pool);
  const rows = await seed(pool, SIZES[size]);
  const db = new Database(pool);

  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'DEVELOPMENT',
    DATABASE_URL: url.toString(),
    MANAGER_WEB_ALLOWED_DOMAINS: 'example.co.jp',
    DEV_AUTH_ENABLED: 'true',
    DEV_AUTH_EMAILS: `${ADMIN},${MEMBER}`,
    PUBLIC_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent'
  });
  const app = await buildApp({ config, db, inbox: new NullInboxSource(), logger: false });
  await app.ready();

  const adminAuth = await signIn(app, ADMIN);
  const memberAuth = await signIn(app, MEMBER);
  let writeCounter = 0;

  const endpoints: { name: string; method: 'GET' | 'POST'; url: string; auth: { cookie: string; csrf: string }; payload?: () => unknown }[] = [
    { name: 'overview', method: 'GET', url: '/api/manager/overview', auth: adminAuth },
    { name: 'projects page (50)', method: 'GET', url: '/api/manager/projects?pageSize=50', auth: adminAuth },
    { name: 'tasks page (50)', method: 'GET', url: '/api/manager/tasks?pageSize=50', auth: adminAuth },
    { name: 'task detail', method: 'GET', url: '/api/manager/tasks/T-0000001', auth: adminAuth },
    { name: 'references', method: 'GET', url: '/api/manager/references', auth: adminAuth },
    { name: 'requests', method: 'GET', url: '/api/manager/requests', auth: adminAuth },
    { name: 'workload', method: 'GET', url: '/api/manager/reports/workload', auth: adminAuth },
    { name: 'status', method: 'GET', url: '/api/manager/status', auth: adminAuth },
    { name: 'employee snapshot', method: 'GET', url: '/api/employee/snapshot', auth: memberAuth },
    {
      name: 'task create (write)',
      method: 'POST',
      url: '/api/manager/tasks',
      auth: adminAuth,
      payload: () => {
        writeCounter += 1;
        return {
          idempotencyKey: `bench-${size}-${writeCounter}-0001`,
          projectId: 'P-000001',
          taskName: `Benchmark task ${writeCounter}`,
          deadline: new Date(Date.now() + 86_400_000 * 7).toISOString().slice(0, 10)
        };
      }
    }
  ];

  const results: EndpointResult[] = [];
  for (const endpoint of endpoints) {
    results.push(await measure(app, endpoint.auth, endpoint, iterations));
  }

  await app.close();
  await db.close();
  return { dataset: size, rows, endpoints: results };
}

function printTable(results: DatasetResult[]): void {
  process.stdout.write(
    '| Dataset | Endpoint | p50 ms | p95 ms | p99 ms | max ms | cold ms | db calls | bytes |\n'
  );
  process.stdout.write('| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n');
  for (const result of results) {
    for (const endpoint of result.endpoints) {
      process.stdout.write(
        `| ${result.dataset} | ${endpoint.method} ${endpoint.url} | ${endpoint.p50} | ${endpoint.p95} | ${endpoint.p99} | ${endpoint.max} | ${endpoint.coldMs} | ${endpoint.dbCalls} | ${endpoint.bytes} |\n`
      );
    }
  }
}

async function main(): Promise<void> {
  const requested = arg('dataset', 'all') as DatasetSize | 'all';
  const iterations = Number(arg('iterations', '15'));
  const selected: DatasetSize[] = requested === 'all' ? ['small', 'medium', 'large'] : [requested];

  const server = await startEmbeddedPostgres('eh_bench');
  const startedAt = new Date().toISOString();
  const results: DatasetResult[] = [];
  try {
    for (const size of selected) {
      process.stderr.write(`seeding ${size}…\n`);
      results.push(await measureDataset(server, `eh_bench_${size}`, size, iterations));
    }
  } finally {
    await server.stop();
  }

  const environment = {
    startedAt,
    node: process.version,
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    memoryGb: round(totalmem() / 1024 ** 3),
    iterations,
    transport: 'in-process app.inject (no TLS, no network)',
    postgres: 'embedded PostgreSQL 18.6 (test binaries)'
  };

  printTable(results);
  process.stdout.write(`\n${JSON.stringify({ environment, results }, null, 2)}\n`);

  const outDir = join(fileURLToPath(new URL('../../../', import.meta.url)), 'docs', 'v2', 'bench');
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `results-${startedAt.replace(/[:.]/g, '-')}.json`);
  await writeFile(file, `${JSON.stringify({ environment, results }, null, 2)}\n`, 'utf8');
  process.stderr.write(`wrote ${file}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
