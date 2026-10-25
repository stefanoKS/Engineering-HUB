'use strict';

/**
 * V1.3 localization: default language, switching, dictionary integrity and the rule that
 * stored spreadsheet text is never translated.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I18n = require('../shared/i18n.js');
const dashboardFixtures = require('./dashboard-fixtures');
const sync = require('../scripts/sync-i18n.js');

const root = path.resolve(__dirname, '..');
const APP_NAME = '設計・開発課 管理';

function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }

test('the default interface language is Japanese', () => {
  assert.equal(I18n.DEFAULT_LANGUAGE, 'ja');
  assert.equal(I18n.normalize(''), 'ja');
  assert.equal(I18n.normalize('fr'), 'ja');
  assert.equal(I18n.normalize('EN'), 'en');
  assert.equal(I18n.read(), 'ja', 'without browser storage the default is Japanese');
  assert.equal(I18n.t('ja', 'dashboard.filter.status'), '状態');
});

test('the official application name is identical in every language', () => {
  assert.equal(I18n.DICTIONARY.ja['app.name'], APP_NAME);
  assert.equal(I18n.DICTIONARY.en['app.name'], APP_NAME);
  assert.equal(I18n.t('en', 'app.name'), APP_NAME);
  assert.equal(I18n.APP_NAME, APP_NAME);
});

test('both languages define exactly the same non-empty keys', () => {
  const ja = Object.keys(I18n.DICTIONARY.ja).sort();
  const en = Object.keys(I18n.DICTIONARY.en).sort();
  assert.deepEqual(ja, en);
  ja.forEach(key => {
    assert.equal(typeof I18n.DICTIONARY.ja[key], 'string', key);
    assert.ok(I18n.DICTIONARY.ja[key].trim(), 'missing ja text: ' + key);
    assert.ok(I18n.DICTIONARY.en[key].trim(), 'missing en text: ' + key);
  });
});

test('English can be selected and every visible label changes', () => {
  const pairs = [
    ['dashboard.filter.status', '状態', 'Status'],
    ['dashboard.kpi.overdueTasks', '期限超過タスク', 'Overdue tasks'],
    ['request.action.deadline', '納期変更を申請', 'Request deadline change'],
    ['request.action.completion', '完了報告', 'Report completion'],
    ['manager.requests.approve', '承認', 'Approve'],
    ['manager.task.deadline', '完了期限', 'Deadline'],
    ['manager.task.duration', '必要期間', 'Required duration'],
    ['deadline.today', '本日期限', 'Due today']
  ];
  pairs.forEach(([key, ja, en]) => {
    assert.equal(I18n.t('ja', key), ja);
    assert.equal(I18n.t('en', key), en);
  });
});

test('controlled enums and deadline wording are localized, unknown values pass through', () => {
  assert.equal(I18n.status('ja', 'In Progress'), '進行中');
  assert.equal(I18n.status('en', 'In Progress'), 'In progress');
  assert.equal(I18n.health('en', 'RED'), 'Critical');
  assert.equal(I18n.priority('en', 'Critical'), 'Critical');
  assert.equal(I18n.status('en', 'Unknown Status'), 'Unknown Status');
  assert.equal(I18n.deadline('ja', 'overdue', -3), '3日超過');
  assert.equal(I18n.deadline('en', 'overdue', -3), '3 days overdue');
  assert.equal(I18n.deadline('en', 'future', 4), 'in 4 days');
  assert.equal(I18n.deadline('ja', 'none', null), '期限未設定');
  assert.equal(I18n.deadline('en', 'done', null, true), 'Done');
});

test('the generated copies match the canonical dictionary', () => {
  const source = read('shared/i18n.js');
  sync.TARGETS.forEach(target => {
    assert.equal(read(path.relative(root, target.file)), sync.expected(target, source),
      path.relative(root, target.file) + ' is out of date; run npm run sync:i18n');
  });
});

test('stored spreadsheet text is never translated', () => {
  // No key exists for stored content, and no dictionary value contains a stored sample.
  ['AI外観検査設備', '機構設計', '設計 次郎', '光学系の再評価が必要です。'].forEach(stored => {
    assert.equal(I18n.has(stored), false, 'a stored value must not be a translation key');
    assert.equal(I18n.t('en', stored), stored, 'an unknown key is returned unchanged');
    Object.values(I18n.DICTIONARY.en).forEach(value => {
      assert.notEqual(value, stored, 'the dictionary must not contain stored text');
    });
  });
  // Server modules never translate operational values.
  ['src/Requests.gs', 'dashboard-app/RequestService.gs', 'src/SharedDashboardModel.gs'].forEach(file => {
    assert.doesNotMatch(read(file), /EH_I18N/, file + ' must not translate stored values');
  });
});

test('request reasons are stored canonically while the label is localized', () => {
  const source = read('dashboard-app/Client.html');
  const stored = Array.from(source.matchAll(/\{value: '([^']+)', key: '(request\.reason\.[a-z]+)'\}/g))
    .map(match => match[1]);
  const app = require('./helpers').loadDashboard({});
  assert.deepEqual(stored, Array.from(app.context.DashboardRequests.REASONS));
  assert.equal(I18n.t('ja', 'request.reason.technical'), '技術的問題');
  assert.equal(I18n.t('en', 'request.reason.technical'), 'Technical problem');
});

test('switching language keeps the current project, task and filter state', async () => {
  const { viewer } = dashboardFixtures.scenarioFixture();
  const server = {
    dashboardPortfolio: request => viewer.context.dashboardPortfolio(request),
    dashboardProject: (id, options) => viewer.context.dashboardProject(id, options),
    dashboardTask: (projectId, taskId) => viewer.context.dashboardTask(projectId, taskId),
    requestSubmissionConfig: () => ({ok: true, data: {enabled: true}})
  };
  const client = dashboardFixtures.runClient(server);
  await dashboardFixtures.flush();

  // Japanese by default (including the number of result rows).
  assert.match(client.document.getElementById('result-count').textContent, /件を表示/);
  assert.match(client.document.getElementById('sync-info').textContent, /最終同期:/);

  // Open a project so a screen and a selection are active.
  const list = client.document.getElementById('project-list');
  list.dispatchEvent('click', {target: list.childNodes[0].childNodes[0]});
  await dashboardFixtures.flush();
  const titleBefore = client.document.getElementById('detail-title').textContent;
  assert.ok(titleBefore);

  const english = client.buttons.filter(button => button.getAttribute('data-lang') === 'en')[0];
  english.dispatchEvent('click');
  await dashboardFixtures.flush();

  assert.equal(client.store.get('eh.lang'), 'en');
  assert.match(client.document.getElementById('sync-info').textContent, /Last synced:/);
  assert.match(client.document.getElementById('result-count').textContent, /shown/);
  // The project remains open and its stored name is unchanged.
  assert.equal(client.document.getElementById('detail-title').textContent, titleBefore);
  assert.equal(client.document.getElementById('detail').hidden, false);
  assert.doesNotMatch(client.document.getElementById('detail-title').textContent, /Project|プロジェクト/);

  const japanese = client.buttons.filter(button => button.getAttribute('data-lang') === 'ja')[0];
  japanese.dispatchEvent('click');
  await dashboardFixtures.flush();
  assert.equal(client.store.get('eh.lang'), 'ja');
  assert.match(client.document.getElementById('sync-info').textContent, /最終同期:/);
});

test('every required screen carries the visible language switch', () => {
  ['src/UiMenu.html', 'src/UiRequests.html', 'src/UiSettings.html', 'src/UiSystem.html']
    .forEach(file => {
      const content = read(file);
      assert.match(content, /include\('UiLang'\)/, file + ' must include the language switch');
    });
  const lang = read('src/UiLang.html');
  assert.match(lang, /data-lang="ja"/);
  assert.match(lang, /data-lang="en"/);
  assert.match(lang, /日本語/);
  assert.match(lang, /English/);

  const index = read('dashboard-app/Index.html');
  assert.match(index, /data-lang="ja"/);
  assert.match(index, /data-lang="en"/);
  assert.match(index, /include\('I18n'\)/);
});

test('request forms are localized in both languages', () => {
  const client = read('dashboard-app/Client.html');
  ['request.action.deadline', 'request.action.completion', 'request.form.requestedDeadline',
    'request.form.reason', 'request.form.requester', 'request.completion.note',
    'request.confirm.heading', 'request.status.title'].forEach(key => {
    assert.ok(client.indexOf("'" + key + "'") >= 0, 'the request UI must use ' + key);
    assert.ok(I18n.has(key), 'the dictionary must define ' + key);
  });
});

test('no authentication or login interface was introduced', () => {
  ['src/UiMenu.html', 'src/UiRequests.html', 'src/UiSettings.html', 'src/UiSystem.html',
    'dashboard-app/Index.html', 'dashboard-app/Client.html'].forEach(file => {
    const content = read(file);
    assert.doesNotMatch(content, /type="password"/i, file + ' must not contain a password field');
    assert.doesNotMatch(content, /name="password"/i, file + ' must not contain a password field');
    assert.doesNotMatch(content, /<form[^>]+action=/i, file + ' must not post credentials');
  });
  assert.doesNotMatch(read('dashboard-app/RequestService.gs'), /password|credential|token\s*=\s*['"][A-Za-z0-9]{16,}/i);
});

test('translation helpers work without browser storage', () => {
  const sandbox = {module: {exports: {}}};
  vm.runInNewContext(read('shared/i18n.js'), sandbox, {filename: 'shared/i18n.js'});
  const isolated = sandbox.module.exports;
  assert.equal(isolated.read(), 'ja');
  assert.equal(isolated.write('en'), 'en');
  assert.equal(isolated.read(), 'ja', 'without storage the choice falls back to Japanese');
});
