'use strict';
/**
 * V1.6.1 release gate: version agreement, six checkgates, evidence artefacts and the honest
 * production status. Live Workspace verification stays BLOCKED / NOT_RUN, and the historical
 * V1.6 evidence is left exactly as recorded.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('package, publisher, README and the manager page agree on V1.6.1', () => {
  assert.match(read('package.json'), /"version": "1\.6\.2"/);
  assert.match(read('src/SharedDashboardPublisher.gs'), /PUBLISHER_VERSION = '1\.6\.2'/);
  assert.match(read('README.md'), /## Current release — V1\.6\.2/);
  assert.match(read('README_JP.md'), /## 現行リリース — V1\.6\.2/);
  assert.match(read('src/ManagerWebIndex.html'), /V1\.6\.2/);
  assert.match(read('CHANGELOG.md'), /## V1\.6\.1/);
  // The V1.6 and V1.6.1 records are kept as history, never overwritten.
  assert.match(read('README.md'), /## Historical V1\.6 release record/);
  assert.match(read('README.md'), /## Historical V1\.6\.1 release record/);
  assert.match(read('CHANGELOG.md'), /## V1\.6 — /);
});

test('the six V1.6.1 checkgates exist and keep the release status honest', () => {
  for (let index = 1; index <= 6; index += 1) {
    const file = `docs/checkgates/V1_6_1_GATE_${index}.md`;
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
    const content = read(file);
    assert.match(content, /^# V1\.6\.1 gate/m, `${file} needs a heading`);
    assert.match(content, /Status: \*\*PASS\*\* \(local\) — \*\*BLOCKED\*\* for live verification/,
      `${file} must separate local PASS from live BLOCKED`);
    assert.match(content, /NOT APPROVED FOR PRODUCTION/, `${file} must keep the production status`);
    assert.match(content, /## 12\. Final gate status/, `${file} needs the final status section`);
  }
  // The twelve V1.6 gates stay exactly as recorded for that release.
  for (let index = 1; index <= 12; index += 1) {
    const content = read(`docs/checkgates/V1_6_GATE_${index}.md`);
    assert.match(content, /^# V1\.6 gate/m);
    assert.match(content, /Status: \*\*(PASS|FAIL|BLOCKED|NOT_RUN)/);
  }
});

test('the V1.6.1 evidence artefacts record measured results only', () => {
  const validation = read('docs/checkgates/V1_6_1_VALIDATION.txt');
  assert.match(validation, /exit code: 0/);
  assert.match(validation, /500/);
  assert.match(validation, /Live Workspace verification is BLOCKED \/ NOT_RUN/);
  const performance = JSON.parse(read('docs/checkgates/V1_6_1_PERFORMANCE.json'));
  assert.equal(performance.liveWorkspace, 'NOT_RUN');
  assert.equal(performance.datasets.length, 3);
  performance.datasets.forEach(entry => {
    assert.equal(typeof entry.overview.p50Ms, 'number');
    assert.equal(typeof entry.bootstrap.p50Ms, 'number');
    assert.equal(typeof entry.taskIndex.p50Ms, 'number');
    assert.equal(entry.ui.taskIndexLoaded, true);
  });
});

test('the schema, contract and migration boundaries are unchanged by this release', () => {
  assert.match(read('src/Schema.gs'), /return \{ version: 7,/);
  assert.match(read('src/Migrations.gs'), /007_responsibility_hierarchy_and_lifecycle', from: 6, to: 7/);
  assert.doesNotMatch(read('src/Migrations.gs'), /008_/, 'a corrective release adds no migration');
  const model = read('src/SharedDashboardModel.gs');
  assert.match(model, /CONTRACT_VERSION = '1\.5'/);
  assert.match(read('DATA_SCHEMA.md'), /current schema version is \*\*7\*\*/);
});

test('the production readiness record is unchanged and claims no live evidence', () => {
  const readiness = read('docs/PRODUCTION_READINESS.md');
  assert.match(readiness, /NOT APPROVED FOR PRODUCTION/);
  assert.match(readiness, /V1\.6\.1|V1\.6/);
});

test('the performance document records the corrected figures and the disclosed regression', () => {
  const performance = read('docs/MANAGER_WEB_APP_PERFORMANCE.md');
  assert.match(performance, /V1\.6\.1/);
  assert.match(performance, /Disclosed regression|disclosed regression|V1\.6\.1 regression/);
  assert.match(performance, /V1_6_1_PERFORMANCE\.json/);
});
