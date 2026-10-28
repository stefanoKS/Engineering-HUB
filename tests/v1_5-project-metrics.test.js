'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {base} = require('./fixtures');

const make = (actor = 'admin@example.test') => base({actor, properties: {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'}});
const project = (a, id) => a.context.managerWebRead('projects', {}).data.items.find(p => p.id === id);

/** Task and project writes must never fall back to the full report refresh. */
function forbidReports(a) {
  const generated = [];
  a.context.Dashboard.refresh = () => { throw new Error('Unwanted full management refresh'); };
  a.context.Database.writeGenerated = name => { generated.push(name); };
  return generated;
}

test('a task save immediately changes the project list and overview without a report refresh', () => {
  const a = make(), c = a.context, generated = forbidReports(a);
  // The stored column is never maintained by a task save: 24.39% is derived from T1 (25% of 40h)
  // and the unestimated T2 (documented fallback weight 1).
  assert.equal(c.Database.find('PROJECTS', 'P1').Progress_Percent, 0);
  let p1 = project(a, 'P1');
  assert.equal(p1.progress, 24.39);
  assert.equal(p1.totalTasks, 2);
  assert.equal(p1.doneTasks, 0);
  assert.equal(p1.overdueTasks, 0);
  assert.equal(p1.health, 'GREEN');

  const t2 = c.managerWebRead('task', {id: 'T2'}).data.record;
  // V1.6: Done/100 % comes from the reviewed completion workflow, never from an ordinary save.
  const refused = c.managerWebWrite('taskSave', {taskId: 'T2', revision: t2._revision, progress: 100});
  assert.equal(refused.ok, false);
  assert.match(refused.error, /承認/);
  c.Completion.withApproval(() => c.Tasks.update('T2', {Status: 'Done', Progress_Percent: 100}));
  assert.equal(c.Database.find('PROJECTS', 'P1').Progress_Percent, 0);
  p1 = project(a, 'P1');
  assert.equal(p1.progress, 26.83);
  assert.equal(p1.doneTasks, 1);
  assert.equal(c.managerWebRead('overview').data.projects.items.find(x => x.id === 'P1').progress, 26.83);

  const t1 = c.managerWebRead('task', {id: 'T1'}).data.record;
  const blocked = c.managerWebWrite('taskSave', {taskId: 'T1', revision: t1._revision, status: 'Blocked'});
  assert.equal(blocked.ok, true, blocked.error);
  p1 = project(a, 'P1');
  assert.equal(p1.health, 'YELLOW');
  assert.ok(p1.healthReasons.indexOf('BLOCKED_TASK') >= 0, JSON.stringify(p1.healthReasons));
  const overview = c.managerWebRead('overview').data;
  assert.equal(overview.projects.items.find(x => x.id === 'P1').health, 'YELLOW');
  assert.ok(overview.kpis.risk >= 1);
  assert.deepEqual(generated, []);
});

test('project cards receive fresh counts and a neutral deadline state', () => {
  const a = make(), c = a.context, generated = forbidReports(a);
  c.Database.insert('TASKS', {Task_ID: 'T-LATE', Project_ID: 'P1', Task_Name: '遅延タスク', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2020-01-01'});
  let p1 = project(a, 'P1');
  assert.equal(p1.overdueTasks, 1);
  assert.equal(p1.deadline, '2026-12-31');
  assert.equal(p1.deadlineKind, 'future');
  assert.ok(p1.daysRemaining > 7);
  assert.equal(p1.health, 'YELLOW');
  assert.ok(p1.healthReasons.indexOf('OVERDUE_TASK') >= 0);

  c.Database.update('PROJECTS', 'P1', {Committed_Deadline: '2020-01-01'});
  p1 = project(a, 'P1');
  assert.equal(p1.deadlineKind, 'overdue');
  assert.ok(p1.daysRemaining < 0);

  c.Database.update('PROJECTS', 'P1', {Committed_Deadline: ''});
  assert.equal(project(a, 'P1').deadlineKind, 'none');
  assert.equal(project(a, 'P2').deadlineKind, 'closed');
  assert.deepEqual(generated, []);
});

test('project save keeps the derived progress and never rewrites it from the browser', () => {
  const a = make(), c = a.context, generated = forbidReports(a);
  const before = c.managerWebRead('project', {id: 'P1'}).data.record;
  const saved = c.managerWebWrite('projectSave', {projectId: 'P1', revision: before._revision, name: '検査装置 改'});
  assert.equal(saved.ok, true, saved.error);
  assert.equal(c.Database.find('PROJECTS', 'P1').Project_Name, '検査装置 改');
  assert.equal(c.Database.find('PROJECTS', 'P1').Progress_Percent, 0);
  assert.equal(project(a, 'P1').progress, 24.39);
  assert.deepEqual(generated, []);
});

test('deadline-only task creation keeps the planned start unknown; a duration still back-plans', () => {
  const a = make(), c = a.context, generated = forbidReports(a);
  const deadlineOnly = c.managerWebWrite('taskSave', {projectId: 'P1', taskName: '期限のみ', ownerId: 'M-ENG', deadline: '2026-12-18', durationValue: ''});
  assert.equal(deadlineOnly.ok, true, deadlineOnly.error);
  const created = c.Database.find('TASKS', deadlineOnly.data.task.Task_ID);
  assert.equal(created.Due_Date, '2026-12-18');
  assert.equal(created.Planned_Start, '');
  assert.equal(created.Planned_Duration_Value, '');
  assert.equal(created.Planned_Start_Source, '');
  assert.equal(deadlineOnly.data.task.Planned_Start, '');

  const planned = c.managerWebWrite('taskSave', {projectId: 'P1', taskName: '期間あり', ownerId: 'M-ENG', deadline: '2026-12-18', durationValue: 3, durationUnit: 'DAY', durationBasis: 'WORKING_DAYS'});
  assert.equal(planned.ok, true, planned.error);
  assert.equal(planned.data.task.Planned_Start, '2026-12-16');
  assert.equal(planned.data.task.Planned_Start_Source, 'DERIVED');

  const missing = c.managerWebWrite('taskSave', {projectId: 'P1', taskName: '期限なし', ownerId: 'M-ENG', durationValue: ''});
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Deadline required/);
  assert.deepEqual(generated, []);
});

test('hierarchy rollups, revision checks and role authorization are unchanged', () => {
  const a = make(), c = a.context;
  const detail = c.managerWebRead('project', {id: 'P1'}).data;
  assert.equal(detail.progress.percent, project(a, 'P1').progress);
  const sub = detail.subprojects.find(s => s.Subproject_ID === 'S1');
  assert.equal(sub._progress.percent, 25);
  assert.equal(typeof sub._revision, 'string');
  const tasks = c.managerWebRead('tasks', {projectId: 'P1', subprojectId: 'S1'}).data.items.map(t => t.id);
  assert.equal(tasks.join(','), 'T1');

  const rejected = c.managerWebWrite('taskSave', {taskId: 'T1', revision: 'stale-revision', taskName: 'Stale'});
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /EDIT_CONFLICT/);
  assert.equal(c.Database.find('TASKS', 'T1').Task_Name, '機構設計');

  a.setActor('engineer@example.test');
  assert.equal(c.managerWebRead('projects', {}).ok, false);
  assert.equal(c.managerWebRead('overview').ok, false);
  assert.equal(c.managerWebWrite('taskSave', {projectId: 'P1', taskName: 'forged', ownerId: 'M-ENG', deadline: '2026-12-18'}).ok, false);
  a.setActor('viewer@example.test');
  assert.equal(c.managerWebRead('projects', {}).ok, false);
  a.setActor('admin@example.test');
  assert.equal(c.managerWebRead('projects', {}).ok, true);
});

test('interactive reads write nothing and read every table exactly once per request', () => {
  const a = make(), c = a.context, generated = forbidReports(a);
  const reads = {};
  for (const sheet of a.book.getSheets()) {
    const get = sheet.getDataRange.bind(sheet);
    sheet.getDataRange = () => { const name = sheet.getName(); reads[name] = (reads[name] || 0) + 1; return get(); };
  }
  const reset = () => { Object.keys(reads).forEach(name => delete reads[name]); };
  const overview = c.managerWebRead('overview');
  assert.equal(overview.ok, true, overview.error);
  assert.ok(Object.values(reads).every(count => count === 1), JSON.stringify(reads));
  reset();
  const projects = c.managerWebRead('projects', {});
  assert.equal(projects.ok, true, projects.error);
  assert.ok(Object.values(reads).every(count => count === 1), JSON.stringify(reads));
  assert.deepEqual(generated, []);
  assert.equal(c.Database.read('TASKS').filter(t => t.Task_ID === 'T1').length, 1);
});
