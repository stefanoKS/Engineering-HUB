'use strict';
/**
 * V1.6.2 task responsibility filter.
 *
 * The task list resolves the organisation area through `TASKS.Project_ID -> PROJECTS
 * .Responsibility_ID`; it never copies the value into TASKS. The server understands the 未分類
 * scope, both filtering paths agree, and a project transferred between areas invalidates the
 * browser's task index and its scoped caches so no list keeps showing the previous area.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {base, bulk} = require('./fixtures');
const {harness, flush} = require('./support/manager-web-harness');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};

/**
 * One area per behaviour: R-A active with nested work, R-B with a task, the 未分類 bucket and a
 * retired area whose project still exists.
 *
 * T1 P1 In Progress (container of T4), T2 P1 assigned, T3 P2, T4 nested under T1,
 * T5 P3 unassigned, T6 P4 (retired area), T7 P1 owned by the manager.
 */
function areaFixture() {
  const app = base({properties: MANAGER_WEB});
  const db = app.context.Database;
  db.insert('RESPONSIBILITIES', {Responsibility_ID: 'R-A', Name: '製品設計', Status: 'Active', Sort_Order: 1});
  db.insert('RESPONSIBILITIES', {Responsibility_ID: 'R-B', Name: '工程設計', Status: 'Active', Sort_Order: 2});
  db.insert('RESPONSIBILITIES', {Responsibility_ID: 'R-C', Name: '旧領域', Status: 'Retired', Sort_Order: 3});
  db.update('PROJECTS', 'P1', {Responsibility_ID: 'R-A'});
  db.update('PROJECTS', 'P2', {Responsibility_ID: 'R-B'});
  db.insert('PROJECTS', {Project_ID: 'P3', Project_Name: '未分類案件', Status: 'Active', Project_Owner_ID: 'M-MGR'});
  db.insert('PROJECTS', {Project_ID: 'P4', Project_Name: '旧領域案件', Status: 'Active',
    Project_Owner_ID: 'M-MGR', Responsibility_ID: 'R-C'});
  db.update('TASKS', 'T1', {Priority: 'High'});
  db.update('TASKS', 'T2', {Priority: 'Medium'});
  db.update('TASKS', 'T3', {Priority: 'Low'});
  db.insert('TASKS', {Task_ID: 'T4', Project_ID: 'P1', Parent_Task_ID: 'T1', Task_Name: '詳細検討',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Priority: 'Critical', Due_Date: '2026-12-10'});
  db.insert('TASKS', {Task_ID: 'T5', Project_ID: 'P3', Task_Name: '未分類作業',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Priority: 'Medium', Due_Date: '2026-12-20'});
  db.insert('TASKS', {Task_ID: 'T6', Project_ID: 'P4', Task_Name: '旧領域作業',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Priority: 'Medium', Due_Date: '2026-12-21'});
  db.insert('TASKS', {Task_ID: 'T7', Project_ID: 'P1', Task_Name: '管理確認',
    Owner_Member_ID: 'M-MGR', Status: 'Not Started', Priority: 'Low', Due_Date: '2026-12-30'});
  return app;
}

function read(app, operation, payload) {
  const result = app.context.managerWebRead(operation, payload);
  assert.equal(result.ok, true, result.error);
  return result.data;
}

const ids = data => Array.from(data.items, task => String(task.id)).sort();
const content = h => h.document.getElementById('content').textContent;

function clientOf(app, options) {
  return harness((write, operation, payload) => write
    ? app.context.managerWebWrite(operation, payload)
    : app.context.managerWebRead(operation, payload), options || {});
}

const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let index = 0; index < 40; index += 1) await tick(); }

/* ------------------------------------------------------------------ *
 * Server: the area is resolved through the project, never copied
 * ------------------------------------------------------------------ */

test('responsibility A returns only A’s tasks and responsibility B returns only B’s tasks', () => {
  const app = areaFixture();
  const a = read(app, 'tasks', {responsibilityId: 'R-A', limit: 100});
  assert.deepEqual(ids(a), ['T1', 'T2', 'T4', 'T7']);
  assert.equal(a.total, 4);
  assert.equal(a.items.every(task => task.responsibilityId === 'R-A'), true);
  const b = read(app, 'tasks', {responsibilityId: 'R-B', limit: 100});
  assert.deepEqual(ids(b), ['T3']);
  assert.equal(b.total, 1);
  const all = read(app, 'tasks', {limit: 100});
  assert.equal(all.total, 7, 'no area filter returns everything');
});

test('the unassigned scope returns only tasks of projects without a responsibility', () => {
  const app = areaFixture();
  const unassigned = read(app, 'tasks', {unassigned: true, limit: 100});
  assert.deepEqual(ids(unassigned), ['T5']);
  assert.equal(unassigned.total, 1);
  assert.equal(unassigned.items[0].responsibilityId, '');
  // 未分類 wins over a named area, exactly like the overview and project scope rule.
  const both = read(app, 'tasks', {unassigned: true, responsibilityId: 'R-A', limit: 100});
  assert.deepEqual(ids(both), ['T5']);
  assert.equal(read(app, 'tasks', {unassigned: false, responsibilityId: 'R-A'}).total, 4);
});

test('a retired responsibility with existing projects stays filterable', () => {
  const app = areaFixture();
  const retired = read(app, 'tasks', {responsibilityId: 'R-C', limit: 100});
  assert.deepEqual(ids(retired), ['T6']);
  const options = read(app, 'responsibilities').items.filter(row => row.Responsibility_ID === 'R-C');
  assert.equal(options.length, 1, 'retirement is a status, not a deletion');
  assert.equal(options[0].Status, 'Retired');
});

test('a project transfer moves its tasks from A to B and leaves the other list untouched', () => {
  const app = areaFixture();
  app.context.Database.update('PROJECTS', 'P1', {Responsibility_ID: 'R-B'});
  assert.deepEqual(ids(read(app, 'tasks', {responsibilityId: 'R-A', limit: 100})), []);
  assert.deepEqual(ids(read(app, 'tasks', {responsibilityId: 'R-B', limit: 100})), ['T1', 'T2', 'T3', 'T4', 'T7']);
  assert.deepEqual(ids(read(app, 'tasks', {unassigned: true, limit: 100})), ['T5'], 'the bucket is unchanged');
});

test('a renamed project keeps its area filter because the filter uses the stable ID', () => {
  const app = areaFixture();
  app.context.Database.update('PROJECTS', 'P1', {Project_Name: '検査装置（改称）'});
  const scoped = read(app, 'tasks', {responsibilityId: 'R-A', limit: 100});
  assert.deepEqual(ids(scoped), ['T1', 'T2', 'T4', 'T7']);
  assert.equal(scoped.items[0].project, '検査装置（改称）');
  assert.equal(read(app, 'tasks', {projectId: 'P1', limit: 100}).total, 4);
});

test('a nested subtask inherits its project responsibility and the top-level filter still applies', () => {
  const app = areaFixture();
  const nested = read(app, 'tasks', {responsibilityId: 'R-A', limit: 100});
  const subtask = nested.items.filter(task => task.id === 'T4')[0];
  assert.equal(subtask.parentId, 'T1');
  assert.equal(subtask.responsibilityId, 'R-A');
  assert.equal(subtask.depth, 1);
  assert.deepEqual(ids(read(app, 'tasks', {responsibilityId: 'R-A', treeScope: 'TOP', limit: 100})),
    ['T1', 'T2', 'T7'], 'the subtree filter and the area filter combine');
  assert.deepEqual(ids(read(app, 'tasks', {responsibilityId: 'R-B', parentTaskId: 'T1', limit: 100})), []);
});

test('the project, owner, status, priority and deadline filters combine with the area filter', () => {
  const app = areaFixture();
  assert.deepEqual(ids(read(app, 'tasks', {responsibilityId: 'R-A', projectId: 'P2'})), []);
  assert.deepEqual(ids(read(app, 'tasks', {responsibilityId: 'R-A', projectId: 'P1'})), ['T1', 'T2', 'T4', 'T7']);
  assert.deepEqual(ids(read(app, 'tasks', {responsibilityId: 'R-A', ownerId: 'M-MGR'})), ['T7']);
  assert.deepEqual(ids(read(app, 'tasks', {responsibilityId: 'R-A', status: 'Assigned'})), ['T2', 'T4']);
  assert.deepEqual(ids(read(app, 'tasks', {responsibilityId: 'R-A', priority: 'High'})), ['T1']);
  assert.deepEqual(ids(read(app, 'tasks', {responsibilityId: 'R-A', deadlineBefore: '2026-12-12'})), ['T4']);
  assert.deepEqual(ids(read(app, 'tasks', {responsibilityId: 'R-A', deadlineAfter: '2026-12-25'})), ['T7']);
});

test('the status filter follows the displayed status of a container task on the server', () => {
  const app = areaFixture();
  app.context.Database.insert('TASKS', {Task_ID: 'T8', Project_ID: 'P1', Parent_Task_ID: 'T1',
    Task_Name: '子作業', Owner_Member_ID: 'M-ENG', Status: 'Done', Progress_Percent: 100, Due_Date: '2026-12-11'});
  app.context.Database.update('TASKS', 'T4', {Status: 'Done', Progress_Percent: 100});
  assert.deepEqual(ids(read(app, 'tasks', {responsibilityId: 'R-A', status: 'Done'})), ['T1', 'T4', 'T8']);
  assert.deepEqual(ids(read(app, 'tasks', {responsibilityId: 'R-A', status: 'In Progress'})), []);
});

test('more than fifty tasks paginate inside the selected responsibility', () => {
  const app = areaFixture();
  bulk(app, 'TASKS', Array.from({length: 120}, (_, i) => ({Task_ID: 'M' + String(i).padStart(3, '0'),
    Project_ID: 'P1', Task_Name: '量産 ' + i, Owner_Member_ID: 'M-ENG', Status: 'Assigned',
    Priority: 'Medium', Due_Date: '2026-12-01'})));
  app.context.Database.insert('TASKS', {Task_ID: 'B-ONLY', Project_ID: 'P2', Task_Name: 'B専用',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Priority: 'Medium', Due_Date: '2026-12-02'});
  const first = read(app, 'tasks', {responsibilityId: 'R-A', limit: 50});
  assert.equal(first.total, 120);
  assert.equal(first.items.length, 50);
  const last = read(app, 'tasks', {responsibilityId: 'R-A', offset: 100, limit: 50});
  assert.equal(last.items.length, 20);
  assert.equal(last.items[0].id, 'M100');
  assert.equal(last.items[19].id, 'M119');
  const other = read(app, 'tasks', {responsibilityId: 'R-B'});
  assert.equal(other.total, 1, 'the other area is not affected by the page');
  assert.deepEqual(ids(other), ['B-ONLY']);
});

/* ------------------------------------------------------------------ *
 * Browser: filter order, parity, invalidation and rapid switching
 * ------------------------------------------------------------------ */

test('the responsibility filter is the first control of the task filter bar', async () => {
  const h = clientOf(areaFixture());
  await flush();
  h.click('nav', 'タスク');
  await flush();
  const bar = h.nodes('content').filter(node => node.tagName === 'FORM')[0];
  assert.ok(bar, 'the task filter bar is rendered');
  const names = bar.descendants().filter(node => node.name).map(node => node.name);
  assert.equal(names[0], 'filterResponsibility');
  assert.equal(names[1], 'search');
  const select = bar.descendants().filter(node => node.name === 'filterResponsibility')[0];
  const labels = select.childNodes.filter(node => node.tagName === 'OPTION').map(node => node.textContent);
  assert.deepEqual(labels, ['すべての担当領域', '製品設計', '工程設計', '旧領域', '未分類'],
    'active, retired and the 未分類 bucket are all selectable');
});

test('cached filtering and the server page agree for every area and filter combination', async () => {
  const h = clientOf(areaFixture());
  await flush();
  h.click('nav', 'タスク');
  await flush();
  const app = areaFixture();
  const select = () => h.nodes('content').filter(node => node.name === 'filterResponsibility')[0];
  const cases = [
    ['R-A', {responsibilityId: 'R-A'}], ['R-B', {responsibilityId: 'R-B'}],
    ['__none__', {unassigned: true}], ['R-C', {responsibilityId: 'R-C'}], ['', {}]
  ];
  for (const [value, filter] of cases) {
    const control = select();
    control.value = value;
    control.dispatchEvent('change', {});
    await flush();
    const server = read(app, 'tasks', Object.assign({limit: 100}, filter));
    assert.match(content(h), new RegExp('1–' + server.total + ' / ' + server.total),
      'area ' + (value || 'all') + ' counts the filtered set');
    const names = server.items.map(task => task.name);
    names.forEach(name => assert.ok(content(h).indexOf(name) >= 0, name + ' is rendered'));
  }
});

test('switching responsibility resets paging and drops an incompatible project filter', async () => {
  const app = areaFixture();
  const h = clientOf(app);
  await flush();
  h.click('nav', 'タスク');
  await flush();
  const control = name => h.nodes('content').filter(node => node.name === name)[0];
  control('projectId').value = 'P1';
  control('projectId').dispatchEvent('change', {});
  control('ownerId').value = 'M-ENG';
  control('ownerId').dispatchEvent('change', {});
  assert.match(content(h), /1–3 \/ 3/);
  // The area keeps the compatible owner filter and clears the project that is outside it.
  const area = control('filterResponsibility');
  area.value = 'R-B';
  area.dispatchEvent('change', {});
  await flush();
  assert.equal(control('projectId').value, '', 'the project select is visibly back to すべて');
  assert.equal(control('ownerId').value, 'M-ENG', 'the compatible member filter is preserved');
  assert.equal(h.window.ManagerWebClient.api.peek('tasks', {}), null);
  assert.match(content(h), /1–1 \/ 1/);
  assert.ok(content(h).indexOf('旧ライン保守') >= 0, 'only the new area is listed');
});

test('a project transfer handled by the client invalidates the task index and both area lists', async () => {
  const app = areaFixture();
  const h = clientOf(app);
  await flush();
  h.click('nav', 'タスク');
  await flush();
  const store = h.window.ManagerWebClient.store;
  assert.equal(store.tasks.loaded, true, 'the compact index is loaded before the transfer');
  const area = h.nodes('content').filter(node => node.name === 'filterResponsibility')[0];
  area.value = 'R-A';
  area.dispatchEvent('change', {});
  await flush();
  assert.match(content(h), /1–4 \/ 4/);

  const record = read(app, 'project', {id: 'P1'}).record;
  await h.window.ManagerWebClient.api.write('projectSave',
    {projectId: 'P1', responsibilityId: 'R-B', confirmResponsibilityChange: true, revision: record._revision});
  assert.equal(store.tasks.loaded, false, 'the task-index responsibility data is dropped');
  assert.equal(store.projects.items.filter(project => project.id === 'P1')[0].responsibilityId, 'R-B',
    'the project summary carries the new area');
  assert.equal(store.overview, null, 'the area overview aggregates are dropped');

  h.click('content', '再読み込み');
  await flush();
  await flush();
  assert.doesNotMatch(content(h), /1–4 \/ 4/, 'the old area no longer lists the moved work');
  assert.ok(content(h).indexOf('機構設計') < 0);

  const next = h.nodes('content').filter(node => node.name === 'filterResponsibility')[0];
  next.value = 'R-B';
  next.dispatchEvent('change', {});
  await flush();
  assert.match(content(h), /1–5 \/ 5/);
  assert.ok(content(h).indexOf('機構設計') >= 0, 'the new area lists the moved work');
});

test('rapid responsibility switches never paint an older area page', async () => {
  const app = areaFixture();
  // Above the documented index bound the browser must use the paginated server path.
  bulk(app, 'TASKS', Array.from({length: 3001}, (_, i) => ({Task_ID: 'L' + String(i).padStart(4, '0'),
    Project_ID: 'P1', Task_Name: '大量 ' + i, Owner_Member_ID: 'M-ENG', Status: 'Assigned',
    Priority: 'Medium', Due_Date: '2026-12-01'})));
  app.context.Database.insert('TASKS', {Task_ID: 'B-ONLY', Project_ID: 'P2', Task_Name: 'B専用タスク',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Priority: 'Medium', Due_Date: '2026-12-02'});
  assert.equal(read(app, 'bootstrap').tasks.complete, false);
  // Filtering happens before paging, so the incomplete index cannot truncate the answer.
  assert.equal(read(app, 'tasks', {responsibilityId: 'R-B'}).total, 1);
  assert.equal(read(app, 'tasks', {responsibilityId: 'R-A', offset: 3000, limit: 50}).items.length, 1);

  const h = clientOf(app, {manual: true});
  await tick();
  await tick();
  h.waiting.shift().success(app.context.managerWebRead('bootstrap'));
  await settle();
  assert.equal(h.waiting.length, 0, 'an oversized index is not prefetched');

  h.click('nav', 'タスク');
  await tick();
  const unfiltered = h.waiting.shift();
  assert.equal(unfiltered.operation, 'tasks');
  unfiltered.success(app.context.managerWebRead('tasks', unfiltered.payload));
  await settle();

  const area = () => h.nodes('content').filter(node => node.name === 'filterResponsibility')[0];
  area().value = 'R-A';
  area().dispatchEvent('change', {});
  await tick();
  const first = h.waiting.shift();
  assert.equal(first.payload.responsibilityId, 'R-A');
  assert.match(content(h), /読み込み中/, 'the previous page is cleared while the new one loads');
  area().value = 'R-B';
  area().dispatchEvent('change', {});
  await tick();
  const second = h.waiting.shift();
  assert.equal(second.payload.responsibilityId, 'R-B');

  // The newer area answers first; the older response must not repaint over it.
  second.success(app.context.managerWebRead('tasks', second.payload));
  await settle();
  first.success(app.context.managerWebRead('tasks', first.payload));
  await settle();
  assert.ok(content(h).indexOf('B専用タスク') >= 0, 'the selected area is shown');
  assert.equal(/大量/.test(content(h)), false, 'the superseded page is discarded');
});
