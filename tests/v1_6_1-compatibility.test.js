'use strict';
/**
 * V1.6.1 gate 5: snapshot, contract and deployment compatibility.
 *
 * The employee reader accepted exactly one contract string, so a snapshot published before the
 * manager upgrade became unreadable the moment the reader was updated. Both published contracts
 * are now readable, each through its own exact header row, and an unknown or mixed contract
 * still fails closed. The published completion date is normalized and stored as text, and the
 * deployment runbook names the real entry points in the order that keeps users unaffected.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./fixtures');
const dashboardFixtures = require('./dashboard-fixtures');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_14_TASK_FIELDS = ['taskId', 'projectId', 'subprojectId', 'name', 'ownerName', 'status',
  'priority', 'plannedStart', 'dueDate', 'progress', 'publicNote', 'revision', 'pendingRequest'];

/** Rewrites the published snapshot so it looks exactly like a contract 1.4 snapshot. */
function downgradeTo14(snapshot) {
  const meta = snapshot.getSheetByName('PUBLISHED_META');
  const row = meta.rows.findIndex(cells => cells[0] === 'CONTRACT_VERSION');
  meta.rows[row][1] = '1.4';
  const tasks = snapshot.getSheetByName('PUBLISHED_TASKS_A');
  const headers = tasks.rows[0];
  const drop = headers.map((field, index) => (CONTRACT_14_TASK_FIELDS.indexOf(field) >= 0 ? -1 : index))
    .filter(index => index >= 0)
    .sort((a, b) => b - a);
  drop.forEach(index => {
    // Row 0 is the header array itself, so it is shifted once, by the second splice.
    tasks.rows.slice(1).forEach(cells => cells.splice(index, 1));
    headers.splice(index, 1);
  });
  const areas = snapshot.getSheetByName('PUBLISHED_RESPONSIBILITIES_A');
  const colorColumn = areas.rows[0].indexOf('color');
  if (colorColumn >= 0) areas.rows.forEach(cells => cells.splice(colorColumn, 1));
  return snapshot;
}

function published() {
  const manager = fixtures.base();
  manager.context.Database.update('PROJECTS', 'P1', {Dashboard_Visibility: 'INTERNAL'});
  const snapshot = dashboardFixtures.attachSnapshot(manager);
  manager.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(manager);
  manager.context.publishSharedDashboard();
  return {manager, snapshot};
}

test('a contract 1.4 snapshot stays readable by the new employee reader', () => {
  const {snapshot} = published();
  downgradeTo14(snapshot);
  const viewer = dashboardFixtures.dashboardFor(snapshot);
  const portfolio = viewer.context.dashboardPortfolio({query: ''});
  assert.equal(portfolio.ok, true, JSON.stringify(portfolio));
  assert.equal(portfolio.data.meta.contractVersion, '1.4');
  const project = portfolio.data.projects[0];
  assert.ok(project, 'the published project is readable');
  const detail = viewer.context.dashboardProject(project.projectId);
  assert.equal(detail.ok, true, JSON.stringify(detail));
  const task = detail.data.tasks[0];
  assert.equal(task.container, false, 'a 1.4 row has no container flag and is ordinary work');
  assert.equal(task.parentTaskId, '');
  assert.equal(task.completedAt, '');
});

test('a snapshot is read through its own published header row', () => {
  const {snapshot} = published();
  const viewer = dashboardFixtures.dashboardFor(snapshot);
  const portfolio = viewer.context.dashboardPortfolio({query: ''});
  assert.equal(portfolio.ok, true, JSON.stringify(portfolio));
  assert.equal(portfolio.data.meta.contractVersion, viewer.context.DashboardData.CONTRACT_VERSION);
});

test('an unknown or mixed contract still fails closed', () => {
  const {snapshot} = published();
  const meta = snapshot.getSheetByName('PUBLISHED_META');
  const row = meta.rows.findIndex(cells => cells[0] === 'CONTRACT_VERSION');
  const original = meta.rows[row][1];

  meta.rows[row][1] = '1.3';
  let result = dashboardFixtures.dashboardFor(snapshot).context.dashboardPortfolio({query: ''});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SNAPSHOT_CONTRACT_UNSUPPORTED');

  // A 1.4 header row with the extra 1.5 columns is not the 1.4 contract.
  meta.rows[row][1] = '1.4';
  result = dashboardFixtures.dashboardFor(snapshot).context.dashboardPortfolio({query: ''});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SNAPSHOT_CONTRACT_UNSUPPORTED');

  meta.rows[row][1] = original;
  result = dashboardFixtures.dashboardFor(snapshot).context.dashboardPortfolio({query: ''});
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('the published completion date is normalized and stored as text', () => {
  const manager = fixtures.base();
  manager.context.Database.update('PROJECTS', 'P1', {Dashboard_Visibility: 'INTERNAL'});
  const snapshot = dashboardFixtures.attachSnapshot(manager);
  manager.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(manager);
  fixtures.activate(manager);
  fixtures.complete(manager, 'T2');
  assert.equal(manager.context.publishSharedDashboard().published, true);

  const publisher = manager.context.SharedDashboardPublisher;
  assert.equal(publisher.DATE_FIELDS.indexOf('completedAt') >= 0, true,
    'the completion date is normalized and formatted like every other contract date');
  const sheet = snapshot.getSheetByName('PUBLISHED_TASKS_A');
  const column = sheet.rows[0].indexOf('completedAt');
  assert.equal(column >= 0, true);
  const row = sheet.rows.filter((cells, index) => index > 0 && cells[0] === 'T2')[0];
  assert.match(String(row[column]), /^\d{4}-\d{2}-\d{2}$/, 'no timezone suffix leaks into the snapshot');

  const viewer = dashboardFixtures.dashboardFor(snapshot);
  const portfolio = viewer.context.dashboardPortfolio({query: ''});
  assert.equal(portfolio.ok, true, JSON.stringify(portfolio));
  const detail = viewer.context.dashboardProject(portfolio.data.projects[0].projectId);
  assert.equal(detail.ok, true, JSON.stringify(detail));
  const task = detail.data.tasks.filter(item => item.taskId === 'T2')[0];
  assert.match(String(task.completedAt), /^\d{4}-\d{2}-\d{2}$/);
});

test('the employee reader refuses a container completion report without a server round trip', () => {
  const manager = fixtures.base();
  manager.context.Database.update('PROJECTS', 'P1', {Dashboard_Visibility: 'INTERNAL'});
  const snapshot = dashboardFixtures.attachSnapshot(manager);
  manager.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(manager);
  manager.context.Tasks.create({
    Task_ID: 'T-BOX', Project_ID: 'P1', Task_Name: '装置一式', Owner_Member_ID: 'M-ENG',
    Status: 'In Progress', Due_Date: '2026-12-20'
  });
  manager.context.Tasks.create({
    Task_ID: 'T-BOX1', Project_ID: 'P1', Parent_Task_ID: 'T-BOX', Task_Name: '子作業',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2026-12-10'
  });
  manager.context.publishSharedDashboard();

  const viewer = dashboardFixtures.dashboardFor(snapshot);
  const target = viewer.context.DashboardData.requestTarget('T-BOX');
  assert.equal(target.container, true, 'the published container flag reaches the request service');
  assert.equal(target.contract, viewer.context.DashboardData.CONTRACT_VERSION);
  assert.equal(viewer.context.DashboardData.requestTarget('T-BOX1').container, false);
});

test('the deployment runbook names the real entry points in the safe order', () => {
  const runbook = fs.readFileSync(path.join(ROOT, 'docs', 'V1_6_DEPLOYMENT_RUNBOOK.md'), 'utf8');
  assert.match(runbook, /createDatabaseBackup\(\)/, 'the runbook names the exported backup entry point');
  assert.doesNotMatch(runbook, /`createBackup\(\)`/, 'a non-existent entry point is not documented');
  assert.match(runbook, /reconcileDeletions\('RECONCILE DELETIONS'\)/);
  assert.match(runbook, /reads contracts \*\*1\.4 and 1\.5\*\*/);
  const push = runbook.indexOf('npx clasp push');
  const migrate = runbook.indexOf('upgradeExistingDatabase()');
  assert.equal(push >= 0 && migrate >= 0, true, 'both steps are documented');
  assert.equal(push < migrate, true, 'the head code is pushed before the migration runs');
  assert.equal(runbook.indexOf('Do **not** create a deployment') > 0, true,
    'the deployment is untouched while the migration runs');
});
