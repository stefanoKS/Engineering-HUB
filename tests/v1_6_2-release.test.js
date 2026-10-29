'use strict';
/**
 * V1.6.2 release gate: version agreement, five checkgates, measured evidence and the honest
 * production status. Live Workspace verification stays BLOCKED / NOT_RUN, and the historical
 * V1.6 / V1.6.1 evidence is left exactly as recorded.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const exists = file => fs.existsSync(path.join(root, file));

test('package, publisher, README, UI and changelog agree on the current version', () => {
  assert.match(read('package.json'), /"version": "1\.7\.0"/);
  assert.match(read('src/SharedDashboardPublisher.gs'), /PUBLISHER_VERSION = '1\.7\.0'/);
  assert.match(read('README.md'), /## Current release — V1\.7/);
  assert.match(read('README_JP.md'), /## 現行リリース — V1\.7/);
  assert.match(read('src/ManagerWebIndex.html'), /V1\.7/);
  assert.match(read('CHANGELOG.md'), /## V1\.6\.2 — /);
  // Earlier records are kept as history, never overwritten.
  assert.match(read('README.md'), /## Historical V1\.6\.1 release record/);
  assert.match(read('README.md'), /## Historical V1\.6 release record/);
  assert.match(read('README_JP.md'), /## 過去のリリース記録（V1\.6\.1）/);
  assert.match(read('CHANGELOG.md'), /## V1\.6\.1 — /);
  assert.match(read('CHANGELOG.md'), /## V1\.6 — /);
  // The overview payload, the status page and the sidebar report one application version.
  assert.match(read('src/Config.gs'), /var APP_VERSION = '1\.7\.3'/);
  assert.match(read('src/ManagerWeb.gs'), /version: APP_VERSION/);
  assert.doesNotMatch(read('src/ManagerWeb.gs'), /version: '1\.6\.1'/);
});

test('the five V1.6.2 checkgates exist and keep the release status honest', () => {
  const scopes = ['Request-specific approval integrity', 'Date handling and audit reliability',
    'Employee inbox status reconciliation', 'Member history and responsibility UX',
    'Security, performance and final regression'];
  for (let index = 1; index <= 5; index += 1) {
    const file = `docs/checkgates/V1_6_2_GATE_${index}.md`;
    assert.ok(exists(file), `${file} is missing`);
    const content = read(file);
    assert.match(content, new RegExp('^# V1\\.6\\.2 gate ' + index + ' — ' + scopes[index - 1], 'm'),
      `${file} needs the gate heading and scope`);
    assert.match(content, /Status: \*\*PASS\*\* \(local\) — \*\*BLOCKED\*\* for live verification/,
      `${file} must separate local PASS from live BLOCKED`);
    assert.match(content, /NOT APPROVED FOR PRODUCTION/, `${file} must keep the production status`);
    assert.match(content, /## 12\. Final gate status/, `${file} needs the final status section`);
    // Every required record is present.
    for (const heading of ['## 1. Objective', '## 2. Confirmed root cause', '## 5. Source files modified',
      '## 6. Test cases', '## 7. Actual test results', '## 10. Known limitations', '## 11. Remaining blockers']) {
      assert.ok(content.indexOf(heading) >= 0, `${file} is missing ${heading}`);
    }
    assert.match(content, /Implementation commit SHA:/, `${file} must record the implementation SHA`);
  }
  // The historical V1.6 and V1.6.1 gates stay exactly as recorded.
  for (let index = 1; index <= 12; index += 1) {
    assert.match(read(`docs/checkgates/V1_6_GATE_${index}.md`), /^# V1\.6 gate/m);
  }
  for (let index = 1; index <= 6; index += 1) {
    assert.match(read(`docs/checkgates/V1_6_1_GATE_${index}.md`), /^# V1\.6\.1 gate/m);
  }
});

test('the V1.6.2 evidence artefacts record measured results only', () => {
  const validation = read('docs/checkgates/V1_6_2_VALIDATION.txt');
  assert.match(validation, /exit code: 0/);
  assert.match(validation, /tests 543/);
  assert.match(validation, /pass 543/);
  assert.match(validation, /fail 0/);
  assert.match(validation, /Live Workspace verification is BLOCKED \/ NOT_RUN/);
  assert.match(validation, /NOT APPROVED FOR PRODUCTION/);

  const performance = JSON.parse(read('docs/checkgates/V1_6_2_PERFORMANCE.json'));
  assert.equal(performance.liveWorkspace, 'NOT_RUN');
  assert.equal(performance.datasets.length, 3);
  performance.datasets.forEach(entry => {
    for (const key of ['overview', 'bootstrap', 'taskIndex', 'requestApproval', 'requestReconciliation',
      'auditFinalization']) {
      assert.equal(typeof entry[key].p50Ms, 'number', key + ' must be measured');
      assert.equal(typeof entry[key].payloadBytes, 'number', key + ' must report its payload');
    }
    assert.equal(typeof entry.responsibilitySwitch.before.p50Ms, 'number');
    assert.equal(typeof entry.responsibilitySwitch.after.p50Ms, 'number');
    assert.equal(entry.ui.taskIndexLoaded, true);
    assert.equal(entry.ui.cachedNavigationMs.p50 < 100, true, 'cached navigation stays under 100 ms');
    assert.equal(entry.ui.localSearchMs.p50 < 50, true, 'local filtering stays under 50 ms');
  });
});

test('the schema, contract and migration boundaries are unchanged by this release', () => {
  assert.match(read('src/Schema.gs'), /return \{ version: 8,/);
  assert.match(read('src/Migrations.gs'), /007_responsibility_hierarchy_and_lifecycle', from: 6, to: 7/);
  // V1.7 adds its own reviewed identifier; the corrective release still added none of its own.
  assert.match(read('src/Migrations.gs'), /008_task_and_responsibility_members', from: 7, to: 8/);
  assert.match(read('src/SharedDashboardModel.gs'), /CONTRACT_VERSION = '1\.6'/);
  assert.match(read('DATA_SCHEMA.md'), /current schema version is \*\*8\*\*/);
  assert.match(read('DATA_SCHEMA.md'), /## V1\.6\.2 compatibility/);
  // The request journal reuses AUDIT_LOG instead of adding a column or a table.
  assert.doesNotMatch(read('src/Schema.gs'), /REQUEST_JOURNAL|REQUEST_OPERATIONS/);
});

test('the new recovery entrypoints stay authorisation-gated', () => {
  const requests = read('src/Requests.gs');
  assert.match(requests, /function reconcileRequestDecision[\s\S]{0,120}Access\.requireManager\(\)/);
  assert.match(requests, /function previewRequestDecisionReconciliation[\s\S]{0,120}Access\.requireManager\(\)/);
  assert.match(requests, /function reconcileRequestInbox[\s\S]{0,120}Access\.requireManager\(\)/);
  assert.match(requests, /function previewRequestInboxReconciliation[\s\S]{0,120}Access\.requireManager\(\)/);
  const completion = read('src/Completion.gs');
  assert.match(completion, /function reconcileCompletionOverrides[\s\S]{0,120}Access\.requireAdmin\(\)/);
  assert.match(completion, /function previewCompletionOverrideReconciliation[\s\S]{0,120}Access\.requireAdmin\(\)/);
  // The state-based guess is gone: no function infers an application from the task row.
  assert.doesNotMatch(requests, /function alreadyApplied/);
});

test('the production readiness record is updated and claims no live evidence', () => {
  const readiness = read('docs/PRODUCTION_READINESS.md');
  assert.match(readiness, /NOT APPROVED FOR PRODUCTION/);
  assert.match(readiness, /Current assessment — V1\.7/);
  assert.match(readiness, /Historical V1\.6\.2 assessment/);
  assert.match(readiness, /UNVERIFIED/);
  assert.match(readiness, /## Historical V1\.6\.1 assessment/);
});

test('the operating documents describe the V1.6.2 recovery rules', () => {
  const workflow = read('docs/DEADLINE_REQUEST_WORKFLOW.md');
  assert.match(workflow, /REQUEST_DECISION_PREPARED/);
  assert.match(workflow, /REQUEST_RECONCILE_REQUIRED/);
  assert.match(workflow, /reconcileRequestDecision/);
  const inbox = read('docs/REQUEST_INBOX_DEPLOYMENT.md');
  assert.match(inbox, /RECONCILE REQUEST INBOX/);
  assert.match(inbox, /MISSING_INBOX_ROW/);
  const runbook = read('docs/V1_6_DEPLOYMENT_RUNBOOK.md');
  assert.match(runbook, /V1\.6\.2 note/);
  assert.match(runbook, /reconcileCompletionOverrides/);
  const manager = read('docs/MANAGER_WORKFLOW.md');
  assert.match(manager, /## V1\.6\.2 corrections to the daily workflow/);
  const architecture = read('ARCHITECTURE.md');
  assert.match(architecture, /## V1\.6\.2 corrective architecture notes/);
  const performance = read('docs/MANAGER_WEB_APP_PERFORMANCE.md');
  assert.match(performance, /V1\.6\.2/);
  assert.match(performance, /V1_6_2_PERFORMANCE\.json/);
});
