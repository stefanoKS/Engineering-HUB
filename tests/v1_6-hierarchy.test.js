'use strict';
/**
 * V1.6 gate 4 and gate 5: four subproject levels and three task levels.
 *
 * The limits are configured centrally, cycles are refused instead of recursed, a task with
 * children is a work container whose progress comes from leaf work only, and a task that
 * already carries recorded work is never silently converted into a container.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};
const plain = value => JSON.parse(JSON.stringify(value));

function project() {
  const app = fixtures.base({properties: MANAGER_WEB});
  return app;
}

/* ---------------------------- subprojects ---------------------------- */

test('four subproject levels are accepted and a fifth is refused', () => {
  const app = project(), c = app.context;
  assert.equal(c.Subprojects.MAX_DEPTH, 4, 'the limit is defined in one place');
  c.Subprojects.create({Subproject_ID: 'L2', Project_ID: 'P1', Parent_Subproject_ID: 'S1', Subproject_Name: '納入部品図作成'});
  c.Subprojects.create({Subproject_ID: 'L3', Project_ID: 'P1', Parent_Subproject_ID: 'L2', Subproject_Name: 'フロント部品'});
  c.Subprojects.create({Subproject_ID: 'L4', Project_ID: 'P1', Parent_Subproject_ID: 'L3', Subproject_Name: '断面検討'});
  assert.equal(c.Subprojects.levelOf('L4', c.Subprojects.parentMap()), 4);
  assert.throws(() => c.Subprojects.create({
    Subproject_ID: 'L5', Project_ID: 'P1', Parent_Subproject_ID: 'L4', Subproject_Name: '最終確認'
  }), /4階層まで/);
});

test('a cycle, a self parent and a cross-project parent are refused at any depth', () => {
  const app = project(), c = app.context;
  c.Subprojects.create({Subproject_ID: 'L2', Project_ID: 'P1', Parent_Subproject_ID: 'S1', Subproject_Name: '納入部品図作成'});
  c.Subprojects.create({Subproject_ID: 'L3', Project_ID: 'P1', Parent_Subproject_ID: 'L2', Subproject_Name: 'フロント部品'});
  assert.throws(() => c.Subprojects.reparent('S1', 'L3', {confirmed: true}), /循環/);
  assert.throws(() => c.Subprojects.update('L2', {Parent_Subproject_ID: 'L2'}), /自身の親/);
  c.Database.insert('PROJECTS', {Project_ID: 'P9', Project_Name: '別案件', Status: 'Active'});
  assert.throws(() => c.Subprojects.reparent('L3', 'P2-SUB', {confirmed: true}), /not found|見つかりません/);
  assert.throws(() => c.Subprojects.create({Project_ID: 'P9', Parent_Subproject_ID: 'S1', Subproject_Name: '別案件の子'}), /同じプロジェクト/);
});

test('existing two-level data keeps its meaning and its IDs', () => {
  const app = project(), c = app.context;
  c.Subprojects.create({Subproject_ID: 'S1-CHILD', Project_ID: 'P1', Parent_Subproject_ID: 'S1', Subproject_Name: 'カメラ取付'});
  assert.equal(c.Database.find('SUBPROJECTS', 'S1').Parent_Subproject_ID, '');
  assert.equal(c.Database.find('SUBPROJECTS', 'S1-CHILD').Parent_Subproject_ID, 'S1');
  assert.equal(c.Subprojects.levelOf('S1-CHILD', c.Subprojects.parentMap()), 2);
  assert.equal(c.Database.find('TASKS', 'T1').Subproject_ID, 'S1', 'a task keeps its node');
});

test('reparenting validates the whole subtree instead of flattening it', () => {
  const app = project(), c = app.context;
  c.Subprojects.create({Subproject_ID: 'A', Project_ID: 'P1', Subproject_Name: 'A'});
  c.Subprojects.create({Subproject_ID: 'A1', Project_ID: 'P1', Parent_Subproject_ID: 'A', Subproject_Name: 'A1'});
  c.Subprojects.create({Subproject_ID: 'A2', Project_ID: 'P1', Parent_Subproject_ID: 'A1', Subproject_Name: 'A2'});
  c.Subprojects.create({Subproject_ID: 'A3', Project_ID: 'P1', Parent_Subproject_ID: 'A2', Subproject_Name: 'A3'});
  c.Subprojects.create({Subproject_ID: 'B', Project_ID: 'P1', Subproject_Name: 'B'});
  // A (with A1, A2, A3) beneath B would occupy levels 2-5.
  assert.throws(() => c.Subprojects.reparent('A', 'B', {confirmed: true}), /4階層まで/);
  assert.equal(c.Database.find('SUBPROJECTS', 'A').Parent_Subproject_ID, '', 'nothing was written');
  assert.equal(c.Database.find('SUBPROJECTS', 'A1').Parent_Subproject_ID, 'A');
});

/* ------------------------------- tasks ------------------------------- */

function tree() {
  const app = project(), c = app.context;
  // T1 already carries recorded work, so it can never become a container.
  const parent = c.Tasks.create({Task_ID: 'TK-P', Project_ID: 'P1', Subproject_ID: '', Task_Name: '図面作成',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Estimated_Hours: 10});
  const child = c.Tasks.create({Task_ID: 'TK-A', Project_ID: 'P1', Subproject_ID: '', Parent_Task_ID: parent.Task_ID,
    Task_Name: '断面図作成', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Estimated_Hours: 4});
  const grandchild = c.Tasks.create({Task_ID: 'TK-A1', Project_ID: 'P1', Subproject_ID: '', Parent_Task_ID: child.Task_ID,
    Task_Name: '寸法確認', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Estimated_Hours: 2});
  return {app, c, parent, child, grandchild};
}

test('three task levels are accepted and a fourth is refused', () => {
  const {c, grandchild} = tree();
  assert.equal(c.TaskTree.MAX_DEPTH, 3);
  assert.throws(() => c.Tasks.create({Task_ID: 'TK-A2', Project_ID: 'P1', Subproject_ID: '',
    Parent_Task_ID: grandchild.Task_ID, Task_Name: '最終提出', Owner_Member_ID: 'M-ENG'}), /3階層まで/);
});

test('a task parent must exist, match the project and match the subproject', () => {
  const {app, c} = tree();
  assert.throws(() => c.Tasks.create({Project_ID: 'P1', Subproject_ID: '', Parent_Task_ID: 'MISSING',
    Task_Name: '不在の親', Owner_Member_ID: 'M-ENG'}), /親タスクが見つかりません/);
  assert.throws(() => c.Tasks.create({Project_ID: 'P2', Subproject_ID: '', Parent_Task_ID: 'TK-P',
    Task_Name: '別案件', Owner_Member_ID: 'M-ENG'}), /同じプロジェクト/);
  c.Tasks.create({Task_ID: 'TK-S', Project_ID: 'P1', Subproject_ID: 'S1', Task_Name: '試作の親', Owner_Member_ID: 'M-ENG'});
  assert.throws(() => c.Tasks.create({Project_ID: 'P1', Subproject_ID: '', Parent_Task_ID: 'TK-S',
    Task_Name: '別サブプロジェクト', Owner_Member_ID: 'M-ENG'}), /同じサブプロジェクト/);
});

test('task cycles and self parents are refused', () => {
  const {c} = tree();
  assert.throws(() => c.Tasks.update('TK-P', {Parent_Task_ID: 'TK-A1'}), /循環/);
  assert.throws(() => c.Tasks.update('TK-P', {Parent_Task_ID: 'TK-P'}), /自身の親/);
});

test('a task with recorded work is never silently converted into a container', () => {
  const {app, c} = tree();
  // T1 is In Progress with actual hours: adding a child under it must be refused.
  assert.throws(() => c.Tasks.create({Task_ID: 'X1', Project_ID: 'P1', Subproject_ID: 'S1',
    Parent_Task_ID: 'T1', Task_Name: '子', Owner_Member_ID: 'M-ENG'}), /コンテナにできません/);
  assert.equal(c.Database.find('TASKS', 'T1').Status, 'In Progress', 'the parent is untouched');
});

test('the project and subproject progress count leaf work exactly once', () => {
  const {c} = tree();
  fixtures.complete({context: c}, 'TK-A1');                 // 2h leaf at 100 %
  c.Progress.refresh();
  const project = c.Database.find('PROJECTS', 'P1');
  // P1 holds T1 (25 % of 40h), T2 (unestimated: documented fallback weight 1) and the leaf
  // TK-A1 (100 % of 2h). The two container tasks are excluded, so nothing is counted twice:
  // (0.25*40 + 0*1 + 1*2) / 43 = 27.91.
  assert.equal(project.Progress_Percent, 27.91);
  const p1 = c.Progress.rollup(c.Database.read('TASKS').filter(task => task.Project_ID === 'P1'));
  assert.equal(p1.unknown, 1, 'the unestimated task is still reported as unknown');
  assert.equal(p1.percent, project.Progress_Percent);
  const leaves = c.TaskTree.leaves(c.Database.read('TASKS')).map(task => task.Task_ID);
  assert.deepEqual(leaves.sort(), ['T1', 'T2', 'T3', 'TK-A1'], 'containers are excluded from leaf work');
});

test('a container task reports derived completion from its leaves', () => {
  const {c} = tree();
  fixtures.complete({context: c}, 'TK-A1');
  const tasks = c.Database.read('TASKS');
  const childView = c.TaskTree.view(c.Database.find('TASKS', 'TK-A'), tasks);
  assert.equal(childView.container, true);
  assert.equal(childView.progress, 100, 'the only leaf child is complete');
  assert.equal(childView.status, 'Done', 'the container reports Done without a manual edit');
  const parentView = c.TaskTree.view(c.Database.find('TASKS', 'TK-P'), tasks);
  assert.equal(parentView.container, true);
  assert.equal(parentView.progress, 100);
  // The stored columns are never rewritten by a derived value.
  assert.equal(c.Database.find('TASKS', 'TK-A').Status, 'Assigned');
});

test('a container task refuses manual status, progress and cross-subproject moves', () => {
  const {c} = tree();
  assert.throws(() => c.Tasks.update('TK-P', {Status: 'Blocked'}), /子タスクから算出されます/);
  assert.throws(() => c.Tasks.update('TK-P', {Progress_Percent: 50}), /子タスクから算出されます/);
  assert.throws(() => c.Tasks.update('TK-P', {Subproject_ID: 'S1'}), /移動できません/);
  // An unrelated field stays editable.
  const renamed = c.Tasks.update('TK-P', {Task_Name: '図面作成（改）'});
  assert.equal(renamed.Task_Name, '図面作成（改）');
});

test('dependency sequencing stays separate from the parent hierarchy', () => {
  const {c} = tree();
  const dependent = c.Tasks.create({Task_ID: 'TK-DEP', Project_ID: 'P1', Subproject_ID: '',
    Task_Name: '依存作業', Owner_Member_ID: 'M-ENG', Dependency_IDs: 'TK-P'});
  assert.equal(c.Database.find('TASKS', dependent.Task_ID).Parent_Task_ID, '', 'a dependency is not a parent');
  // The dependency graph keeps its own cycle rule, independent of the organisation tree.
  assert.throws(() => c.Tasks.create({Task_ID: 'TK-X', Project_ID: 'P1', Subproject_ID: '',
    Task_Name: '循環', Owner_Member_ID: 'M-ENG', Parent_Task_ID: 'TK-DEP', Dependency_IDs: 'TK-X'}), /Cyclic/i);
  // A parent link alone never creates a dependency.
  assert.equal(c.Database.find('TASKS', 'TK-A').Dependency_IDs, '');
});

test('the task index carries the hierarchy without a second server call', () => {
  const {app} = tree();
  const index = app.context.managerWebRead('taskIndex');
  assert.equal(index.ok, true, index.error);
  const columns = plain(index.data.columns);
  ['parentId', 'container', 'depth', 'reviewState'].forEach(name => assert.ok(columns.indexOf(name) >= 0, name));
  const rows = index.data.rows.map(row => {
    const item = {};
    columns.forEach((column, at) => { item[column] = row[at]; });
    return item;
  });
  const child = rows.filter(row => row.id === 'TK-A1')[0];
  assert.equal(child.parentId, 'TK-A');
  assert.equal(child.depth, 2);
  const container = rows.filter(row => row.id === 'TK-P')[0];
  assert.equal(container.container, true);
});

test('the project detail renders the subproject tree with a collapse control', async () => {
  const {harness, flush} = require('./support/manager-web-harness');
  const {fixture} = require('../scripts/manager-web-preview');
  const instance = fixture(4);
  const h = harness((write, op, payload) => write
    ? instance.context.managerWebWrite(op, payload)
    : instance.context.managerWebRead(op, payload));
  await flush();
  // 編集 on the first project card opens the project detail view.
  h.click('content', '編集');
  await flush();
  const nodes = h.nodes('content');
  assert.ok(nodes.some(node => String(node.className || '').indexOf('tree') >= 0), 'the hierarchy cards render');
  const toggle = nodes.filter(node => node.tagName === 'BUTTON' && String(node.className) === 'tree-toggle')[0];
  assert.ok(toggle, 'a parent subproject offers a collapse control');
  toggle.dispatchEvent('click', {});
  await flush();
  assert.match(h.document.getElementById('content').textContent, /階層|サブプロジェクト/);
});
