'use strict';

/**
 * V1.4 UI behaviour: manager section navigation, responsibility controls, the nested
 * subproject tree, the request approval layout and the dashboard request form.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./fixtures');
const dashboardFixtures = require('./dashboard-fixtures');
const { createMenu, template, scriptOf } = require('./support/menu-harness');

const SRC = path.resolve(__dirname, '../src');
const MANAGER = 'manager@example.test';

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function managerApp(options = {}) {
  const app = fixtures.base({ actor: MANAGER, ...options });
  const area = app.context.Responsibilities.create({Name: '製品設計', Owner_Member_ID: 'M-MGR'});
  const other = app.context.Responsibilities.create({Name: '自動化・工程設計', Owner_Member_ID: 'M-MGR'});
  return {app, area, other};
}

/* ---------------- manager navigation ---------------- */

test('every Sheets menu entry opens a distinct, known sidebar handler', () => {
  const source = fs.readFileSync(path.join(SRC, 'Ui.gs'), 'utf8');
  const items = Array.from(source.matchAll(/\.addItem\('([^']+)', '([A-Za-z0-9_]+)'\)/g))
    .map(match => ({label: match[1], handler: match[2]}));
  assert.ok(items.length >= 12);
  items.forEach(item => {
    assert.ok(new RegExp('function ' + item.handler + '\\(\\s*\\)').test(source),
      item.label + ' must map to a defined handler');
  });
  // The menu is not one handler for everything any more.
  const distinct = new Set(items.map(item => item.handler));
  assert.ok(distinct.size >= 8, 'menu entries open the correct section');
  ['showNewProjectSidebar', 'showNewSubprojectSidebar', 'showNewTaskSidebar', 'showProgressSidebar',
    'showMembersSidebar', 'showSkillsSidebar', 'showResponsibilitiesSidebar'].forEach(handler => {
    assert.ok(distinct.has(handler), handler + ' must be reachable from the menu');
  });
});

test('the requested section is passed as a template value, not a mutable global', () => {
  const source = fs.readFileSync(path.join(SRC, 'Ui.gs'), 'utf8');
  assert.match(source, /template\.initialView = view;/);
  assert.match(source, /template\.initialAction = action;/);
  const html = template('UiMenu');
  assert.match(html, /var EH_INITIAL_VIEW = '<\?= initialView \?>';/);
  assert.match(html, /var EH_INITIAL_ACTION = '<\?= initialAction \?>';/);
  // Three top-level sections only.
  ['tab-project', 'tab-task', 'tab-admin'].forEach(id => assert.match(html, new RegExp('id="' + id + '"')));
  ['view-project', 'view-task', 'view-admin'].forEach(id => assert.match(html, new RegExp('id="' + id + '"')));
});

test('the sidebar keeps collapsed detail sections so stored values survive an edit', () => {
  const html = template('UiMenu');
  assert.match(html, /<details class="section" id="projectDetail">/);
  assert.match(html, /<details class="section" id="taskDetail">/);
  // The secondary fields stay inside the collapsed sections and keep their ids.
  ['projectCategory', 'projectPriority', 'projectVisibility', 'projectSummary', 'projectDescription']
    .forEach(id => assert.match(html, new RegExp('id="' + id + '"')));
  ['taskEstimate', 'taskAcceptance', 'taskPriority', 'taskNotify', 'taskApprove', 'taskConfirm']
    .forEach(id => assert.match(html, new RegExp('id="' + id + '"')));
});

test('the sidebar form sends only the responsibility the manager selected', () => {
  const {app, area} = managerApp();
  app.context.Projects.update('P1', {Responsibility_ID: area.Responsibility_ID});
  const page = createMenu(app, {template: 'UiMenu'});
  const options = page.options('projectResponsibility').map(item => item.value);
  assert.ok(options.indexOf('') >= 0, '未分類 stays available');
  assert.ok(options.indexOf(area.Responsibility_ID) >= 0, 'active responsibilities are selectable');

  page.set('projectPick', 'P1');
  page.context.loadProject(true);
  assert.equal(page.value('projectResponsibility'), area.Responsibility_ID, 'the stored value is preselected');
  const before = plain(app.context.Database.find('PROJECTS', 'P1'));

  // Saving with the same responsibility must not create a transfer.
  page.context.saveProject();
  assert.equal(app.context.Database.read('AUDIT_LOG').filter(row => row.Action === 'RESPONSIBILITY_TRANSFERRED').length, 0);

  // Clearing the selection is an explicit 未分類 transfer and keeps the owner.
  page.set('projectResponsibility', '');
  page.context.saveProject();
  const after = app.context.Database.find('PROJECTS', 'P1');
  assert.equal(after.Responsibility_ID, '');
  assert.equal(after.Project_Owner_ID, before.Project_Owner_ID);
  assert.equal(app.context.Database.read('AUDIT_LOG').filter(row => row.Action === 'RESPONSIBILITY_TRANSFERRED').length, 1);
});

/* ---------------- responsibility controls ---------------- */

test('a manager creates, renames and retires a responsibility through the sidebar bridges', () => {
  const app = fixtures.base({ actor: MANAGER });
  const created = app.context.uiSaveResponsibility({name: '製品設計', description: '製品の設計'});
  assert.equal(created.ok, true);
  const id = created.data.Responsibility_ID;
  assert.equal(created.data.Owner_Member_ID, 'M-MGR', 'the creating manager owns it');

  const renamed = app.context.uiSaveResponsibility({responsibilityId: id, name: '製品設計（更新）'});
  assert.equal(renamed.ok, true);
  assert.equal(renamed.data.Name, '製品設計（更新）');

  const retired = app.context.uiRetireResponsibility({responsibilityId: id});
  assert.equal(retired.ok, true);
  assert.equal(retired.data.retired, true);
  assert.equal(app.context.Database.find('RESPONSIBILITIES', id).Status, 'Retired');

  const restored = app.context.uiReactivateResponsibility({responsibilityId: id});
  assert.equal(restored.ok, true);
  assert.equal(restored.data.Status, 'Active');
});

test('changing a project responsibility asks for confirmation and keeps the owner', () => {
  const {app, area, other} = managerApp();
  app.context.Projects.update('P1', {Responsibility_ID: area.Responsibility_ID});
  const before = plain(app.context.Database.find('PROJECTS', 'P1'));

  const refused = app.context.uiUpdateProject({
    projectId: 'P1', responsibilityId: other.Responsibility_ID, updatedAt: before.Last_Updated
  });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /確認が必要/);

  const accepted = app.context.uiUpdateProject({
    projectId: 'P1', responsibilityId: other.Responsibility_ID,
    confirmResponsibilityChange: true, updatedAt: before.Last_Updated
  });
  assert.equal(accepted.ok, true);
  const after = app.context.Database.find('PROJECTS', 'P1');
  assert.equal(after.Responsibility_ID, other.Responsibility_ID);
  assert.equal(after.Project_Owner_ID, before.Project_Owner_ID, 'ownership never changes with the area');
  assert.equal(after.Committed_Deadline, before.Committed_Deadline);
  assert.ok(app.context.Database.read('AUDIT_LOG').some(row => row.Action === 'RESPONSIBILITY_TRANSFERRED'));
});

test('the responsibility list shows owners, counts and retired state', () => {
  const {app, area} = managerApp();
  app.context.Projects.update('P1', {Responsibility_ID: area.Responsibility_ID});
  app.context.uiRetireResponsibility({responsibilityId: area.Responsibility_ID});
  const page = createMenu(app, {template: 'UiMenu'});
  const text = page.texts('respList');
  assert.match(text, /製品設計/);
  assert.match(text, /自動化・工程設計/);
  assert.match(text, /担当領域がまだありません|件/, 'the list is rendered');
  assert.match(text, /設計 花子|管理 花子/, 'the owner name is shown');
});

/* ---------------- hierarchy ---------------- */

test('nested subprojects are created, archived and moved through the sidebar bridges', () => {
  const {app} = managerApp();
  const parent = app.context.uiCreateSubproject({projectId: 'P1', name: '機構設計', ownerId: 'M-ENG'});
  assert.equal(parent.ok, true);
  const child = app.context.uiCreateSubproject({
    projectId: 'P1', parentId: parent.data.Subproject_ID, name: 'カメラ取付設計', ownerId: 'M-ENG'
  });
  assert.equal(child.ok, true);
  assert.equal(child.data.Parent_Subproject_ID, parent.data.Subproject_ID);

  const refused = app.context.uiCreateSubproject({
    projectId: 'P1', parentId: child.data.Subproject_ID, name: '深すぎる'
  });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /2階層まで/);

  const moved = app.context.uiMoveTask({taskId: 'T1', subprojectId: child.data.Subproject_ID});
  assert.equal(moved.ok, true);
  assert.equal(moved.data.Subproject_ID, child.data.Subproject_ID);

  const archived = app.context.uiArchiveSubproject({subprojectId: parent.data.Subproject_ID});
  assert.equal(archived.ok, true);
  assert.equal(archived.data.Status, 'Archived');
  assert.ok(app.context.Database.find('SUBPROJECTS', child.data.Subproject_ID), 'the child survives');

  const restored = app.context.uiReactivateSubproject({subprojectId: parent.data.Subproject_ID});
  assert.equal(restored.ok, true);
  assert.equal(restored.data.Status, 'Active');
});

test('the sidebar context exposes the nested level and parent of every subproject', () => {
  const {app} = managerApp();
  const parent = app.context.uiCreateSubproject({projectId: 'P1', name: '機構設計'});
  const child = app.context.uiCreateSubproject({
    projectId: 'P1', parentId: parent.data.Subproject_ID, name: 'カメラ取付設計'
  });
  const view = app.context.Ui.context().data;
  const items = plain(view.subprojects);
  const root = items.filter(item => item.id === parent.data.Subproject_ID)[0];
  const nested = items.filter(item => item.id === child.data.Subproject_ID)[0];
  assert.equal(root.level, 1);
  assert.equal(root.hasChildren, true);
  assert.equal(nested.level, 2);
  assert.equal(nested.parentId, parent.data.Subproject_ID);
});

/* ---------------- request approval layout ---------------- */

test('the request queue leads with the type, the dates and the difference', () => {
  const app = fixtures.base({ actor: MANAGER });
  app.context.Database.insert('TASK_REQUESTS', {
    Request_ID: 'REQ-LAYOUT', Request_Type: 'DEADLINE_CHANGE', Task_ID: 'T1', Project_ID: 'P1',
    Requester_Name: '設計 次郎', Submitted_At: '2026-10-20T09:00:00.000Z',
    Original_Due_Date: '2026-12-15', Requested_Due_Date: '2026-12-22',
    Reason: '部品納期遅延', Explanation: '部品の入荷が1週間遅れます。', Status: 'PENDING'
  });
  const page = createMenu(app, {template: 'UiRequests'});
  const text = page.texts('requests');
  assert.match(text, /納期変更/);
  assert.match(text, /承認待ち/);
  assert.match(text, /検査装置/);
  assert.match(text, /機構設計/);
  assert.match(text, /現在の期限/);
  assert.match(text, /希望期限/);
  assert.match(text, /\+7日/);
  assert.match(text, /部品納期遅延/);
  assert.match(text, /設計 次郎/);
  // Decision controls exist exactly once per pending request.
  const buttons = page.element('requests').descend()
    .filter(node => node.tagName === 'BUTTON').map(node => node.textContent);
  assert.deepEqual(buttons.slice().sort(), ['却下', '差戻し', '承認'].sort());
});

/* ---------------- dashboard ---------------- */

function viewerScenario() {
  const app = fixtures.base({ actor: 'admin@example.test' });
  const area = app.context.Responsibilities.create({Name: '自動化・工程設計', Owner_Member_ID: 'M-MGR'});
  const retired = app.context.Responsibilities.create({Name: '研究開発（旧）', Owner_Member_ID: 'M-MGR'});
  app.context.Responsibilities.retire(retired.Responsibility_ID, {confirmed: true});
  app.context.Projects.update('P1', {Responsibility_ID: area.Responsibility_ID, Dashboard_Visibility: 'INTERNAL'});
  app.context.Projects.update('P2', {Responsibility_ID: retired.Responsibility_ID, Dashboard_Visibility: 'INTERNAL'});
  app.context.Subprojects.create({
    Subproject_ID: 'S1-CHILD', Project_ID: 'P1', Parent_Subproject_ID: 'S1', Subproject_Name: 'カメラ取付設計', Status: 'Active'
  });
  app.context.Tasks.create({Task_ID: 'T-CHILD', Project_ID: 'P1', Subproject_ID: 'S1-CHILD', Task_Name: 'カメラ取付',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2026-12-10'});
  const snapshot = dashboardFixtures.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(app);
  app.context.publishSharedDashboard();
  return dashboardFixtures.dashboardFor(snapshot);
}

function readServer(viewer, requestConfig) {
  return {
    dashboardPortfolio: request => viewer.context.dashboardPortfolio(request),
    dashboardProject: (id, options) => viewer.context.dashboardProject(id, options),
    dashboardTask: (projectId, taskId) => viewer.context.dashboardTask(projectId, taskId),
    requestSubmissionConfig: requestConfig || (() => ({ok: true, data: {enabled: false}})),
    submitDeadlineRequest: () => ({ok: true, data: {requestId: 'R1', status: 'PENDING'}}),
    submitCompletionReport: () => ({ok: true, data: {requestId: 'R2', status: 'PENDING'}}),
    requestSubmissionStatus: () => ({ok: false, error: {code: 'REQUEST_NOT_FOUND', message: 'x'}})
  };
}

function findByClass(root, className) {
  return root.descendants().filter(node => String(node.className).split(' ').indexOf(className) >= 0);
}

test('the dashboard offers a responsibility filter and marks a retired one', async () => {
  const viewer = viewerScenario();
  const client = dashboardFixtures.runClient(readServer(viewer));
  await dashboardFixtures.flush();
  const options = client.document.getElementById('filter-responsibility').childNodes
    .map(node => ({value: node.value, label: node.textContent}));
  assert.equal(options[0].value, '');
  const labels = options.map(item => item.label);
  assert.ok(labels.some(label => /自動化・工程設計/.test(label)));
  assert.ok(labels.some(label => /研究開発（旧）（退職）/.test(label)), 'a retired area stays filterable');
  const cardText = client.document.getElementById('project-list').textContent;
  assert.match(cardText, /自動化・工程設計/);
});

test('a nested subproject is indented and its parent reports the descendant count', async () => {
  const viewer = viewerScenario();
  const client = dashboardFixtures.runClient(readServer(viewer));
  await dashboardFixtures.flush();
  const list = client.document.getElementById('project-list');
  const card = list.descendants().find(node => node.getAttribute('data-project-id') === 'P1');
  list.dispatchEvent('click', {target: card});
  await dashboardFixtures.flush();
  const groups = client.document.getElementById('detail-groups');
  const nested = findByClass(groups, 'group-nested');
  assert.equal(nested.length, 1, 'one nested group is indented');
  assert.equal(nested[0].getAttribute('data-level'), '2');
  assert.match(groups.textContent, /配下を含む/);
});

test('the request form is not offered while submission is disabled', async () => {
  const viewer = viewerScenario();
  const client = dashboardFixtures.runClient(readServer(viewer, () => ({ok: true, data: {enabled: false}})));
  await dashboardFixtures.flush();
  await openFirstTask(client);
  const section = findByClass(client.document.getElementById('drawer-body'), 'request-section')[0];
  assert.ok(section, 'the request area exists');
  assert.equal(findByClass(section, 'request-button').filter(button => button.getAttribute('disabled') === null).length, 0,
    'no active submission button is shown');
  assert.match(section.textContent, /申請の受付は停止しています/);
  assert.equal(client.document.getElementById('drawer-body').descendants().some(node => node.id === 'request-deadline'), false,
    'no unusable form can be opened');
});

test('a configuration failure fails closed and never claims requests are open', async () => {
  const viewer = viewerScenario();
  const client = dashboardFixtures.runClient(readServer(viewer, () => { throw new Error('boom'); }));
  await dashboardFixtures.flush();
  await openFirstTask(client);
  const section = findByClass(client.document.getElementById('drawer-body'), 'request-section')[0];
  assert.match(section.textContent, /申請の受付状況を確認できませんでした/);
  assert.equal(findByClass(section, 'request-button').length, 0, 'no button is offered');
});

test('an enabled configuration offers both request types', async () => {
  const viewer = viewerScenario();
  const client = dashboardFixtures.runClient(readServer(viewer, () => ({ok: true, data: {enabled: true}})));
  await dashboardFixtures.flush();
  await openFirstTask(client);
  const section = findByClass(client.document.getElementById('drawer-body'), 'request-section')[0];
  const buttons = findByClass(section, 'request-button').map(button => button.textContent);
  assert.ok(buttons.indexOf('納期変更を申請') >= 0);
  assert.ok(buttons.indexOf('完了報告') >= 0);
});

test('switching language keeps an unsent request draft and never submits it', async () => {
  const viewer = viewerScenario();
  const server = readServer(viewer, () => ({ok: true, data: {enabled: true}}));
  let submitted = 0;
  server.submitDeadlineRequest = () => { submitted++; return {ok: true, data: {requestId: 'R1', status: 'PENDING'}}; };
  const client = dashboardFixtures.runClient(server);
  await dashboardFixtures.flush();
  await openFirstTask(client);
  const section = findByClass(client.document.getElementById('drawer-body'), 'request-section')[0];
  findByClass(section, 'request-button')[0].dispatchEvent('click');
  await dashboardFixtures.flush();

  const body = client.document.getElementById('drawer-body');
  const deadline = body.descendants().find(node => node.id === 'request-deadline');
  const explanation = body.descendants().find(node => node.id === 'request-explanation');
  const requester = body.descendants().find(node => node.id === 'request-requester');
  assert.ok(deadline && explanation && requester, 'the form is open');
  deadline.value = '2026-12-24';
  explanation.value = '部品の納期が遅れています。';
  requester.value = '設計 次郎';
  deadline.dispatchEvent('input');
  explanation.dispatchEvent('input');
  requester.dispatchEvent('input');

  // Switch to English, then back, without submitting.
  client.buttons[1].dispatchEvent('click');
  const english = client.document.getElementById('drawer-body');
  assert.equal(english.descendants().find(node => node.id === 'request-deadline').value, '2026-12-24');
  assert.equal(english.descendants().find(node => node.id === 'request-explanation').value, '部品の納期が遅れています。');
  assert.equal(english.descendants().find(node => node.id === 'request-requester').value, '設計 次郎');
  client.buttons[0].dispatchEvent('click');
  const japanese = client.document.getElementById('drawer-body');
  assert.equal(japanese.descendants().find(node => node.id === 'request-deadline').value, '2026-12-24');
  assert.equal(submitted, 0, 'a language switch never submits');
});

async function openFirstTask(client) {
  const list = client.document.getElementById('project-list');
  const card = list.descendants().find(node => node.getAttribute('data-project-id') === 'P1');
  list.dispatchEvent('click', {target: card});
  await dashboardFixtures.flush();
  const groups = client.document.getElementById('detail-groups');
  const button = groups.descendants().find(node => node.hasAttribute('data-open-task'));
  groups.dispatchEvent('click', {target: button});
  await dashboardFixtures.flush();
}
