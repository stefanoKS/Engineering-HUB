'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

test('unknown effort stays unknown and is never rewritten to zero', () => {
  const app = fixtures.base();
  const db = app.context.Database;
  const unknown = db.insert('TASKS', { Task_ID: 'T-UNKNOWN', Project_ID: 'P1', Task_Name: '未見積', Owner_Member_ID: 'M-ENG', Status: 'Assigned' });
  const zero = db.insert('TASKS', { Task_ID: 'T-ZERO', Project_ID: 'P1', Task_Name: 'ゼロ見積', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Estimated_Hours: 0 });
  assert.equal(unknown.Estimated_Hours, '');
  assert.equal(zero.Estimated_Hours, 0);
  assert.equal(app.context.Estimates.known(unknown.Estimated_Hours), false);
  assert.equal(app.context.Estimates.known(zero.Estimated_Hours), true);

  const engineer = app.context.Planning.workloadData('2026-11-02').members.find(member => member.Member_ID === 'M-ENG');
  assert.ok(engineer.Unknown_Tasks >= 2, 'unknown estimates are counted separately');
  assert.equal(db.find('TASKS', 'T-UNKNOWN').Estimated_Hours, '');
  assert.equal(app.context.Estimates.remaining({ Estimated_Hours: '', Actual_Hours: 0 }), null);
});

test('deadline-only assignment is approvable and schedule confirmation is a separate gate', () => {
  const app = fixtures.base();
  const db = app.context.Database;
  fixtures.activate(app);
  db.insert('TASKS', { Task_ID: 'T-DEADLINE', Project_ID: 'P1', Task_Name: '期限のみ', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2026-12-10' });

  fixtures.approve(app, 'T-DEADLINE');
  assert.ok(db.find('TASKS', 'T-DEADLINE').Assignment_Approved_At);
  assert.equal(app.context.ScheduleConfirmations.active('T-DEADLINE'), null);

  assert.throws(() => app.context.confirmTaskSchedule('T-DEADLINE', 'admin@example.test', 'CONFIRM SCHEDULE'), /known effort estimate/);
  assert.throws(() => app.context.confirmTaskSchedule('T-DEADLINE', 'admin@example.test', 'yes'), /confirmation/);

  db.update('TASKS', 'T-DEADLINE', { Estimated_Hours: 8 });
  const confirmation = app.context.confirmTaskSchedule('T-DEADLINE', 'admin@example.test', 'CONFIRM SCHEDULE');
  assert.equal(confirmation.Active, true);
  assert.equal(app.context.ScheduleConfirmations.active('T-DEADLINE').Version, 1);

  app.context.updateTask('T-DEADLINE', { Due_Date: '2026-12-20' });
  assert.equal(app.context.ScheduleConfirmations.active('T-DEADLINE'), null);
  const history = app.context.ScheduleConfirmations.history('T-DEADLINE');
  assert.equal(history.length, 1);
  assert.equal(history[0].Active, false);
});

test('progress updates keep approval; material assignment changes revoke it', () => {
  const app = fixtures.base();
  const db = app.context.Database;
  fixtures.activate(app);
  db.insert('TASKS', { Task_ID: 'T-APPROVAL', Project_ID: 'P1', Task_Name: '承認対象', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2026-12-10', Estimated_Hours: 8 });
  fixtures.approve(app, 'T-APPROVAL');
  const approved = db.find('TASKS', 'T-APPROVAL');

  const progress = app.context.updateTask('T-APPROVAL', { Progress_Percent: 50 });
  assert.equal(new Date(progress.Assignment_Approved_At).toISOString(), new Date(approved.Assignment_Approved_At).toISOString());
  assert.equal(progress.Assignment_Version, approved.Assignment_Version);

  const changed = app.context.updateTask('T-APPROVAL', { Owner_Member_ID: 'M-MGR' });
  assert.equal(changed.Assignment_Approved_At, '');
  assert.equal(changed.Assignment_Version, Number(approved.Assignment_Version) + 1);

  const forged = app.context.updateTask('T-APPROVAL', { Assignment_Approved_At: '2020-01-01T00:00:00Z', Assignment_Version: 99 });
  assert.equal(forged.Assignment_Approved_At, '');
});

test('approval cannot bypass owner validation and requires explicit confirmation', () => {
  const app = fixtures.base();
  const db = app.context.Database;
  fixtures.activate(app);
  db.insert('MEMBERS', { Member_ID: 'M-OFF', Name: '退職 四郎', Email: 'inactive@example.test', Active: false, Role: 'MEMBER', Weekly_Capacity_Hours: 0 });
  db.insert('TASKS', { Task_ID: 'T-INACTIVE', Project_ID: 'P1', Task_Name: '無効担当', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2026-12-10' });
  db.update('TASKS', 'T-INACTIVE', { Owner_Member_ID: 'M-OFF' });

  assert.throws(() => app.context.approveTaskAssignment('T-INACTIVE', 'admin@example.test', 'APPROVE ASSIGNMENT'), /active owner/);
  assert.throws(() => app.context.approveTaskAssignment('T-INACTIVE', 'admin@example.test', 'ok'), /confirmation/);
  assert.throws(() => app.context.approveTaskAssignment('T-INACTIVE', 'other@example.test', 'APPROVE ASSIGNMENT'), /verified/);
  assert.equal(db.find('TASKS', 'T-INACTIVE').Assignment_Approved_At, '');
});

test('archived projects keep their records but stop contributing to active work', () => {
  const app = fixtures.base();
  const db = app.context.Database;
  const engineer = app.context.Planning.workloadData('2026-11-02').members.find(member => member.Member_ID === 'M-ENG');
  // Only the P1 task (40h estimated, 8h actual, 32h remaining spread over 32 working days) counts.
  assert.equal(engineer.Remaining_Hours, 5);
  assert.equal(engineer.Unknown_Tasks, 1);
  assert.equal(db.read('TASKS').length, 3);
  assert.equal(db.find('PROJECTS', 'P2').Status, 'Archived');
  assert.equal(app.context.Eligibility.projectContributesWorkload(db.find('PROJECTS', 'P2')), false);
  assert.equal(app.context.Eligibility.projectNotificationsAllowed({ Status: 'Active', Notification_Enabled: false }), false);
  assert.equal(app.context.Eligibility.projectNotificationsAllowed({ Status: 'Active', Notification_Enabled: '' }), true);
});

test('project freshness follows application changes but not dashboard refreshes', () => {
  const app = fixtures.base();
  const db = app.context.Database;
  const today = app.context.Domain.today();
  db.update('PROJECTS', 'P1', { Last_Updated: '2026-01-01T00:00:00.000Z' });
  assert.ok(app.context.Health.staleDays(db.find('PROJECTS', 'P1'), today) > 7);

  app.context.updateTask('T1', { Progress_Percent: 60 });
  assert.notEqual(app.context.Health.day(db.find('PROJECTS', 'P1').Last_Updated), '2026-01-01');

  const frozen = app.context.Health.day(db.find('PROJECTS', 'P1').Last_Updated);
  app.context.Dashboard.refresh(today);
  assert.equal(app.context.Health.day(db.find('PROJECTS', 'P1').Last_Updated), frozen);
});

test('stable IDs survive view refreshes and sorting', () => {
  const app = fixtures.base();
  const db = app.context.Database;
  const sheet = app.book.getSheetByName('TASKS');
  const header = sheet.rows[0];
  const idColumn = header.indexOf('Task_ID');
  const body = sheet.rows.slice(1).reverse();
  sheet.rows = [header].concat(body);
  app.context.Dashboard.refresh('2026-11-02');
  assert.deepEqual(db.read('TASKS').map(task => task.Task_ID).sort(), ['T1', 'T2', 'T3']);
  assert.equal(db.find('TASKS', 'T1').Task_Name, '機構設計');
  assert.throws(() => db.update('TASKS', 'T1', { Task_ID: 'renumbered' }), /immutable/);
});
