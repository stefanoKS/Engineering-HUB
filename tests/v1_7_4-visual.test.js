'use strict';

/**
 * V1.7.4 visual refresh and project colour hierarchy.
 *
 * A project accent is an identity marker derived from the stable Project_ID by one shared,
 * deterministic helper. It must be the same in the manager application and the employee
 * dashboard, survive filtering and sorting, be inherited by every subproject and task of the
 * project, and never replace a semantic status colour. No colour may cost an extra backend call.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const colors = require('../shared/project-colors.js');
const colorSync = require('../scripts/sync-project-colors.js');
const fixtures = require('./fixtures');
const dashboardFixtures = require('./dashboard-fixtures');
const { harness, flush } = require('./support/manager-web-harness');
const { fixture: managerFixture } = require('../scripts/manager-web-preview');

const ROOT = path.resolve(__dirname, '..');
const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function styleOf(node) {
  return (node && node.getAttribute ? node.getAttribute('style') : '') || '';
}

function accentOf(node) {
  const match = /--project-accent:(#[0-9A-F]{6})/.exec(styleOf(node));
  return match ? match[1] : '';
}

function outlineOf(node) {
  const match = /--project-outline:(rgba\([^)]*\))/.exec(styleOf(node));
  return match ? match[1] : '';
}

function byClass(host, className) {
  return host.descendants().filter(node => String(node.className).split(' ').indexOf(className) >= 0);
}

/** Name → accent of every rendered manager project card. */
function managerCardAccents(host) {
  const map = new Map();
  byClass(host, 'project-card').forEach(card => {
    const name = card.descendants().filter(node => node.tagName === 'H2')[0];
    if (name) map.set(name.textContent, accentOf(card));
  });
  return map;
}

/* ---------------- the shared algorithm ---------------- */

test('every project colour is deterministic from its stable ID', () => {
  ['P0', 'P1', 'P3', 'PC', 'PROJ-001', '設計-案件-1'].forEach(id => {
    const first = colors.colorFor(id);
    assert.ok(colors.PALETTE.indexOf(first) >= 0, id + ' must use a palette value');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      assert.equal(colors.colorFor(id), first, 'the same ID always gets the same colour');
    }
    assert.equal(colors.colorFor('  ' + id + '  '), first, 'padding is not a different project');
    assert.equal(colors.indexFor(id), colors.indexFor(id), 'the palette index is stable');
  });
  assert.equal(colors.colorFor(''), '', 'no ID means no derived colour');
  assert.equal(colors.colorFor(undefined), '');
  assert.equal(colors.colorFor(null), '');
  assert.equal(colors.styleFor(''), '', 'no accent is invented without a project');
});

test('a project ID or name is never trusted as a CSS colour', () => {
  ['#FF0000', '#365E80', 'red', 'rgb(1,2,3)', 'url(javascript:alert(1))', '"><script>x</script>',
    'P1;--project-accent:#FF0000', 'expression(alert(1))'].forEach(input => {
    const value = colors.colorFor(input);
    assert.ok(value === '' || colors.PALETTE.indexOf(value) >= 0, 'only palette values may be returned: ' + input);
    const style = colors.styleFor(input);
    assert.doesNotMatch(style, /[<>"]/, 'no markup can reach a style attribute');
    assert.doesNotMatch(style, /FF0000|javascript|expression|;color/i, 'the input is never echoed');
    assert.ok(style === '' || /^--project-accent:#[0-9A-F]{6};/.test(style), 'the style is built from the palette');
  });
});

test('the palette stays readable and never reuses a responsibility colour', () => {
  assert.ok(colors.PALETTE.length >= 8, 'a small portfolio gets distinct colours');
  assert.equal(new Set(colors.PALETTE).size, colors.PALETTE.length, 'palette entries are unique');
  colors.PALETTE.forEach(color => assert.match(color, /^#[0-9A-F]{6}$/));

  const clientPresets = /var COLOR_PRESETS = \[([\s\S]*?)\];/.exec(read('src/ManagerWebClient.html'));
  assert.ok(clientPresets, 'the responsibility presets stay defined in the client');
  const serverPalette = /PALETTE = \[([\s\S]*?)\]/.exec(read('src/Responsibilities.gs'));
  assert.ok(serverPalette, 'the server keeps its own responsibility palette');
  const responsibilityColours = (clientPresets[1] + serverPalette[1]).match(/#[0-9A-Fa-f]{6}/g)
    .map(value => value.toUpperCase());
  responsibilityColours.forEach(value => {
    assert.equal(colors.PALETTE.indexOf(value), -1,
      'a project accent must not be mistaken for a responsibility colour: ' + value);
  });
});

test('the manager application and the dashboard carry the same generated helper', () => {
  const source = read('shared/project-colors.js');
  colorSync.TARGETS.forEach(target => {
    const relative = path.relative(ROOT, target.file).split(path.sep).join('/');
    assert.ok(fs.existsSync(target.file), relative + ' must exist');
    assert.equal(colorSync.matches(target, source, read(relative)), true,
      relative + ' is out of date; run npm run sync:colors');
  });
  assert.match(read('src/ManagerWebClient.html'), /EH_PROJECT_COLORS\.styleFor/,
    'the manager client uses the shared helper');
  assert.match(read('dashboard-app/Client.html'), /EH_PROJECT_COLORS\.styleFor/,
    'the dashboard client uses the shared helper');
  assert.match(read('src/ManagerWebIndex.html'), /include\('ProjectColors'\)/);
  assert.match(read('dashboard-app/Index.html'), /include\('ProjectColors'\)/);
});

/* ---------------- manager application ---------------- */

function manager() {
  const app = managerFixture();
  const h = harness((write, operation, payload) => (write
    ? app.context.managerWebWrite(operation, payload)
    : app.context.managerWebRead(operation, payload)));
  return { app, h };
}

test('manager project cards, subprojects and tasks share one project accent', async () => {
  const { h } = manager();
  await flush();

  h.click('nav', '案件');
  await flush();
  const content = h.document.getElementById('content');
  const accents = managerCardAccents(content);
  assert.ok(accents.size > 0, 'project cards are rendered');
  accents.forEach((accent, name) => {
    const id = 'P' + name.split(' ').pop();
    assert.equal(accent, colors.colorFor(id), name + ' carries the accent of ' + id);
    assert.ok(accent, name + ' has a visible accent');
  });

  // Opening the detail keeps the same hue for every subproject level.
  const projectId = 'P3';
  const projectAccent = colors.colorFor(projectId);
  const card = byClass(content, 'project-card')
    .filter(node => node.textContent.indexOf('検査装置の設計・製作 3') >= 0)[0];
  assert.ok(card, 'the P3 card is rendered');
  const open = card.descendants().filter(node => node.tagName === 'BUTTON')[0];
  open.dispatchEvent('click', {});
  await flush();

  const trees = byClass(content, 'tree');
  assert.ok(trees.length > 0, 'subproject cards are rendered');
  trees.forEach(node => {
    assert.equal(accentOf(node), projectAccent, 'a subproject inherits the parent project hue');
  });
  const nested = trees.filter(node => String(node.className).indexOf('child') >= 0);
  assert.ok(nested.length > 0, 'a nested subproject exists');
  nested.forEach(node => {
    assert.equal(outlineOf(node), colors.outlineFor(projectId),
      'a nested subproject keeps the same hue at a lighter strength');
  });
});

test('manager task cards, including nested ones, reuse the project accent', async () => {
  const { app, h } = manager();
  const parent = JSON.parse(JSON.stringify(app.context.Tasks.create({
    Project_ID: 'P3', Subproject_ID: 'S6', Task_Name: '詳細設計準備',
    Owner_Member_ID: 'M-ENG', Status: 'In Progress', Due_Date: '2026-01-05'
  })));
  const child = JSON.parse(JSON.stringify(app.context.Tasks.create({
    Project_ID: 'P3', Subproject_ID: 'S6', Parent_Task_ID: parent.Task_ID, Task_Name: '詳細設計の子タスク',
    Owner_Member_ID: 'M-ENG', Status: 'In Progress', Due_Date: '2026-01-05'
  })));
  await flush();

  h.click('nav', 'タスク');
  await flush();
  const content = h.document.getElementById('content');
  const page = app.context.managerWebRead('tasks', {}).data;
  const projectOf = new Map(page.items.map(item => [item.name, item.projectId]));
  projectOf.set(child.Task_Name, 'P3');

  const cards = byClass(content, 'task-card');
  assert.ok(cards.length > 0, 'task cards are rendered');
  cards.forEach(card => {
    const name = card.descendants().filter(node => node.tagName === 'STRONG')[0];
    const text = name ? name.textContent : '';
    const projectId = projectOf.get(text) || (function () {
      const index = /詳細設計タスク (\d+)/.exec(text);
      return index ? 'P' + Math.floor(Number(index[1]) / 10) : '';
    }());
    assert.ok(projectId, 'every rendered task belongs to a project: ' + text);
    assert.equal(accentOf(card), colors.colorFor(projectId), text + ' keeps its project accent');
  });

  const nested = byClass(content, 'task-nested');
  assert.equal(nested.length, 1, 'the subtask renders one level deep');
  assert.equal(accentOf(nested[0]), colors.colorFor('P3'), 'a nested task keeps the project hue');
  assert.match(nested[0].textContent, /詳細設計の子タスク/);
});

test('filtering the manager list never changes a project colour', async () => {
  const { h } = manager();
  await flush();
  h.click('nav', '案件');
  await flush();
  const content = h.document.getElementById('content');
  const before = managerCardAccents(content);
  const sample = Array.from(before.keys())[0];
  assert.ok(sample, 'at least one card exists');

  // A status filter reloads the list from the server; the colour still follows the ID.
  const statusField = h.nodes('content').filter(node => node.name === 'statusField')[0];
  assert.ok(statusField, 'the status filter exists');
  statusField.value = 'Active';
  statusField.dispatchEvent('change', {});
  h.nodes('content').filter(node => node.tagName === 'FORM')[0].dispatchEvent('submit', {preventDefault() {}});
  await flush();

  const after = managerCardAccents(content);
  assert.ok(after.size > 0, 'the filtered list still renders cards');
  after.forEach((accent, name) => {
    if (!before.has(name)) return;
    assert.equal(accent, before.get(name), name + ' keeps its colour after filtering');
  });
});

test('the manager accent costs no extra backend call', async () => {
  const { h } = manager();
  await flush();
  h.click('nav', '案件');
  await flush();
  const calls = h.calls.length;
  const before = managerCardAccents(h.document.getElementById('content'));

  // A language switch re-renders the loaded snapshot locally.
  h.document.getElementById('language').dispatchEvent('click', {});
  await flush();

  assert.equal(h.calls.length, calls, 're-rendering the accents makes no service call');
  const after = managerCardAccents(h.document.getElementById('content'));
  after.forEach((accent, name) => {
    if (!before.has(name)) return;
    assert.equal(accent, before.get(name), 'the colour survives a re-render');
  });
});

test('a responsibility colour never replaces a project accent', async () => {
  const app = fixtures.base({actor: 'admin@example.test', properties: MANAGER_WEB});
  const area = JSON.parse(JSON.stringify(app.context.Responsibilities.create({
    Name: '製品設計', Owner_Member_ID: 'M-MGR', Color_Hex: '#8A5A7A'
  })));
  app.context.Projects.update('P1', {Responsibility_ID: area.Responsibility_ID});
  const h = harness((write, operation, payload) => (write
    ? app.context.managerWebWrite(operation, payload)
    : app.context.managerWebRead(operation, payload)));
  await flush();

  const content = h.document.getElementById('content');
  const areaCard = byClass(content, 'area-card')
    .filter(node => /#8A5A7A/.test(styleOf(node)))[0];
  assert.ok(areaCard, 'the responsibility card keeps its stored colour');
  const projectCard = byClass(content, 'project-card')[0];
  assert.ok(projectCard, 'a project card is rendered');
  assert.equal(accentOf(projectCard), colors.colorFor('P1'), 'the project keeps its own identity colour');
  assert.notEqual(accentOf(projectCard), '#8A5A7A', 'responsibility and project colours stay separate');

  h.click('nav', '案件');
  await flush();
  byClass(h.document.getElementById('content'), 'project-card').forEach(card => {
    assert.notEqual(accentOf(card), '#8A5A7A', 'no project card borrows the responsibility colour');
  });
});

/* ---------------- employee dashboard ---------------- */

function viewerScenario() {
  const app = fixtures.base({actor: 'admin@example.test'});
  app.context.Database.update('PROJECTS', 'P1', {Dashboard_Visibility: 'INTERNAL'});
  app.context.Database.update('PROJECTS', 'P2', {Dashboard_Visibility: 'INTERNAL'});
  app.context.Subprojects.create({
    Subproject_ID: 'S1-CHILD', Project_ID: 'P1', Parent_Subproject_ID: 'S1',
    Subproject_Name: 'カメラ取付設計', Status: 'Active'
  });
  app.context.Tasks.create({
    Task_ID: 'T-PARENT', Project_ID: 'P1', Subproject_ID: 'S1',
    Task_Name: 'カメラ取付準備', Owner_Member_ID: 'M-ENG', Status: 'In Progress', Due_Date: '2026-12-12'
  });
  app.context.Tasks.create({
    Task_ID: 'T-CHILD', Project_ID: 'P1', Subproject_ID: 'S1', Parent_Task_ID: 'T-PARENT',
    Task_Name: 'カメラ取付', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2026-12-10'
  });
  app.context.Tasks.create({
    Task_ID: 'T-NESTED', Project_ID: 'P1', Subproject_ID: 'S1-CHILD',
    Task_Name: 'カメラ取付金具', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2026-12-11'
  });
  const snapshot = dashboardFixtures.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(app);
  app.context.publishSharedDashboard();
  return dashboardFixtures.dashboardFor(snapshot);
}

function employeeServer(viewer) {
  const calls = [];
  const track = (name, fn) => (...args) => {
    calls.push({name, args});
    return fn(...args);
  };
  const server = {
    dashboardPortfolio: track('portfolio', request => viewer.context.dashboardPortfolio(request)),
    dashboardProject: track('project', (id, options) => viewer.context.dashboardProject(id, options)),
    dashboardTask: track('task', (projectId, taskId) => viewer.context.dashboardTask(projectId, taskId)),
    dashboardWorkerTasks: track('workers', request => viewer.context.dashboardWorkerTasks(request)),
    requestSubmissionConfig: track('config', () => ({ok: true, data: {enabled: false}})),
    submitDeadlineRequest: () => ({ok: true, data: {requestId: 'R1', status: 'RECEIVED'}}),
    submitCompletionReport: () => ({ok: true, data: {requestId: 'R2', status: 'RECEIVED'}}),
    requestSubmissionStatus: () => ({ok: false, error: {code: 'REQUEST_NOT_FOUND', message: 'x'}})
  };
  return { server, calls };
}

function portfolioAccents(client) {
  const map = new Map();
  client.document.getElementById('project-list').descendants()
    .filter(node => node.hasAttribute && node.hasAttribute('data-project-id'))
    .forEach(card => map.set(card.getAttribute('data-project-id'), accentOf(card)));
  return map;
}

test('the dashboard card, detail blocks, task rows and worker cards share the project accent', async () => {
  const viewer = viewerScenario();
  const { server } = employeeServer(viewer);
  const client = dashboardFixtures.runClient(server);
  await dashboardFixtures.flush();

  const accents = portfolioAccents(client);
  assert.ok(accents.size > 0, 'the portfolio renders project cards');
  accents.forEach((accent, projectId) => {
    assert.equal(accent, colors.colorFor(projectId), projectId + ' carries its own accent');
    assert.ok(accent, projectId + ' has a visible accent');
  });

  const list = client.document.getElementById('project-list');
  const card = list.descendants().find(node => node.getAttribute('data-project-id') === 'P1');
  list.dispatchEvent('click', {target: card});
  await dashboardFixtures.flush();

  const groups = client.document.getElementById('detail-groups');
  const blocks = byClass(groups, 'group');
  assert.ok(blocks.length > 0, 'subproject groups are rendered');
  blocks.forEach(block => {
    assert.equal(accentOf(block), colors.colorFor('P1'), 'a subproject block inherits the project hue');
  });
  const nested = byClass(groups, 'group-nested');
  assert.ok(nested.length > 0, 'the nested subproject is rendered');
  nested.forEach(block => {
    assert.equal(outlineOf(block), colors.outlineFor('P1'), 'the nested block keeps the same hue');
  });

  const rows = groups.descendants().filter(node => node.tagName === 'TR' && node.hasAttribute('data-task-id'));
  assert.ok(rows.length > 1, 'task rows are rendered, including a nested task');
  rows.forEach(row => {
    assert.equal(accentOf(row), colors.colorFor('P1'), 'a task row carries the project accent');
  });
  const nestedRows = rows.filter(row => row.className.indexOf('task-nested') >= 0 ||
    row.descendants().some(node => String(node.className).indexOf('task-nested') >= 0));
  assert.ok(nestedRows.length > 0, 'a nested task row exists and keeps the same colour');

  client.document.getElementById('view-workers').dispatchEvent('click', {});
  await dashboardFixtures.flush();
  const workerList = client.document.getElementById('worker-list');
  const items = workerList.descendants().filter(node => node.hasAttribute && node.hasAttribute('data-worker-project'));
  assert.ok(items.length > 0, 'the worker view renders task cards');
  items.forEach(item => {
    assert.equal(accentOf(item), colors.colorFor(item.getAttribute('data-worker-project')),
      'a worker task card carries its project accent');
  });
});

test('filtering and sorting the dashboard never changes a project colour', async () => {
  const viewer = viewerScenario();
  const { server } = employeeServer(viewer);
  const client = dashboardFixtures.runClient(server);
  await dashboardFixtures.flush();
  const before = portfolioAccents(client);

  // A local chip filter re-orders and re-renders the loaded portfolio.
  client.document.getElementById('filter-due').dispatchEvent('click', {});
  await dashboardFixtures.flush();
  const filtered = portfolioAccents(client);
  filtered.forEach((accent, projectId) => {
    if (!before.has(projectId)) return;
    assert.equal(accent, before.get(projectId), projectId + ' keeps its colour in a filtered list');
  });

  const status = client.document.getElementById('filter-status');
  status.value = 'active';
  status.dispatchEvent('change', {});
  await dashboardFixtures.flush();
  portfolioAccents(client).forEach((accent, projectId) => {
    if (!before.has(projectId)) return;
    assert.equal(accent, before.get(projectId), projectId + ' keeps its colour after a status filter');
  });

  client.document.getElementById('reset-filters').dispatchEvent('click', {});
  await dashboardFixtures.flush();
  const reset = portfolioAccents(client);
  before.forEach((accent, projectId) => {
    assert.equal(reset.get(projectId), accent, projectId + ' returns with the same colour');
  });
});

test('the dashboard accent costs no extra backend call', async () => {
  const viewer = viewerScenario();
  const { server, calls } = employeeServer(viewer);
  const client = dashboardFixtures.runClient(server);
  await dashboardFixtures.flush();
  const after = calls.length;

  client.document.getElementById('filter-due').dispatchEvent('click', {});
  await dashboardFixtures.flush();
  client.document.getElementById('view-portfolio').dispatchEvent('click', {});
  await dashboardFixtures.flush();

  assert.equal(calls.length, after, 'rendering the accents makes no service call');
});

test('manager and dashboard show the same colour for the same project', async () => {
  const { h } = manager();
  await flush();
  h.click('nav', '案件');
  await flush();
  const managerAccent = managerCardAccents(h.document.getElementById('content'))
    .get('検査装置の設計・製作 1');
  assert.equal(managerAccent, colors.colorFor('P1'));

  const viewer = viewerScenario();
  const client = dashboardFixtures.runClient(employeeServer(viewer).server);
  await dashboardFixtures.flush();
  assert.equal(portfolioAccents(client).get('P1'), managerAccent,
    'the employee dashboard shows the same accent as the manager application');
});

/* ---------------- status, semantics and behaviour ---------------- */

test('warning and approval states keep their own colours and their text', async () => {
  const { h } = manager();
  await flush();
  const content = h.document.getElementById('content');
  const pills = byClass(content, 'pill');
  assert.ok(pills.length > 0, 'status pills are rendered');
  pills.forEach(pill => {
    const kind = pill.className.split(' ').filter(name => /^pill-(green|amber|red|gray)$/.test(name))[0];
    assert.ok(kind, 'every pill keeps a semantic colour class');
    assert.ok(pill.textContent.trim(), 'a pill always carries readable text');
  });
  // The accent is an identity marker and never one of the semantic colours.
  ['#A83E3A', '#8C5A15', '#287348'].forEach(semantic => {
    assert.equal(colors.PALETTE.indexOf(semantic), -1, 'a project colour is never a status colour');
  });
  assert.ok(h.nodes('content').some(node => /健康|Health/.test(node.textContent) || /healthy/i.test(node.textContent)) ||
    byClass(content, 'pill').length > 0, 'health information stays visible');
});

test('the dashboard keeps the health warning next to the stable identity colour', async () => {
  const viewer = viewerScenario();
  const client = dashboardFixtures.runClient(employeeServer(viewer).server);
  await dashboardFixtures.flush();
  byClass(client.document.getElementById('project-list'), 'project-card').forEach(card => {
    assert.equal(accentOf(card), colors.colorFor(card.getAttribute('data-project-id')),
      'the identity colour never becomes a health colour');
    const pill = byClass(card, 'pill')[0];
    assert.ok(pill, 'the health badge stays visible');
    assert.match(pill.className, /pill-(green|amber|red|gray)/, 'the badge keeps its semantic colour');
    assert.ok(pill.textContent.trim(), 'the badge keeps its text');
  });
});

test('the refreshed styles keep wrapping, sizing and reduced-motion rules', () => {
  const managerCss = read('src/ManagerWebStyles.html');
  const dashboardCss = read('dashboard-app/Styles.html');
  [managerCss, dashboardCss].forEach(css => {
    assert.match(css, /prefers-reduced-motion/, 'reduced motion is respected');
    assert.doesNotMatch(css, /overflow-x:\s*hidden/, 'overflow is never masked');
    assert.match(css, /--ui-font/, 'the Japanese-first font stack is a token');
  });
  assert.match(managerCss, /button,input,select\{min-height:44px\}/, 'the manager keeps 44px controls');
  assert.match(dashboardCss, /--tap:\s*44px/, 'the dashboard keeps 44px targets');
  assert.match(managerCss, /--ui-space-4:16px/, 'the spacing scale is shared');
  assert.match(dashboardCss, /overwrap|overflow-wrap: anywhere/, 'long names wrap inside cards');
  assert.match(dashboardCss, /@media \(max-width: 640px\)/, 'the mobile layout is preserved');
  assert.match(managerCss, /@media\(max-width:480px\)/, 'the narrow manager layout is preserved');
});

test('existing project and task operations are unaffected', async () => {
  const { app, h } = manager();
  await flush();
  const created = JSON.parse(JSON.stringify(app.context.Projects.create({
    Project_Name: '配色確認プロジェクト', Project_Owner_ID: 'M-MGR', Status: 'Active'
  })));
  const readBack = app.context.managerWebRead('projects', {});
  assert.equal(readBack.ok, true);
  assert.ok(readBack.data.items.some(row => row.id === created.Project_ID), 'a new project is listed');

  h.click('nav', 'タスク');
  await flush();
  const content = h.document.getElementById('content');
  const text = content.textContent;
  assert.match(text, /進行中|In Progress|未着手|Assigned/, 'the task status is still visible as text');
  assert.match(text, /2026-12-18/, 'the deadline is still visible');
  assert.match(text, /\d+%/, 'the task progress is still visible as text');
  assert.ok(byClass(content, 'task-card').length > 0, 'task cards are still rendered');

  // The project cards keep their accessible progress bar next to the new accent strip.
  h.click('nav', '案件');
  await flush();
  const projects = h.document.getElementById('content');
  const progress = byClass(projects, 'progress');
  assert.ok(progress.length > 0, 'the progress bar is still rendered');
  progress.forEach(bar => {
    assert.equal(bar.getAttribute('role'), 'progressbar');
    assert.ok(bar.getAttribute('aria-valuenow') !== null, 'the progress value stays accessible');
  });
});
