#!/usr/bin/env node
/**
 * Deployment-template validation.
 *
 * Static, honest checks over the files a reviewer cannot run in every environment: the Compose
 * topology, the reverse proxy, the tunnel example and the container build definitions. It is not
 * a substitute for starting the stack, and the documents say so.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(relative) {
  const path = join(root, relative);
  if (!existsSync(path)) {
    failures.push(`Missing ${relative}`);
    return '';
  }
  return readFileSync(path, 'utf8');
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function withoutComments(text, marker) {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith(marker))
    .join('\n');
}

/* ------------------------------- compose --------------------------------- */
const compose = read('deploy/docker-compose.yml');
if (compose) {
  const postgresImage = /image:\s*postgres:(\d+)(?:-alpine)?/.exec(compose);
  expect(!!postgresImage, 'Compose has no PostgreSQL image');
  const major = postgresImage ? Number(postgresImage[1]) : 0;
  const volumeLine = /-\s*db-data:(\/var\/lib\/postgresql[^\s]*)/.exec(compose);
  expect(!!volumeLine, 'Compose does not mount the PostgreSQL data volume');
  if (volumeLine) {
    const target = volumeLine[1];
    // PostgreSQL 18 and later moved PGDATA under /var/lib/postgresql/<major>/docker, so the
    // volume must cover the parent directory; the older /data path silently stops persisting.
    if (major >= 18) {
      expect(
        target === '/var/lib/postgresql',
        `PostgreSQL ${major} keeps PGDATA under /var/lib/postgresql/<major>/docker; mount the volume at /var/lib/postgresql (found ${target})`
      );
    } else {
      expect(
        target === '/var/lib/postgresql/data',
        `PostgreSQL ${major} expects the volume at /var/lib/postgresql/data (found ${target})`
      );
    }
  }
  expect(!/5432:5432/.test(compose), 'Compose publishes PostgreSQL to the host');
  expect(!/0\.0\.0\.0:5432/.test(compose), 'Compose publishes PostgreSQL on every interface');
  const migrateBlock = /migrate:\s*([\s\S]*?)(?=\n {2}\w+:|\nvolumes:)/.exec(compose);
  expect(!!migrateBlock, 'Compose has no explicit migrate service');
  if (migrateBlock) {
    expect(/profiles:/.test(migrateBlock[1]), 'The migrate service must stay behind an explicit profile');
    expect(
      /apps\/api\/dist\/migrate\.js/.test(migrateBlock[1]),
      'The migrate service must run the built migration entrypoint'
    );
  }
  expect(!/DEV_AUTH_ENABLED:\s*['"]?true/.test(compose), 'Compose enables development sign-in');
  expect(!/DATABASE_URL:\s*postgresql:\/\/[^\s]*@db:5432/.test(compose) === false, 'Compose must build DATABASE_URL from variables');
  expect(/127\.0\.0\.1:8080:8080/.test(compose), 'The API port must bind to the loopback interface only');
  expect(/depends_on:[\s\S]*condition:\s*service_healthy/.test(compose), 'Services must wait for a healthy database');
}

/* --------------------------------- proxy --------------------------------- */
const caddy = read('deploy/caddy/Caddyfile');
if (caddy) {
  const stripped = withoutComments(caddy, '#');
  const open = (stripped.match(/{/g) ?? []).length;
  const close = (stripped.match(/}/g) ?? []).length;
  expect(open === close, 'Caddyfile braces are unbalanced');
  const firstLine = stripped.split('\n').find((line) => line.trim() !== '');
  expect(
    !!firstLine && firstLine.includes('{$APP_DOMAIN}'),
    'Caddyfile must start with the site block for {$APP_DOMAIN}; a site nested in a global options block never serves'
  );
  expect(/reverse_proxy\s+api:8080/.test(stripped), 'Caddyfile must proxy to the api service');
  expect(/Strict-Transport-Security/.test(stripped), 'Caddyfile must set HSTS');
  expect(
    !/reverse_proxy\s+(?!api:8080|@api api:8080)[a-z]+:\d+/.test(stripped),
    'Caddyfile proxies to an unexpected backend'
  );
}

/* -------------------------------- tunnel --------------------------------- */
const tunnel = read('deploy/cloudflared/config.yml');
if (tunnel) {
  expect(/tunnel:\s*[0-9a-f-]{36}/.test(tunnel), 'Tunnel example needs a tunnel UUID placeholder');
  expect(/credentials-file:/.test(tunnel), 'Tunnel example needs a credentials file');
  expect(/service:\s*http:\/\/api:8080/.test(tunnel), 'Tunnel must target the internal api service');
  expect(/service:\s*http_status:404/.test(tunnel), 'Tunnel needs a catch-all rule');
  expect(!/noTLSVerify:\s*true/.test(tunnel), 'Tunnel must not disable TLS verification');
  expect(!/0\.0\.0\.0|localhost/.test(tunnel), 'Tunnel must not expose a host-local origin');
}

/* ------------------------------ Dockerfiles ------------------------------ */
const apiImage = read('deploy/api.Dockerfile');
if (apiImage) {
  expect(/npm ci/.test(apiImage), 'api image must install from the lockfile');
  expect(!/--force/.test(apiImage), 'api image must not use --force');
  const runtime = apiImage.split(/FROM .* AS runtime/)[1] ?? '';
  expect(/COPY --from=build \/app\/apps\/api\/dist/.test(runtime), 'api runtime must copy the API build');
  expect(/COPY --from=build \/app\/apps\/web\/dist/.test(runtime), 'api runtime must copy the web build');
  expect(/COPY --from=build \/app\/packages\/db\/src\/migrations/.test(runtime), 'api runtime must copy the reviewed SQL');
  expect(!/COPY apps \.\/apps/.test(runtime), 'api runtime must not copy application sources');
  expect(!/COPY packages \.\/packages/.test(runtime), 'api runtime must not copy workspace packages');
  expect(/CMD \["node", "apps\/api\/dist\/main\.js"\]/.test(runtime), 'api runtime must start the built entrypoint');
  expect(/USER node/.test(runtime), 'api runtime must not run as root');
  expect(/ENV EH_MIGRATIONS_DIR=/.test(runtime), 'api runtime must point the migration CLI at the copied SQL');
}
const workerImage = read('deploy/worker.Dockerfile');
if (workerImage) {
  expect(/npm ci/.test(workerImage), 'worker image must install from the lockfile');
  expect(!/--force/.test(workerImage), 'worker image must not use --force');
  const runtime = workerImage.split(/FROM .* AS runtime/)[1] ?? '';
  expect(/COPY --from=build \/app\/apps\/worker\/dist/.test(runtime), 'worker runtime must copy the worker build');
  expect(!/COPY apps \.\/apps/.test(runtime), 'worker runtime must not copy application sources');
  expect(!/COPY packages \.\/packages/.test(runtime), 'worker runtime must not copy workspace packages');
  expect(/CMD \["node", "apps\/worker\/dist\/main\.js"\]/.test(runtime), 'worker runtime must start the built entrypoint');
  expect(/USER node/.test(runtime), 'worker runtime must not run as root');
}

/* --------------------------- Windows LAN profile ------------------------- */
const lanApi = read('deploy/windows/api.env.example');
const lanWorker = read('deploy/windows/worker.env.example');
expect(lanApi.includes('AUTH_MODE=local'), 'LAN API must use local authentication');
expect(lanApi.includes('DEV_AUTH_ENABLED=false'), 'LAN API must disable development sign-in');
expect(!lanApi.includes('GOOGLE_SERVICE_ACCOUNT_JSON'), 'LAN API must not receive Google credentials');
expect(lanWorker.includes('BACKUP_ONLY=true'), 'LAN worker must suppress mail and Calendar');
expect(lanWorker.includes('BACKUP_DIRECTORY='), 'LAN backups need persistent storage');
expect(read('.gitignore').split(/\r?\n/).includes('data/'), 'Runtime secrets and local data must be gitignored');

/* -------------------------------- pipeline -------------------------------- */
const ci = read('.github/workflows/ci.yml');
if (ci) {
  expect(/runs-on:\s*ubuntu/.test(ci), 'CI must run on Linux');
  expect(/image:\s*postgres:18/.test(ci), 'CI must start a PostgreSQL 18 service container');
  expect(/TEST_DATABASE_URL:/.test(ci), 'CI must point the tests at its PostgreSQL service');
  expect(/REQUIRE_DATABASE:\s*['"]?1/.test(ci), 'CI must fail when the database is unavailable');
  for (const step of ['npm ci', 'run typecheck', 'run lint', 'test', 'run validate', 'run build', 'test:browser']) {
    expect(ci.includes(step), `CI is missing the "${step}" step`);
  }
  expect(!/windows|macos/.test(ci.split('jobs:')[1] ?? ''), 'CI must not depend on a developer platform');
}

/* ------------------------------ env example ------------------------------ */
const envExample = read('deploy/.env.example');
if (envExample) {
  expect(
    !/VITE_GOOGLE_CLIENT_ID|VITE_DEV_SIGN_IN/.test(envExample),
    'Public configuration is served at runtime; build-time VITE_ variables must not remain'
  );
  expect(/TRUST_PROXY=/.test(envExample), '.env.example must document TRUST_PROXY');
  expect(/BACKUP_INTERVAL_MINUTES=/.test(envExample), '.env.example must document the backup interval');
}

if (failures.length) {
  process.stderr.write(`Deployment validation failed:\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Deployment templates validated (compose, proxy, tunnel, images, CI, env).\n');
}
