'use strict';
/**
 * V1.5.1 local-first navigation.
 *
 * The browser keeps an authorized in-memory snapshot: overview, project summaries, reference
 * choices and, within a documented bound, compact task summaries. Navigation, filtering and
 * cached detail opens must not call google.script.run; Google Sheets stays authoritative and is
 * still read once per table per request.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {harness, flush} = require('./support/manager-web-harness');
const {fixture} = require('../scripts/manager-web-preview');
const {base, bulk} = require('./fixtures');

function setup(size) {
  const a = fixture(size === undefined ? 10 : size);
  const h = harness((write, op, p) => write ? a.context.managerWebWrite(op, p) : a.context.managerWebRead(op, p));
  return {a, h};
}
const stat = h => h.window.ManagerWebClient.stats;
const apiOf = h => h.window.ManagerWebClient.api;
const content = h => h.document.getElementById('content').textContent;
const notice = h => h.document.getElementById('notice').textContent;
const plain = value => JSON.parse(JSON.stringify(value));

/* ------------------------------------------------------------------ *
 * Server: one authorized snapshot, bounded and allowlisted
 * ------------------------------------------------------------------ */

test('bootstrap reads every source table once and never ships private task fields', () => {
  const a = fixture(), c = a.context, reads = {};
  for (const sheet of a.book.getSheets()) {
    const get = sheet.getDataRange.bind(sheet);
    sheet.getDataRange = () => { const name = sheet.getName(); reads[name] = (reads[name] || 0) + 1; return get(); };
  }
  const result = c.managerWebRead('bootstrap');
  assert.equal(result.ok, true, result.error);
  assert.ok(Object.values(reads).every(count => count === 1), JSON.stringify(reads));
  assert.equal(result.metrics.tableReads, 9);
  const payload = JSON.stringify(result.data);
  assert.doesNotMatch(payload, /Acceptance_Criteria|acceptanceCriteria|Estimated_Hours|estimatedHours|"description"/i);
  assert.equal(result.data.contract, '1.6');
  assert.equal(result.data.projects.complete, true);
  assert.equal(result.data.tasks.total, 100);
  assert.equal(result.data.tasks.rows, undefined);
  assert.equal(result.data.actor.role, 'ADMIN');
});

test('the compact task index is columnar, allowlisted and paged-safe', () => {
  const a = fixture(), c = a.context, reads = {};
  for (const sheet of a.book.getSheets()) {
    const get = sheet.getDataRange.bind(sheet);
    sheet.getDataRange = () => { const name = sheet.getName(); reads[name] = (reads[name] || 0) + 1; return get(); };
  }
  const result = c.managerWebRead('taskIndex');
  assert.equal(result.ok, true, result.error);
  // SETTINGS is the environment marker read, not a data table.
  assert.deepEqual(Object.keys(reads).sort(), ['MEMBERS', 'PROJECTS', 'SETTINGS', 'TASKS', 'TASK_ASSIGNEES', 'TASK_REQUESTS']);
  assert.ok(Object.values(reads).every(count => count === 1), JSON.stringify(reads));
  assert.equal(result.metrics.tableReads, 5);
  assert.deepEqual(plain(result.data.columns), ['id', 'name', 'projectId', 'project', 'subprojectId', 'ownerId', 'owner', 'responsibilityId', 'deadline', 'status', 'progress', 'priority', 'parentId', 'container', 'depth', 'reviewState',
    'assigneeIds', 'assigneeNames', 'sharedAssignment']);
  assert.equal(result.data.rows.length, 100);
  assert.equal(result.data.complete, true);
  assert.ok(result.data.rows.every(row => row.length === result.data.columns.length));
  assert.doesNotMatch(JSON.stringify(result.data), /Description|Acceptance_Criteria|Estimated_Hours/);
});

test('an oversized task set is reported incomplete instead of being silently truncated', () => {
  const a = base({properties: {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'}});
  bulk(a, 'TASKS', Array.from({length: 3001}, (_, i) => ({Task_ID: 'B' + i, Project_ID: 'P1', Task_Name: 'Synthetic ' + i, Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2026-12-01'})));
  const bootstrap = a.context.managerWebRead('bootstrap');
  assert.equal(bootstrap.ok, true, bootstrap.error);
  assert.equal(bootstrap.data.tasks.complete, false);
  assert.equal(bootstrap.data.tasks.total, 3001);
  const index = a.context.managerWebRead('taskIndex');
  assert.equal(index.data.complete, false);
  assert.deepEqual(plain(index.data.rows), []);
  // The paginated server operation still reaches every record.
  const last = a.context.managerWebRead('tasks', {offset: 3000, limit: 50});
  assert.equal(last.data.total, 3001);
  assert.equal(last.data.items.length, 1);
});

test('project summaries carry the owner id the browser filters on', () => {
  const a = fixture();
  const items = a.context.managerWebRead('bootstrap').data.projects.items;
  assert.equal(items[0].ownerId, 'M-MGR');
  assert.equal(typeof items[0].responsibilityId, 'string');
});

/* ------------------------------------------------------------------ *
 * Browser: cached navigation, local search, deduplicated reads
 * ------------------------------------------------------------------ */

test('navigation between overview, projects and tasks never calls the server', async () => {
  const {h} = setup();
  await flush();
  const afterLoad = stat(h).rpc;
  h.click('nav', '案件'); await flush();
  assert.match(content(h), /1–10 \/ 10/);
  h.click('nav', 'タスク'); await flush();
  assert.match(content(h), /1–50 \/ 100/);
  h.click('nav', '概要'); await flush();
  assert.match(content(h), /進行中案件/);
  assert.equal(stat(h).rpc, afterLoad);
  assert.equal(h.calls.filter(c => c.operation === 'projects' || c.operation === 'tasks').length, 0);
});

test('local filtering and sorting match the authoritative server result', async () => {
  const {a, h} = setup();
  await flush();
  const api = apiOf(h);
  const server = a.context.managerWebRead('tasks', {projectId: 'P3', limit: 100}).data;
  h.click('nav', 'タスク'); await flush();
  const set = (name, value) => { const node = h.nodes('content').find(n => n.name === name); node.value = value; node.dispatchEvent('change', {}); node.dispatchEvent('input', {}); };
  set('projectId', 'P3');
  assert.match(content(h), new RegExp('1–' + server.items.length + ' / ' + server.total));
  assert.equal(stat(h).rpc, h.calls.filter(c => !c.write).length);
  assert.equal(api.peek('tasks', {}), null, 'a local page is not cached as a server payload');
});

test('typing filters locally while an explicit search still queries every field', async () => {
  const a = fixture();
  // The index holds summaries only, so a description match can only come from the server.
  a.context.Database.update('TASKS', 'T5', {Description: '特殊な光学アライメント手順'});
  const h = harness((write, op, p) => write ? a.context.managerWebWrite(op, p) : a.context.managerWebRead(op, p));
  await flush();
  h.click('nav', 'タスク'); await flush();
  const search = h.nodes('content').find(n => n.name === 'search');
  const rpcBefore = stat(h).rpc;
  search.value = '光学アライメント';
  search.dispatchEvent('input', {});
  assert.match(content(h), /対象のデータはありません/);
  assert.equal(stat(h).rpc, rpcBefore, 'typing never calls the server');
  const filterForm = h.nodes('content').find(n => n.tagName === 'FORM');
  filterForm.dispatchEvent('submit', {preventDefault() {}});
  await flush();
  assert.match(content(h), /1–1 \/ 1/);
  assert.match(content(h), /詳細設計タスク 5/);
});

test('identical in-flight reads share one RPC and stale responses never repopulate the cache', async () => {
  const a = fixture(), h = harness(null, {manual: true});
  await flush();
  const startup = h.waiting.shift();
  assert.equal(startup.operation, 'bootstrap');
  const api = apiOf(h);
  const first = api.read('taskIndex', {}, true);
  const second = api.read('taskIndex', {}, true);
  await flush();
  assert.equal(h.waiting.length, 1);
  h.waiting.shift().success(a.context.managerWebRead('taskIndex'));
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one.rows.length, two.rows.length);

  const members = api.read('members', {}, true);
  await flush();
  const pending = h.waiting.shift();
  api.clear();
  pending.success(a.context.managerWebRead('members', {}));
  assert.equal(await members, null);
  assert.equal(api.peek('members', {}), null);
  startup.success(a.context.managerWebRead('bootstrap'));
  await flush();
});

/* ------------------------------------------------------------------ *
 * Background revalidation
 * ------------------------------------------------------------------ */

test('stale data renders instantly, refreshes in the background and keeps the screen', async () => {
  const {a, h} = setup();
  await flush();
  a.context.Database.update('TASKS', 'T0', {Task_Name: 'Background rename'});
  h.window.ManagerWebClient.store.at.bootstrap = Date.now() - 60000;
  h.window.ManagerWebClient.store.at.tasks = Date.now() - 60000;
  const rpcBefore = stat(h).rpc;
  const bootstrapBefore = h.calls.filter(c => c.operation === 'bootstrap').length;
  h.events.focus({});
  // The cached view is on screen before the refresh answers.
  assert.match(content(h), /進行中案件/);
  await flush();
  assert.ok(stat(h).rpc > rpcBefore, 'the snapshot was revalidated');
  assert.equal(h.calls.filter(c => c.operation === 'bootstrap').length, bootstrapBefore + 1, 'no duplicate bootstrap request');
  h.click('nav', 'タスク'); await flush();
  const search = h.nodes('content').find(n => n.name === 'search');
  search.value = 'Background rename';
  search.dispatchEvent('input', {});
  assert.match(content(h), /1–1 \/ 1/);
});

test('a save patches summaries, keeps unrelated caches and revalidates aggregates', async () => {
  const {a, h} = setup();
  await flush();
  h.click('nav', '管理'); h.click('content', 'メンバー'); await flush();
  const api = apiOf(h);
  assert.ok(api.peek('members', {}), 'member list is cached');
  h.click('nav', 'タスク'); await flush();
  h.click('content', '編集'); await flush();
  h.fill('taskName', 'Local patch');
  h.submit();
  await flush();
  assert.equal(a.context.Database.find('TASKS', 'T0').Task_Name, 'Local patch');
  assert.ok(api.peek('members', {}), 'an unrelated cached view survives the save');
  assert.equal(apiOf(h).peek('task', {id: 'T0'}), null, 'the edited detail is invalidated');
  assert.match(content(h), /Local patch/);
  assert.match(notice(h), /保存完了/);
  assert.equal(h.calls.filter(c => c.write).length, 1);
});

test('a failed save keeps the open form, shows the error and never retries by itself', async () => {
  const {a, h} = setup();
  await flush();
  h.click('nav', 'タスク'); await flush();
  h.click('content', '編集'); await flush();
  h.fill('taskName', 'Mine');
  a.context.Database.update('TASKS', 'T0', {Task_Name: 'Someone else'});
  h.submit(); await flush();
  assert.match(h.document.getElementById('formHost').textContent, /EDIT_CONFLICT/);
  assert.equal(h.nodes('formHost').find(n => n.name === 'taskName').value, 'Mine');
  assert.equal(a.context.Database.find('TASKS', 'T0').Task_Name, 'Someone else');
  assert.equal(h.calls.filter(c => c.write).length, 1);
  assert.ok(h.window.ManagerWebClient.editor(), 'the open form keeps the entered value');
});

/* ------------------------------------------------------------------ *
 * Authorization revocation
 * ------------------------------------------------------------------ */

test('a revoked manager loses cached views and the open form', async () => {
  const {a, h} = setup();
  await flush();
  assert.ok(apiOf(h).peek('bootstrap', {}));
  h.click('nav', 'タスク'); await flush();
  h.click('content', '編集'); await flush();
  h.fill('taskName', 'Unsent');
  a.setActor('viewer@example.test');
  const refresh = h.nodes('content').find(n => n.tagName === 'BUTTON' && n.textContent === '再読み込み');
  refresh.dispatchEvent('click', {});
  await flush();
  assert.match(notice(h), /権限/);
  assert.equal(h.window.ManagerWebClient.store.projects, null);
  assert.equal(h.window.ManagerWebClient.editor(), null, 'the open form is discarded');
  assert.equal(h.document.getElementById('editor').open, false, 'the dialog is closed');
  const callsBefore = h.calls.length;
  h.click('nav', 'タスク'); await flush();
  assert.equal(h.calls.length, callsBefore, 'no further server request after revocation');
  assert.doesNotMatch(content(h), /詳細設計タスク/);
});

/* ------------------------------------------------------------------ *
 * Large datasets
 * ------------------------------------------------------------------ */

test('large datasets keep the first payload bounded and the local list complete', async () => {
  const {a, h} = setup(300);
  await flush();
  assert.ok(h.calls.find(c => c.operation === 'bootstrap'));
  const payload = Buffer.byteLength(JSON.stringify(a.context.managerWebRead('bootstrap').data));
  assert.ok(payload < 200000, 'bootstrap payload ' + payload);
  assert.equal(h.window.ManagerWebClient.store.projects.total, 300);
  // Above the prefetch bound the compact index loads only when the task view opens.
  assert.equal(h.window.ManagerWebClient.store.tasks.loaded, false);
  h.click('nav', 'タスク'); await flush();
  await flush();
  assert.equal(h.window.ManagerWebClient.store.tasks.loaded, true);
  assert.equal(h.window.ManagerWebClient.store.tasks.items.length, 3000);
  const search = h.nodes('content').find(n => n.name === 'search');
  const started = Date.now();
  search.value = 'タスク 2999';
  search.dispatchEvent('input', {});
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 250, 'local search took ' + elapsed + ' ms');
  assert.match(content(h), /1–1 \/ 1/);
});

/* ------------------------------------------------------------------ *
 * Existing business behaviour is unchanged
 * ------------------------------------------------------------------ */

test('existing writes still go through the validated domain path from cached forms', async () => {
  const {a, h} = setup();
  await flush();
  h.click('nav', '案件'); await flush();
  h.click('content', '編集'); await flush();
  const rpc = stat(h).rpc;
  h.click('content', '編集'); await flush();
  assert.equal(stat(h).rpc, rpc, 'the project form opens from the loaded detail without a read');
  h.fill('name', 'Renamed project');
  h.submit(); await flush();
  assert.equal(a.context.Database.find('PROJECTS', 'P0').Project_Name, 'Renamed project');
  assert.equal(a.context.Database.find('PROJECTS', 'P0').Original_Deadline, '2026-12-18');
  assert.equal(a.sentEmails.length, 0);
  assert.equal(a.triggers.length, 0);
});
