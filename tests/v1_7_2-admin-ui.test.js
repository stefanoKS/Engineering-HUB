'use strict';

/**
 * V1.7.2 administration layout and the simplified editor lifecycle.
 *
 * Two behaviours are covered:
 *
 * 1. Open → edit → save or close. A form always starts from the stored record; closing (or
 *    navigating away) discards every entered value and reopens empty/latest. Nothing is kept in
 *    memory, in localStorage or as a draft, and one save is one write.
 * 2. Purpose-built administration pages: publication, system status, grouped automation and the
 *    searchable parent selectors. No page dumps a nested server payload, and the four different
 *    "versions" are never presented as interchangeable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./fixtures');
const dashboardFixtures = require('./dashboard-fixtures');
const { harness, flush } = require('./support/manager-web-harness');
const managerPreview = require('../scripts/manager-web-preview');

const DOMAIN = { MANAGER_WEB_ALLOWED_DOMAINS: 'example.test' };

/** Administrator workbook with an initialized + published shared dashboard snapshot. */
function administrator() {
  const manager = fixtures.base({ actor: 'admin@example.test', properties: DOMAIN });
  const snapshot = dashboardFixtures.attachSnapshot(manager);
  manager.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(manager);
  manager.context.publishSharedDashboard();
  return { manager, snapshot };
}

function clientOf(manager) {
  return harness((write, operation, payload) => (write
    ? manager.context.managerWebWrite(operation, payload)
    : manager.context.managerWebRead(operation, payload)));
}

const content = h => h.document.getElementById('content').textContent;
const formText = h => h.document.getElementById('formHost').textContent;
const withClass = (nodes, className) => nodes.filter(node => String(node.className).split(' ').indexOf(className) >= 0);
const contentNodes = (h, className) => withClass(h.nodes('content'), className);
const formNodes = (h, className) => withClass(h.nodes('formHost'), className);
const fieldOf = (h, name) => h.nodes('formHost').find(node => node.name === name);

/** A button that belongs to the card mentioning `matchText`. */
function clickCardButton(h, matchText, label) {
  const card = h.nodes('content').filter(node => String(node.className).indexOf('card') >= 0
    && node.textContent.indexOf(matchText) >= 0)[0];
  assert.ok(card, 'card containing ' + matchText);
  const button = card.descendants().filter(node => node.tagName === 'BUTTON' && node.textContent === label)[0];
  assert.ok(button, 'button ' + label + ' in the card for ' + matchText);
  button.dispatchEvent('click', {});
  return button;
}

async function openAdminPage(h, label) {
  h.click('nav', '管理');
  await flush();
  h.click('content', label);
  await flush();
}

/* ------------------------------------------------------------------ *
 * 1. Editor lifecycle: open → edit → save or close
 * ------------------------------------------------------------------ */

test('closing an editor discards the change and reopening loads the stored record', async () => {
  const { manager } = administrator();
  const h = clientOf(manager);
  await flush();
  h.click('nav', 'タスク');
  await flush();
  h.click('content', '編集');
  await flush();

  const stored = fieldOf(h, 'taskName').value;
  const id = h.window.ManagerWebClient.editor().id;
  h.fill('taskName', '未保存の変更');
  h.click('formHost', '閉じる');
  await flush();

  assert.equal(h.window.ManagerWebClient.editor(), null, 'closing drops the form');
  assert.equal(formText(h).trim(), '', 'the form is cleared, not hidden');
  assert.equal(manager.context.Database.find('TASKS', id).Task_Name, stored, 'nothing was written');

  h.click('content', '編集');
  await flush();
  assert.equal(fieldOf(h, 'taskName').value, stored, 'reopening shows the stored value');
});

test('a confirmed save closes the form and reopening shows the new value', async () => {
  const { manager } = administrator();
  const h = clientOf(manager);
  await flush();
  h.click('nav', 'タスク');
  await flush();
  h.click('content', '編集');
  await flush();

  const id = h.window.ManagerWebClient.editor().id;
  h.fill('taskName', '保存した名前');
  h.submit();
  await flush();

  assert.equal(manager.context.Database.find('TASKS', id).Task_Name, '保存した名前');
  assert.equal(h.window.ManagerWebClient.editor(), null, 'a confirmed save closes the form');
  assert.equal(h.nodes('formHost').length, 0, 'the form host is empty after saving');

  h.click('content', '編集');
  await flush();
  assert.equal(fieldOf(h, 'taskName').value, '保存した名前', 'reopening shows the saved value');
});

test('closing a new-record form discards it and reopening starts empty', async () => {
  const { manager } = administrator();
  const h = clientOf(manager);
  await flush();
  h.click('nav', 'タスク');
  await flush();
  h.click('content', '新規作成');
  await flush();
  h.fill('taskName', '破棄されるタスク');
  h.click('formHost', '閉じる');
  await flush();

  assert.equal(h.window.ManagerWebClient.editor(), null);
  assert.equal(h.calls.some(call => call.write), false, 'closing never writes');

  h.click('content', '新規作成');
  await flush();
  assert.equal(fieldOf(h, 'taskName').value, '', 'a new form is empty again');
  assert.equal(h.calls.some(call => call.write), false);
});

test('navigating away from an unfinished editor has the same result as closing', async () => {
  const { manager } = administrator();
  const h = clientOf(manager);
  await flush();
  h.click('nav', 'タスク');
  await flush();
  h.click('content', '編集');
  await flush();
  const stored = fieldOf(h, 'taskName').value;
  h.fill('taskName', '途中の変更');

  h.click('nav', '概要');
  await flush();
  assert.equal(h.window.ManagerWebClient.editor(), null, 'the editor is dropped on navigation');
  assert.equal(h.document.getElementById('editor').open, false, 'the dialog is closed');

  h.click('nav', 'タスク');
  await flush();
  h.click('content', '編集');
  await flush();
  assert.equal(fieldOf(h, 'taskName').value, stored, 'the abandoned value is gone');
});

test('a refused save keeps the open form and sends no second write', async () => {
  const { manager } = administrator();
  const h = clientOf(manager);
  await flush();
  h.click('nav', 'タスク');
  await flush();
  h.click('content', '編集');
  await flush();
  const id = h.window.ManagerWebClient.editor().id;
  h.fill('taskName', '自分の変更');
  manager.context.Database.update('TASKS', id, { Task_Name: '他の管理者' });
  h.submit();
  h.submit();
  await flush();

  assert.match(formText(h), /EDIT_CONFLICT/);
  assert.equal(fieldOf(h, 'taskName').value, '自分の変更', 'the open form keeps the value');
  assert.equal(manager.context.Database.find('TASKS', id).Task_Name, '他の管理者');
  assert.equal(h.calls.filter(call => call.write).length, 1, 'a refused save is never retried automatically');
});

test('one save is one write and a second submit after closing sends nothing', async () => {
  const { manager } = administrator();
  const h = clientOf(manager);
  await flush();
  h.click('nav', 'タスク');
  await flush();
  h.click('content', '編集');
  await flush();
  h.fill('taskName', '一度だけ');
  h.submit();
  h.submit();
  await flush();

  const writes = h.calls.filter(call => call.write && call.operation === 'taskSave');
  assert.equal(writes.length, 1, 'exactly one write');
  assert.equal(h.window.ManagerWebClient.editor(), null);
  assert.equal(h.nodes('formHost').length, 0, 'nothing is left that could be submitted again');
});

/* ------------------------------------------------------------------ *
 * 2. Deletion panel and request decision notes
 * ------------------------------------------------------------------ */

test('closing the deletion panel discards the reason and reopening starts empty', async () => {
  const { manager } = administrator();
  const h = clientOf(manager);
  await flush();
  const host = h.document.getElementById('content');
  h.window.ManagerWebClient.deletion('TASKS', 'T2', '要件整理', '', host);
  await flush();

  const reason = h.nodes('content').find(node => node.name === 'deleteReason');
  assert.ok(reason, 'the reason field exists');
  assert.equal(reason.value, '', 'a new panel starts empty');
  reason.value = '誤って登録したため';
  reason.dispatchEvent('change', {});

  h.click('content', '閉じる');
  await flush();
  assert.equal(contentNodes(h, 'deletion-panel').length, 0, 'the panel closes');
  assert.equal(h.calls.some(call => call.write), false, 'closing never deletes');

  h.window.ManagerWebClient.deletion('TASKS', 'T2', '要件整理', '', host);
  await flush();
  assert.equal(h.nodes('content').find(node => node.name === 'deleteReason').value, '', 'the previous reason is discarded');
  assert.equal(manager.context.Database.find('TASKS', 'T2').Task_ID, 'T2', 'the record is untouched');
});

test('an unsent request decision note is not retained after leaving the page', async () => {
  const app = managerPreview.fixture();
  const h = harness((write, operation, payload) => (write
    ? app.context.managerWebWrite(operation, payload)
    : app.context.managerWebRead(operation, payload)));
  await flush();
  h.click('nav', '申請');
  await flush();
  const note = h.nodes('content').find(node => node.name === 'note');
  assert.ok(note, 'the decision note exists');
  note.value = '未送信のメモ';
  note.dispatchEvent('input', {});

  h.click('nav', '概要');
  await flush();
  h.click('nav', '申請');
  await flush();
  assert.equal(h.nodes('content').find(node => node.name === 'note').value, '', 'the note is gone');
  assert.equal(h.calls.filter(call => call.write && call.operation === 'requestDecide').length, 0,
    'no decision was submitted');
});

/* ------------------------------------------------------------------ *
 * 3. Publication page
 * ------------------------------------------------------------------ */

test('the publication page shows status cards, counts and every distinct version', async () => {
  const { manager } = administrator();
  const h = clientOf(manager);
  await flush();
  await openAdminPage(h, '共有ダッシュボード公開');

  const text = content(h);
  assert.match(text, /公開状態/);
  assert.match(text, /最終成功/);
  assert.match(text, /自動公開/);
  assert.match(text, /公開件数/);
  assert.match(text, /スナップショットの契約/);
  assert.match(text, /版の情報/);
  assert.match(text, /今すぐ公開/);
  assert.ok(contentNodes(h, 'admin-card').length >= 6, 'each fact is its own card');
  assert.equal(contentNodes(h, 'admin-card-error').length, 0, 'a healthy publication shows no error card');

  // The four versions are labelled separately instead of being shown as one number.
  const versions = contentNodes(h, 'admin-card').filter(card => card.textContent.indexOf('版の情報') >= 0)[0];
  assert.match(versions.textContent, /データベース スキーマの版/);
  assert.match(versions.textContent, /アプリケーションの版/);
  assert.match(versions.textContent, /パブリッシャーの版/);
  assert.match(versions.textContent, /公開スナップショット番号/);

  // Nothing here may be the raw nested payload.
  assert.doesNotMatch(text, /\{|\}/);
  assert.doesNotMatch(text, /\[object Object\]/);
  assert.doesNotMatch(text, /destinationConfigured|publisherVersion|contractVersion/);

  // Technical metadata is available behind an expandable block.
  const details = contentNodes(h, 'admin-details');
  assert.equal(details.length, 1, 'one details block');
  assert.match(details[0].textContent, /技術情報を表示/);
  assert.match(details[0].textContent, /使用中のスロット/);
});

test('a newer publisher contract than the published snapshot is an informational update', async () => {
  const { manager, snapshot } = administrator();
  // The committed snapshot was produced by contract 1.5 while this publisher supports 1.6.
  snapshot.getSheetByName('PUBLISHED_META').rows
    .filter(cells => cells[0] === 'CONTRACT_VERSION')
    .forEach(cells => { cells[1] = '1.5'; });
  const h = clientOf(manager);
  await flush();
  await openAdminPage(h, '共有ダッシュボード公開');

  const text = content(h);
  assert.match(text, /更新あり/);
  assert.match(text, /1\.5/, 'the published contract is shown');
  assert.match(text, /1\.6/, 'the supported contract is shown');
  assert.equal(contentNodes(h, 'admin-card-error').length, 0, 'a newer contract is not a failure');

  const banners = contentNodes(h, 'info-banner');
  assert.equal(banners.length, 1, 'exactly one informational banner');
  assert.equal(String(banners[0].className).indexOf('is-warn'), -1, 'an informational update is not a warning');

  // Publishing is still an explicitly confirmed action.
  h.click('content', '今すぐ公開');
  await flush();
  const publish = h.calls.filter(call => call.write && call.operation === 'publication')[0];
  assert.ok(publish, 'the publish action goes through the authorized write');
  assert.equal(publish.payload.confirmed, true);
});

test('an unconfigured destination and a broken snapshot are shown as states, never as raw data', async () => {
  const unconfigured = fixtures.base({ actor: 'admin@example.test', properties: DOMAIN });
  const first = clientOf(unconfigured);
  await flush();
  await openAdminPage(first, '共有ダッシュボード公開');
  assert.match(content(first), /公開先が未設定/);
  assert.match(content(first), /自動公開は停止中/, 'publication defaults to off');

  const { manager, snapshot } = administrator();
  const meta = snapshot.getSheetByName('PUBLISHED_META');
  meta.rows.length = 1; // keep the header only: the committed slot cannot be resolved
  const second = clientOf(manager);
  await flush();
  await openAdminPage(second, '共有ダッシュボード公開');
  assert.match(content(second), /前回の公開に失敗しました/);
  assert.equal(contentNodes(second, 'admin-card-error').length, 1, 'the failure is never hidden');
  assert.doesNotMatch(content(second), /\{|\}/);
});

/* ------------------------------------------------------------------ *
 * 4. System status and automation pages
 * ------------------------------------------------------------------ */

test('the system status page groups database, application, health and integration facts', async () => {
  const { manager } = administrator();
  const h = clientOf(manager);
  await flush();
  await openAdminPage(h, 'システム状態');

  const text = content(h);
  assert.match(text, /データベースと環境/);
  assert.match(text, /アプリケーション/);
  assert.match(text, /稼働状態/);
  assert.match(text, /連携/);
  assert.match(text, /エラーと警告/);
  assert.match(text, /整合性チェックに合格/);
  assert.doesNotMatch(text, /\{|\}/, 'no raw nested payload');
  assert.doesNotMatch(text, /rowCounts|emailMode|emergencyStop/, 'internal field names stay out of the page');

  const details = contentNodes(h, 'admin-details');
  assert.ok(details.length >= 1, 'technical metadata stays in an expandable block');
  assert.match(details[0].textContent, /内部情報/);
  // Row counts are available, but not in the primary view.
  assert.equal(details.length >= 1 && contentNodes(h, 'admin-details').some(node => node.textContent.indexOf('テーブル別レコード件数') >= 0), true);
});

test('the automation page groups the settings and keeps the save path intact', async () => {
  const { manager } = administrator();
  const h = clientOf(manager);
  await flush();
  await openAdminPage(h, '自動化');

  const text = content(h);
  ['メール通知', '申請の同期', '定期処理・レポート', '緊急停止', 'スナップショット公開']
    .forEach(group => assert.match(text, new RegExp(group)));
  const groups = contentNodes(h, 'settings-group');
  assert.ok(groups.length >= 4, 'every group is a card');
  assert.ok(h.nodes('content').some(node => String(node.className).indexOf('pill-') > 0), 'states are shown as badges');
  assert.doesNotMatch(text, /\{|\}/);

  // An unchanged form saves nothing; a changed toggle sends only that key.
  const before = h.calls.filter(call => call.write && call.operation === 'automationSave').length;
  const toggle = h.nodes('content').find(node => node.name === 'ASSIGNMENT_EMAIL_ENABLED');
  assert.ok(toggle, 'a boolean setting is a control');
  toggle.checked = true;
  toggle.dispatchEvent('change', {});
  const form = h.nodes('content').find(node => node.tagName === 'FORM');
  form.dispatchEvent('submit', { preventDefault() {} });
  await flush();

  const writes = h.calls.filter(call => call.write && call.operation === 'automationSave');
  assert.equal(writes.length, before + 1, 'exactly one settings write');
  assert.deepEqual(JSON.parse(JSON.stringify(writes[writes.length - 1].payload.changes)),
    { ASSIGNMENT_EMAIL_ENABLED: true }, 'only the addressed setting is sent');
});

/* ------------------------------------------------------------------ *
 * 5. Subproject and task hierarchy controls
 * ------------------------------------------------------------------ */

test('a subproject parent is chosen by name and the record can never be its own parent', async () => {
  const { manager } = administrator();
  const child = manager.context.Subprojects.create({
    Project_ID: 'P1', Subproject_Name: '詳細試作', Parent_Subproject_ID: 'S1', Owner_ID: 'M-ENG'
  });
  const h = clientOf(manager);
  await flush();
  h.click('nav', '案件');
  await flush();
  clickCardButton(h, '検査装置', '編集');
  await flush();
  clickCardButton(h, '詳細試作', '編集');
  await flush();

  const select = fieldOf(h, 'parentId');
  assert.ok(select, 'the parent is a selector, not a free-text ID field');
  assert.equal(select.tagName, 'SELECT');
  const labels = select.childNodes.map(option => option.textContent);
  const values = select.childNodes.map(option => option.value);
  assert.ok(labels.some(text => /親サブプロジェクト|親なし/.test(text) || text === '試作' || text.indexOf('試作') >= 0),
    'the choices carry readable names: ' + labels.join(' / '));
  assert.equal(values.indexOf(child.Subproject_ID), -1, 'the record is never offered as its own parent');
  assert.ok(values.indexOf('S1') >= 0, 'the same project subprojects are offered');
  assert.equal(select.value, 'S1', 'the stored parent is preselected');
  assert.match(formText(h), /選択中の親: 試作/, 'the selected parent name is echoed');
});

test('the parent selector filters by name and never asks for an internal ID', async () => {
  const { manager } = administrator();
  manager.context.Subprojects.create({ Project_ID: 'P1', Subproject_Name: '詳細試作', Parent_Subproject_ID: 'S1', Owner_ID: 'M-ENG' });
  const mass = manager.context.Subprojects.create({ Project_ID: 'P1', Subproject_Name: '量産試作', Owner_ID: 'M-ENG' });
  const h = clientOf(manager);
  await flush();
  h.click('nav', '案件');
  await flush();
  clickCardButton(h, '検査装置', '編集');
  await flush();
  h.click('content', 'サブプロジェクト');
  await flush();

  const wrapper = formNodes(h, 'search-select')[0];
  assert.ok(wrapper, 'the hierarchy control is a searchable selector');
  const search = wrapper.descendants().filter(node => node.tagName === 'INPUT')[0];
  assert.ok(search, 'a search box is offered');
  search.value = '量産';
  search.dispatchEvent('input', {});
  const select = fieldOf(h, 'parentId');
  const values = select.childNodes.map(option => option.value);
  assert.deepEqual(JSON.parse(JSON.stringify(values.filter(Boolean))), [mass.Subproject_ID],
    'only the matching name remains');
  assert.match(wrapper.textContent, /名前で検索|親サブプロジェクト/);

  select.value = mass.Subproject_ID;
  select.dispatchEvent('change', {});
  h.fill('name', '量産準備');
  h.submit();
  await flush();
  const created = manager.context.Database.read('SUBPROJECTS').filter(row => row.Subproject_Name === '量産準備')[0];
  assert.ok(created, 'the subproject was created');
  assert.equal(created.Parent_Subproject_ID, mass.Subproject_ID, 'the stable ID is sent, never a typed name');
});

test('a task parent is limited to the same project and subproject without the task itself', async () => {
  const { manager } = administrator();
  const parent = manager.context.Tasks.create({
    Project_ID: 'P1', Subproject_ID: 'S1', Task_Name: '親タスク候補', Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  });
  const h = clientOf(manager);
  await flush();
  h.click('nav', '案件');
  await flush();
  clickCardButton(h, '検査装置', '編集');
  await flush();
  h.click('content', 'タスク');
  await flush();
  clickCardButton(h, '機構設計', '編集');
  await flush();

  const select = fieldOf(h, 'parentTaskId');
  assert.ok(select, 'the parent task is a selector');
  const values = select.childNodes.map(option => option.value);
  assert.ok(values.indexOf(parent.Task_ID) >= 0, 'a task of the same project and subproject is offered');
  assert.equal(values.indexOf('T1'), -1, 'the edited task is never its own parent');
  assert.equal(values.indexOf('T2'), -1, 'a task of another subproject is not offered');
  assert.ok(select.childNodes.some(option => option.textContent.indexOf('親タスク候補') >= 0), 'the choice shows the task name');
});

/* ------------------------------------------------------------------ *
 * 6. Localization, layout and preserved operational records
 * ------------------------------------------------------------------ */

test('the administration pages follow the 日本語 | English switch', async () => {
  const { manager } = administrator();
  const h = clientOf(manager);
  await flush();
  h.click('nav', '管理');
  await flush();
  h.document.getElementById('language').dispatchEvent('click', {});
  await flush();

  assert.ok(h.nodes('content').some(node => node.textContent === 'System status'), 'English navigation');
  h.click('content', 'System status');
  await flush();
  let text = content(h);
  assert.match(text, /Database and environment/);
  assert.match(text, /Operational status/);
  assert.match(text, /Errors and warnings/);

  h.click('nav', 'Administration');
  await flush();
  h.click('content', 'Dashboard publication');
  await flush();
  text = content(h);
  assert.match(text, /Publication status/);
  assert.match(text, /Publish now/);
  assert.match(text, /Database schema version/);
  assert.match(text, /Publisher supported contract/);

  h.document.getElementById('language').dispatchEvent('click', {});
  await flush();
  assert.match(content(h), /公開状態/);
  assert.match(content(h), /データベース スキーマの版/);
});

test('the administration layout is responsive and keeps touch-sized controls', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../src/ManagerWebStyles.html'), 'utf8');
  assert.match(css, /\.admin-grid\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,300px\),1fr\)\)/,
    'cards reflow instead of overflowing');
  assert.match(css, /@media \(max-width:640px\)\{\.admin-grid\{grid-template-columns:1fr\}/,
    'a narrow screen collapses to one column');
  assert.match(css, /@media\(max-width:900px\)\{\.layout\{grid-template-columns:1fr\}/,
    'the page stacks below 900 px instead of squeezing the content into a side column');
  assert.match(css, /@media\(min-width:901px\) and \(max-width:1100px\)\{\.layout\{grid-template-columns:200px/,
    'the narrower navigation column never overrides the stacked mobile layout');
  assert.match(css, /nav button\{width:auto;margin:0;flex:1 1 96px\}/,
    'the mobile navigation wraps instead of shrinking every button');
  assert.match(css, /\.search-select select\{min-height:44px\}/, 'the selector stays touch sized');
  assert.match(css, /\.search-select-echo\{[^}]*overflow-wrap:anywhere\}/, 'the echoed name cannot overflow');
  assert.match(css, /\.info-banner p\{[^}]*overflow-wrap:anywhere\}/);
});

test('the editor lifecycle leaves approvals, request records and audit rows intact', async () => {
  const { manager } = administrator();
  const h = clientOf(manager);
  await flush();
  fixtures.activate(manager);
  fixtures.approve(manager, 'T1');
  const approved = String(manager.context.Database.find('TASKS', 'T1').Assignment_Approved_At || '');
  assert.ok(approved, 'the assignment approval exists before the edit');
  const requests = manager.context.Database.read('TASK_REQUESTS').length;
  const auditBefore = manager.context.Database.read('AUDIT_LOG').length;

  h.click('nav', 'タスク');
  await flush();
  clickCardButton(h, '機構設計', '編集');
  await flush();
  assert.equal(h.window.ManagerWebClient.editor().id, 'T1');
  // A field that is not part of the assignment keeps the approval (a rename would revoke it).
  h.fill('nextAction', '次は光学系の再評価');
  h.submit();
  await flush();

  assert.equal(String(manager.context.Database.find('TASKS', 'T1').Assignment_Approved_At || ''), approved,
    'the approval record is untouched by an unrelated edit');
  assert.equal(manager.context.Database.read('TASK_REQUESTS').length, requests, 'request receipts are untouched');
  assert.ok(manager.context.Database.read('AUDIT_LOG').length > auditBefore, 'the save still writes an audit record');
});
