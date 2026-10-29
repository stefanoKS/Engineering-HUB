'use strict';

/**
 * V1.3 release gate: documentation, gates, credentials and honest status.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const NEW_DOCS = [
  'docs/UI_LOCALIZATION.md',
  'docs/TASK_DURATION_POLICY.md',
  'docs/DEADLINE_REQUEST_WORKFLOW.md',
  'docs/REQUEST_INBOX_DEPLOYMENT.md'
];

const GATES = [1, 2, 3, 4, 5, 6, 7].map(number => `docs/checkgates/V1_3_GATE_${number}.md`);

test('V1.3 documentation and check gates exist', () => {
  NEW_DOCS.forEach(file => {
    assert.ok(fs.existsSync(path.join(root, file)), file + ' is missing');
    assert.ok(read(file).length > 1500, file + ' looks empty');
  });
  GATES.forEach(file => {
    assert.ok(fs.existsSync(path.join(root, file)), file + ' is missing');
    const content = read(file);
    assert.match(content, /\bResult\b[^\n]*\*\*(PASS|FAIL|BLOCKED)/, file + ' must record a gate result');
    assert.match(content, /Evidence/, file + ' must record evidence');
    assert.match(content, /UNVERIFIED/, file + ' must keep live verification separate');
  });
});

test('operating documentation describes V1.3', () => {
  const expectations = [
    ['README.md', /V1\.3/],
    ['README.md', /設計・開発課 管理/],
    ['README.md', /TASK_DURATION_POLICY\.md/],
    ['README_JP.md', /V1\.3/],
    ['README_JP.md', /設計・開発課 管理/],
    ['AGENTS.md', /V1\.3 mandatory rules/],
    ['AGENTS.md', /overlapping assignments/],
    ['.github/copilot-instructions.md', /V1\.3 rules/],
    ['ARCHITECTURE.md', /V1\.3/],
    ['ARCHITECTURE.md', /RequestService\.gs/],
    ['DATA_SCHEMA.md', /005_task_planning_and_requests/],
    ['DATA_SCHEMA.md', /TASK_REQUESTS/],
    ['DATA_SCHEMA.md', /TASK_DEADLINE_HISTORY/],
    ['DEPLOYMENT.md', /V1\.3/],
    ['DEPLOYMENT.md', /REQUEST_INBOX_SPREADSHEET_ID/],
    ['CHANGELOG.md', /V1\.3/],
    ['docs/SECURITY_MODEL.md', /V1\.3/],
    ['docs/PRODUCTION_READINESS.md', /V1\.3/],
    ['docs/MANAGER_WORKFLOW.md', /申請一覧/],
    ['docs/AUTOMATION_SETTINGS.md', /DEADLINE_REQUEST_EMAIL_ENABLED/],
    ['docs/dashboard/ARCHITECTURE.md', /V1\.3/],
    ['docs/dashboard/VISUAL_SPEC.md', /V1\.3/],
    ['docs/dashboard/ACCESS_AND_SHARING.md', /V1\.3/],
    ['docs/dashboard/DEPLOYMENT.md', /V1\.3/],
    ['docs/dashboard/SMOKE_TEST.md', /V1\.3/],
    ['docs/dashboard/DATA_CONTRACT.md', /Contract 1\.3/]
  ];
  expectations.forEach(([file, pattern]) => {
    assert.match(read(file), pattern, file + ' does not describe V1.3');
  });
});

test('the localization documentation states the rules that must never regress', () => {
  const content = read('docs/UI_LOCALIZATION.md');
  assert.match(content, /What is never translated/);
  assert.match(content, /descriptions, acceptance criteria, next actions and public notes/);
  assert.match(content, /Japanese is the default|default language/i);
  assert.match(content, /localStorage/);
  assert.match(content, /No third-party translation API/);
  assert.match(content, /日本語 \| English/);
});

test('production readiness stays unapproved for V1.3', () => {
  const content = read('docs/PRODUCTION_READINESS.md');
  assert.match(content, /NOT APPROVED FOR PRODUCTION/);
  assert.match(content, /V1\.3 status/);
  assert.match(content, /UNVERIFIED/);
});

test('new V1.3 sources contain no credentials, identifiers or employee addresses', () => {
  const files = [
    'shared/i18n.js',
    'shared/project-colors.js',
    'src/Requests.gs',
    'src/Planning.gs',
    'src/UiRequests.html',
    'src/UiLang.html',
    'dashboard-app/RequestService.gs',
    'dashboard-app/App.gs',
    'dashboard-app/DataService.gs',
    'dashboard-app/Client.html',
    'dashboard-app/Index.html',
    'scripts/sync-i18n.js'
  ];
  files.forEach(file => {
    const content = read(file);
    assert.doesNotMatch(content, /@(?!example\.test)[a-z0-9.-]+\.[a-z]{2,}/i, file + ' contains an e-mail address');
    assert.doesNotMatch(content, /AKfycb|AIza[0-9A-Za-z_-]{10,}|1[A-Za-z0-9_-]{20,}/, file + ' contains a credential-like value');
    assert.doesNotMatch(content, /spreadsheets\/d\/[A-Za-z0-9_-]{20,}/, file + ' contains a spreadsheet URL');
  });
  assert.equal(require('./support/repository').tracked(root, '.clasp.json'), false, '.clasp.json must not be committed');
  const gitignore = read('.gitignore');
  assert.match(gitignore, /^\.clasp\.json$/m);
});

test('the request inbox is never the private workbook or the snapshot', () => {
  const requests = read('src/Requests.gs');
  assert.match(requests, /Request inbox must be a separate spreadsheet/);
  assert.match(requests, /Request inbox must never be the private master workbook|must be a separate spreadsheet/);
  const service = read('dashboard-app/RequestService.gs');
  assert.match(service, /REQUEST_INBOX_SPREADSHEET_ID/);
  assert.doesNotMatch(service, /SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID/);
});

test('no destructive reset, restore or automatic deletion was added', () => {
  const files = ['src/Requests.gs', 'src/Planning.gs', 'dashboard-app/RequestService.gs'];
  files.forEach(file => {
    const content = read(file);
    assert.doesNotMatch(content, /setTrashed|deleteSheet|clearContents|deleteRows|restore|resetDatabase/i,
      file + ' must not contain destructive operations');
  });
});
