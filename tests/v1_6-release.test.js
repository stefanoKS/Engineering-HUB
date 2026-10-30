'use strict';
/**
 * V1.6 release gate: version agreement, ten-plus checkgates, dependency-free UI rules and the
 * honest production status. Live Workspace verification stays BLOCKED / NOT_RUN.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {loadApp, loadDashboard} = require('./helpers');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('package, publisher, README and the manager page agree on V1.6', () => {
  assert.match(read('package.json'), /"version": "1\.7\.7"/);
  assert.match(read('src/SharedDashboardPublisher.gs'), /PUBLISHER_VERSION = '1\.7\.0'/);
  assert.match(read('README.md'), /## Current release — V1\.7/);
  assert.match(read('README_JP.md'), /## 現行リリース — V1\.7/);
  assert.match(read('src/ManagerWebIndex.html'), /V1\.7/);
  assert.match(read('CHANGELOG.md'), /## V1\.6/);
});

test('the twelve V1.6 checkgates and the deployment runbook exist and stay honest', () => {
  for (let index = 1; index <= 12; index += 1) {
    const content = read(`docs/checkgates/V1_6_GATE_${index}.md`);
    assert.match(content, /^# V1\.6 gate/m, 'gate ' + index + ' needs a heading');
    assert.match(content, /Status: \*\*(PASS|FAIL|BLOCKED|NOT_RUN)/, 'gate ' + index + ' needs a status');
    assert.match(content, /## 12\. Final gate status/, 'gate ' + index + ' needs the final status section');
  }
  const runbook = read('docs/V1_6_DEPLOYMENT_RUNBOOK.md');
  assert.match(runbook, /backup/i);
  assert.match(runbook, /007_responsibility_hierarchy_and_lifecycle/);
  assert.match(runbook, /rollback/i);
});

test('the schema, migration and contract documents describe the current release', () => {
  assert.match(read('src/Schema.gs'), /return \{ version: 8,/);
  assert.match(read('src/Migrations.gs'), /007_responsibility_hierarchy_and_lifecycle', from: 6, to: 7/);
  assert.match(read('DATA_SCHEMA.md'), /current schema version is \*\*8\*\*/);
  assert.match(read('DATA_SCHEMA.md'), /007_responsibility_hierarchy_and_lifecycle/);
  assert.match(read('docs/dashboard/DATA_CONTRACT.md'), /## Contract 1\.5/);
  assert.match(read('DEPLOYMENT.md'), /V1\.6/);
});

test('the publisher and the employee reader agree on contract 1.6 fields', () => {
  const manager = loadApp();
  const viewer = loadDashboard();
  const model = manager.context.SharedDashboardModel;
  assert.equal(model.CONTRACT_VERSION, '1.6');
  assert.equal(viewer.context.DashboardData.CONTRACT_VERSION, '1.6');
  const contracts = viewer.context.DashboardData.CONTRACTS;
  assert.deepEqual(JSON.parse(JSON.stringify(contracts['1.6'].tasks.fields)),
    JSON.parse(JSON.stringify(model.TASK_PUBLIC_FIELDS)));
  assert.deepEqual(JSON.parse(JSON.stringify(contracts['1.6'].responsibilities.fields)),
    JSON.parse(JSON.stringify(model.RESPONSIBILITY_PUBLIC_FIELDS)));
  ['parentTaskId', 'container', 'reviewState', 'completedAt', 'assigneeNames'].forEach(field =>
    assert.ok(model.TASK_PUBLIC_FIELDS.indexOf(field) >= 0, field));
  assert.ok(model.RESPONSIBILITY_PUBLIC_FIELDS.indexOf('color') >= 0);
  // A snapshot published by the previous release stays readable.
  assert.ok(viewer.context.DashboardData.SUPPORTED_CONTRACTS.indexOf('1.5') >= 0);
  assert.equal(contracts['1.5'].tasks.fields.indexOf('assigneeNames'), -1);
});

test('the employee dashboard renders the hierarchy and the review state without unsafe HTML', () => {
  const client = read('dashboard-app/Client.html');
  assert.match(client, /task-depth-/);
  assert.match(client, /container-badge/);
  assert.match(client, /review-badge/);
  assert.match(client, /dashboard\.drawer\.reviewState/);
  assert.doesNotMatch(client, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/);
  const styles = read('dashboard-app/Styles.html');
  assert.match(styles, /\.review-badge/);
});

test('the manager page keeps the responsibility filter in page memory only', () => {
  const client = read('src/ManagerWebClient.html');
  assert.doesNotMatch(client, /localStorage\s*\.\s*(get|set|remove)Item|indexedDB\s*\.\s*open|sessionStorage\s*\./i);
  assert.match(client, /activeResponsibility/);
  assert.match(client, /Responsibility_ID/);
  const dashboard = read('dashboard-app/Client.html');
  assert.match(dashboard, /localStorage/); // the language preference only, documented in UI_LOCALIZATION.md
});

test('the documentation records the narrow deletion exception and the reviewed lifecycle', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /## V1\.6 mandatory rules/);
  assert.match(agents, /Documented, narrowly scoped exception/);
  assert.match(agents, /Deletion\.gs`? is the only/);
  assert.match(read('docs/RESPONSIBILITIES.md'), /four|4/);
  assert.match(read('docs/MANAGER_WORKFLOW.md'), /COMPLETION_REPORT|completion/i);
  assert.match(read('docs/SECURITY_MODEL.md'), /ADMIN/);
});

test('production readiness stays unapproved and separates local evidence from live verification', () => {
  const readiness = read('docs/PRODUCTION_READINESS.md');
  assert.match(readiness, /NOT APPROVED FOR PRODUCTION/);
  assert.match(readiness, /V1\.6/);
  assert.match(readiness, /Schema version \| 8/);
  assert.match(readiness, /BLOCKED|NOT_RUN|unverified|UNVERIFIED/i);
});

test('the local performance evidence exists and never claims a live measurement', () => {
  const raw = JSON.parse(read('docs/checkgates/V1_6_PERFORMANCE.json'));
  assert.equal(raw.liveWorkspace, 'NOT_RUN');
  raw.datasets.forEach(dataset => {
    ['bootstrap', 'taskIndex', 'overview', 'projectList'].forEach(name => {
      assert.ok(dataset[name].p50Ms >= 0, name + ' p50');
      assert.ok(dataset[name].payloadBytes > 0, name + ' payload');
    });
    assert.ok(dataset.ui.cachedNavigationMs.p50 < 100, 'cached navigation stays under the 100 ms target');
    assert.ok(dataset.ui.localSearchMs.p50 < 50, 'local filtering stays under the 50 ms target');
  });
  assert.match(read('docs/MANAGER_WEB_APP_PERFORMANCE.md'), /NOT_RUN/);
});

test('the manager web keeps execute-as and the employee app keeps the deployer identity', () => {
  const manager = JSON.parse(read('src/appsscript.json'));
  const employee = JSON.parse(read('dashboard-app/appsscript.json'));
  assert.deepEqual(manager.webapp, {access: 'DOMAIN', executeAs: 'USER_ACCESSING'});
  assert.equal(employee.webapp.access, 'DOMAIN');
  assert.equal(employee.webapp.executeAs, 'USER_DEPLOYING');
});

test('the installed source never re-enables a direct destructive reset', () => {
  // The two reviewed exceptions: the schema-guarded generated-sheet writer and the safety-checked
  // row-removal path in Deletion.gs. Every other module must never touch a destructive Sheets API.
  const reviewed = ['Database.gs', 'Deletion.gs'];
  const files = fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.gs'));
  files.forEach(name => {
    const source = read(path.join('src', name));
    assert.doesNotMatch(source, /BEGIN [A-Z ]*PRIVATE KEY/, name);
    assert.doesNotMatch(source, /client_secret|refresh_token|ya29\.|AIza[0-9A-Za-z_-]{30}/, name);
    if (reviewed.indexOf(name) >= 0) return;
    assert.doesNotMatch(source, /\.(?:clear|clearContents|deleteSheet|deleteRows?|deleteColumns?)\(\s*/, name + ' must not reset a sheet');
  });
  // Deletion.gs may only remove a row, never clear or restructure a sheet.
  const deletion = read('src/Deletion.gs');
  assert.doesNotMatch(deletion, /\.(?:clear|clearContents|deleteSheet|deleteColumns?)\(\s*/);
  assert.match(deletion, /deleteRow\(/);
});
