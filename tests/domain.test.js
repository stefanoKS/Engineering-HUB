'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers');

function fixture() {
  const app = loadApp();
  app.properties.setProperties({ ALLOWED_RECIPIENT_DOMAINS: 'example.test' });
  for (const [name, definition] of Object.entries(app.context.Schema.tables)) {
    app.spreadsheet.insertSheet(name).appendRow(definition.fields.map(field => field.name));
  }
  const c = app.context;
  const member = c.createMember({ Name: 'Engineer', Email: 'engineer@example.test', Weekly_Capacity_Hours: 40 });
  const project = c.createProject({ Project_Name: 'Product', Status: 'Active', Committed_Deadline: '2026-11-30' });
  const subproject = c.createSubproject({ Project_ID: project.Project_ID, Subproject_Name: 'Prototype' });
  function task(overrides = {}) {
    return c.createTask({
      Project_ID: project.Project_ID, Subproject_ID: subproject.Subproject_ID,
      Task_Name: 'Build', Owner_Member_ID: member.Member_ID,
      Planned_Start: '2026-10-26', Due_Date: '2026-10-30', Estimated_Hours: 40,
      ...overrides
    });
  }
  return { ...app, c, member, project, subproject, task };
}

test('projects retain original commitments; generated updates never rewrite operational data', () => {
  const { c, project, task, spreadsheet } = fixture();
  task();
  c.updateProject(project.Project_ID, { Committed_Deadline: '2026-12-01' });
  assert.equal(c.Database.find('PROJECTS', project.Project_ID).Original_Deadline, '2026-11-30');
  assert.throws(() => c.updateProject(project.Project_ID, { Original_Deadline: '2027-01-01' }), /immutable/);
  const before = JSON.stringify(spreadsheet.getSheetByName('TASKS').rows);
  const metrics = c.refreshDashboard('2026-10-31');
  assert.equal(metrics.overdueTasks, 1);
  assert.equal(metrics.activeProjects, 1);
  assert.equal(JSON.stringify(spreadsheet.getSheetByName('TASKS').rows), before);
  assert.ok(spreadsheet.getSheetByName('TIMELINE_DATA'));
  assert.ok(spreadsheet.getSheetByName('GANTT_OVERVIEW'));
});

test('cross-project references, inactive owners, invalid dates and progress are rejected', () => {
  const { c, member, task, subproject } = fixture();
  const other = c.createProject({ Project_Name: 'Other' });
  assert.throws(() => task({ Project_ID: other.Project_ID }), /Subproject/);
  assert.throws(() => task({ Due_Date: '2026-02-30' }), /valid/);
  assert.throws(() => task({ Due_Date: '2026-10-01' }), /exceed/);
  assert.throws(() => task({ Progress_Percent: 101 }), /range/);
  assert.throws(() => task({ Status: 'Done', Progress_Percent: 20 }), /100%/);
  c.updateMember(member.Member_ID, { Active: false });
  assert.throws(() => task(), /active/);
  assert.throws(() => c.updateSubproject(subproject.Subproject_ID, { Project_ID: 'missing' }), /not found/);
});

test('task dependencies are explicit, same-project and acyclic', () => {
  const { c, task } = fixture();
  const first = task(), second = task({ Dependency_IDs: first.Task_ID });
  assert.throws(() => c.updateTask(first.Task_ID, { Dependency_IDs: second.Task_ID }), /Cyclic/);
  assert.throws(() => task({ Dependency_IDs: 'missing' }), /Unknown/);
  const done = c.updateTask(first.Task_ID, { Status: 'Done', Progress_Percent: 100 });
  assert.ok(done.Completed_At);
  assert.equal(c.Database.find('TASKS', first.Task_ID).Dependency_IDs, '');
});

test('assignment changes increment version and revoke explicit notification approval', () => {
  const { c, task } = fixture();
  const created = task();
  c.Notifications.activate('admin@example.test', 'ACTIVATE NOTIFICATIONS');
  c.approveTaskAssignment(created.Task_ID, 'admin@example.test', 'APPROVE ASSIGNMENT');
  const approved = c.Database.find('TASKS', created.Task_ID);
  assert.ok(approved.Assignment_Approved_At);
  const changed = c.updateTask(created.Task_ID, { Due_Date: '2026-11-02' });
  assert.equal(changed.Assignment_Version, approved.Assignment_Version + 1);
  assert.equal(changed.Assignment_Approved_At, '');
  const forged = c.updateTask(created.Task_ID, { Assignment_Approved_At: '2026-01-01T00:00:00Z', Assignment_Version: 99 });
  assert.equal(forged.Assignment_Approved_At, '');
  assert.equal(forged.Assignment_Version, changed.Assignment_Version);
  const progress = c.updateTask(created.Task_ID, { Progress_Percent: 25 });
  assert.equal(progress.Assignment_Version, changed.Assignment_Version);
});

test('member skill upserts are unique and matrix includes unassessed cells', () => {
  const { c, member, spreadsheet } = fixture();
  const skill = c.createSkill({ Skill_Name: 'CAD' });
  c.createSkill({ Skill_Name: 'Testing' });
  c.setMemberSkill(member.Member_ID, skill.Skill_ID, 2);
  c.setMemberSkill(member.Member_ID, skill.Skill_ID, 4);
  assert.equal(c.Database.read('MEMBER_SKILLS').length, 1);
  assert.throws(() => c.setMemberSkill(member.Member_ID, skill.Skill_ID, 5), /range/);
  c.refreshSkillMatrix();
  assert.deepEqual(spreadsheet.getSheetByName('SKILL_MATRIX').rows[1].slice(2), [4, '']);
});

test('reverse schedule validates DAG and skips Japanese holidays and weekends without changing commitments', () => {
  const { c, project } = fixture();
  c.Database.insert('HOLIDAYS', { Date: '2026-11-03', Name: '文化の日' });
  const before = JSON.stringify(c.Database.read('PROJECTS'));
  const phases = [
    { Phase_ID: 'design', Phase_Name: 'Design', Duration_Days: 2, Buffer_Days: 0, Dependency_IDs: '' },
    { Phase_ID: 'build', Phase_Name: 'Build', Duration_Days: 2, Buffer_Days: 0, Dependency_IDs: 'design' }
  ];
  const schedule = c.reversePlan(project.Project_ID, '2026-11-04', phases);
  assert.equal(schedule[1].Start_Date, '2026-11-02');
  assert.equal(schedule[0].End_Date, '2026-10-30');
  assert.equal(schedule[0].Start_Date, '2026-10-29');
  assert.equal(JSON.stringify(c.Database.read('PROJECTS')), before);
  assert.throws(() => c.reversePlan(project.Project_ID, '2026-11-04', [
    { ...phases[0], Dependency_IDs: 'build' }, phases[1]
  ]), /Cyclic/);
  assert.throws(() => c.reversePlan(project.Project_ID, '2026-11-04', [
    { ...phases[0], Dependency_IDs: 'unknown' }
  ]), /Unknown/);
});

test('unknown reverse durations remain DRAFT with no invented dates', () => {
  const { c, project } = fixture();
  const schedule = c.reversePlan(project.Project_ID, '2026-11-04', [
    { Phase_ID: 'a', Phase_Name: 'A', Duration_Days: 2 },
    { Phase_ID: 'b', Phase_Name: 'B', Duration_Days: '', Dependency_IDs: 'a' }
  ]);
  for (const row of schedule) {
    assert.equal(row.Status, 'DRAFT');
    assert.equal(row.Start_Date, '');
    assert.equal(row.End_Date, '');
  }
});

test('workload distributes remaining estimates across current working days, with holiday capacity', () => {
  const { c, task } = fixture();
  task({ Actual_Hours: 8 });
  c.Database.insert('HOLIDAYS', { Date: '2026-10-28', Name: 'Company holiday' });
  const workload = c.refreshWorkload('2026-10-26');
  assert.equal(workload[0].Remaining_Hours, 32);
  assert.equal(workload[0].Capacity_Hours, 32);
  assert.equal(workload[0].Utilization, 1);
  task({ Task_Name: 'Unknown', Estimated_Hours: '' });
  assert.equal(c.refreshWorkload('2026-10-26')[0].Unknown_Tasks, 1);
});

test('issues and milestones enforce project and subproject consistency', () => {
  const { c, project, subproject, task } = fixture();
  const work = task();
  const other = c.createProject({ Project_Name: 'Other' });
  assert.throws(() => c.createIssue({ Project_ID: other.Project_ID, Task_ID: work.Task_ID, Description: 'Problem' }), /match/);
  assert.throws(() => c.createMilestone({ Project_ID: other.Project_ID, Subproject_ID: subproject.Subproject_ID, Milestone_Name: 'Gate' }), /Subproject/);
  const issue = c.createIssue({ Project_ID: project.Project_ID, Task_ID: work.Task_ID, Description: 'Problem' });
  assert.equal(c.updateIssue(issue.Issue_ID, { Status: 'Closed' }).Status, 'Closed');
});

test('operational updates preserve custom columns and existing date-valued cells', () => {
  const { c, task, spreadsheet, run } = fixture();
  const created = task();
  const sheet = spreadsheet.getSheetByName('TASKS');
  sheet.rows[0].push('User_Formula');
  sheet.rows[1].push('=1+1');
  const due = run("new Date('2026-10-30T00:00:00Z')");
  c.Database.update('TASKS', created.Task_ID, { Due_Date: due });
  c.updateTask(created.Task_ID, { Progress_Percent: 25 });
  assert.equal(sheet.rows[1][sheet.rows[0].indexOf('User_Formula')], '=1+1');
  assert.equal(sheet.rows[1][sheet.rows[0].indexOf('Due_Date')], due);
});
