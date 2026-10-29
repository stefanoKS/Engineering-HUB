'use strict';

/**
 * V1.7.5 response-contract tests.
 *
 * A payload from Apps Script is remote input. A required list that is missing, null or not an
 * array must be reported as a contract error with a retry — never rendered as "no records" and
 * never as an unhandled TypeError. A documented-optional list must still become "none".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./fixtures');
const dashboard = require('./dashboard-fixtures');
const { harness } = require('./support/manager-web-harness');
const { createMenu } = require('./support/menu-harness');

const DOMAIN = { MANAGER_WEB_ALLOWED_DOMAINS: 'example.test' };
const EMPTY = '対象のデータはありません';

function manager() { return fixtures.base({ actor: 'manager@example.test', properties: DOMAIN }); }
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let index = 0; index < 40; index += 1) await tick(); }
const content = h => h.document.getElementById('content').textContent;
const notice = h => h.document.getElementById('notice').textContent;

function clientOf(app, options) {
  return harness((write, operation, payload) => write
    ? app.context.managerWebWrite(operation, payload)
    : app.context.managerWebRead(operation, payload), options || {});
}

async function bootClient(h, app) {
  await tick();
  h.waiting.shift().success(app.context.managerWebRead('bootstrap'));
  await settle();
}

/* ------------------------------------------------------------------ *
 * Manager application
 * ------------------------------------------------------------------ */

test('a list without its items is a contract error, not an empty list', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await bootClient(h, app);

  h.click('nav', 'メンバー');
  await settle();
  h.waiting.shift().success({ ok: true, data: { items: { M1: 'x' }, total: 1 } });
  await settle();

  assert.match(notice(h), /INVALID_RESPONSE/, 'the broken contract is reported');
  assert.match(notice(h), /members\.items/, 'the message names the missing field');
  assert.doesNotMatch(content(h), new RegExp(EMPTY), 'a false empty state is never claimed');
  assert.match(content(h), /再試行/, 'the page offers a retry');
});

test('a requests payload without the queue is reported instead of shown as empty', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await bootClient(h, app);

  h.click('nav', '申請');
  await settle();
  h.waiting.shift().success({ ok: true, data: { requests: null, counts: {}, configured: true } });
  await settle();

  assert.match(notice(h), /INVALID_RESPONSE/);
  assert.match(notice(h), /requests/);
  assert.doesNotMatch(content(h), new RegExp(EMPTY));
});

test('a valid empty list renders the empty state and no error', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await bootClient(h, app);

  h.click('nav', 'メンバー');
  await settle();
  h.waiting.shift().success({ ok: true, data: { items: [], total: 0, offset: 0, limit: 50 } });
  await settle();

  assert.doesNotMatch(notice(h), /INVALID_RESPONSE/);
  assert.match(content(h), new RegExp(EMPTY), 'an empty result is displayed as empty');
});

test('an optional list may be absent and is normalized to none', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await bootClient(h, app);

  h.click('nav', '申請');
  await settle();
  h.waiting.shift().success({ ok: true, data: { requests: [], configured: true } });
  await settle();

  assert.doesNotMatch(notice(h), /INVALID_RESPONSE/, 'a documented-optional field may be absent');
  assert.match(content(h), new RegExp(EMPTY));
  assert.equal(h.waiting.length, 1, 'the page still performs its single import');
  assert.equal(h.waiting[0].operation, 'requestSync');
});

test('a detail payload without a record never opens a form and reports the contract', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await bootClient(h, app);
  h.click('nav', 'タスク');
  await settle();
  h.waiting.shift().success(app.context.managerWebRead('taskIndex'));
  await settle();

  h.click('content', '編集');
  await settle();
  h.waiting.shift().success({ ok: true, data: {} });
  await settle();

  assert.equal(h.window.ManagerWebClient.editor(), null, 'no form is opened from a broken payload');
  assert.match(notice(h), /INVALID_RESPONSE/);
});

test('a snapshot without a project list is reported and offers a retry', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await tick();
  h.waiting.shift().success({ ok: true, data: { tasks: { total: 0, complete: true, limit: 3000 } } });
  await settle();

  assert.match(notice(h), /INVALID_RESPONSE/);
  assert.match(content(h), /再試行/);
});

test('a planning answer without warnings is treated as no warnings', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await bootClient(h, app);
  h.click('nav', 'タスク');
  await settle();
  h.waiting.shift().success(app.context.managerWebRead('taskIndex'));
  await settle();
  h.click('content', '編集');
  await settle();
  h.waiting.shift().success(app.context.managerWebRead('task', { id: 'T1' }));
  await settle();
  while (h.waiting.length) {
    const call = h.waiting.shift();
    call.success(app.context.managerWebRead(call.operation, call.payload));
    await settle();
  }

  h.click('formHost', '予定日を計算');
  await settle();
  const plan = h.waiting.shift();
  assert.equal(plan.operation, 'plan');
  plan.success({ ok: true, data: { startDate: '2026-12-01', endDate: '2026-12-15' } });
  await settle();

  const form = h.document.getElementById('formHost').textContent;
  assert.match(form, /2026-12-01/, 'the plan is shown');
  assert.doesNotMatch(notice(h), /INVALID_RESPONSE/, 'an absent optional list is not an error');
});

/* ------------------------------------------------------------------ *
 * Bound sidebars
 * ------------------------------------------------------------------ */

function withStubs(app, stubs) {
  Object.keys(stubs).forEach(name => { app.context[name] = stubs[name]; });
  return app;
}

test('the request sidebar reports a broken queue instead of claiming there are none', () => {
  const app = withStubs(manager(), {
    uiRequests: () => ({ ok: true, data: { requests: null, history: [], counts: {} } })
  });
  const page = createMenu(app, { template: 'UiRequests' });
  const status = page.status().textContent;
  assert.match(status, /INVALID_RESPONSE/);
  assert.match(status, /requests/);
  assert.doesNotMatch(page.texts('requests'), /申請はありません/);
});

test('the request sidebar accepts an absent history list', () => {
  const app = withStubs(manager(), {
    uiRequests: () => ({ ok: true, data: { requests: [], counts: {}, configured: true } })
  });
  const page = createMenu(app, { template: 'UiRequests' });
  assert.doesNotMatch(page.status().textContent, /INVALID_RESPONSE/);
  assert.equal(page.texts('history').length > 0, true, 'the history block renders its empty hint');
});

test('the system sidebar reports a payload without trigger facts', () => {
  const app = withStubs(manager(), {
    uiSystemStatus: () => ({ ok: true, data: { health: { environment: 'DEV' }, valid: true, rowCounts: {} } })
  });
  const page = createMenu(app, { template: 'UiSystem' });
  assert.match(page.status().textContent, /INVALID_RESPONSE/);
  assert.match(page.status().textContent, /triggers/);
  assert.doesNotMatch(page.texts('facts'), /OK/);
});

test('the system sidebar accepts empty trigger lists', () => {
  const app = withStubs(manager(), {
    uiSystemStatus: () => ({ ok: true, data: {
      health: { environment: 'DEV', emailMode: 'OFF', automationConfigured: true },
      valid: true, errorCount: 0, rowCounts: {},
      triggers: { installed: [], missing: [], obsolete: [], duplicates: [], scheduleMatches: true }
    } })
  });
  const page = createMenu(app, { template: 'UiSystem' });
  assert.doesNotMatch(page.status().textContent, /INVALID_RESPONSE/);
  assert.match(page.texts('triggerFacts'), /0/);
});

test('the settings sidebar treats publication warnings as optional and counts as required', () => {
  const app = manager();
  const valid = withStubs(app, {
    uiAutomationSettings: () => ({ ok: true, data: { settings: [], history: [] } }),
    uiPublicationStatus: () => ({ ok: true, data: { enabled: false, destinationConfigured: false } }),
    uiPublicationPreview: () => ({ ok: true, data: { initialized: false, counts: { PROJECT_COUNT: 2, TASK_COUNT: 5 }, excluded: { projects: 1 } } })
  });
  const page = createMenu(valid, { template: 'UiSettings' });
  page.context.previewPublication();
  assert.doesNotMatch(page.status().textContent, /INVALID_RESPONSE/);
  assert.match(page.texts('publicationPreview'), /2 \/ 5/);

  const broken = withStubs(manager(), {
    uiAutomationSettings: () => ({ ok: true, data: { settings: [], history: [] } }),
    uiPublicationStatus: () => ({ ok: true, data: { enabled: false, destinationConfigured: false } }),
    uiPublicationPreview: () => ({ ok: true, data: { initialized: false, excluded: { projects: 1 } } })
  });
  const brokenPage = createMenu(broken, { template: 'UiSettings' });
  brokenPage.context.previewPublication();
  assert.match(brokenPage.status().textContent, /INVALID_RESPONSE/);
});

test('the menu sidebar reports a payload without the member directory', () => {
  const app = withStubs(manager(), {
    uiContext: () => ({ ok: true, data: { actor: { email: 'manager@example.test', role: 'MANAGER' }, projects: [], skills: [], tasks: [] } })
  });
  const page = createMenu(app, { template: 'UiMenu' });
  assert.match(page.status().textContent, /INVALID_RESPONSE/);
  assert.match(page.status().textContent, /members/);
});

test('the menu sidebar accepts empty directories', () => {
  const app = withStubs(manager(), {
    uiContext: () => ({ ok: true, data: {
      actor: { email: 'manager@example.test', role: 'MANAGER' },
      members: [], projects: [], skills: [], responsibilities: [], subprojects: [], tasks: [], roles: ['MEMBER']
    } })
  });
  const page = createMenu(app, { template: 'UiMenu' });
  assert.doesNotMatch(page.status().textContent, /INVALID_RESPONSE/);
});

/* ------------------------------------------------------------------ *
 * Shared dashboard
 * ------------------------------------------------------------------ */

function dashboardServer(overrides) {
  const stub = () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'x' } });
  return Object.assign({
    dashboardPortfolio: stub, dashboardProject: stub, dashboardTask: stub,
    submitDeadlineRequest: stub, submitCompletionReport: stub,
    requestSubmissionStatus: stub, requestSubmissionConfig: () => ({ ok: true, data: { enabled: false } }),
    dashboardWorkerTasks: () => ({ ok: true, data: { tasks: [], workers: [], projects: [], responsibilities: [], total: 0, offset: 0, limit: 20 } })
  }, overrides);
}

test('a portfolio without a project list shows the error block, never an empty portfolio', async () => {
  const client = dashboard.runClient(dashboardServer({
    dashboardPortfolio: () => ({ ok: true, data: { projects: 'nope', meta: {}, indicators: {}, filters: {} } })
  }));
  await dashboard.flush();
  assert.equal(client.document.getElementById('overview-error').hidden, false);
  assert.match(client.document.getElementById('overview-error-detail').textContent, /INVALID_RESPONSE/);
  assert.equal(client.document.getElementById('project-list').hidden, true);
});

test('a portfolio without a payload shows the error block', async () => {
  const client = dashboard.runClient(dashboardServer({ dashboardPortfolio: () => ({ ok: true }) }));
  await dashboard.flush();
  assert.equal(client.document.getElementById('overview-error').hidden, false);
  assert.equal(client.document.getElementById('project-list').hidden, true);
});

test('an empty project list is an empty state, not an error', async () => {
  const client = dashboard.runClient(dashboardServer({
    dashboardPortfolio: () => ({ ok: true, data: { projects: [], meta: {}, indicators: {}, filters: {} } })
  }));
  await dashboard.flush();
  assert.equal(client.document.getElementById('overview-error').hidden, true);
  assert.equal(client.document.getElementById('project-list').hidden, true);
});

test('a worker payload without tasks is reported instead of showing no work', async () => {
  const scenario = dashboard.scenarioFixture();
  const client = dashboard.runClient(dashboardServer({
    dashboardPortfolio: request => scenario.viewer.context.dashboardPortfolio(request),
    dashboardProject: (id, options) => scenario.viewer.context.dashboardProject(id, options),
    dashboardTask: (projectId, taskId) => scenario.viewer.context.dashboardTask(projectId, taskId),
    dashboardWorkerTasks: () => ({ ok: true, data: { workers: [], projects: [], responsibilities: [], total: 0, offset: 0, limit: 20 } })
  }));
  await dashboard.flush();
  client.document.getElementById('view-workers').dispatchEvent('click', {});
  await dashboard.flush();
  assert.equal(client.document.getElementById('worker-error').hidden, false);
  assert.match(client.document.getElementById('worker-error-detail').textContent, /INVALID_RESPONSE/);
});

/* ------------------------------------------------------------------ *
 * The guards themselves
 * ------------------------------------------------------------------ */

test('the sidebar guard helpers reject non-arrays and normalize absent lists', () => {
  const app = manager();
  const page = createMenu(app, { template: 'UiMenu' });
  const EH = page.context.EH;
  assert.deepEqual(page.context.JSON ? [] : [], []);
  assert.throws(() => EH.requireArray(null, 'x'), /INVALID_RESPONSE: expected array for x/);
  assert.throws(() => EH.requireArray({ length: 0 }, 'x'), /INVALID_RESPONSE/);
  assert.equal(EH.requireArray([], 'x').length, 0);
  assert.equal(EH.optionalArray(undefined, 'x').length, 0);
  assert.throws(() => EH.optionalArray('a', 'x'), /INVALID_RESPONSE/);
  assert.throws(() => EH.requireObject([], 'x'), /INVALID_RESPONSE/);
  assert.equal(EH.requireObject({ a: 1 }, 'x').a, 1);
});

test('every sidebar template reports a render contract failure', () => {
  const root = path.resolve(__dirname, '..');
  ['UiRequests', 'UiSystem', 'UiSettings', 'UiMenu'].forEach(name => {
    const html = fs.readFileSync(path.join(root, 'src', name + '.html'), 'utf8');
    assert.match(html, /catch \(error\) \{ setStatus\(/,
      name + ' reports a render contract failure instead of crashing');
  });
  const safe = fs.readFileSync(path.join(root, 'src', 'UiSafe.html'), 'utf8');
  ['requireArray', 'optionalArray', 'requireObject'].forEach(name => {
    assert.match(safe, new RegExp('function ' + name + '\\('));
  });
});
