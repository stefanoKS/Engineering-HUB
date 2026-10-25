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
const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'appsscript.json'), 'utf8'));
if (manifest.runtimeVersion !== 'V8') throw new Error('Apps Script V8 runtime is required');
if (manifest.timeZone !== 'Asia/Tokyo') throw new Error('Manifest timezone must be Asia/Tokyo');
console.log(`Validated ${files.length} Apps Script files and manifest`);
