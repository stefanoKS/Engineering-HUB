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
function runClient(server) {
  const source = fs.readFileSync(path.resolve(__dirname, '../dashboard-app/Client.html'), 'utf8');
  const match = /<script>([\s\S]*)<\/script>/.exec(source);
  if (!match) throw new Error('Client.html must contain the dashboard script');
  const { document, registry } = createDashboardDocument();
  const windowObject = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id),
    scrollTo: () => {}
  };
  const context = vm.createContext({
    document,
    window: windowObject,
    google: { script: { run: makeRunner(server) } },
    Promise,
    setTimeout,
    clearTimeout,
    console
  });
  new vm.Script(match[1], { filename: 'dashboard-client.js' }).runInContext(context);
  return { document, registry, context };
}

/** Lets every queued microtask and timer callback run. */
function flush() {
  return new Promise(resolve => setTimeout(resolve, 5));
}

module.exports = {
  SNAPSHOT_ID,
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
