'use strict';
/**
 * V1.6.1 gate 1: one counting rule for every manager figure.
 *
 * V1.6 counted container tasks in the responsibility cards and in the overview KPIs while
 * every progress rollup counted leaf work only, and it filtered an already-paged project list
 * and an already-cut top-five list in the browser. These tests pin the corrected behaviour:
 * containers are organisation, only open leaf work in active work is open or overdue, and a
 * scope is applied before paging and before the top-five cut.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};

function app(actor = 'admin@example.test') {
  return fixtures.base({actor, properties: MANAGER_WEB});
}

function read(instance, operation, payload) {
  const result = instance.context.managerWebRead(operation, payload || {});
  assert.equal(result.ok, true, result.error);
  return result.data;
}

function area(instance, name) {
  return instance.context.Responsibilities.create({Name: name, Owner_Member_ID: 'M-MGR'});
}

/** Adds a container task with two open leaf children inside P1. */
function nestedWork(instance) {
  const c = instance.context;
  const parent = c.Tasks.create({
    Task_ID: 'T-PARENT', Project_ID: 'P1', Task_Name: '装置一式', Owner_Member_ID: 'M-ENG',
    Status: 'In Progress', Due_Date: '2026-12-20'
  });
  c.Tasks.create({
    Task_ID: 'T-C1', Project_ID: 'P1', Parent_Task_ID: parent.Task_ID, Task_Name: '子1',
    Owner_Member_ID: 'M-ENG', Status: 'In Progress', Due_Date: '2026-11-10'
  });
  c.Tasks.create({
    Task_ID: 'T-C2', Project_ID: 'P1', Parent_Task_ID: parent.Task_ID, Task_Name: '子2',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2026-11-11'
  });
  return parent.Task_ID;
}

function areaCard(instance, responsibilityId) {
  const cards = read(instance, 'overview').responsibilityCards;
  return (cards.items || []).filter(card => card.id === responsibilityId)[0];
}

test('a container task is never an extra unit of work in an area card', () => {
  const instance = app();
  const design = area(instance, '製品設計');
  instance.context.Projects.update('P1', {Responsibility_ID: design.Responsibility_ID});
  nestedWork(instance);

  const card = areaCard(instance, design.Responsibility_ID);
  // T1, T2 and the two children are the work items; the parent organises them.
  assert.equal(card.workItems, 4);
  assert.equal(card.containers, 1);
  assert.equal(card.openTasks, 4, 'open work items, not raw task rows');
  assert.equal(card.overdueTasks, 0, 'no open work item is overdue yet');
  const cards = read(instance, 'overview').responsibilityCards;
  assert.equal(cards.policy.containers, 'ORGANISATION_ONLY', 'the policy is published with the numbers');
});

test('the area card, the overview KPIs and the rollup agree on the same rules', () => {
  const instance = app();
  const design = area(instance, '製品設計');
  instance.context.Projects.update('P1', {Responsibility_ID: design.Responsibility_ID});
  nestedWork(instance);

  const overview = read(instance, 'overview', {responsibilityId: design.Responsibility_ID});
  const card = areaCard(instance, design.Responsibility_ID);
  assert.equal(overview.counts.openWork, card.openTasks);
  assert.equal(overview.counts.overdueWork, card.overdueTasks);
  assert.equal(overview.counts.workItems, card.workItems);
  assert.equal(overview.counts.containers, card.containers);
  const rolled = instance.context.Progress.rollup(instance.context.Database.read('TASKS')
    .filter(task => task.Project_ID === 'P1'));
  assert.equal(rolled.tasks, 4, 'four leaf work items are counted by the rollup');
  assert.equal(typeof card.progress, 'number');
});

test('overdue work counts only open leaf work in active work', () => {
  const instance = app();
  const c = instance.context;
  // A past deadline on finished work is history, not an overdue task.
  fixtures.activate(instance);
  fixtures.approve(instance, 'T2');
  fixtures.complete(instance, 'T2');
  c.Tasks.update('T2', {Due_Date: '2020-01-01'});
  // A live overdue item is counted.
  c.Tasks.create({
    Task_ID: 'T-LATE', Project_ID: 'P1', Task_Name: '遅延作業',
    Owner_Member_ID: 'M-ENG', Status: 'In Progress', Due_Date: '2020-01-03'
  });
  // A past deadline beneath a working subproject is counted until that branch stops working.
  c.Subprojects.create({Subproject_ID: 'S-OLD', Project_ID: 'P1', Subproject_Name: '旧工程'});
  c.Tasks.create({
    Task_ID: 'T-OLD', Project_ID: 'P1', Subproject_ID: 'S-OLD', Task_Name: '旧作業',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2020-01-02'
  });

  const before = read(instance, 'overview');
  assert.equal(before.counts.completedWork, 1, 'completed work is reported separately');
  assert.equal(before.counts.overdueWork, before.kpis.overdue);
  const counted = before.counts.overdueWork;
  assert.equal(counted >= 2, true, 'the unfinished overdue work is counted');

  c.Subprojects.archive('S-OLD');
  const after = read(instance, 'overview');
  assert.equal(after.counts.overdueWork, counted - 1, 'an archived branch leaves active work');
  assert.equal(after.kpis.overdue, after.counts.overdueWork);
});

test('a scoped overview filters before paging, so the totals are the scope totals', () => {
  const instance = app();
  const c = instance.context;
  const first = area(instance, '領域A');
  const second = area(instance, '領域B');
  for (let i = 0; i < 25; i++) {
    c.Projects.create({
      Project_ID: 'PA-' + i, Project_Name: 'A案件 ' + i, Status: 'Active', Project_Owner_ID: 'M-MGR',
      Responsibility_ID: first.Responsibility_ID, Committed_Deadline: '2026-12-31'
    });
  }
  c.Projects.create({
    Project_ID: 'PB-1', Project_Name: 'B案件', Status: 'Active', Project_Owner_ID: 'M-MGR',
    Responsibility_ID: second.Responsibility_ID, Committed_Deadline: '2026-12-31'
  });

  const scoped = read(instance, 'overview', {responsibilityId: first.Responsibility_ID});
  assert.equal(scoped.projects.total, 25, 'the 25 projects of the scope');
  assert.equal(scoped.projects.items.length, 20);
  assert.equal(scoped.projects.items.every(project => project.responsibilityId === first.Responsibility_ID), true,
    'every visible row belongs to the scope');
  assert.equal(scoped.kpis.active, 25, 'the KPI describes the scope, not the page');
  assert.equal(scoped.counts.projects, 25);

  const other = read(instance, 'overview', {responsibilityId: second.Responsibility_ID});
  assert.equal(other.projects.total, 1);
  assert.equal(other.kpis.active, 1);

  const unassigned = read(instance, 'overview', {unassigned: true});
  assert.equal(unassigned.projects.total, 2, 'P2 and the project without a responsibility');

  const all = read(instance, 'overview');
  assert.equal(all.projects.total, 28);
});

test('the upcoming list is scoped before the top five are cut', () => {
  const instance = app();
  const c = instance.context;
  const today = c.Domain.today();
  const soon = new Date(today + 'T00:00:00Z');
  soon.setUTCDate(soon.getUTCDate() + 2);
  const dueDate = soon.toISOString().slice(0, 10);
  const empty = area(instance, '空の領域');
  const busy = area(instance, '多忙な領域');
  c.Projects.update('P1', {Responsibility_ID: busy.Responsibility_ID});
  for (let i = 0; i < 7; i++) {
    c.Tasks.create({
      Task_ID: 'T-SOON-' + i, Project_ID: 'P1', Task_Name: '近日作業 ' + i,
      Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: dueDate
    });
  }

  const busyView = read(instance, 'overview', {responsibilityId: busy.Responsibility_ID});
  assert.equal(busyView.upcoming.total, 7, 'the total is the scope total, not the cut length');
  assert.equal(busyView.upcoming.items.length, 5, 'the visible list stays bounded');
  assert.equal(busyView.kpis.soon, 7);

  const emptyView = read(instance, 'overview', {responsibilityId: empty.Responsibility_ID});
  assert.equal(emptyView.upcoming.total, 0);
  assert.equal(emptyView.upcoming.items.length, 0);
  assert.equal(emptyView.kpis.soon, 0, 'another area never borrows the global list');

  const all = read(instance, 'overview');
  assert.equal(all.upcoming.total, 7);
});

test('a container is never offered as a deadline item of its own', () => {
  const instance = app();
  const c = instance.context;
  const today = c.Domain.today();
  const soon = new Date(today + 'T00:00:00Z');
  soon.setUTCDate(soon.getUTCDate() + 1);
  const dueDate = soon.toISOString().slice(0, 10);
  c.Tasks.create({
    Task_ID: 'T-BOX', Project_ID: 'P1', Task_Name: '親', Owner_Member_ID: 'M-ENG',
    Status: 'In Progress', Due_Date: dueDate
  });
  c.Tasks.create({
    Task_ID: 'T-LEAF', Project_ID: 'P1', Parent_Task_ID: 'T-BOX', Task_Name: '子',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: dueDate
  });
  const overview = read(instance, 'overview', {responsibilityId: ''});
  const ids = overview.upcoming.items.map(item => item.id);
  assert.equal(ids.indexOf('T-BOX'), -1, 'the container deadline is not a work item');
  assert.equal(ids.indexOf('T-LEAF') >= 0, true);
});

test('a task with recorded history can never be turned into a container', () => {
  const instance = app();
  const c = instance.context;
  fixtures.activate(instance);
  fixtures.approve(instance, 'T2');
  assert.throws(() => c.Tasks.create({
    Task_ID: 'T-UNDER', Project_ID: 'P1', Parent_Task_ID: 'T2', Task_Name: '子'
  }), /コンテナにできません/);

  // A confirmed schedule is history as well.
  const scheduled = c.Tasks.create({
    Task_ID: 'T-SCHED', Project_ID: 'P1', Task_Name: '日程確認済み', Owner_Member_ID: 'M-ENG',
    Status: 'Assigned', Due_Date: '2026-12-20', Estimated_Hours: 8, Planned_Duration_Value: 3
  });
  c.Tasks.confirmSchedule(scheduled.Task_ID, 'admin@example.test', 'CONFIRM SCHEDULE');
  assert.throws(() => c.Tasks.create({
    Task_ID: 'T-UNDER2', Project_ID: 'P1', Parent_Task_ID: 'T-SCHED', Task_Name: '子'
  }), /コンテナにできません/);

  // A recorded request is history as well.
  const requested = c.Tasks.create({
    Task_ID: 'T-REQ', Project_ID: 'P1', Task_Name: '申請あり', Owner_Member_ID: 'M-ENG',
    Status: 'Assigned', Due_Date: '2026-12-22'
  });
  c.Database.insert('TASK_REQUESTS', {
    Request_ID: 'REQ-ONE', Request_Type: 'DEADLINE_CHANGE', Task_ID: requested.Task_ID, Project_ID: 'P1',
    Requester_Name: '自己申告', Submitted_At: '2026-10-20T01:00:00.000Z', Status: 'PENDING',
    Original_Due_Date: '2026-12-22', Requested_Due_Date: '2026-12-25', Reason: '技術的問題',
    Task_Revision_At_Submission: c.SharedDashboardModel.revision(c.Database.find('TASKS', requested.Task_ID))
  });
  assert.throws(() => c.Tasks.create({
    Task_ID: 'T-UNDER3', Project_ID: 'P1', Parent_Task_ID: requested.Task_ID, Task_Name: '子'
  }), /コンテナにできません/);

  // A plain assignment without recorded work can still become a container.
  const plain = c.Tasks.create({
    Task_ID: 'T-PLAIN', Project_ID: 'P1', Task_Name: '未作業', Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  });
  const child = c.Tasks.create({
    Task_ID: 'T-PLAIN1', Project_ID: 'P1', Parent_Task_ID: plain.Task_ID, Task_Name: '最初の子',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  });
  assert.equal(child.Parent_Task_ID, plain.Task_ID);
  assert.equal(c.TaskTree.isContainer(plain.Task_ID, c.TaskTree.containerIds(c.Database.read('TASKS'))), true);
});

test('moving a task under another task invalidates its assignment approval', () => {
  const instance = app();
  const c = instance.context;
  fixtures.activate(instance);
  const parent = c.Tasks.create({
    Task_ID: 'T-BOX', Project_ID: 'P1', Task_Name: '親', Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  });
  const child = c.Tasks.create({
    Task_ID: 'T-ROOT', Project_ID: 'P1', Task_Name: '移動する作業', Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  });
  fixtures.approve(instance, child.Task_ID);
  const approved = c.Database.find('TASKS', child.Task_ID);
  assert.equal(approved.Assignment_Version, 1);
  assert.ok(approved.Assignment_Approved_At, 'the approval exists before the move');

  const moved = c.Tasks.update(child.Task_ID, {Parent_Task_ID: parent.Task_ID});
  assert.equal(moved.Parent_Task_ID, parent.Task_ID);
  assert.equal(moved.Assignment_Version, 2, 'the parent link is a material assignment change');
  assert.equal(moved.Assignment_Approved_At, '', 'the stale approval is cleared');
});
