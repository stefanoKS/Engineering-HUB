'use strict';

const { loadApp } = require('./helpers');

const DOMAIN = 'example.test';

function app(options = {}) {
  const properties = { ALLOWED_RECIPIENT_DOMAINS: DOMAIN, BACKUP_FOLDER_ID: 'restricted-backups', ...options.properties };
  const instance = loadApp({ ...options, properties });
  instance.context.initializeNewDatabase('INITIALIZE test-db');
  return instance;
}

/** Fictional baseline: two projects, one subproject, English/Japanese labels, no secrets. */
function base(options = {}) {
  const instance = app(options);
  const db = instance.context.Database;
  db.insert('MEMBERS', { Member_ID: 'M-ADMIN', Name: '管理 太郎', Email: 'admin@example.test', Department: '設計', Active: true, Role: 'ADMIN', Weekly_Capacity_Hours: 40 });
  db.insert('MEMBERS', { Member_ID: 'M-MGR', Name: '管理 花子', Email: 'manager@example.test', Department: '設計', Active: true, Role: 'MANAGER', Weekly_Capacity_Hours: 40 });
  db.insert('MEMBERS', { Member_ID: 'M-ENG', Name: '設計 次郎', Email: 'engineer@example.test', Department: '設計', Active: true, Role: 'MEMBER', Weekly_Capacity_Hours: 40 });
  db.insert('MEMBERS', { Member_ID: 'M-VIEW', Name: '閲覧 三郎', Email: 'viewer@example.test', Department: '管理', Active: true, Role: 'VIEWER', Weekly_Capacity_Hours: 0 });
  db.insert('PROJECTS', { Project_ID: 'P1', Project_Name: '検査装置', Status: 'Active', Project_Owner_ID: 'M-MGR', Planned_Start: '2026-10-01', Committed_Deadline: '2026-12-31' });
  db.insert('PROJECTS', { Project_ID: 'P2', Project_Name: '旧ライン', Status: 'Archived', Project_Owner_ID: 'M-MGR', Committed_Deadline: '2026-11-30', Archived_At: '2026-09-30T00:00:00.000Z' });
  db.insert('SUBPROJECTS', { Subproject_ID: 'S1', Project_ID: 'P1', Subproject_Name: '試作', Owner_ID: 'M-ENG', Status: 'Active', Planned_Start: '2026-10-01', Deadline: '2026-12-15' });
  db.insert('TASKS', { Task_ID: 'T1', Project_ID: 'P1', Subproject_ID: 'S1', Task_Name: '機構設計', Owner_Member_ID: 'M-ENG', Status: 'In Progress', Planned_Start: '2026-11-01', Due_Date: '2026-12-15', Estimated_Hours: 40, Actual_Hours: 8, Progress_Percent: 25, Notification_Enabled: true });
  db.insert('TASKS', { Task_ID: 'T2', Project_ID: 'P1', Task_Name: '要件整理', Owner_Member_ID: 'M-ENG', Status: 'Assigned' });
  db.insert('TASKS', { Task_ID: 'T3', Project_ID: 'P2', Task_Name: '旧ライン保守', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2026-11-15', Estimated_Hours: 10, Actual_Hours: 0, Notification_Enabled: true });
  return instance;
}

/** Seed many rows at once through a bounded range write (no per-row validation cost). */
function bulk(instance, table, rows) {
  const fields = instance.context.Schema.tables[table].fields.map(field => field.name);
  const sheet = instance.book.getSheetByName(table);
  if (!rows.length) return;
  const values = rows.map(row => fields.map(name => (row[name] === undefined ? '' : row[name])));
  sheet.getRange(2, 1, values.length, fields.length).setValues(values);
}

function settings(instance, changes, confirmation) {
  return instance.context.AutomationSettings.save(changes, 'admin@example.test', confirmation || '');
}

function approve(instance, taskId) {
  return instance.context.approveTaskAssignment(taskId, 'admin@example.test', 'APPROVE ASSIGNMENT');
}

/**
 * Seeds an approved completion.
 *
 * V1.6 makes manager approval the only ordinary path to Done / 100 %, so fixtures that need
 * completed work use the same privileged path the approval service uses instead of writing
 * Done directly. Production entrypoints cannot reach it from a browser payload.
 */
function complete(instance, taskId) {
  return instance.context.Completion.withApproval(function () {
    return instance.context.Tasks.update(taskId, {Status: 'Done', Progress_Percent: 100});
  });
}

/** Creates a task and immediately records its approved completion. */
function completedTask(instance, data) {
  const created = instance.context.Tasks.create(Object.assign({}, data, {Status: 'Assigned', Progress_Percent: 0}));
  return complete(instance, created.Task_ID);
}

function activate(instance) {
  return instance.context.activateNotifications('admin@example.test', 'ACTIVATE NOTIFICATIONS');
}

function live(options = {}) {
  const instance = base(options);
  activate(instance);
  settings(instance, {
    EMAIL_MODE: 'LIVE', EMERGENCY_STOP: false,
    WEEKDAY_ONLY_SENDING: false, EXECUTION_WINDOW_START: '00:00', EXECUTION_WINDOW_END: '23:59'
  }, 'ENABLE LIVE EMAIL');
  return instance;
}

module.exports = { DOMAIN, app, base, bulk, settings, approve, complete, completedTask, activate, live };
