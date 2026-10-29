'use strict';
/** V1.5.1 release record: version agreement, performance evidence and unchanged boundaries. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('package, publisher, README and UI agree on the current release', () => {
  assert.match(read('package.json'), /"version": "1\.7\.0"/);
  assert.match(read('src/SharedDashboardPublisher.gs'), /PUBLISHER_VERSION = '1\.7\.0'/);
  assert.match(read('README.md'), /## Current release — V1\.7/);
  assert.match(read('README_JP.md'), /## 現行リリース — V1\.7/);
  // The V1.5.1 result is kept as history, exactly as released.
  assert.match(read('README.md'), /406 tests, 406 pass/);
  assert.match(read('README_JP.md'), /406件すべて成功/);
  assert.match(read('src/ManagerWebIndex.html'), /V1\.7/);
});

test('the ten V1.5.1 checkgates exist and keep the release status honest', () => {
  for (let index = 1; index <= 10; index += 1) {
    const file = `docs/checkgates/V1_5_1_GATE_${index}.md`;
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
    const content = read(file);
    assert.match(content, /NOT APPROVED FOR\s+PRODUCTION/, `${file} must keep the production status`);
    assert.match(content, /Status: \*\*(BLOCKED|PASS|FAIL)\*\*/, `${file} must record a status`);
  }
});

test('raw V1.5.1 performance evidence exists and never claims a live measurement', () => {
  const report = JSON.parse(read('docs/checkgates/V1_5_1_PERFORMANCE.json'));
  assert.equal(report.liveWorkspace, 'NOT_RUN');
  assert.deepEqual(report.datasets.map(entry => entry.projects), [10, 100, 300]);
  for (const entry of report.datasets) {
    assert.equal(entry.bootstrap.rangeReadsPerCall, 10, 'bootstrap reads nine tables plus the marker');
    assert.equal(entry.taskIndex.rangeReadsPerCall, 4, 'taskIndex reads three tables plus the marker');
    assert.equal(entry.bootstrap.workbookOpensPerCall, 1);
    for (const key of ['cachedNavigationMs', 'localSearchMs', 'inFlightNavigationMs']) {
      assert.ok(entry.ui[key].p50 >= 0 && entry.ui[key].p95 >= entry.ui[key].p50, key);
    }
    assert.ok(entry.ui.rpcAfterInitialLoad <= 3);
    assert.equal(entry.previousUi.rpcForOverviewProjectsTasks, 4);
  }
  assert.match(read('docs/MANAGER_WEB_APP_PERFORMANCE.md'), /NOT_RUN/);
});

test('schema, contract, execute-as and the production status are unchanged', () => {
  assert.equal(read('src/Schema.gs').match(/version:\s*8/)[0].replace(/\s/g, ''), 'version:8');
  assert.match(read('src/SharedDashboardModel.gs'), /CONTRACT_VERSION = '1\.6'/);
  const manager = JSON.parse(read('src/appsscript.json'));
  const employee = JSON.parse(read('dashboard-app/appsscript.json'));
  assert.deepEqual(manager.webapp, {access: 'DOMAIN', executeAs: 'USER_ACCESSING'});
  assert.equal(employee.webapp.executeAs, 'USER_DEPLOYING');
  assert.match(read('docs/PRODUCTION_READINESS.md'), /NOT APPROVED FOR PRODUCTION/);
});

test('the manager page keeps private records in memory only', () => {
  const client = read('src/ManagerWebClient.html');
  assert.doesNotMatch(client, /localStorage\s*\.\s*(get|set|remove)Item|indexedDB\s*\.\s*open|sessionStorage\s*\./i);
  assert.doesNotMatch(client, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(client, /bootstrap/);
  assert.match(client, /taskIndex/);
  assert.match(client, /MANAGER_ACCESS_DENIED/);
});
