'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixtures = require('./fixtures');
const { loadDashboard, MockSpreadsheet } = require('./helpers');
const { createDashboardDocument } = require('./support/dashboard-dom');

const SNAPSHOT_ID = 'snapshot-db';
const ACTOR = 'admin@example.test';
const PUBLICATION_CONFIRMATION = 'ENABLE SHARED DASHBOARD PUBLICATION';

/** Creates the separate snapshot workbook and registers it in the manager mock. */
function attachSnapshot(manager) {
  const snapshot = new MockSpreadsheet(SNAPSHOT_ID);
  manager.spreadsheets.set(snapshot.getId(), snapshot);
  manager.properties.setProperty('SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID', SNAPSHOT_ID);
  return snapshot;
}

function enablePublication(manager, changes) {
  return manager.context.SharedDashboardPublisher.saveSettings(
    Object.assign({ SHARED_DASHBOARD_PUBLISH_ENABLED: true }, changes || {}),
    ACTOR, PUBLICATION_CONFIRMATION);
}

/** A manager workbook with one initialized + published snapshot. */
function published(options = {}) {
  const manager = options.manager || fixtures.base(options);
  const snapshot = attachSnapshot(manager);
  manager.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
  enablePublication(manager);
  const publication = manager.context.publishSharedDashboard();
  return { manager, snapshot, publication };
}

/** A dashboard project context reading the snapshot workbook. */
function dashboardFor(snapshot, properties) {
  return loadDashboard({
    spreadsheet: snapshot,
    properties: Object.assign({ SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID: SNAPSHOT_ID }, properties || {})
  });
}

/** A published snapshot plus a viewer context over the standard fictional fixtures. */
function scenarioFixture() {
  const manager = fixtures.base();
  manager.context.Database.update('PROJECTS', 'P1', { Dashboard_Visibility: 'INTERNAL' });
  const snapshot = attachSnapshot(manager);
  manager.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
  enablePublication(manager);
  manager.context.publishSharedDashboard();
  return { manager, snapshot, viewer: dashboardFor(snapshot) };
}

/** google.script.run stand-in that resolves the read-only server functions. */
function makeRunner(server) {
  return {
    withSuccessHandler(success) {
      return {
        withFailureHandler(failure) {
          const target = {};
          Object.keys(server).forEach(name => {
            target[name] = (...args) => {
              Promise.resolve()
                .then(() => success(server[name](...args)))
                .catch(error => failure(error));
            };
          });
          return target;
        }
      };
    }
  };
}

/** Executes the real dashboard client script against a shim document + server stubs. */
function runClient(server, options = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '../dashboard-app/Client.html'), 'utf8');
  const match = /<script>([\s\S]*)<\/script>/.exec(source);
  if (!match) throw new Error('Client.html must contain the dashboard script');
  const i18nSource = fs.readFileSync(path.resolve(__dirname, '../shared/i18n.js'), 'utf8');
  const colorSource = fs.readFileSync(path.resolve(__dirname, '../shared/project-colors.js'), 'utf8');
  const { document, registry } = createDashboardDocument();
  const buttons = (options.languages || ['ja', 'en']).map(lang => {
    const node = document.createElement('button');
    node.setAttribute('data-lang', lang);
    node.className = 'lang-option';
    return node;
  });
  document.querySelectorAll = selector => (selector === '.lang-option' ? buttons : []);
  const store = new Map();
  Object.keys(options.storage || {}).forEach(key => store.set(key, String(options.storage[key])));
  const windowObject = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id),
    scrollTo: () => {},
    __DASHBOARD_PREVIEW__: null
  };
  const context = vm.createContext({
    document,
    window: windowObject,
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value))
    },
    google: { script: { run: makeRunner(server) } },
    Promise,
    setTimeout,
    clearTimeout,
    console
  });
  // The dictionary and the client share one context so the browser storage shim is shared.
  new vm.Script(i18nSource, { filename: 'shared/i18n.js' }).runInContext(context);
  new vm.Script(colorSource, { filename: 'shared/project-colors.js' }).runInContext(context);
  vm.runInContext('window.EH_I18N = EH_I18N;', context);
  new vm.Script(match[1], { filename: 'dashboard-client.js' }).runInContext(context);
  return { document, registry, context, store, buttons };
}

/** Lets every queued microtask and timer callback run. */
function flush() {
  return new Promise(resolve => setTimeout(resolve, 5));
}

module.exports = {
  SNAPSHOT_ID,
  scenarioFixture,
  ACTOR,
  PUBLICATION_CONFIRMATION,
  attachSnapshot,
  enablePublication,
  published,
  dashboardFor,
  runClient,
  flush,
  fixtures
};
