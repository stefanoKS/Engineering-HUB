'use strict';

/**
 * V2 source governance checks.
 *
 * These are the rules a reviewer would otherwise have to remember: no Apps Script dependency in
 * the V2 runtime, no HTML injection sink, no committed secret, one publication allowlist, no
 * destructive SQL outside the reviewed deletion path, no private browser persistence and no
 * `SELECT *` in a response projection.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

function walk(directory, extensionFilter, ignore = []) {
  const result = [];
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (ignore.some((fragment) => full.includes(fragment))) continue;
    if (entry.isDirectory()) result.push(...walk(full, extensionFilter, ignore));
    else if (extensionFilter.some((extension) => entry.name.endsWith(extension))) result.push(full);
  }
  return result;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

const codeFiles = [
  ...walk(path.join(root, 'apps'), ['.ts', '.tsx', '.js', '.html'], ['node_modules', 'dist']),
  ...walk(path.join(root, 'packages'), ['.ts', '.tsx', '.sql'], ['node_modules', 'dist'])
];

/* 1. No Apps Script runtime dependency in V2. */
const APPS_SCRIPT = /\b(SpreadsheetApp|MailApp|GmailApp|CalendarApp|DriveApp|ScriptApp|UrlFetchApp|HtmlService|Utilities\.sleep|google\.script\.run)\b/;
for (const file of codeFiles) {
  if (APPS_SCRIPT.test(read(file))) fail(`Apps Script dependency in ${relative(file)}`);
}

/* 2. No HTML injection sink in the browser code. */
const HTML_SINK = /(\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\(|document\.write\()/;
for (const file of walk(path.join(root, 'apps', 'web', 'src'), ['.ts', '.tsx'])) {
  if (HTML_SINK.test(read(file))) fail(`HTML injection sink in ${relative(file)}`);
}

/* 3. No committed credentials. */
const SECRET = /(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|"private_key"\s*:\s*"|AIza[0-9A-Za-z_-]{20,}|ghp_[0-9A-Za-z]{20,})/;
for (const file of [...codeFiles, ...walk(path.join(root, 'deploy'), ['.yml', '.yaml', '.env', '.example', '.json', '.caddyfile'])]) {
  if (SECRET.test(read(file))) fail(`Possible committed secret in ${relative(file)}`);
}

/* 4. One publication allowlist: exactly one declaration of the published header list. */
const headerDefinitions = [
  ...walk(path.join(root, 'packages'), ['.ts']),
  ...walk(path.join(root, 'apps'), ['.ts'])
].filter((file) => !file.includes(`${path.sep}test${path.sep}`) && !file.includes(`${path.sep}dist${path.sep}`))
  .filter((file) => /export const PUBLISHED_HEADERS\s*=/.test(read(file)));
if (headerDefinitions.length !== 1) {
  fail(`Expected exactly one published header definition, found ${headerDefinitions.length}`);
}

/* 5. No destructive SQL outside the reviewed paths. */
const DESTRUCTIVE = /\b(DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i;
// Each allowlisted module has one reviewed reason to remove rows:
//   repo/tasks.ts        replace a task's dependency set (sequencing, not history)
//   repo/workflow.ts     claim/finish a request decision row's transient state
//   repo/system.ts       expire sessions and job bookkeeping
//   services/deletion.ts the ADMIN tombstone path, guarded by the empty-record preflight
//   worker/backup.ts     verification restore into a scratch database it created itself
//   worker/jobs.ts       purge expired sessions only
//   worker/cli.ts        drop the scratch database created by `verify-restore`
//   migration/import.ts  dry-run rollback and an explicit fresh-database import
const DESTRUCTIVE_ALLOWLIST = [
  'packages/db/src/repo/workflow.ts',
  'packages/db/src/repo/system.ts',
  'packages/db/src/repo/tasks.ts',
  'apps/api/src/services/deletion.ts',
  'apps/worker/src/backup.ts',
  'apps/worker/src/jobs.ts',
  'apps/worker/src/cli.ts',
  'tools/migration/src/import.ts'
];
for (const file of walk(path.join(root, 'packages'), ['.ts', '.sql'], ['node_modules'])) {
  const text = read(file);
  if (!DESTRUCTIVE.test(text)) continue;
  const name = relative(file);
  if (name.includes('/migrations/')) {
    fail(`Destructive SQL in migration ${name}`);
    continue;
  }
  if (name.startsWith('packages/db/test/')) continue;
  if (!DESTRUCTIVE_ALLOWLIST.some((allowed) => name.startsWith(allowed) || name === allowed)) {
    fail(`Destructive SQL in ${name}`);
  }
}
for (const file of walk(path.join(root, 'apps'), ['.ts'], ['node_modules', 'dist'])) {
  const text = read(file);
  const name = relative(file);
  if (!DESTRUCTIVE.test(text)) continue;
  if (name.includes('/test/')) continue;
  if (!DESTRUCTIVE_ALLOWLIST.some((allowed) => name === allowed)) {
    fail(`Destructive SQL in ${name}`);
  }
}

/* 6. No SELECT * in a response projection (a comment may still describe the rule). */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}
for (const file of [
  ...walk(path.join(root, 'packages', 'db', 'src', 'repo'), ['.ts']),
  ...walk(path.join(root, 'apps', 'api', 'src'), ['.ts'])
]) {
  if (/SELECT\s+\*/i.test(withoutComments(read(file)))) fail(`SELECT * in ${relative(file)}`);
}

/* 7. Browser persistence stays limited to the language and non-sensitive receipts. */
const STORAGE = /localStorage\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g;
for (const file of walk(path.join(root, 'apps', 'web', 'src'), ['.ts', '.tsx'])) {
  for (const match of read(file).matchAll(STORAGE)) {
    const key = match[1];
    if (!['eh.lang', 'eh.receipts'].includes(key)) fail(`Unexpected browser persistence key "${key}" in ${relative(file)}`);
  }
}

/* 8. i18n parity. */
const dictionaryPath = path.join(root, 'packages', 'i18n', 'src', 'dictionary.json');
if (!fs.existsSync(dictionaryPath)) {
  fail('packages/i18n/src/dictionary.json is missing (run node scripts/build-i18n-v2.cjs)');
} else {
  const dictionary = JSON.parse(read(dictionaryPath));
  const ja = Object.keys(dictionary.ja);
  const en = Object.keys(dictionary.en);
  if (ja.length !== en.length) fail(`i18n key count differs: ${ja.length} ja, ${en.length} en`);
  const missing = ja.filter((key) => !(key in dictionary.en));
  if (missing.length) fail(`i18n keys missing English: ${missing.slice(0, 5).join(', ')}`);
}

/* 9. Required V2 documentation. */
const requiredDocs = [
  'docs/v2/FEATURE_PARITY.md',
  'docs/v2/ARCHITECTURE.md',
  'docs/v2/API.md',
  'docs/v2/MIGRATION.md',
  'docs/v2/SECURITY.md',
  'docs/v2/PERFORMANCE.md',
  'docs/v2/GOOGLE_WORKSPACE.md',
  'docs/v2/SELF_HOSTING.md',
  'docs/v2/REMOTE_ACCESS.md',
  'docs/v2/BACKUP_RESTORE.md',
  'docs/v2/OPERATIONS.md',
  'docs/v2/ACCEPTANCE.md'
];
for (const doc of requiredDocs) {
  if (!fs.existsSync(path.join(root, doc))) fail(`Missing ${doc}`);
}

/* 10. Deployment templates must keep the database private and automation off. */
const compose = path.join(root, 'deploy', 'docker-compose.yml');
if (!fs.existsSync(compose)) fail('Missing deploy/docker-compose.yml');
else {
  const text = read(compose);
  if (!/postgres:/.test(text)) fail('Compose file has no PostgreSQL service');
  if (/0\.0\.0\.0:5432|"5432:5432"/.test(text)) fail('Compose file publishes PostgreSQL to the host');
}

const envExample = path.join(root, 'deploy', '.env.example');
if (!fs.existsSync(envExample)) fail('Missing deploy/.env.example');
else {
  const text = read(envExample);
  for (const key of ['DATABASE_URL', 'MANAGER_WEB_ALLOWED_DOMAINS', 'GOOGLE_CLIENT_ID', 'BACKUP_ENCRYPTION_KEY']) {
    if (!text.includes(`${key}=`)) fail(`deploy/.env.example is missing ${key}`);
  }
}

/* 11. Migrations must be additive and ordered. */
const migrations = fs
  .readdirSync(path.join(root, 'packages', 'db', 'src', 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort();
for (let index = 1; index < migrations.length; index += 1) {
  const previous = Number(migrations[index - 1].slice(0, 4));
  const current = Number(migrations[index].slice(0, 4));
  if (!(current > previous)) fail(`Migration order is not increasing at ${migrations[index]}`);
}

if (failures.length) {
  process.stderr.write(`V2 validation failed:\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`V2 validation passed (${codeFiles.length} files checked).\n`);
}
