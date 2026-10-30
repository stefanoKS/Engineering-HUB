'use strict';

/**
 * V1.7.5 release record.
 *
 * The corrective release must keep schema 8, employee contract 1.6, the migrations, the
 * authorization rules and the project colours unchanged, and it must leave its own evidence
 * behind: a gate file per area, the benchmark record and an honest production-readiness status.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./fixtures');

const ROOT = path.resolve(__dirname, '..');
const MANAGER_WEB = { MANAGER_WEB_ALLOWED_DOMAINS: 'example.test' };
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(ROOT, relative));

test('the application reports release 1.7.7 while schema 8 and contract 1.6 stay unchanged', () => {
  const app = fixtures.base({ actor: 'manager@example.test', properties: MANAGER_WEB });
  const status = app.context.managerWebRead('status', {});
  assert.equal(status.ok, true, status.error);
  assert.equal(status.data.version, '1.7.7');
  assert.equal(status.data.schema, 8, 'no schema change in a corrective release');
  const bootstrap = app.context.managerWebRead('bootstrap', {});
  assert.equal(bootstrap.ok, true, bootstrap.error);
  assert.equal(bootstrap.data.contract, '1.6', 'the employee publication contract is unchanged');
  assert.equal(bootstrap.data.version, '1.7.7');
});

test('the header badge shows the same release version', () => {
  const index = read('src/ManagerWebIndex.html');
  assert.match(index, /class="version">V1\.7\.7</);
  assert.match(read('src/Config.gs'), /var APP_VERSION = '1\.7\.7'/);
});

test('the migration list is untouched by this release', () => {
  const migrations = read('src/Migrations.gs');
  const ids = Array.from(migrations.matchAll(/id: '([0-9]{3}_[a-z0-9_]+)'/g)).map(match => match[1]);
  assert.deepEqual(ids, ['002_task_assignment_safety', '003_management_reliability',
    '004_shared_dashboard', '005_task_planning_and_requests',
    '006_responsibilities_and_nested_subprojects', '007_responsibility_hierarchy_and_lifecycle',
    '008_task_and_responsibility_members'], 'a corrective release adds no migration');
});

test('no manager write entrypoint was added for this release', () => {
  const api = read('src/ManagerWebApi.gs');
  const actions = /var actions = \{([\s\S]*?)\n  \};/.exec(api);
  assert.ok(actions, 'the write allowlist must exist');
  ['projectCreate', 'projectSave', 'taskSave', 'requestSync', 'requestDecide', 'automationSave']
    .forEach(name => assert.match(actions[1], new RegExp(name + ':')));
  assert.doesNotMatch(api, /eval\(|globalThis|Function\(/);
  assert.match(api, /if \(!Object\.prototype\.hasOwnProperty\.call\(actions, action\)\) throw new Error/,
    'the allowlist stays the only dispatch');
});

test('the corrective release documents every confirmed defect', () => {
  const changelog = read('CHANGELOG.md');
  assert.match(changelog, /## V1\.7\.5 — stability, data integrity and logic corrections/);
  ['patchSummary', 'requestSync', 'syncTaskIndex', 'INVALID_RESPONSE', 'Parent_Task_ID']
    .forEach(term => assert.match(changelog, new RegExp(term)));
  assert.match(changelog, /## V1\.7\.4 — visual refresh and project colour hierarchy/,
    'the previous release record is kept');
});

test('the overviews describe the current release', () => {
  const readme = read('README.md');
  assert.match(readme, /## Current release — V1\.7\.7/);
  assert.match(readme, /## Historical V1\.7\.6 release record/);
  const japanese = read('README_JP.md');
  assert.match(japanese, /## 現行リリース — V1\.7\.7/);
  assert.match(japanese, /## 過去のリリース記録（V1\.7\.6）/);
});

test('the architecture notes describe the write, refresh and validation boundaries', () => {
  const architecture = read('ARCHITECTURE.md');
  assert.match(architecture, /## V1\.7\.5 corrective architecture notes/);
  assert.match(architecture, /supersedeRead/);
  assert.match(architecture, /readContract/);
  assert.match(architecture, /hydrateTasks/);
});

test('the rules for this release are recorded', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /## V1\.7\.5 mandatory rules/);
  [131, 132, 133, 134, 135, 136, 137, 138].forEach(number => {
    assert.match(agents, new RegExp('\\n' + number + '\\. '), 'rule ' + number + ' must exist');
  });
});

test('the release keeps its own gate evidence', () => {
  ['docs/checkgates/V1_7_5_GATE_1.md', 'docs/checkgates/V1_7_5_GATE_2.md',
    'docs/checkgates/V1_7_5_GATE_3.md', 'docs/checkgates/V1_7_5_PERFORMANCE.json'].forEach(file => {
    assert.equal(exists(file), true, file + ' must exist');
  });
  const performance = JSON.parse(read('docs/checkgates/V1_7_5_PERFORMANCE.json'));
  assert.equal(performance.liveWorkspace, 'NOT_RUN', 'local mocks are never live evidence');
  performance.datasets.forEach(dataset => {
    assert.equal(dataset.ui.taskIndexLoaded, true);
    assert.equal(dataset.ui.rpcAfterInitialLoad, 2, 'one index read and one page read');
  });
  // Earlier gate records stay intact.
  ['docs/checkgates/V1_7_4_GATE_1.md', 'docs/checkgates/V1_7_4_GATE_2.md',
    'docs/checkgates/V1_7_3_PERFORMANCE.json'].forEach(file => assert.equal(exists(file), true));
});

test('production readiness stays NOT APPROVED', () => {
  const readiness = read('docs/PRODUCTION_READINESS.md');
  assert.match(readiness, /NOT APPROVED FOR PRODUCTION/);
});

test('the corrective release adds no forbidden client capability', () => {
  const client = read('src/ManagerWebClient.html');
  ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']
    .forEach(term => assert.equal(client.indexOf(term), -1, term + ' must not be used'));
  // The manager application keeps nothing private in the browser; only the language is stored.
  assert.doesNotMatch(client, /localStorage\s*\.\s*(get|set|remove|clear)/);
  assert.doesNotMatch(client, /sessionStorage|indexedDB\s*\./);
  const dashboard = read('dashboard-app/Client.html');
  assert.doesNotMatch(dashboard, /MailApp|GmailApp|CalendarApp|DriveApp|UrlFetchApp|ScriptApp/);
});
