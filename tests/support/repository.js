'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
function tracked(root, name) {
  if (!fs.existsSync(path.join(root, '.git'))) return fs.existsSync(path.join(root, name));
  return execFileSync('git', ['ls-files', '--', name], {cwd: root, encoding: 'utf8'}).trim() !== '';
}
module.exports = {tracked};
