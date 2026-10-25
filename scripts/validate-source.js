'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'src');
const files = fs.readdirSync(sourceDir).filter(name => name.endsWith('.gs')).sort();
if (!files.length) throw new Error('No Apps Script source files found');
const sources = files.map(name => {
  const source = fs.readFileSync(path.join(sourceDir, name), 'utf8');
  new vm.Script(source, { filename: name });
  // Only the schema-guarded generated-sheet writer may replace sheet contents.
  const generatedWriter = /function writeGenerated\(name, rows\) \{\s*if \(Schema\.generated\.indexOf\(name\) < 0\) throw new Error\('[^']*'\);\s*var sheet = book\(\)\.getSheetByName\(name\) \|\| book\(\)\.insertSheet\(name\);\s*sheet\.clearContents\(\);/;
  const checkedSource = name === 'Database.gs' ? source.replace(generatedWriter, '') : source;
  const destructive = /\.(?:clear|clearContent|clearContents|deleteSheet|deleteRows?|deleteColumns?|deleteCells|setTrashed|removeFile|removeFolder)\s*\(/;
  if (destructive.test(checkedSource)) {
    throw new Error(`${name}: destructive APIs are prohibited in production source`);
  }
  return source;
});
new vm.Script(sources.join('\n;\n'), { filename: 'combined-app.gs' });

// Mail authorization must stay centralized: only the notification service may send.
files.forEach(name => {
  const source = fs.readFileSync(path.join(sourceDir, name), 'utf8');
  if (name !== 'Notifications.gs' && /MailApp\s*\.\s*sendEmail\s*\(/.test(source)) {
    throw new Error(`${name}: MailApp.sendEmail is only allowed in Notifications.gs`);
  }
});

// HTML templates must exist and be referenced, and clasp must package them.
const htmlFiles = fs.readdirSync(sourceDir).filter(name => name.endsWith('.html'));
if (!htmlFiles.length) throw new Error('No HTML templates found for the bound manager UI');
const templates = new Set();
const partials = new Set();
files.forEach(name => {
  const source = fs.readFileSync(path.join(sourceDir, name), 'utf8');
  const pattern = /createHtmlOutputFromFile\(\s*'([^']+)'\s*\)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) templates.add(match[1]);
});
htmlFiles.forEach(name => {
  const content = fs.readFileSync(path.join(sourceDir, name), 'utf8');
  const pattern = /include\(\s*'([^']+)'\s*\)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) partials.add(match[1]);
});
templates.forEach(template => {
  if (!htmlFiles.includes(`${template}.html`)) throw new Error(`Missing HTML template: ${template}.html`);
});
partials.forEach(template => {
  if (!htmlFiles.includes(`${template}.html`)) throw new Error(`Missing HTML include: ${template}.html`);
});
htmlFiles.forEach(name => {
  const content = fs.readFileSync(path.join(sourceDir, name), 'utf8');
  const isPartial = partials.has(name.replace(/\.html$/, ''));
  if (!isPartial && !/<!DOCTYPE html>/i.test(content)) throw new Error(`${name}: HTML document expected`);
  // Stored spreadsheet text is untrusted: templates must never build markup from data.
  if (/\.(?:innerHTML|outerHTML)\s*=/.test(content) || /insertAdjacentHTML|document\.write/.test(content)) {
    throw new Error(`${name}: unsafe HTML insertion is prohibited; use textContent/DOM creation`);
  }
});
const claspIgnore = fs.readFileSync(path.join(root, '.claspignore'), 'utf8');
if (!/\*\*\/\*\.html/.test(claspIgnore)) throw new Error('.claspignore must include HTML templates in the push payload');

const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'appsscript.json'), 'utf8'));
if (manifest.runtimeVersion !== 'V8') throw new Error('Apps Script V8 runtime is required');
if (manifest.timeZone !== 'Asia/Tokyo') throw new Error('Manifest timezone must be Asia/Tokyo');
console.log(`Validated ${files.length} Apps Script files and manifest`);
