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
  const generatedWriter = /function writeGenerated\(name, rows\) \{\s*if \(Schema\.generated\.indexOf\(name\) < 0\) throw new Error\('[^']*'\);\s*var sheet = book\(\)\.getSheetByName\(name\) \|\| book\(\)\.insertSheet\(name\);\s*sheet\.clearContents\(\);/;
  const checkedSource = name === 'Database.gs' ? source.replace(generatedWriter, '') : source;
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

const REQUIRED_DASHBOARD_FILES = ['App.gs', 'DataService.gs', 'Index.html', 'Styles.html', 'Client.html', 'appsscript.json'];
REQUIRED_DASHBOARD_FILES.forEach(name => {
  assert(fs.existsSync(path.join(dashboardDir, name)), `dashboard-app/${name} is missing`);
});

const dashboardFiles = scripts(dashboardDir);
assert(dashboardFiles.length, 'No dashboard Apps Script source files found');
const dashboardSources = dashboardFiles.map(name => {
  const source = read(dashboardDir, name);
  new vm.Script(source, { filename: `dashboard/${name}` });

  // Read-only by construction: the viewer project has no spreadsheet write path.
  const writeApis = /\.(?:setValue|setValues|setFormula|setFormulas|setNumberFormat|setDataValidation|appendRow|insertRow|insertRows|insertColumn|insertColumns|insertSheet|copyTo)\(\s*/;
  assert(!writeApis.test(source), `dashboard-app/${name}: spreadsheet writes are prohibited in the read-only dashboard`);
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
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
];
(dashboardManifest.oauthScopes || []).forEach(scope => {
  assert(DASHBOARD_SCOPES.indexOf(scope) >= 0, `dashboard-app: unexpected OAuth scope ${scope}`);
});
assert((dashboardManifest.oauthScopes || []).indexOf('https://www.googleapis.com/auth/spreadsheets.readonly') >= 0,
  'dashboard-app: the dashboard must request read-only spreadsheet access');

// The two Apps Script projects must stay isolated in their clasp configuration.
const deploymentDoc = fs.readFileSync(path.join(root, 'DEPLOYMENT.md'), 'utf8');
assert(/dashboard-app/.test(deploymentDoc), 'DEPLOYMENT.md must document the separate dashboard-app deployment');

console.log(`Validated ${files.length} manager Apps Script files, ${dashboardFiles.length} dashboard files and both manifests`);
