'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const managerDir = path.join(root, 'src');
const dashboardDir = path.join(root, 'dashboard-app');

const UNSAFE_HTML = /\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/;
const DESTRUCTIVE = /\.(?:clear|clearContent|clearContents|deleteSheet|deleteRows?|deleteColumns?|deleteCells|setTrashed|removeFile|removeFolder)\s*\(/;

function read(directory, name) {
  return fs.readFileSync(path.join(directory, name), 'utf8');
}

function scripts(directory) {
  return fs.readdirSync(directory).filter(name => name.endsWith('.gs')).sort();
}

function htmls(directory) {
  return fs.readdirSync(directory).filter(name => name.endsWith('.html')).sort();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/* ------------------------------------------------------------------ *
 * Manager application (src/)
 * ------------------------------------------------------------------ */

const files = scripts(managerDir);
assert(files.length, 'No Apps Script source files found');
const sources = files.map(name => {
  const source = read(managerDir, name);
  new vm.Script(source, { filename: name });
  // Only the schema-guarded generated-sheet writer may replace sheet contents.
  const generatedWriter = /function writeGenerated\(name, rows\) \{\s*(?:if \(readContext && !readContext\.allowWrites\) throw new Error\("Writes are forbidden in a read context"\);\s*)?if \(Schema\.generated\.indexOf\(name\) < 0\) throw new Error\('[^']*'\);\s*var sheet = book\(\)\.getSheetByName\(name\) \|\| book\(\)\.insertSheet\(name\);\s*sheet\.clearContents\(\);/;
  // V1.6 adds exactly one reviewed row-removal surface, guarded by Deletion.preflight.
  const deletionWriter = /^\s*sheet\.deleteRow\(index \+ 1\);$/m;
  const checkedSource = name === 'Database.gs' ? source.replace(generatedWriter, '')
    : name === 'Deletion.gs' ? source.replace(deletionWriter, '')
    : source;
  assert(!DESTRUCTIVE.test(checkedSource), `${name}: destructive APIs are prohibited in production source`);
  return source;
});
new vm.Script(sources.join('\n;\n'), { filename: 'combined-app.gs' });

// Mail authorization must stay centralized: only the notification service may send.
files.forEach(name => {
  assert(name === 'Notifications.gs' || !/MailApp\s*\.\s*sendEmail\s*\(/.test(read(managerDir, name)),
    `${name}: MailApp.sendEmail is only allowed in Notifications.gs`);
});

// HTML templates must exist and be referenced, and clasp must package them.
function checkTemplates(directory, sourceFiles, label) {
  const documentFiles = htmls(directory);
  assert(documentFiles.length, `${label}: no HTML templates found`);
  const templates = new Set();
  const partials = new Set();
  sourceFiles.forEach(name => {
    const pattern = /createHtmlOutputFromFile\(\s*'([^']+)'\s*\)/g;
    let match;
    const source = read(directory, name);
    while ((match = pattern.exec(source)) !== null) templates.add(match[1]);
  });
  documentFiles.forEach(name => {
    const pattern = /include\(\s*'([^']+)'\s*\)/g;
    let match;
    const content = read(directory, name);
    while ((match = pattern.exec(content)) !== null) partials.add(match[1]);
  });
  templates.forEach(template => {
    assert(documentFiles.includes(`${template}.html`), `${label}: missing HTML template ${template}.html`);
  });
  partials.forEach(template => {
    assert(documentFiles.includes(`${template}.html`), `${label}: missing HTML include ${template}.html`);
  });
  documentFiles.forEach(name => {
    const content = read(directory, name);
    const isPartial = partials.has(name.replace(/\.html$/, ''));
    assert(isPartial || /<!DOCTYPE html>/i.test(content), `${label}/${name}: HTML document expected`);
    // Stored spreadsheet text is untrusted: templates must never build markup from data.
    assert(!UNSAFE_HTML.test(content), `${label}/${name}: unsafe HTML insertion is prohibited; use textContent/DOM creation`);
  });
  return documentFiles;
}
checkTemplates(managerDir, files, 'src');

const claspIgnore = fs.readFileSync(path.join(root, '.claspignore'), 'utf8');
if (!/\*\*\/\*\.html/.test(claspIgnore)) throw new Error('.claspignore must include HTML templates in the push payload');

const manifest = JSON.parse(read(managerDir, 'appsscript.json'));
if (manifest.runtimeVersion !== 'V8') throw new Error('Apps Script V8 runtime is required');
if (manifest.timeZone !== 'Asia/Tokyo') throw new Error('Manifest timezone must be Asia/Tokyo');

/* ------------------------------------------------------------------ *
 * Shared dashboard web app (dashboard-app/)
 *
 * A separate Apps Script project. It must stay strictly read-only and
 * must never reach the private management workbook.
 * ------------------------------------------------------------------ */

const REQUIRED_DASHBOARD_FILES = ['App.gs', 'DataService.gs', 'RequestService.gs', 'I18n.html', 'ProjectColors.html', 'Index.html', 'Styles.html', 'Client.html', 'appsscript.json'];
REQUIRED_DASHBOARD_FILES.forEach(name => {
  assert(fs.existsSync(path.join(dashboardDir, name)), `dashboard-app/${name} is missing`);
});

const dashboardFiles = scripts(dashboardDir);
assert(dashboardFiles.length, 'No dashboard Apps Script source files found');
// V1.3 adds exactly one write surface: appending a validated request to the inbox.
const INBOX_WRITER = 'RequestService.gs';
const dashboardSources = dashboardFiles.map(name => {
  const source = read(dashboardDir, name);
  new vm.Script(source, { filename: `dashboard/${name}` });

  // Read-only by construction, except for the narrow request-inbox writer.
  const writeApis = /\.(?:setValue|setValues|setFormula|setFormulas|setNumberFormat|setDataValidation|appendRow|insertRow|insertRows|insertColumn|insertColumns|insertSheet|copyTo)\(\s*/;
  if (name === INBOX_WRITER) {
    assert(/REQUEST_INBOX_SPREADSHEET_ID/.test(source),
      `${INBOX_WRITER}: the only permitted write target must be the request inbox property`);
    assert(!/SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID/.test(source),
      `${INBOX_WRITER}: the request inbox writer must never open the published snapshot`);
    assert(!/\.(?:setFormula|setFormulas|setDataValidation|insertSheet|insertRows?|insertColumns?|copyTo)\(\s*/.test(source),
      `${INBOX_WRITER}: only appended request rows are permitted; no structural spreadsheet writes`);
  } else {
    assert(!writeApis.test(source), `dashboard-app/${name}: spreadsheet writes are prohibited in the read-only dashboard`);
  }
  assert(!DESTRUCTIVE.test(source), `dashboard-app/${name}: destructive APIs are prohibited in the read-only dashboard`);

  // No outbound mail, Calendar, trigger or external request surface.
  ['MailApp', 'GmailApp', 'CalendarApp', 'ScriptApp', 'UrlFetchApp', 'DriveApp'].forEach(api => {
    assert(!new RegExp(`\\b${api}\\s*\\.`).test(source),
      `dashboard-app/${name}: ${api} is not available to the shared dashboard`);
  });

  // Private management modules must not be reachable from the viewer project.
  ['Database', 'Schema', 'Access', 'Roles', 'Notifications', 'AutomationSettings'].forEach(moduleName => {
    assert(!new RegExp(`\\b${moduleName}\\s*\\.`).test(source),
      `dashboard-app/${name}: ${moduleName} belongs to the manager application and must not be used here`);
  });

  // Only the sanitized snapshot property may be read.
  assert(!/getProperty\(\s*'SPREADSHEET_ID'\s*\)/.test(source),
    `dashboard-app/${name}: the dashboard must never read the master SPREADSHEET_ID property`);

  return source;
});
new vm.Script(dashboardSources.join('\n;\n'), { filename: 'combined-dashboard.gs' });

const dashboardHtmlFiles = checkTemplates(dashboardDir, dashboardFiles, 'dashboard-app');
assert(dashboardHtmlFiles.indexOf('Index.html') >= 0, 'dashboard-app/Index.html is required');

const dashboardManifest = JSON.parse(read(dashboardDir, 'appsscript.json'));
assert(dashboardManifest.runtimeVersion === 'V8', 'dashboard-app: V8 runtime is required');
assert(dashboardManifest.timeZone === 'Asia/Tokyo', 'dashboard-app: manifest timezone must be Asia/Tokyo');
assert(dashboardManifest.webapp, 'dashboard-app: a web app deployment requires a "webapp" section');
assert(dashboardManifest.webapp.access === 'DOMAIN',
  'dashboard-app: web app access must be restricted to the Workspace domain (no anonymous access)');
assert(dashboardManifest.webapp.executeAs === 'USER_DEPLOYING',
  'dashboard-app: the web app must execute as the authorized deployment account');
const DASHBOARD_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email'
];
(dashboardManifest.oauthScopes || []).forEach(scope => {
  assert(DASHBOARD_SCOPES.indexOf(scope) >= 0, `dashboard-app: unexpected OAuth scope ${scope}`);
});
assert((dashboardManifest.oauthScopes || []).indexOf('https://www.googleapis.com/auth/spreadsheets') >= 0,
  'dashboard-app: the dashboard must request spreadsheet access (snapshot read + request inbox append)');
assert((dashboardManifest.oauthScopes || []).indexOf('https://www.googleapis.com/auth/spreadsheets.readonly') < 0,
  'dashboard-app: a single spreadsheet scope is required; do not mix read-only and read/write scopes');

/* ------------------------------------------------------------------ *
 * V1.3 localization
 *
 * The translation dictionary is the single source of truth; both
 * Apps Script projects carry a generated copy. Stored spreadsheet text
 * is never translated, so only static labels live in the dictionary.
 * ------------------------------------------------------------------ */

const sync = require('./sync-i18n.js');
const i18nSource = fs.readFileSync(path.join(root, 'shared', 'i18n.js'), 'utf8');
const sandbox = {module: {exports: {}}};
vm.runInNewContext(i18nSource, sandbox, {filename: 'shared/i18n.js'});
const i18n = sandbox.module.exports;
assert(i18n && i18n.DICTIONARY, 'shared/i18n.js must export the EH_I18N dictionary');

sync.TARGETS.forEach(target => {
  const actual = fs.existsSync(target.file) ? fs.readFileSync(target.file, 'utf8') : '';
  assert(sync.matches(target, i18nSource, actual),
    `${path.relative(root, target.file)} is out of date; run "npm run sync:i18n"`);
});

/* ------------------------------------------------------------------ *
 * Shared project colour helper (shared/project-colors.js)
 *
 * The manager application and the employee dashboard must derive the
 * same accent for the same Project_ID, so both carry a generated copy
 * of one shared module. Only palette values may be returned: a project
 * ID never reaches a CSS colour.
 * ------------------------------------------------------------------ */

const colorSync = require('./sync-project-colors.js');
const colorSource = fs.readFileSync(path.join(root, 'shared', 'project-colors.js'), 'utf8');
const colorSandbox = {};
vm.runInNewContext(colorSource + '\nthis.EH_PROJECT_COLORS = EH_PROJECT_COLORS;', colorSandbox, {filename: 'shared/project-colors.js'});
const projectColors = colorSandbox.EH_PROJECT_COLORS;
assert(projectColors && Array.isArray(projectColors.PALETTE), 'shared/project-colors.js must export the palette');
assert(projectColors.PALETTE.length >= 8, 'the project palette must stay usable for a small portfolio');
projectColors.PALETTE.forEach(color => {
  assert(/^#[0-9A-F]{6}$/.test(color), 'palette entries must be opaque #RRGGBB values: ' + color);
});
['P1', 'P3', 'PROJ-001'].forEach(id => {
  const first = projectColors.colorFor(id);
  assert(projectColors.PALETTE.indexOf(first) >= 0, 'a project colour must come from the palette: ' + id);
  assert(projectColors.colorFor(id) === first, 'the project colour must be deterministic: ' + id);
});
assert(projectColors.colorFor('') === '', 'an empty project ID has no derived colour');

colorSync.TARGETS.forEach(target => {
  const actual = fs.existsSync(target.file) ? fs.readFileSync(target.file, 'utf8') : '';
  assert(colorSync.matches(target, colorSource, actual),
    `${path.relative(root, target.file)} is out of date; run "npm run sync:colors"`);
});

const jaKeys = Object.keys(i18n.DICTIONARY.ja).sort();
const enKeys = Object.keys(i18n.DICTIONARY.en).sort();
assert(JSON.stringify(jaKeys) === JSON.stringify(enKeys),
  'Every translation key must exist in both Japanese and English');
jaKeys.forEach(key => {
  const ja = i18n.DICTIONARY.ja[key];
  const en = i18n.DICTIONARY.en[key];
  assert(typeof ja === 'string' && ja.trim(), `Missing Japanese text for ${key}`);
  assert(typeof en === 'string' && en.trim(), `Missing English text for ${key}`);
});
assert(i18n.DICTIONARY.ja['app.name'] === '設計・開発課 管理' && i18n.DICTIONARY.en['app.name'] === '設計・開発課 管理',
  'The official application name must be identical in every language');
assert(i18n.DEFAULT_LANGUAGE === 'ja', 'The default interface language must be Japanese');
assert(i18n.LANGUAGES.join(',') === 'ja,en', 'Exactly Japanese and English are supported');

// Every static key referenced by a template or client script must exist.
function usedKeys(file) {
  const content = fs.readFileSync(file, 'utf8');
  const keys = new Set();
  const attribute = /data-i18n(?:-aria|-title|-placeholder)?="([^"]+)"/g;
  let match;
  while ((match = attribute.exec(content)) !== null) keys.add(match[1]);
  const literal = /(?:^|[^.\w])(?:T|t)\(\s*'([^']+)'\s*[,)]/g;
  while ((match = literal.exec(content)) !== null) keys.add((path.basename(file) === 'ManagerWebClient.html' ? 'web.' : '') + match[1]);
  return Array.from(keys);
}
[managerDir, dashboardDir].forEach(directory => {
  htmls(directory).forEach(name => {
    if (name === 'I18n.html') return;
    usedKeys(path.join(directory, name)).forEach(key => {
      assert(i18n.has(key), `${path.basename(directory)}/${name}: unknown translation key ${key}`);
    });
  });
});

// The obsolete English brand must not survive in any user-visible template.
[managerDir, dashboardDir].forEach(directory => {
  htmls(directory).forEach(name => {
    const content = read(directory, name);
    assert(!/Engineering HUB/.test(content), `${path.basename(directory)}/${name}: obsolete "Engineering HUB" brand remains`);
  });
});
assert(/var TITLE = '設計・開発課 管理'/.test(read(dashboardDir, 'App.gs')),
  'The dashboard document title must use the official application name');

console.log(`Validated ${files.length} manager Apps Script files, ${dashboardFiles.length} dashboard files, both manifests and ${jaKeys.length} translation keys`);

// The two Apps Script projects must stay isolated in their clasp configuration.
const deploymentDoc = fs.readFileSync(path.join(root, 'DEPLOYMENT.md'), 'utf8');
assert(/dashboard-app/.test(deploymentDoc), 'DEPLOYMENT.md must document the separate dashboard-app deployment');
assert(fs.existsSync(path.join(root, 'docs', 'UI_LOCALIZATION.md')),
  'docs/UI_LOCALIZATION.md must document the localization architecture');
assert(fs.existsSync(path.join(root, 'docs', 'DEADLINE_REQUEST_WORKFLOW.md')),
  'docs/DEADLINE_REQUEST_WORKFLOW.md must document the request workflow');
assert(fs.existsSync(path.join(root, 'docs', 'REQUEST_INBOX_DEPLOYMENT.md')),
  'docs/REQUEST_INBOX_DEPLOYMENT.md must document the request inbox deployment');
assert(fs.existsSync(path.join(root, 'docs', 'TASK_DURATION_POLICY.md')),
  'docs/TASK_DURATION_POLICY.md must document the duration policy');
assert(fs.existsSync(path.join(root, 'docs', 'RESPONSIBILITIES.md')),
  'docs/RESPONSIBILITIES.md must document responsibilities and the hierarchy');
assert(fs.existsSync(path.join(root, 'docs', 'UI_UX_GUIDELINES.md')),
  'docs/UI_UX_GUIDELINES.md must document the shared visual language');
assert(fs.existsSync(path.join(root, 'docs', 'checkgates', 'V1_4_GATE_6.md')),
  'docs/checkgates/V1_4_GATE_6.md must record the V1.4 release review');
assert(fs.existsSync(path.join(root, 'docs', 'checkgates', 'V1_4_1_GATE_6.md')),
  'docs/checkgates/V1_4_1_GATE_6.md must record the V1.4.1 release review');
