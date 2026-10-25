'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

function project(app, id, overrides = {}) {
  return app.context.Database.insert('PROJECTS', Object.assign({
    Project_ID: id, Project_Name: id, Status: 'Active', Project_Owner_ID: 'M-MGR',
    Committed_Deadline: '2099-12-31'
  }, overrides));
}

function task(app, id, overrides = {}) {
  return app.context.Database.insert('TASKS', Object.assign({
    Task_ID: id, Project_ID: 'P1', Task_Name: id, Owner_Member_ID: 'M-ENG',
    Status: 'Assigned', Due_Date: '2099-12-20'
  }, overrides));
}

test('health returns a numeric stale age and keeps thresholds separate', () => {
  const app = fixtures.base();
  const today = app.context.Domain.today();
  project(app, 'H-OLD', { Last_Updated: '2020-01-01T00:00:00.000Z' });
  project(app, 'H-NEW', {});

  const analysis = app.context.Dashboard.analyze(today);
  const old = analysis.projects.find(item => item.project.Project_ID === 'H-OLD');
  const fresh = analysis.projects.find(item => item.project.Project_ID === 'H-NEW');

  assert.equal(typeof old.health.staleDays, 'number');
  assert.ok(old.health.staleDays > 1000);
  assert.equal(old.health.staleDays.staleDays, undefined, 'staleDays must never hold a thresholds object');
  assert.equal(old.health.thresholds.staleDays, 7);
  assert.equal(old.health.thresholds.staleAlert, true);
  assert.equal(typeof fresh.health.staleDays, 'number');
  assert.ok(fresh.health.staleDays <= 7);

  const evaluated = app.context.evaluateProjectHealth('H-OLD', today);
  assert.equal(typeof evaluated.staleDays, 'number');
  assert.deepEqual(Object.keys(evaluated).sort(), ['evaluatedOn', 'health', 'reasons', 'staleDays', 'thresholds']);
});

test('dashboard attention categories stay independent', () => {
  const app = fixtures.base();
  const today = app.context.Domain.today();

  project(app, 'U1', { Committed_Deadline: '', Forecast_End: '' });
  project(app, 'R1', { Committed_Deadline: '2020-01-01' });
  project(app, 'S1', { Last_Updated: '2020-01-01T00:00:00.000Z' });
  project(app, 'B1', {});
  project(app, 'C1', {});
  project(app, 'O1', {});

  task(app, 'T-BLOCKED', { Project_ID: 'B1', Status: 'Blocked' });
  task(app, 'T-OVERDUE', { Project_ID: 'O1', Due_Date: '2020-01-01' });
  app.context.Database.insert('ISSUES', {
    Issue_ID: 'I-CRIT', Project_ID: 'C1', Description: '重大な品質問題', Severity: 'Critical', Status: 'Open'
  });

  const analysis = app.context.Dashboard.analyze(today);
  const attention = analysis.attention;
  const metrics = analysis.metrics;

  assert.equal(attention.unknownScheduleProjects.slice().sort().join(','), 'U1',
    'only projects without any schedule information are unknown');
  assert.equal(attention.overdueTasks.slice().sort().join(','), 'T-OVERDUE');
  assert.equal(attention.blockedTasks.slice().sort().join(','), 'T-BLOCKED');
  assert.equal(attention.criticalIssues.slice().sort().join(','), 'I-CRIT');
  assert.equal(attention.staleProjects.slice().sort().join(','), 'S1');

  const atRisk = attention.atRiskProjects.slice().sort();
  assert.equal(atRisk.indexOf('U1'), -1, 'unknown schedule is not an at-risk colour');
  for (const id of ['R1', 'S1', 'B1', 'C1', 'O1']) assert.ok(atRisk.indexOf(id) >= 0, id + ' must be at risk');

  assert.equal(metrics.unknownScheduleProjects, 1);
  assert.equal(metrics.overdueTasks, 1);
  assert.equal(metrics.blockedTasks, 1);
  assert.equal(metrics.criticalIssues, 1);
  assert.equal(metrics.staleProjects, 1);
  assert.equal(metrics.archivedProjects, 1);

  const dashboard = app.context.Dashboard.refresh(today);
  assert.equal(dashboard.unknownScheduleProjects, 1);
  assert.equal(dashboard.blockedTasks, 1);
});

test('a realistic programme keeps progress, workload and attention honest', () => {
  const app = fixtures.base();
  const db = app.context.Database;
  const asOf = '2026-11-02';

  db.insert('MEMBERS', { Member_ID: 'M-E1', Name: '設計 一郎', Email: 'e1@example.test', Active: true, Role: 'MEMBER', Weekly_Capacity_Hours: 40 });
  db.insert('MEMBERS', { Member_ID: 'M-E2', Name: '設計 二郎', Email: 'e2@example.test', Active: true, Role: 'MEMBER', Weekly_Capacity_Hours: 40 });
  db.insert('MEMBERS', { Member_ID: 'M-E3', Name: '設計 三郎', Email: 'e3@example.test', Active: true, Role: 'MEMBER', Weekly_Capacity_Hours: 40 });

  project(app, 'PRJ-A', { Committed_Deadline: '2026-12-31', Project_Owner_ID: 'M-MGR' });
  db.insert('SUBPROJECTS', { Subproject_ID: 'SUB-A1', Project_ID: 'PRJ-A', Subproject_Name: '機構', Status: 'Active' });
  db.insert('SUBPROJECTS', { Subproject_ID: 'SUB-A2', Project_ID: 'PRJ-A', Subproject_Name: '電気', Status: 'Active' });
  db.insert('TASKS', { Task_ID: 'A1', Project_ID: 'PRJ-A', Subproject_ID: 'SUB-A1', Task_Name: '機構設計', Owner_Member_ID: 'M-E1', Status: 'In Progress', Progress_Percent: 50, Estimated_Hours: 40, Planned_Start: '2026-11-02', Due_Date: '2026-11-06' });
  db.insert('TASKS', { Task_ID: 'A2', Project_ID: 'PRJ-A', Subproject_ID: 'SUB-A2', Task_Name: '電気要件', Owner_Member_ID: 'M-E1', Status: 'Assigned' });
  db.insert('TASKS', { Task_ID: 'A3', Project_ID: 'PRJ-A', Task_Name: '構想レビュー', Owner_Member_ID: 'M-E2', Status: 'Done', Progress_Percent: 100, Estimated_Hours: 10, Due_Date: '2026-11-06' });

  project(app, 'PRJ-B', { Committed_Deadline: '2026-12-31', Project_Owner_ID: 'M-MGR' });
  db.insert('TASKS', { Task_ID: 'B1', Project_ID: 'PRJ-B', Task_Name: '部品搬入待ち', Owner_Member_ID: 'M-E2', Status: 'Blocked', Estimated_Hours: 20, Planned_Start: '2026-10-05', Due_Date: '2026-10-20' });
  db.insert('ISSUES', { Issue_ID: 'I-SUPPLIER', Project_ID: 'PRJ-B', Description: '供应商納期遅延', Severity: 'High', Status: 'Open', Raised_Date: '2026-10-21' });

  project(app, 'PRJ-C', { Status: 'Archived', Committed_Deadline: '2026-09-30', Archived_At: '2026-10-01T00:00:00.000Z' });
  db.insert('TASKS', { Task_ID: 'C1', Project_ID: 'PRJ-C', Task_Name: '旧型の残作業', Owner_Member_ID: 'M-E3', Status: 'Assigned', Estimated_Hours: 30, Planned_Start: '2026-11-02', Due_Date: '2026-11-06' });

  const analysis = app.context.Dashboard.analyze(asOf);
  const projectA = analysis.projects.find(item => item.project.Project_ID === 'PRJ-A');
  assert.equal(projectA.progress.percent, 58.82, '40h@50% + unknown@0 + 10h@100% with fallback weight 1');
  assert.equal(projectA.progress.unknown, 1);

  const members = app.context.Planning.workloadData(asOf).members;
  const e1 = members.find(member => member.Member_ID === 'M-E1');
  const e2 = members.find(member => member.Member_ID === 'M-E2');
  const e3 = members.find(member => member.Member_ID === 'M-E3');
  // Remaining hours are estimate minus logged actual hours; progress alone does not reduce them.
  assert.equal(e1.Remaining_Hours, 40);
  assert.equal(e1.Unknown_Tasks, 1);
  assert.equal(e1.Capacity_Hours, 40);
  assert.equal(e2.Remaining_Hours, 20, 'the blocked, overdue supplier task still consumes the week');
  assert.equal(e3.Remaining_Hours, 0, 'archived project work is excluded from workload');
  assert.equal(e3.Unknown_Tasks, 0);

  assert.equal(analysis.metrics.archivedProjects, 2, 'the fixture baseline archive plus PRJ-C');
  assert.equal(analysis.attention.blockedTasks.join(','), 'B1');
  assert.equal(analysis.attention.overdueTasks.join(','), 'B1');
  assert.ok(analysis.attention.staleProjects.length >= 0);
  const projectB = analysis.projects.find(item => item.project.Project_ID === 'PRJ-B');
  assert.equal(projectB.health.reasons.indexOf('BLOCKED_TASK') >= 0, true);
  assert.equal(projectB.health.reasons.indexOf('OVERDUE_TASK') >= 0, true);
  assert.equal(projectB.health.reasons.indexOf('UNKNOWN_SCHEDULE') >= 0, false);

  const report = app.context.Reports.weekly(asOf);
  assert.equal(report.sections.blocked, 1);
  assert.equal(report.sections.overdue, 1);
  assert.match(report.body, /部品搬入待ち/);
  assert.doesNotMatch(report.body, /旧型の残作業/, 'archived project work is not reported as active');

  app.context.refreshProgress();
  assert.equal(db.find('PROJECTS', 'PRJ-A').Progress_Percent, 58.82);
  assert.equal(db.find('SUBPROJECTS', 'SUB-A1').Progress_Percent, 50);
  // A subproject containing only unestimated work reports 0% with the unknown count kept separate.
  assert.equal(db.find('SUBPROJECTS', 'SUB-A2').Progress_Percent, 0);
  assert.equal(app.context.Progress.rollup([db.find('TASKS', 'A2')]).unknown, 1);
});

test('upgrade preserves skill records, notification history, custom columns and formulas', () => {
  const app = fixtures.base();
  const context = app.context;
  const db = context.Database;

  db.insert('SKILLS', { Skill_ID: 'SK1', Skill_Name: '機械設計', Required_Level: 3 });
  db.insert('MEMBER_SKILLS', { Member_Skill_ID: 'MS1', Member_ID: 'M-ENG', Skill_ID: 'SK1', Current_Level: 2, Assessment_Date: '2026-04-01', Assessed_By: 'M-MGR', Evidence: '過去2案件', Training_Action: 'OJT', Next_Review_Date: '2026-10-01' });
  db.insert('NOTIFICATION_LOG', { Notification_ID: 'N1', Notification_Key: '["legacy"]', Task_ID: 'T1', Recipient: 'engineer@example.test', Notification_Type: 'NEW_ASSIGNMENT', Assignment_Version: 1, Result: 'SENT' });

  const tasks = app.book.getSheetByName('TASKS');
  tasks.rows[0].push('Manual_Note');
  tasks.rows.slice(1).forEach((row, index) => row.push(index === 0 ? '=1+1' : 'keep'));

  app.book.sheets = app.book.sheets.filter(sheet => ['PROJECT_PHASES', 'SCHEDULE_CONFIRMATIONS'].indexOf(sheet.getName()) < 0);
  for (const [table, field] of [['PROJECTS', 'Notification_Enabled'], ['MEMBERS', 'Role'],
    ['NOTIFICATION_LOG', 'Reconciled_At'], ['NOTIFICATION_LOG', 'Reconciled_By']]) {
    const sheet = app.book.getSheetByName(table);
    const column = sheet.rows[0].indexOf(field);
    if (column >= 0) sheet.rows.forEach(row => row.splice(column, 1));
  }
  const history = app.book.getSheetByName('SCHEMA_MIGRATIONS');
  history.rows = [history.rows[0], ['INITIALIZE_V2', new Date().toISOString(), 0, 2, 'SUCCESS', 'NEW_EMPTY_DATABASE']];

  const before = JSON.parse(JSON.stringify(context.Backup.snapshot(app.book)));
  app.properties.setProperty('APPROVED_MIGRATIONS', '003_management_reliability,004_shared_dashboard');
  assert.equal(context.upgradeExistingDatabase(), 4);

  for (const old of before) {
    if (['SCHEMA_MIGRATIONS', 'BACKUP_LOG', 'AUTOMATION_SETTINGS'].includes(old.name)) continue;
    const values = app.book.getSheetByName(old.name).getDataRange().getValues();
    old.values.forEach((row, r) => row.forEach((cell, c) => assert.deepEqual(values[r][c], cell,
      `${old.name} row ${r + 1} column ${c + 1} changed`)));
  }

  assert.equal(db.find('MEMBER_SKILLS', 'MS1').Evidence, '過去2案件');
  assert.equal(db.find('MEMBER_SKILLS', 'MS1').Current_Level, 2);
  assert.equal(db.find('NOTIFICATION_LOG', 'N1').Result, 'SENT');
  assert.equal(db.find('NOTIFICATION_LOG', 'N1').Notification_Key, '["legacy"]');
  assert.equal(db.find('TASKS', 'T1').Owner_Member_ID, 'M-ENG');
  assert.equal(db.find('TASKS', 'T1').Manual_Note, '=1+1');
  assert.equal(db.find('TASKS', 'T2').Manual_Note, 'keep');
  assert.deepEqual(db.read('TASKS').map(row => row.Task_ID).sort(), ['T1', 'T2', 'T3']);
  assert.equal(app.backups.length, 2);
});
