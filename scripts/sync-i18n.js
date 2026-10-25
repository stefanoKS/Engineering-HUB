#!/usr/bin/env node
/**
 * Copies the canonical translation dictionary (shared/i18n.js) into the two Apps Script
 * projects. Apps Script cannot share files between projects, so the copies are generated
 * instead of maintained by hand.
 *
 *   node scripts/sync-i18n.js           write the copies
 *   node scripts/sync-i18n.js --check   fail when a copy is out of date
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'shared', 'i18n.js');

const TARGETS = [
  {file: path.join(ROOT, 'src', 'I18n.html'), kind: 'html'},
  {file: path.join(ROOT, 'dashboard-app', 'I18n.html'), kind: 'html'}
];

const HEADER = [
  '/**',
  ' * GENERATED FILE — do not edit.',
  ' * Source: shared/i18n.js (run `npm run sync:i18n` after changing the source).',
  ' * `npm run validate` fails when this copy drifts from the source.',
  ' */'
].join('\n');

const HTML_HEADER = '<!-- Generated from shared/i18n.js by scripts/sync-i18n.js. Do not edit directly. -->';

function readSource() {
  return fs.readFileSync(SOURCE, 'utf8');
}

function expected(target, source) {
  if (target.kind === 'html') {
    return [HTML_HEADER, '<script>', source.trimEnd(), '</script>', ''].join('\n');
  }
  return HEADER + '\n' + source;
}

/**
 * Content comparison ignores the checkout line ending: the copies are generated with LF,
 * while a Windows working tree may hold CRLF. Drift is about content, not EOL style.
 */
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
      process.stderr.write('i18n copies are out of date: ' + problems.join(', ') + '\n' +
        'Run `npm run sync:i18n` and commit the result.\n');
      return 1;
    }
    process.stdout.write('i18n copies match shared/i18n.js\n');
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {TARGETS: TARGETS, HEADER: HEADER, expected: expected, matches: matches,
  normalizeNewlines: normalizeNewlines, main: main};
