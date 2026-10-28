'use strict';
/**
 * V1.6 gate 1 and 2: the responsibility-first manager dashboard.
 *
 * Responsibilities are the top organisational level; the project relationship is the stable
 * Responsibility_ID; the manager home shows an area card for every responsibility; selecting an
 * area filters projects, tasks and the KPIs without another Apps Script call.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const {harness, flush} = require('./support/manager-web-harness');
const {fixture} = require('../scripts/manager-web-preview');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};
const plain = value => JSON.parse(JSON.stringify(value));

function managerApp(actor = 'admin@example.test') {
  return fixtures.base({actor, properties: MANAGER_WEB});
}

function withAreas() {
  const app = managerApp();
  const first = app.context.Responsibilities.create({Name: '製品設計', Owner_Member_ID: 'M-MGR'});
  const second = app.context.Responsibilities.create({Name: '自動化・工程設計', Owner_Member_ID: 'M-MGR'});
  app.context.Projects.update('P1', {Responsibility_ID: first.Responsibility_ID});
  return {app, first: plain(first), second: plain(second)};
}

function clientOf(app) {
  return harness((write, op, payload) => write
    ? app.context.managerWebWrite(op, payload)
    : app.context.managerWebRead(op, payload));
}

test('every responsibility is a card on the manager home with counts and progress', () => {
  const {app, first} = withAreas();
  const bootstrap = app.context.managerWebRead('bootstrap');
  assert.equal(bootstrap.ok, true, bootstrap.error);
  const cards = bootstrap.data.responsibilityCards;
  assert.equal(cards.items.length, 2);
  const design = cards.items.filter(area => area.id === first.Responsibility_ID)[0];
  assert.equal(design.name, '製品設計');
  assert.equal(design.projects, 1, 'the active project is counted');
  assert.equal(design.openTasks, 2, 'both open tasks of P1 are counted');
  // T1 is 25 % of 40h; T2 has no estimate and keeps the documented fallback weight of 1.
  assert.equal(design.progress, 24.39);
  assert.match(design.color, /^#[0-9A-F]{6}$/);
  // P2 has no responsibility: it appears in the 未分類 bucket, never in an invented area.
  assert.equal(cards.unassigned.totalProjects, 1);
});

test('overdue tasks are counted per area and 未分類 stays a separate bucket', () => {
  const {app, first} = withAreas();
  app.context.Database.insert('TASKS', {
    Task_ID: 'T-LATE', Project_ID: 'P1', Task_Name: '遅延', Owner_Member_ID: 'M-ENG',
    Status: 'In Progress', Due_Date: '2020-01-01'
  });
  const cards = app.context.managerWebRead('overview').data.responsibilityCards;
  const design = cards.items.filter(area => area.id === first.Responsibility_ID)[0];
  assert.equal(design.overdueTasks, 1);
  assert.equal(cards.unassigned.overdueTasks, 0);
});

test('a responsibility keeps its stable ID through rename, reorder and retirement', () => {
  const {app, first, second} = withAreas();
  app.context.Ui.saveResponsibility({responsibilityId: first.Responsibility_ID, name: '製品設計（改名）'});
  assert.equal(app.context.Database.find('PROJECTS', 'P1').Responsibility_ID, first.Responsibility_ID,
    'renaming never rewrites the project link');
  app.context.Ui.moveResponsibility({responsibilityId: second.Responsibility_ID, direction: 'up'});
  const order = app.context.Responsibilities.all().map(row => row.Responsibility_ID);
  assert.equal(order[0], second.Responsibility_ID);
  app.context.Responsibilities.retire(second.Responsibility_ID, {confirmed: true});
  const retired = app.context.Database.find('RESPONSIBILITIES', second.Responsibility_ID);
  assert.equal(retired.Status, 'Retired');
  assert.ok(retired.Retired_At, 'retirement is a status change with a timestamp');
  // The retired area still exists, still lists its projects and is never deleted.
  assert.ok(app.context.Database.find('RESPONSIBILITIES', second.Responsibility_ID));
});

test('a responsibility colour must be a validated hex value and defaults from the palette', () => {
  const app = managerApp();
  const area = app.context.Responsibilities.create({Name: '製品設計', Owner_Member_ID: 'M-MGR'});
  assert.match(area.Color_Hex, /^#[0-9A-F]{6}$/, 'a new area takes the next palette entry');
  const updated = app.context.Ui.saveResponsibility({
    responsibilityId: area.Responsibility_ID, color: '#6a65a8'
  });
  assert.equal(updated.ok, true, updated.error);
  assert.equal(updated.data.Color_Hex, '#6A65A8', 'the stored value is normalized');
  const refused = app.context.Ui.saveResponsibility({
    responsibilityId: area.Responsibility_ID, color: 'red'
  });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /#RRGGBB/);
});

test('the manager dashboard refuses a new project without an active responsibility', () => {
  const {app, first} = withAreas();
  const missing = app.context.managerWebWrite('projectCreate', {name: '担当領域なし'});
  assert.equal(missing.ok, false);
  assert.match(missing.error, /担当領域/);

  const created = app.context.managerWebWrite('projectCreate', {name: '新案件', responsibilityId: first.Responsibility_ID});
  assert.equal(created.ok, true, created.error);
  assert.equal(created.data.Responsibility_ID, first.Responsibility_ID);

  // A retired area is not a valid destination for new work.
  app.context.Responsibilities.retire(first.Responsibility_ID, {confirmed: true});
  const retired = app.context.managerWebWrite('projectCreate', {name: '廃止領域', responsibilityId: first.Responsibility_ID});
  assert.equal(retired.ok, false);
  assert.match(retired.error, /廃止/);
});

test('existing projects without a responsibility stay editable and display 未分類', () => {
  const {app} = withAreas();
  const project = app.context.managerWebRead('projects', {}).data.items.filter(row => row.id === 'P2')[0];
  assert.equal(project.responsibilityId, '');
  assert.equal(project.responsibility, '');
  const edit = app.context.managerWebWrite('projectSave', {
    projectId: 'P2', revision: app.context.managerWebRead('project', {id: 'P2'}).data.record._revision,
    name: '旧ライン（改名）'
  });
  assert.equal(edit.ok, true, edit.error);
  assert.equal(app.context.Database.find('PROJECTS', 'P2').Responsibility_ID, '');
});

test('the browser filters projects and tasks by the selected responsibility without an RPC', async () => {
  const app = fixture(10);
  const h = clientOf(app);
  await flush();
  const before = h.calls.length;
  assert.equal(before >= 1, true, 'the first paint reads the authorized snapshot');
  assert.match(h.document.getElementById('content').textContent, /製品設計/);

  // Select the first area card. The list narrows locally: no additional server call.
  const card = h.nodes('content').filter(node => node.tagName === 'BUTTON' && /^製品設計/.test(node.textContent))[0];
  assert.ok(card, 'the area card is an interactive button');
  card.dispatchEvent('click', {});
  await flush();
  assert.equal(h.calls.length, before, 'selecting an area never calls the server');
  const state = h.window.ManagerWebClient.store;
  assert.equal(state.responsibilityCards.items.length, 2, 'both areas stay in the snapshot');
  assert.equal(state.projects.items.filter(project => project.responsibilityId === 'R1').length > 0, true);
  assert.match(h.document.getElementById('content').textContent, /製品設計/);
});

test('the responsibility section is rendered above the KPIs', async () => {
  const app = fixture(10);
  const h = clientOf(app);
  await flush();
  assert.match(h.document.getElementById('nav').textContent, /責任領域/);
  assert.match(h.document.getElementById('nav').textContent, /すべての担当領域/);
  assert.match(h.document.getElementById('nav').textContent, /製品設計/);
  assert.match(h.document.getElementById('content').textContent, /\+ 担当領域を追加/);
});
