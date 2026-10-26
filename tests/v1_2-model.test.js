'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers');

const LIMITS = {staleDays: 7, milestoneApproachDays: 14, delayToleranceDays: 0, staleAlert: true};
const TODAY = '2026-11-10';
// Values returned from the Apps Script VM belong to another realm; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));

function project(id, overrides) {
  return Object.assign({
    Project_ID: id, Project_Name: '案件 ' + id, Category: '設計', Project_Owner_ID: 'M1',
    Status: 'Active', Committed_Deadline: '2026-12-31', Forecast_End: '2026-12-20',
    Last_Updated: '2026-11-09T00:00:00.000Z', Dashboard_Visibility: 'INTERNAL',
    Dashboard_Summary: '公開用の概要', Description: '社外秘の詳細説明', Next_Action: '社外秘の次の一手'
  }, overrides || {});
}

function task(id, projectId, overrides) {
  return Object.assign({
    Task_ID: id, Project_ID: projectId, Subproject_ID: '', Task_Name: 'タスク ' + id,
    Owner_Member_ID: 'M1', Status: 'In Progress', Priority: 'High', Progress_Percent: 50,
    Due_Date: '2026-11-12', Estimated_Hours: 8, Description: '社外秘のタスク詳細',
    Acceptance_Criteria: '社外秘の完了条件', Next_Action: '社外秘の次アクション', Public_Note: '公開メモ'
  }, overrides || {});
}

function build(model, input) {
  return model.build(Object.assign({
    today: TODAY,
    limits: LIMITS,
    members: [{Member_ID: 'M1', Name: '設計 太郎', Email: 'hidden@example.test', Weekly_Capacity_Hours: 40}],
    projects: [], subprojects: [], tasks: [], milestones: [], issues: []
  }, input));
}

test('schema version 6 adds responsibilities, nested subprojects and the V1.2/V1.3 fields', () => {
  const app = loadApp();
  const context = app.context;
  assert.equal(context.Schema.version, 6);
  assert.deepEqual(plain(context.Migrations.registry.map(item => item.id)),
    ['002_task_assignment_safety', '003_management_reliability', '004_shared_dashboard',
      '005_task_planning_and_requests', '006_responsibilities_and_nested_subprojects']);
  const visibility = context.Schema.tables.PROJECTS.fields.find(field => field.name === 'Dashboard_Visibility');
  assert.equal(visibility.defaultValue, 'RESTRICTED');
  assert.deepEqual(plain(visibility.values), ['INTERNAL', 'RESTRICTED']);
  assert.ok(context.Schema.tables.PROJECTS.fields.some(field => field.name === 'Dashboard_Summary'));
  assert.ok(context.Schema.tables.TASKS.fields.some(field => field.name === 'Public_Note'));
  assert.ok(context.Schema.tables.PROJECTS.fields.some(field => field.name === 'Responsibility_ID'));
  assert.ok(context.Schema.tables.SUBPROJECTS.fields.some(field => field.name === 'Parent_Subproject_ID'));
  assert.ok(context.Schema.tables.RESPONSIBILITIES);
});

test('only INTERNAL projects are published; blank and unknown visibility stay private', () => {
  const app = loadApp();
  const model = app.context.SharedDashboardModel;
  const snapshot = build(model, {
    projects: [
      project('P1'),
      project('P2', {Dashboard_Visibility: 'RESTRICTED'}),
      project('P3', {Dashboard_Visibility: ''}),
      project('P4', {Dashboard_Visibility: 'internal-ish'})
    ],
    tasks: [task('T1', 'P1'), task('T2', 'P2'), task('T3', 'P3')]
  });
  assert.deepEqual(plain(snapshot.projects.map(item => item.projectId)), ['P1']);
  assert.deepEqual(plain(snapshot.tasks.map(item => item.taskId)), ['T1']);
  assert.equal(snapshot.excluded.projects, 3);
  assert.equal(snapshot.excluded.tasks, 2);
  assert.equal(model.visibility({Dashboard_Visibility: ''}), 'RESTRICTED');
  assert.equal(model.visibility({}), 'RESTRICTED');
});

test('public DTOs use the explicit allowlist and never carry private source fields', () => {
  const app = loadApp();
  const model = app.context.SharedDashboardModel;
  const snapshot = build(model, {
    projects: [project('P1')],
    subprojects: [{Subproject_ID: 'S1', Project_ID: 'P1', Subproject_Name: '試作', Owner_ID: 'M1', Status: 'Active'}],
    tasks: [task('T1', 'P1', {Subproject_ID: 'S1'})],
    milestones: [{Milestone_ID: 'MS1', Project_ID: 'P1', Milestone_Name: '設計審査', Target_Date: '2026-12-01'}]
  });

  const sets = [
    [snapshot.projects, model.PROJECT_PUBLIC_FIELDS],
    [snapshot.subprojects, model.SUBPROJECT_PUBLIC_FIELDS],
    [snapshot.tasks, model.TASK_PUBLIC_FIELDS],
    [snapshot.milestones, model.MILESTONE_PUBLIC_FIELDS]
  ];
  sets.forEach(([rows, allowed]) => {
    rows.forEach(row => {
      assert.deepEqual(Object.keys(row).sort(), Array.from(allowed).sort());
      assert.equal(model.isPublicFieldSet(row, allowed), true);
    });
  });

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /社外秘/, 'private description, acceptance criteria and next action never leave the manager');
  assert.doesNotMatch(serialized, /hidden@example\.test/, 'member e-mail addresses are never published');
  assert.equal(snapshot.tasks[0].publicNote, '公開メモ');
  assert.equal(snapshot.projects[0].summary, '公開用の概要');
  assert.equal(snapshot.projects[0].ownerName, '設計 太郎');
});

test('task text falls back to empty rather than substituting a private field', () => {
  const app = loadApp();
  const model = app.context.SharedDashboardModel;
  const snapshot = build(model, {
    projects: [project('P1')],
    tasks: [task('T1', 'P1', {Public_Note: ''})]
  });
  assert.equal(snapshot.tasks[0].publicNote, '');
});

test('cross-project task and milestone references are withheld, unknown subprojects are reported', () => {
  const app = loadApp();
  const model = app.context.SharedDashboardModel;
  const snapshot = build(model, {
    projects: [project('P1'), project('P2', {Dashboard_Visibility: 'RESTRICTED'})],
    subprojects: [
      {Subproject_ID: 'S1', Project_ID: 'P1', Subproject_Name: '試作', Status: 'Active'},
      {Subproject_ID: 'S2', Project_ID: 'P2', Subproject_Name: '秘匿', Status: 'Active'}
    ],
    tasks: [
      task('T1', 'P1', {Subproject_ID: 'S1'}),
      task('T2', 'P1', {Subproject_ID: 'S2'}),
      task('T3', 'P1', {Subproject_ID: 'MISSING'})
    ],
    milestones: [{Milestone_ID: 'MS1', Project_ID: 'P1', Subproject_ID: 'S2', Milestone_Name: '越境'}]
  });
  assert.deepEqual(plain(snapshot.tasks.map(item => item.taskId)), ['T1', 'T3']);
  assert.deepEqual(plain(snapshot.milestones.map(item => item.milestoneId)), []);
  const codes = snapshot.warnings.map(warning => warning.code);
  assert.ok(codes.indexOf('TASK_CROSS_PROJECT_REFERENCE') >= 0);
  assert.ok(codes.indexOf('TASK_UNKNOWN_SUBPROJECT') >= 0);
  assert.ok(codes.indexOf('MILESTONE_CROSS_PROJECT_REFERENCE') >= 0);
  assert.equal(snapshot.tasks[1].subprojectId, 'MISSING');
});

test('project aggregates describe only the published tasks', () => {
  const app = loadApp();
  const model = app.context.SharedDashboardModel;
  const snapshot = build(model, {
    projects: [project('P1')],
    tasks: [
      task('T1', 'P1', {Status: 'In Progress', Due_Date: '2026-11-05', Progress_Percent: 20}),
      task('T2', 'P1', {Status: 'Blocked', Progress_Percent: 0, Due_Date: '2026-11-11'}),
      task('T3', 'P1', {Status: 'Done', Progress_Percent: 100, Due_Date: '2026-11-01'}),
      task('T4', 'P1', {Status: 'Cancelled', Progress_Percent: 0, Due_Date: '2026-11-01'}),
      task('T5', 'P1', {Status: 'Not Started', Progress_Percent: 0, Due_Date: '2026-11-20'})
    ]
  });
  const summary = snapshot.projects[0];
  assert.equal(summary.totalTasks, 5);
  assert.equal(summary.doneTasks, 1);
  assert.equal(summary.openTasks, 3, 'in-progress, blocked and not-started work all count as open');
  assert.equal(summary.overdueTasks, 1);
  assert.equal(summary.blockedTasks, 1);
  assert.equal(summary.dueSoonTasks, 1, 'only the 2026-11-11 deadline is inside 7 days');
  // Progress is the effort-weighted rollup of published, non-cancelled tasks:
  // (8×20 + 8×0 + 8×100 + 8×0) / 32 = 30
  assert.equal(summary.progress, 30);
});

test('a restricted sibling project cannot influence a published project rollup', () => {
  const app = loadApp();
  const model = app.context.SharedDashboardModel;
  const shared = {
    projects: [project('P1', {Dashboard_Visibility: 'RESTRICTED'}), project('P2')],
    subprojects: [{Subproject_ID: 'S1', Project_ID: 'P1', Subproject_Name: '秘匿', Status: 'Active'}]
  };
  const withoutSibling = build(model, Object.assign({}, shared, {tasks: [task('T1', 'P2', {Progress_Percent: 40})]}));
  const withSibling = build(model, Object.assign({}, shared, {
    tasks: [task('T1', 'P2', {Progress_Percent: 40}), task('T2', 'P1', {Progress_Percent: 100})]
  }));
  assert.deepEqual(plain(withoutSibling.projects.map(item => item.progress)), plain(withSibling.projects.map(item => item.progress)));
  assert.equal(withSibling.projects.length, 1);
});

test('health is recomputed and terminal projects remain published but flagged', () => {
  const app = loadApp();
  const model = app.context.SharedDashboardModel;
  const snapshot = build(model, {
    projects: [
      project('P1', {Committed_Deadline: '2026-11-01', Next_Action: 'リカバリ'}),
      project('P2', {Status: 'Archived', Archived_At: '2026-10-01T00:00:00.000Z'}),
      project('P3', {Status: 'Completed', Progress_Percent: 100})
    ],
    tasks: [task('T1', 'P3', {Status: 'Done', Progress_Percent: 100})],
    issues: [{Issue_ID: 'I1', Project_ID: 'P1', Description: '部品遅延', Severity: 'Critical', Status: 'Open'}]
  });
  const byId = {};
  snapshot.projects.forEach(item => { byId[item.projectId] = item; });
  assert.equal(byId.P1.health, 'RED');
  assert.equal(byId.P2.terminal, true);
  assert.equal(byId.P3.terminal, true);
  assert.equal(byId.P3.health, 'COMPLETED');
  assert.doesNotMatch(JSON.stringify(snapshot), /部品遅延/, 'issue descriptions are never published');
});

test('content hash is deterministic and changes only when the public payload changes', () => {
  const app = loadApp();
  const model = app.context.SharedDashboardModel;
  const input = {projects: [project('P1')], tasks: [task('T1', 'P1')]};
  const first = model.hash(build(model, input));
  const second = model.hash(build(model, input));
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  const changed = model.hash(build(model, {projects: [project('P1', {Dashboard_Summary: '別の概要'})], tasks: [task('T1', 'P1')]}));
  assert.notEqual(first, changed);
  // A private-only change must not alter the published hash.
  const privateChange = model.hash(build(model, {
    projects: [project('P1', {Description: '別の社外秘'})], tasks: [task('T1', 'P1')]
  }));
  assert.equal(first, privateChange);
});
