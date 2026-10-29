#!/usr/bin/env node
/**
 * Copies the shared project colour palette (shared/project-colors.js) into the two Apps Script
 * projects. Apps Script cannot share files between projects, so the copies are generated
 * instead of maintained by hand; identical copies are what makes the manager and the employee
 * dashboard derive the same accent for the same Project_ID.
 *
 *   node scripts/sync-project-colors.js           write the copies
 *   node scripts/sync-project-colors.js --check   fail when a copy is out of date
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'shared', 'project-colors.js');

const TARGETS = [
  {file: path.join(ROOT, 'src', 'ProjectColors.html'), kind: 'html'},
  {file: path.join(ROOT, 'dashboard-app', 'ProjectColors.html'), kind: 'html'}
];

const HTML_HEADER = '<!-- Generated from shared/project-colors.js by scripts/sync-project-colors.js. Do not edit directly. -->';

function readSource() {
  return fs.readFileSync(SOURCE, 'utf8');
}

function expected(target, source) {
  if (target.kind === 'html') {
    return [HTML_HEADER, '<script>', source.trimEnd(), '</script>', ''].join('\n');
  }
  return source;
}

/** Content comparison ignores the checkout line ending; drift is about content, not EOL style. */
function normalizeNewlines(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\r\n/g, '\n');
}

function matches(target, source, actual) {
  return normalizeNewlines(actual) === normalizeNewlines(expected(target, source));
}

function main(argv) {
  const check = argv.includes('--check');
  const source = readSource();
  const problems = [];

  TARGETS.forEach((target) => {
    const content = expected(target, source);
    const relative = path.relative(ROOT, target.file).split(path.sep).join('/');
    if (check) {
      const current = fs.existsSync(target.file) ? fs.readFileSync(target.file, 'utf8') : '';
      if (!matches(target, source, current)) problems.push(relative);
      return;
    }
    fs.mkdirSync(path.dirname(target.file), {recursive: true});
    fs.writeFileSync(target.file, content, 'utf8');
    process.stdout.write('updated ' + relative + '\n');
  });

  if (check) {
    if (problems.length) {
      process.stderr.write('project colour copies are out of date: ' + problems.join(', ') + '\n' +
        'Run `npm run sync:colors` and commit the result.\n');
      return 1;
    }
    process.stdout.write('project colour copies match shared/project-colors.js\n');
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {TARGETS: TARGETS, HTML_HEADER: HTML_HEADER, expected: expected, matches: matches,
  normalizeNewlines: normalizeNewlines, main: main};
