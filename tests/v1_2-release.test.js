'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

const DASHBOARD_DOCS = [
  'docs/dashboard/ARCHITECTURE.md',
  'docs/dashboard/VISUAL_SPEC.md',
  'docs/dashboard/ACCESS_AND_SHARING.md',
  'docs/dashboard/DEPLOYMENT.md',
  'docs/dashboard/SMOKE_TEST.md',
  'docs/dashboard/DATA_CONTRACT.md'
];

const GATES = [
  'docs/checkgates/V1_2_GATE_1.md',
  'docs/checkgates/V1_2_GATE_2.md',
  'docs/checkgates/V1_2_GATE_3.md',
  'docs/checkgates/V1_2_GATE_4.md',
  'docs/checkgates/V1_2_GATE_5.md'
];

test('V1.2 dashboard documentation and check gates exist', () => {
  DASHBOARD_DOCS.forEach(file => {
    assert.ok(fs.existsSync(path.join(root, file)), file + ' is missing');
    assert.ok(read(file).length > 1500, file + ' looks empty');
  });
  GATES.forEach(file => {
    assert.ok(fs.existsSync(path.join(root, file)), file + ' is missing');
    const content = read(file);
    assert.match(content, /\bResult\b[^\n]*\*\*(PASS|FAIL|BLOCKED)/, file + ' must record a gate result');
    assert.match(content, /Evidence/, file + ' must record evidence');
  });
});

test('operating documentation describes the shared dashboard', () => {
  const expectations = [
    ['README.md', /V1\.2|shared dashboard|ダッシュボード/i],
    ['README_JP.md', /V1\.2/],
    ['ARCHITECTURE.md', /dashboard-app/],
    ['DATA_SCHEMA.md', /004_shared_dashboard/],
    ['DATA_SCHEMA.md', /Dashboard_Visibility/],
    ['DEPLOYMENT.md', /dashboard-app/],
    ['AGENTS.md', /V1\.2 shared dashboard rules/],
    ['.github/copilot-instructions.md', /Shared dashboard \(V1\.2\)/],
    ['docs/SECURITY_MODEL.md', /dashboard/i],
    ['docs/PRODUCTION_READINESS.md', /V1\.2/],
    ['CHANGELOG.md', /V1\.2 shared dashboard/]
  ];
  expectations.forEach(([file, pattern]) => {
    assert.match(read(file), pattern, file + ' does not describe V1.2');
  });
});

test('production readiness stays unapproved and marks dashboard behaviour unverified', () => {
  const content = read('docs/PRODUCTION_READINESS.md');
  assert.match(content, /NOT APPROVED FOR PRODUCTION/);
  assert.match(content, /UNVERIFIED/);
  assert.doesNotMatch(content, /\bAPPROVED\b(?! FOR PRODUCTION)/, 'the release must not be marked approved');
});

test('the repository keeps deployment configuration out of version control', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /^\.clasp\.json$/m);
  assert.match(ignore, /^\.clasp\.\*\.json$/m);
  assert.equal(fs.existsSync(path.join(root, '.clasp.json')), false, '.clasp.json must not be committed');
  const dashboardManifest = JSON.parse(read('dashboard-app/appsscript.json'));
  assert.equal(dashboardManifest.webapp.access, 'DOMAIN');
  assert.equal(dashboardManifest.webapp.executeAs, 'USER_DEPLOYING');
  assert.deepEqual(dashboardManifest.oauthScopes, [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/userinfo.email'
  ]);
  const managerManifest = JSON.parse(read('src/appsscript.json'));
  assert.ok(managerManifest.oauthScopes.indexOf('https://www.googleapis.com/auth/spreadsheets') >= 0,
    'the manager application keeps its own scopes');
  assert.notDeepEqual(managerManifest.oauthScopes, dashboardManifest.oauthScopes);
});

test('the dashboard project contains no write, mail, calendar, trigger or fetch surface', () => {
  const files = fs.readdirSync(path.join(root, 'dashboard-app')).filter(name => name.endsWith('.gs'));
  const source = files.map(name => fs.readFileSync(path.join(root, 'dashboard-app', name), 'utf8')).join('\n');
  [
    /\.setValues?\(/, /\.appendRow\(/, /\.insertSheet\(/, /\.delete/,
    /MailApp/, /GmailApp/, /CalendarApp/, /ScriptApp/, /UrlFetchApp/, /DriveApp/,
    /getProperty\(\s*'SPREADSHEET_ID'\s*\)/,
    /\bDatabase\./, /\bSchema\./, /\bAccess\./, /\bAutomationSettings\./
  ].forEach(pattern => {
    assert.doesNotMatch(source, pattern, 'dashboard source must not contain ' + pattern);
  });
  const html = fs.readdirSync(path.join(root, 'dashboard-app')).filter(name => name.endsWith('.html'))
    .map(name => fs.readFileSync(path.join(root, 'dashboard-app', name), 'utf8')).join('\n');
  assert.doesNotMatch(html, /\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/);
  assert.match(html, /閲覧のみ/);
});

test('source validation passes for both applications', () => {
  const output = execFileSync(process.execPath, [path.join(root, 'scripts/validate-source.js')], { encoding: 'utf8' });
  assert.match(output, /manager Apps Script files/);
  assert.match(output, /dashboard files/);
});

test('new V1.2 sources contain no real identifiers, credentials or employee e-mail addresses', () => {
  const files = [
    'src/SharedDashboardModel.gs',
    'src/SharedDashboardPublisher.gs',
    'dashboard-app/App.gs',
    'dashboard-app/DataService.gs',
    'dashboard-app/Index.html',
    'dashboard-app/Client.html',
    'dashboard-app/Styles.html',
    'scripts/dashboard-preview.js'
  ];
  files.forEach(file => {
    const content = read(file);
    assert.doesNotMatch(content, /@(?!example\.test)[a-z0-9.-]+\.[a-z]{2,}/i, file + ' contains an e-mail address');
    assert.doesNotMatch(content, /AKfycb|AIza[0-9A-Za-z_-]{10,}|1[A-Za-z0-9_-]{20,}/, file + ' contains a credential-like value');
    assert.doesNotMatch(content, /spreadsheets\/d\/[A-Za-z0-9_-]{20,}/, file + ' contains a spreadsheet URL');
  });
});

test('the preview tooling documents that it is not Workspace evidence', () => {
  const source = read('scripts/dashboard-preview.js');
  assert.match(source, /Development tooling only/);
  assert.match(source, /static file/);
  const visual = read('docs/dashboard/VISUAL_SPEC.md');
  assert.match(visual, /not Google Workspace behaviour/);
  assert.match(visual, /UNVERIFIED/);
});
