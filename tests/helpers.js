'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createGoogleMocks, MockSpreadsheet, MockSheet, MockRange } = require('./mocks/google');

function loadApp(options = {}) {
  const mocks = createGoogleMocks(options);
  const context = vm.createContext({ Date, ...mocks.globals, ...options.globals });
  const sourceDir = path.resolve(__dirname, '../src');
  const files = fs.readdirSync(sourceDir).filter(name => name.endsWith('.gs')).sort();
  const source = files.map(name => fs.readFileSync(path.join(sourceDir, name), 'utf8')).join('\n;\n');
  new vm.Script(source, { filename: 'engineering-hub.gs' }).runInContext(context);
  return {
    ...mocks,
    context,
    run: code => vm.runInContext(code, context),
    get: name => vm.runInContext(name, context)
  };
}

/** Loads the separate read-only dashboard project into its own mocked context. */
function loadDashboard(options = {}) {
  const mocks = createGoogleMocks({ htmlDir: 'dashboard-app', ...options });
  const context = vm.createContext({ Date, ...mocks.globals, ...options.globals });
  const sourceDir = path.resolve(__dirname, '../dashboard-app');
  const files = fs.readdirSync(sourceDir).filter(name => name.endsWith('.gs')).sort();
  const source = files.map(name => fs.readFileSync(path.join(sourceDir, name), 'utf8')).join('\n;\n');
  new vm.Script(source, { filename: 'dashboard-app.gs' }).runInContext(context);
  return {
    ...mocks,
    context,
    run: code => vm.runInContext(code, context),
    get: name => vm.runInContext(name, context)
  };
}

module.exports = { loadApp, loadDashboard, createGoogleMocks, MockSpreadsheet, MockSheet, MockRange };
