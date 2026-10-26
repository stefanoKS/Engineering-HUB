'use strict';

/**
 * V1.4 release guards: the documentation, the check gates, the shared contract version and the
 * claim that production readiness is still unapproved.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, loadDashboard } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

test('the V1.4 documentation and check gates exist', () => {
  [
    'docs/RESPONSIBILITIES.md',
    'docs/UI_UX_GUIDELINES.md',
    'docs/checkgates/V1_4_GATE_1.md',
    'docs/checkgates/V1_4_GATE_2.md',
    'docs/checkgates/V1_4_GATE_3.md',
    'docs/checkgates/V1_4_GATE_4.md',
    'docs/checkgates/V1_4_GATE_5.md',
    'docs/checkgates/V1_4_GATE_6.md'
  ].forEach(relative => assert.ok(fs.existsSync(path.join(ROOT, relative)), relative + ' is missing'));
});

test('every V1.4 gate records an explicit status with evidence', () => {
  for (const index of [1, 2, 3, 4, 5, 6]) {
    const content = read('docs/checkgates/V1_4_GATE_' + index + '.md');
    assert.match(content, /^# V1\.4 gate/m, 'gate ' + index + ' needs a heading');
    assert.match(content, /Status: \*\*(PASS|FAIL|BLOCKED)/, 'gate ' + index + ' needs a recorded status');
  }
});

test('the schema, migration and contract versions are documented consistently', () => {
  const schema = read('src/Schema.gs');
  assert.match(schema, /return \{ version: 6,/);
  const migrations = read('src/Migrations.gs');
  assert.match(migrations, /006_responsibilities_and_nested_subprojects', from: 5, to: 6/);
  assert.match(read('DATA_SCHEMA.md'), /current schema version is \*\*6\*\*/);
  assert.match(read('DATA_SCHEMA.md'), /006_responsibilities_and_nested_subprojects/);
  assert.match(read('DEPLOYMENT.md'), /V1\.4 upgrade \(5 → 6\)/);
  assert.match(read('docs/dashboard/DATA_CONTRACT.md'), /## Contract 1\.4/);
});

test('the publisher and the viewer agree on contract 1.4', () => {
  const manager = loadApp();
  const viewer = loadDashboard();
  const published = manager.context.SharedDashboardModel.CONTRACT_VERSION;
  assert.equal(published, '1.4');
  assert.equal(viewer.context.DashboardData.CONTRACT_VERSION, published);
  // Field lists must match exactly, or a publication would be unreadable.
  var model = manager.context.SharedDashboardModel;
  const tables = viewer.context.DashboardData.TABLES;
  assert.deepEqual(plain(tables.responsibilities.fields), plain(model.RESPONSIBILITY_PUBLIC_FIELDS));
  assert.deepEqual(plain(tables.projects.fields), plain(model.PROJECT_PUBLIC_FIELDS));
  assert.deepEqual(plain(tables.subprojects.fields), plain(model.SUBPROJECT_PUBLIC_FIELDS));
  assert.deepEqual(plain(tables.tasks.fields), plain(model.TASK_PUBLIC_FIELDS));
  assert.deepEqual(plain(tables.milestones.fields), plain(model.MILESTONE_PUBLIC_FIELDS));
});

test('the manager templates share one token set and Japanese-first font stack', () => {
  ['UiMenu', 'UiRequests', 'UiSettings', 'UiSystem'].forEach(name => {
    const content = read('src/' + name + '.html');
    ['--accent: #365F7D', '--text: #27333E', '--amber: #8C5A15', '--red: #A83E3A']
      .forEach(token => assert.ok(content.indexOf(token) >= 0, name + ' must define ' + token));
    assert.match(content, /"Hiragino Sans"/, name + ' must use the Japanese-first font stack');
    assert.match(content, /prefers-reduced-motion/, name + ' must respect reduced motion');
  });
  const dashboard = read('dashboard-app/Styles.html');
  ['--accent: #365F7D', '--text: #27333E', '--amber: #8C5A15', '--red: #A83E3A']
    .forEach(token => assert.ok(dashboard.indexOf(token) >= 0, 'the dashboard must define ' + token));
});

test('production readiness stays unapproved for V1.4', () => {
  const readiness = read('docs/PRODUCTION_READINESS.md');
  assert.match(readiness, /NOT APPROVED FOR PRODUCTION/);
  assert.match(readiness, /Version \| 1\.4\.[01]/);
  assert.match(readiness, /Schema version \| 6/);
});

test('no new source introduces credentials, real identifiers or a destructive reset', () => {
  const sources = ['src/Responsibilities.gs', 'src/Subprojects.gs', 'src/Access.gs', 'src/Schema.gs',
    'src/Migrations.gs', 'src/SharedDashboardModel.gs', 'src/SharedDashboardPublisher.gs',
    'src/Ui.gs', 'src/Progress.gs', 'src/Eligibility.gs', 'dashboard-app/DataService.gs',
    'dashboard-app/Client.html'];
  sources.forEach(relative => {
    const content = read(relative);
    assert.doesNotMatch(content, /BEGIN [A-Z ]*PRIVATE KEY/, relative + ' contains a private key');
    assert.doesNotMatch(content, /client_secret|refresh_token|ya29\.|AIza[0-9A-Za-z_-]{30}/, relative + ' contains credentials');
    assert.doesNotMatch(content, /@gmail\.com/, relative + ' contains a real mailbox');
    assert.doesNotMatch(content,
      /\.(?:clear|clearContent|clearContents|deleteSheet|deleteRows?|deleteColumns?|deleteCells)\s*\(/,
      relative + ' must not use a destructive API');
  });
  const responsibilities = read('src/Responsibilities.gs');
  assert.doesNotMatch(responsibilities, /MailApp\s*\.\s*sendEmail\s*\(/);
  const client = read('dashboard-app/Client.html');
  assert.doesNotMatch(client, /\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/);
});

test('the V1.4 release notes describe the behaviour that was implemented', () => {
  const changelog = read('CHANGELOG.md');
  assert.match(changelog, /## V1\.4/);
  assert.match(changelog, /RESPONSIBILITIES/);
  assert.match(changelog, /Parent_Subproject_ID/);
  assert.match(changelog, /REQUEST_SUBMISSION_ENABLED/);
  const agents = read('AGENTS.md');
  assert.match(agents, /## V1\.4 mandatory rules/);
});
