'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

test('dashboard derives portfolio and attention metrics from operational tables', () => {
  const app = fixtures.base();
  const context = app.context;
  const db = context.Database;
  const today = context.Domain.today();
  db.insert('PROJECTS', { Project_ID: 'P-OLD', Project_Name: '旧案件', Status: 'Archived', Committed_Deadline: '2020-01-01' });
  db.insert('TASKS', { Task_ID: 'T-OVERDUE', Project_ID: 'P1', Task_Name: '遅延タスク', Owner_Member_ID: 'M-ENG', Status: 'In Progress', Due_Date: '2020-01-01', Estimated_Hours: 8 });
  db.insert('ISSUES', { Issue_ID: 'I1', Project_ID: 'P1', Description: '重大な品質問題', Severity: 'Critical', Status: 'Open' });
  db.insert('MILESTONES', { Milestone_ID: 'MS1', Project_ID: 'P1', Milestone_Name: '設計審査', Target_Date: '2099-01-31' });

  const tasksBefore = JSON.stringify(db.read('TASKS'));
  const metrics = context.Dashboard.refresh(today);

  assert.equal(metrics.activeProjects, 1);
  assert.equal(metrics.archivedProjects, 2);
  assert.equal(metrics.overdueTasks, 1);
  assert.equal(metrics.criticalIssues, 1);
  assert.equal(metrics.unknownEstimateTasks, 1);
  assert.equal(metrics.unplannedTasks, 2);
  assert.equal(metrics.pendingApprovals, 3);
  assert.equal(metrics.unownedTasks, 0);
  assert.equal(metrics.upcomingMilestones, 1);
  assert.equal(metrics.blockedTasks, 0);
  assert.equal(metrics.dueWithin30, 0);
  assert.ok(metrics.atRiskProjects >= 1);

  assert.equal(JSON.stringify(db.read('TASKS')), tasksBefore, 'operational task rows are untouched');
  const overview = app.book.getSheetByName('PROJECT_OVERVIEW').getDataRange().getValues();
  assert.ok(overview.flat().includes('検査装置'));
  const team = app.book.getSheetByName('TEAM_VIEW').getDataRange().getValues();
  assert.ok(team.flat().includes('設計 次郎'));
  assert.ok(app.book.getSheetByName('AUTOMATION_STATUS'));
});

test('Gantt fallback shows hierarchy, milestones, forecast dates and unscheduled tasks', () => {
  const app = fixtures.base();
  const context = app.context;
  context.Database.insert('MILESTONES', { Milestone_ID: 'MS1', Project_ID: 'P1', Milestone_Name: '設計審査', Target_Date: '2026-12-20' });
  context.Database.update('PROJECTS', 'P1', { Forecast_End: '2026-12-28' });
  context.Dashboard.refresh('2026-11-02');

  const rows = app.book.getSheetByName('GANTT_OVERVIEW').getDataRange().getValues();
  const kinds = rows.slice(1).map(row => row[0]);
  assert.ok(kinds.includes('プロジェクト'));
  assert.ok(kinds.includes('サブプロジェクト'));
  assert.ok(kinds.includes('マイルストーン'));
  assert.ok(kinds.includes('タスク'));
  const t1 = rows.find(row => row[1] === 'T1');
  assert.equal(t1[3], '検査装置');
  assert.equal(t1[5], '2026-12-15');
  const projectRow = rows.find(row => row[0] === 'プロジェクト' && row[1] === 'P1');
  assert.equal(projectRow[6], '2026-12-28', 'project forecast is stored separately from the task deadline');
  assert.equal(t1[6], '');
  const t2 = rows.find(row => row[1] === 'T2');
  assert.equal(t2[9], '日程未設定');
  const milestone = rows.find(row => row[1] === 'MS1');
  assert.equal(milestone[5], '2026-12-20');

  const timeline = app.book.getSheetByName('TIMELINE_DATA').getDataRange().getValues();
  assert.ok(timeline[0].includes('開始日'));
  assert.ok(timeline.slice(1).some(row => row[0] === 'T1' && row[2] === 'P1'));
});

test('workload separates planned from actual work and flags overcapacity', () => {
  const app = fixtures.base();
  const context = app.context;
  const db = context.Database;
  db.insert('MEMBERS', { Member_ID: 'M-OVER', Name: '超過 太郎', Email: 'over@example.test', Active: true, Role: 'MEMBER', Weekly_Capacity_Hours: 8 });
  db.insert('PROJECTS', { Project_ID: 'P-BUSY', Project_Name: '繁忙案件', Status: 'Active', Project_Owner_ID: 'M-MGR', Committed_Deadline: '2099-12-31' });
  db.insert('TASKS', { Task_ID: 'T-BUSY', Project_ID: 'P-BUSY', Task_Name: '繁忙タスク', Owner_Member_ID: 'M-OVER', Status: 'Assigned', Planned_Start: '2026-11-02', Due_Date: '2026-11-06', Estimated_Hours: 40, Actual_Hours: 4 });
  db.insert('TASKS', { Task_ID: 'T-UNSURE', Project_ID: 'P-BUSY', Task_Name: '未見積', Owner_Member_ID: 'M-OVER', Status: 'Assigned' });

  const member = context.Planning.workloadData('2026-11-02').members.find(item => item.Member_ID === 'M-OVER');
  assert.equal(member.Capacity_Hours, 8);
  assert.equal(member.Remaining_Hours, 36);
  assert.equal(member.Actual_Hours, 4);
  assert.equal(member.Unknown_Tasks, 1);
  assert.equal(member.Utilization, 4.5);
  assert.equal(member.Overallocated, true);

  const metrics = context.Dashboard.refresh('2026-11-02');
  assert.equal(metrics.overallocatedMembers, 1);
  context.Planning.workload('2026-11-02');
  const workloadRows = app.book.getSheetByName('WORKLOAD').getDataRange().getValues();
  assert.ok(workloadRows[0].includes('実績時間'));
  assert.ok(workloadRows.slice(1).some(row => row[0] === 'M-OVER' && row[9] === '超過'));
});

test('generated views remain the only replaceable sheets', () => {
  const app = fixtures.base();
  const context = app.context;
  for (const name of context.Schema.generated) assert.ok(app.book.getSheetByName(name), 'missing generated sheet ' + name);
  assert.throws(() => context.Database.writeGenerated('TASKS', [['x']]), /Not a generated/);
  assert.throws(() => context.Database.writeGenerated('AUTOMATION_SETTINGS', [['x']]), /Not a generated/);
});
