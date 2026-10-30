'use strict';

/**
 * V1.4.1 release guards: the check gates, the documentation claims that changed with the
 * simplified authorization policy, and the "still not approved for production" stance.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('the V1.4.1 check gates exist and record a status', () => {
  for (const index of [1, 2, 3, 4, 5, 6]) {
    const relative = 'docs/checkgates/V1_4_1_GATE_' + index + '.md';
    assert.ok(fs.existsSync(path.join(ROOT, relative)), relative + ' is missing');
    const content = read(relative);
    assert.match(content, /^# V1\.4\.1 gate/m, relative + ' needs a heading');
    assert.match(content, /Status: \*\*(PASS|FAIL|BLOCKED)/, relative + ' needs a recorded status');
  }
});

test('production readiness stays unapproved for V1.4.1', () => {
  const readiness = read('docs/PRODUCTION_READINESS.md');
  assert.match(readiness, /NOT APPROVED FOR PRODUCTION/);
  assert.match(readiness, /Version \| 1\.4\.1/);
  assert.match(readiness, /Schema version \| 6/);
  assert.match(readiness, /328 tests, 328 pass/);
});

test('the installation documentation describes schema 6 and INITIALIZE_V6', () => {
  for (const relative of ['DEPLOYMENT.md', 'docs/PRE_TRIAL_CHECKLIST.md']) {
    const content = read(relative);
    assert.match(content, /INITIALIZE_V6/, relative + ' must document INITIALIZE_V6');
    assert.doesNotMatch(content, /INITIALIZE_V5/, relative + ' must not describe the V5 record');
    assert.match(content, /006_responsibilities_and_nested_subprojects/, relative + ' must name the V5 upgrade');
  }
});

test('the documentation states the simplified authorization policy', () => {
  const security = read('docs/SECURITY_MODEL.md');
  assert.match(security, /internal departmental tool/);
  assert.match(security, /no\s+per-project, per-responsibility or per-subproject access control/);
  assert.doesNotMatch(security, /MANAGER \| only the responsibilities they own/);
  assert.match(read('docs/RESPONSIBILITIES.md'), /any manager administers any responsibility|MANAGER \| Everything above/);
  assert.match(read('AGENTS.md'), /## V1\.4\.1 mandatory rules/);
  assert.match(read('AGENTS.md'), /Ownership is accountability, not permission/);
});

test('Japanese organizational wording uses 廃止 and 再有効化', () => {
  const dictionary = read('shared/i18n.js');
  assert.match(dictionary, /'manager\.responsibility\.retired': '廃止'/);
  assert.match(dictionary, /'manager\.responsibility\.reactivate': '再有効化'/);
  assert.match(dictionary, /'dashboard\.filter\.responsibility\.retired': '\{name\}（廃止）'/);
  // The generated copies must stay in sync with the source dictionary.
  const generated = read('src/I18n.html');
  assert.match(generated, /'manager\.responsibility\.retired': '廃止'/);
  const dashboardCopy = read('dashboard-app/I18n.html');
  assert.match(dashboardCopy, /'manager\.responsibility\.retired': '廃止'/);
});

test('the release notes describe the V1.4.1 behaviour', () => {
  const changelog = read('CHANGELOG.md');
  assert.match(changelog, /## V1\.4\.1/);
  assert.match(changelog, /manage every project, subproject, task/);
  assert.match(changelog, /INITIALIZE_V6/);
  assert.match(changelog, /328 passing/);
});

test('the package, publisher and README agree on the release version', () => {
  assert.match(read('package.json'), /"version": "1\.7\.7"/);
  assert.match(read('src/SharedDashboardPublisher.gs'), /PUBLISHER_VERSION = '1\.7\.0'/);
  assert.match(read('README.md'), /328 passing/);
  assert.match(read('README_JP.md'), /328件すべて成功/);
});
