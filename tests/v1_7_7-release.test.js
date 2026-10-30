'use strict';

/**
 * V1.7.7 release record.
 *
 * The hotfix must keep schema 8, employee contract 1.6, the migrations, the authorization policy and
 * the project colours unchanged, and it must leave its own evidence behind: a gate file per area, the
 * benchmark record and an honest production-readiness status.
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

test('an ordinary failure keeps no denial code', () => {
  const app = fixtures.base({ actor: 'manager@example.test', properties: MANAGER_WEB });
  const missing = app.context.managerWebRead('project', {id: 'NOT-A-PROJECT'});
  assert.equal(missing.ok, false, 'a missing record still fails');
  assert.equal(missing.code, undefined, 'and is never reported as a denial');
  assert.equal(app.context.Roles.isDenied(new Error(missing.error)), false);

  const unverified = fixtures.base({ actor: 'stranger@other.test', properties: MANAGER_WEB });
  const refused = unverified.context.managerWebRead('bootstrap', {});
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'AUTHORIZATION_DENIED', 'an unverified identity is a denial');
});

test('every asynchronous denial path reaches the same revocation', () => {
  const client = read('src/ManagerWebClient.html');
  // One classifier, one constant and one revoking call site inside rpc().
  assert.match(client, /var AUTHORIZATION_DENIED = 'AUTHORIZATION_DENIED'/);
  assert.match(client, /function isAuthorizationDenied\(error, result\)/);
  assert.match(client, /if \(isAuthorizationDenied\(error, result\)\) revoke\(\)/);
  assert.match(client, /if \(isAuthorizationDenied\(error\)\) \{ revoke\(\); return; \}/);
  // The wording-only classifier is gone from the compact-index handler.
  assert.doesNotMatch(client, /MANAGER_ACCESS_DENIED\|Insufficient role\|Access denied\|権限/);
});

test('the server marks a denial with the stable code', () => {
  const roles = read('src/Roles.gs');
  assert.match(roles, /var DENIED = 'AUTHORIZATION_DENIED'/);
  assert.match(roles, /function denied\(message\)/);
  assert.match(roles, /function isDenied\(value\)/);
  assert.match(roles, /throw denied\('Insufficient role: '/);
  assert.match(roles, /DENIED: DENIED, denied: denied, isDenied: isDenied/);
  const web = read('src/ManagerWeb.gs');
  assert.match(web, /throw Roles\.denied\('MANAGER_ACCESS_DENIED'\)/);
  assert.match(web, /if \(Roles\.isDenied\(error\)\) failure\.code = Roles\.DENIED/);
});

test('an import refreshes the selected filter without importing again', () => {
  const client = read('src/ManagerWebClient.html');
  ['requestImport', 'refreshRequestList', 'importedCount'].forEach(name =>
    assert.ok(client.indexOf('function ' + name) >= 0, name + ' must exist'));
  assert.match(client, /if\(imported\.imported\)refreshRequestList\(imported\.listPending\)/);
  // The refresh is a read of the current filter, never a write and never a second import.
  const refresh = /function refreshRequestList\(listPending\) \{([\s\S]*?)\n\}/.exec(client);
  assert.ok(refresh, 'refreshRequestList must exist');
  assert.match(refresh[1], /view !== 'requests'/);
  assert.match(refresh[1], /fetchView\('requests', true, false\)/);
  assert.doesNotMatch(refresh[1], /requestSync|api\.write/);
});

test('the migration list and the write entrypoints are untouched by this release', () => {
  const migrations = read('src/Migrations.gs');
  const ids = Array.from(migrations.matchAll(/id: '([0-9]{3}_[a-z0-9_]+)'/g)).map(match => match[1]);
  assert.deepEqual(ids, ['002_task_assignment_safety', '003_management_reliability',
    '004_shared_dashboard', '005_task_planning_and_requests',
    '006_responsibilities_and_nested_subprojects', '007_responsibility_hierarchy_and_lifecycle',
    '008_task_and_responsibility_members'], 'a corrective release adds no migration');
  const api = read('src/ManagerWebApi.gs');
  const actions = /var actions = \{([\s\S]*?)\n  \};/.exec(api);
  assert.ok(actions, 'the write allowlist must exist');
  ['projectCreate', 'projectSave', 'taskSave', 'requestSync', 'requestDecide', 'automationSave']
    .forEach(name => assert.match(actions[1], new RegExp(name + ':')));
  assert.doesNotMatch(api, /eval\(|globalThis|Function\(/);
});

test('the release documents every confirmed defect', () => {
  const changelog = read('CHANGELOG.md');
  assert.match(changelog, /## V1\.7\.7 — authorization denial handling and request synchronization/);
  ['AUTHORIZATION_DENIED', 'refreshRequestList', 'isAuthorizationDenied', 'revoke', 'imported.imported']
    .forEach(term => assert.match(changelog, new RegExp(term.replace('.', '\\.'))));
  assert.match(changelog, /## V1\.7\.6 — request consistency and asynchronous-state safety/,
    'the previous release record is kept');
});

test('the overviews and the architecture notes describe the current release', () => {
  assert.match(read('README.md'), /## Current release — V1\.7\.7/);
  assert.match(read('README.md'), /## Historical V1\.7\.6 release record/);
  assert.match(read('README_JP.md'), /## 現行リリース — V1\.7\.7/);
  assert.match(read('README_JP.md'), /## 過去のリリース記録（V1\.7\.6）/);
  const architecture = read('ARCHITECTURE.md');
  assert.match(architecture, /## V1\.7\.7 corrective architecture notes/);
  assert.match(architecture, /isAuthorizationDenied/);
  assert.match(architecture, /refreshRequestList/);
  assert.match(architecture, /## V1\.7\.6 corrective architecture notes/, 'the earlier notes are kept');
});

test('the rules for this release are recorded', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /## V1\.7\.7 mandatory rules/);
  [145, 146, 147, 148, 149].forEach(number => {
    assert.match(agents, new RegExp('\\n' + number + '\\. '), 'rule ' + number + ' must exist');
  });
});

test('the release keeps its own gate evidence', () => {
  ['docs/checkgates/V1_7_7_GATE_1.md', 'docs/checkgates/V1_7_7_GATE_2.md',
    'docs/checkgates/V1_7_7_GATE_3.md', 'docs/checkgates/V1_7_7_PERFORMANCE.json'].forEach(file => {
    assert.equal(exists(file), true, file + ' must exist');
  });
  const performance = JSON.parse(read('docs/checkgates/V1_7_7_PERFORMANCE.json'));
  assert.equal(performance.liveWorkspace, 'NOT_RUN', 'local mocks are never live evidence');
  performance.datasets.forEach(dataset => {
    assert.equal(dataset.ui.taskIndexLoaded, true);
    assert.equal(dataset.ui.rpcAfterInitialLoad, 2, 'one index read and one page read');
    assert.equal(dataset.bootstrap.rangeReadsPerCall, 10, 'the snapshot read is unchanged');
    assert.equal(dataset.requestApproval.rangeReadsPerCall, 19, 'the decision cost is unchanged');
  });
  // Earlier gate records stay intact.
  ['docs/checkgates/V1_7_6_GATE_1.md', 'docs/checkgates/V1_7_6_PERFORMANCE.json',
    'docs/checkgates/V1_7_5_GATE_1.md', 'docs/checkgates/V1_7_5_PERFORMANCE.json'].forEach(file => {
    assert.equal(exists(file), true, file + ' must exist');
  });
});

test('production readiness stays NOT APPROVED', () => {
  const readiness = read('docs/PRODUCTION_READINESS.md');
  assert.match(readiness, /NOT APPROVED FOR PRODUCTION/);
  assert.match(readiness, /## Current assessment — V1\.7\.7/);
  assert.match(readiness, /## Historical assessment — V1\.7\.6/);
  assert.match(readiness, /BLOCKED \/ NOT_RUN/);
});

test('the hotfix adds no forbidden client capability', () => {
  const client = read('src/ManagerWebClient.html');
  ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']
    .forEach(term => assert.equal(client.indexOf(term), -1, term + ' must not be used'));
  assert.doesNotMatch(client, /localStorage\s*\.\s*(get|set|remove|clear)/);
  assert.doesNotMatch(client, /sessionStorage|indexedDB\s*\./);
});
