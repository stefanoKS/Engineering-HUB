'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const dashboard = require('./dashboard-fixtures');

const ACTOR = dashboard.ACTOR;
const SNAPSHOT_ID = dashboard.SNAPSHOT_ID;

function sheetRows(book, name) {
  const sheet = book.getSheetByName(name);
  return sheet ? sheet.getDataRange().getValues() : [];
}

function metaValue(book, key) {
  const rows = sheetRows(book, 'PUBLISHED_META');
  const row = rows.slice(1).find(item => item[0] === key);
  return row ? row[1] : undefined;
}

/** A manager workbook with one INTERNAL and one restricted project. */
function manager() {
  const app = fixtures.base();
  app.context.Database.update('PROJECTS', 'P1', {
    Dashboard_Visibility: 'INTERNAL', Dashboard_Summary: '公開してよい概要'
  });
  app.context.Database.update('TASKS', 'T1', {
    Description: '社外秘の詳細設計メモ', Acceptance_Criteria: '社外秘の完了条件', Next_Action: '社外秘の次の一手'
  });
  return app;
}

test('snapshot initialization needs administrator rights, an exact confirmation and an empty workbook', () => {
  const app = fixtures.base();
  assert.throws(() => app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID),
    /not configured/);

  const snapshot = dashboard.attachSnapshot(app);
  assert.throws(() => app.context.initializeSharedDashboardSnapshot('yes'),
    /confirmation/);

  const managerActor = fixtures.base({ actor: 'manager@example.test' });
  dashboard.attachSnapshot(managerActor);
  assert.throws(() => managerActor.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID),
    /ADMIN/);

  snapshot.insertSheet('Notes').getRange(1, 1).setValue('existing');
  assert.throws(() => app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID),
    /already contains content/);
});

test('the master workbook can never be used as the publication destination', () => {
  const app = manager();
  app.properties.setProperty('SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID', 'test-db');
  assert.throws(() => app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD test-db'),
    /must not be the master workbook/);

  const other = fixtures.base();
  const operational = dashboard.attachSnapshot(other);
  operational.insertSheet('PROJECTS').getRange(1, 1).setValue('Project_ID');
  assert.throws(() => other.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID),
    /operational table/);
});

test('publication writes only allowlisted fields, excludes restricted projects and leaves the source untouched', () => {
  const app = manager();
  const snapshot = dashboard.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
  const before = JSON.stringify(app.context.Backup.snapshot(app.book));

  const result = app.context.publishSharedDashboard();
  assert.equal(result.published, true);
  assert.equal(result.version, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.counts)),
    {responsibilities: 0, projects: 1, subprojects: 1, tasks: 2, milestones: 0});
  assert.equal(result.excluded.projects, 1, 'the archived, restricted project is never published');

  const projectRows = sheetRows(snapshot, 'PUBLISHED_PROJECTS_A');
  assert.equal(projectRows.length, 2, 'one header row plus one published project');
  assert.deepEqual(JSON.parse(JSON.stringify(projectRows[1])), [
    'P1', '検査装置', '', '', '', '管理 花子', 'Active', 24.39, 'GREEN', '2026-12-31', '', '公開してよい概要',
    projectRows[1][12], false, 2, 0, 0, 0, 0, 2
  ]);
  const taskRows = sheetRows(snapshot, 'PUBLISHED_TASKS_A');
  assert.deepEqual(JSON.parse(JSON.stringify(taskRows.slice(1).map(row => row[0]))), ['T1', 'T2']);

  const serialized = JSON.stringify(snapshot.getSheets().map(sheet => sheet.getDataRange().getValues()));
  assert.doesNotMatch(serialized, /@example\.test/, 'no e-mail address ever reaches the snapshot');
  assert.doesNotMatch(serialized, /社外秘/, 'private descriptions, criteria and next actions never reach the snapshot');
  assert.doesNotMatch(serialized, /Description|Acceptance_Criteria|Next_Action|Owner_Member_ID|Estimated_Hours/);
  assert.match(serialized, /公開してよい概要/);
  assert.match(serialized, /機構設計/, 'the approved task name is published');

  const after = JSON.parse(JSON.stringify(app.context.Backup.snapshot(app.book)))
    .filter(sheet => ['AUTOMATION_SETTINGS', 'AUDIT_LOG'].indexOf(sheet.name) < 0);
  const beforeSheets = JSON.parse(before).filter(sheet => ['AUTOMATION_SETTINGS', 'AUDIT_LOG'].indexOf(sheet.name) < 0);
  assert.deepEqual(after, beforeSheets, 'publication never modifies operational data');
  assert.equal(app.context.Database.find('TASKS', 'T1').Dashboard_Visibility, undefined);
});

test('publication alternates A/B slots, increments the version and keeps the previous snapshot readable', () => {
  const app = manager();
  const snapshot = dashboard.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
  const first = app.context.publishSharedDashboard();
  const second = app.context.publishSharedDashboard();

  assert.equal(first.activeSlot, 'A');
  assert.equal(second.activeSlot, 'B');
  assert.equal(metaValue(snapshot, 'ACTIVE_SLOT'), 'B');
  assert.equal(metaValue(snapshot, 'SNAPSHOT_VERSION'), 2);
  assert.equal(metaValue(snapshot, 'PREVIOUS_SLOT'), 'A');
  assert.match(String(metaValue(snapshot, 'CONTENT_HASH')), /^[0-9a-f]{64}$/);
  assert.ok(metaValue(snapshot, 'PUBLISHED_AT'));
  assert.equal(sheetRows(snapshot, 'PUBLISHED_TASKS_A').length, 3, 'the previous slot is still intact');
});

test('repeating a publication never duplicates tasks', () => {
  const app = manager();
  const snapshot = dashboard.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
  for (let index = 0; index < 3; index++) app.context.publishSharedDashboard();
  const tasks = sheetRows(snapshot, 'PUBLISHED_TASKS_A').slice(1).map(row => row[0]);
  const other = sheetRows(snapshot, 'PUBLISHED_TASKS_B').slice(1).map(row => row[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(tasks.sort())), ['T1', 'T2']);
  assert.deepEqual(JSON.parse(JSON.stringify(other.sort())), ['T1', 'T2']);
  assert.equal(metaValue(snapshot, 'SNAPSHOT_VERSION'), 3);
});

test('a failed publication preserves the committed snapshot and is recorded', () => {
  const app = manager();
  const snapshot = dashboard.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
  app.context.publishSharedDashboard();
  const committed = JSON.stringify(sheetRows(snapshot, 'PUBLISHED_TASKS_A'));

  const target = snapshot.getSheetByName('PUBLISHED_TASKS_B');
  target.getRange = () => ({setValues() { throw new Error('quota exceeded'); }});
  assert.throws(() => app.context.publishSharedDashboard(), /quota exceeded/);

  assert.equal(metaValue(snapshot, 'ACTIVE_SLOT'), 'A');
  assert.equal(metaValue(snapshot, 'SNAPSHOT_VERSION'), 1);
  assert.equal(JSON.stringify(sheetRows(snapshot, 'PUBLISHED_TASKS_A')), committed);

  const settings = app.context.AutomationSettings.get();
  assert.equal(settings.LAST_SHARED_DASHBOARD_PUBLISH_RESULT, 'FAILED');
  assert.match(settings.LAST_SHARED_DASHBOARD_PUBLISH_ERROR, /quota exceeded/);
  assert.equal(app.context.Database.read('AUDIT_LOG')
    .filter(row => row.Action === 'SHARED_DASHBOARD_PUBLICATION_FAILED').length, 1);
});

test('publication OFF suppresses scheduled publishing but never blocks a manual run', () => {
  const app = manager();
  const snapshot = dashboard.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);

  const scheduled = app.context.scheduledSharedDashboardPublish();
  assert.equal(scheduled.published, false);
  assert.equal(scheduled.reason, 'PUBLICATION_DISABLED');
  assert.equal(metaValue(snapshot, 'ACTIVE_SLOT'), '', 'a disabled schedule writes nothing');

  const manual = app.context.publishSharedDashboard();
  assert.equal(manual.published, true, 'manual publication stays available');

  const trigger = app.context.Triggers.expectedHandlers();
  assert.equal(trigger.indexOf('scheduledSharedDashboardPublish'), -1, 'OFF installs no publication trigger');
  dashboard.enablePublication(app);
  assert.ok(app.context.Triggers.expectedHandlers().indexOf('scheduledSharedDashboardPublish') >= 0);
  assert.equal(app.context.Triggers.publicationCadence().everyMinutes, 30);
});

test('enabling publication requires ADMIN, the exact confirmation and an initialized destination', () => {
  const app = manager();
  dashboard.attachSnapshot(app);

  assert.throws(() => app.context.SharedDashboardPublisher.saveSettings(
    {SHARED_DASHBOARD_PUBLISH_ENABLED: true}, ACTOR, 'nope'), /confirmation/);
  assert.throws(() => app.context.SharedDashboardPublisher.saveSettings(
    {SHARED_DASHBOARD_PUBLISH_ENABLED: true}, ACTOR, dashboard.PUBLICATION_CONFIRMATION), /not initialized/);

  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);

  app.setActor('manager@example.test');
  assert.throws(() => app.context.SharedDashboardPublisher.saveSettings(
    {SHARED_DASHBOARD_PUBLISH_ENABLED: true}, 'manager@example.test', dashboard.PUBLICATION_CONFIRMATION), /ADMIN/);

  app.setActor(ACTOR);
  dashboard.enablePublication(app);
  const values = app.context.AutomationSettings.get();
  assert.equal(values.SHARED_DASHBOARD_PUBLISH_ENABLED, true);
  assert.equal(values.SHARED_DASHBOARD_PUBLISH_APPROVED_BY, ACTOR);
  const actions = app.context.Database.read('AUDIT_LOG').map(row => row.Action);
  assert.ok(actions.indexOf('SHARED_DASHBOARD_PUBLICATION_APPROVED') >= 0);
  assert.ok(actions.indexOf('SETTING_CHANGED') >= 0);

  assert.throws(() => app.context.SharedDashboardPublisher.saveSettings(
    {EMAIL_MODE: 'LIVE'}, ACTOR, ''), /Not a shared dashboard publication setting/);
});

test('publication status and preview never expose the destination spreadsheet id', () => {
  const app = manager();
  dashboard.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);

  const beforePublish = app.context.sharedDashboardPublicationStatus();
  assert.equal(beforePublish.destinationConfigured, true);
  assert.equal(beforePublish.enabled, false);
  assert.doesNotMatch(JSON.stringify(beforePublish), new RegExp(SNAPSHOT_ID));

  const preview = app.context.previewSharedDashboardPublication();
  assert.equal(preview.initialized, true);
  assert.deepEqual(JSON.parse(JSON.stringify(preview.counts)),
    {RESPONSIBILITY_COUNT: 0, PROJECT_COUNT: 1, SUBPROJECT_COUNT: 1, TASK_COUNT: 2, MILESTONE_COUNT: 0});
  assert.equal(metaValue(app.spreadsheets.get(SNAPSHOT_ID), 'ACTIVE_SLOT'), '', 'preview writes nothing');

  app.context.publishSharedDashboard();
  const afterPublish = app.context.sharedDashboardPublicationStatus();
  assert.equal(afterPublish.lastResult, 'SUCCESS');
  assert.equal(afterPublish.lastVersion, '1');
  assert.equal(afterPublish.snapshot.version, 1);
  assert.equal(afterPublish.readable, true);
  assert.doesNotMatch(JSON.stringify(afterPublish), new RegExp(SNAPSHOT_ID));

  assert.equal(app.context.previewSharedDashboardPublication().unchanged, true);
  app.context.Database.update('TASKS', 'T1', {Task_Name: '名称変更'});
  assert.equal(app.context.previewSharedDashboardPublication().unchanged, false);
});

test('publication settings stay independent of the mail mode and from the snapshot contract', () => {
  const app = manager();
  dashboard.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
  dashboard.enablePublication(app);
  app.context.publishSharedDashboard();

  const state = app.context.AutomationSettings.emailState(app.context.Config.get());
  assert.equal(state.mode, 'OFF');
  assert.equal(app.sentEmails.length, 0);
  assert.equal(app.calendarEvents.length, 0);
  assert.equal(app.triggers.length, 0, 'publication installs no trigger by itself');

  const snapshot = app.spreadsheets.get(SNAPSHOT_ID);
  assert.equal(metaValue(snapshot, 'CONTRACT_VERSION'), '1.4');
  assert.equal(metaValue(snapshot, 'RESULT'), 'SUCCESS');
  assert.equal(metaValue(snapshot, 'AS_OF').length, 10);
});

test('a workbook that looks like the master is refused even when used as the destination', () => {
  const app = manager();
  const snapshot = dashboard.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
  snapshot.insertSheet('AUTOMATION_SETTINGS').getRange(1, 1).setValue('Setting_ID');
  assert.throws(() => app.context.publishSharedDashboard(), /operational table AUTOMATION_SETTINGS/);
  assert.throws(() => app.context.previewSharedDashboardPublication(), /operational table AUTOMATION_SETTINGS/);
});

test('the manager sidebar exposes publication controls only through validated domain functions', () => {
  const app = manager();
  dashboard.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);

  const status = app.context.Ui.publicationStatus();
  assert.equal(status.ok, true, status.error);
  assert.equal(status.data.enabled, false);
  assert.equal(status.data.destinationConfigured, true);
  assert.doesNotMatch(JSON.stringify(status.data), new RegExp(SNAPSHOT_ID));

  const saved = app.context.Ui.savePublicationSettings({
    changes: {SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES: 15}
  });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.data.enabled, false, 'saving an interval never enables publication');
  assert.equal(app.context.AutomationSettings.get().SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES, 15);

  const denied = app.context.Ui.savePublicationSettings({
    changes: {SHARED_DASHBOARD_PUBLISH_ENABLED: true}
  });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /confirmation/);

  const published = app.context.Ui.publishPublicationNow();
  assert.equal(published.ok, true, published.error);
  assert.equal(published.data.counts.projects, 1);
  assert.equal(published.data.counts.tasks, 2);

  const preview = app.context.Ui.publicationPreview();
  assert.equal(preview.ok, true, preview.error);
  assert.equal(preview.data.unchanged, true);
  assert.equal(app.sentEmails.length, 0, 'the sidebar never sends mail');

  app.setActor('engineer@example.test');
  assert.equal(app.context.Ui.publicationStatus().ok, false);
  assert.equal(app.context.Ui.publicationPreview().ok, false);
  assert.equal(app.context.Ui.publishPublicationNow().ok, false);
  assert.equal(app.context.Ui.savePublicationSettings({changes: {SHARED_DASHBOARD_PUBLISH_ENABLED: true}}).ok, false);
});

test('publication requires a manager or administrator session', () => {
  const app = manager();
  dashboard.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);

  app.setActor('engineer@example.test');
  assert.throws(() => app.context.publishSharedDashboard(), /Insufficient role|MANAGER/);
  app.setActor('viewer@example.test');
  assert.throws(() => app.context.publishSharedDashboard(), /Insufficient role|MANAGER/);
  app.setActor(ACTOR);
  assert.equal(app.context.publishSharedDashboard().published, true);
});
