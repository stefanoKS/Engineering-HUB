'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./fixtures');

test('version 3 upgrade preserves every pre-existing operational cell and cannot skip its backup', () => {
  const app = fixtures.base();
  const context = app.context;
  const db = context.Database;

  const tasks = app.book.getSheetByName('TASKS');
  tasks.rows[0].push('Manual_Note');
  tasks.rows.slice(1).forEach((row, index) => row.push(index === 0 ? '=1+1' : 'keep'));

  // Emulate a version-2 workbook: no V1.1 tables and columns.
  app.book.sheets = app.book.sheets.filter(sheet => ['PROJECT_PHASES', 'SCHEDULE_CONFIRMATIONS'].indexOf(sheet.getName()) < 0);
  for (const [table, field] of [['PROJECTS', 'Notification_Enabled'], ['MEMBERS', 'Role']]) {
    const sheet = app.book.getSheetByName(table);
    const column = sheet.rows[0].indexOf(field);
    if (column >= 0) sheet.rows.forEach(row => row.splice(column, 1));
  }
  const history = app.book.getSheetByName('SCHEMA_MIGRATIONS');
  history.rows = [history.rows[0], ['INITIALIZE_V2', new Date().toISOString(), 0, 2, 'SUCCESS', 'NEW_EMPTY_DATABASE']];

  const before = JSON.parse(JSON.stringify(context.Backup.snapshot(app.book)));
  app.properties.setProperty('APPROVED_MIGRATIONS', '003_management_reliability,004_shared_dashboard,005_task_planning_and_requests,006_responsibilities_and_nested_subprojects,007_responsibility_hierarchy_and_lifecycle,008_task_and_responsibility_members');
  assert.equal(context.upgradeExistingDatabase(), 8);

  for (const old of before) {
    if (['SCHEMA_MIGRATIONS', 'BACKUP_LOG', 'AUTOMATION_SETTINGS'].includes(old.name)) continue;
    const values = app.book.getSheetByName(old.name).getDataRange().getValues();
    old.values.forEach((row, r) => row.forEach((cell, c) => assert.deepEqual(values[r][c], cell,
      `${old.name} row ${r + 1} column ${c + 1} changed`)));
  }

  assert.equal(app.backups.length, 6, 'each migration takes a verified backup');
  assert.ok(app.book.getSheetByName('PROJECT_PHASES'));
  assert.ok(app.book.getSheetByName('SCHEDULE_CONFIRMATIONS'));
  assert.equal(db.find('TASKS', 'T1').Task_Name, '機構設計');
  assert.equal(db.find('TASKS', 'T1').Manual_Note, '=1+1');
  assert.equal(db.find('TASKS', 'T2').Manual_Note, 'keep');
  assert.equal(db.find('PROJECTS', 'P1').Project_Name, '検査装置');
  assert.equal(db.find('MEMBER_SKILLS', 'missing'), null);
  // Existing members are not silently promoted to a privileged role.
  assert.equal(db.find('MEMBERS', 'M-ADMIN').Role, '');
  assert.equal(context.Roles.normalize(db.find('MEMBERS', 'M-ADMIN').Role), 'VIEWER');
});

test('management views remain usable at the V1.1 target scale (local mock benchmark only)', () => {
  const app = fixtures.app();
  const context = app.context;
  const today = '2026-11-02';
  const members = [], projects = [], subprojects = [], tasks = [], milestones = [], issues = [];

  for (let m = 0; m < 100; m++) {
    members.push({ Member_ID: `MX${m}`, Name: `Member ${m}`, Email: `member${m}@example.test`, Active: true,
      Role: m === 0 ? 'ADMIN' : 'MEMBER', Weekly_Capacity_Hours: 40 });
  }
  for (let p = 0; p < 100; p++) {
    projects.push({ Project_ID: `PX${p}`, Project_Name: `Project ${p}`, Status: p % 10 === 9 ? 'Archived' : 'Active',
      Project_Owner_ID: 'MX0', Planned_Start: '2026-10-01', Committed_Deadline: '2026-12-31',
      Last_Updated: '2026-11-01T00:00:00.000Z' });
  }
  for (let s = 0; s < 500; s++) {
    subprojects.push({ Subproject_ID: `SX${s}`, Project_ID: `PX${s % 100}`, Subproject_Name: `Sub ${s}`, Status: 'Active' });
  }
  for (let t = 0; t < 5000; t++) {
    tasks.push({
      Task_ID: `TX${t}`, Project_ID: `PX${t % 100}`,
      Subproject_ID: t % 2 ? `SX${t % 500}` : '', Task_Name: `Task ${t}`,
      Owner_Member_ID: `MX${t % 100}`, Status: t % 7 === 0 ? 'Done' : 'In Progress',
      Progress_Percent: t % 7 === 0 ? 100 : t % 90, Planned_Start: '2026-11-02', Due_Date: '2026-12-15',
      Estimated_Hours: t % 5 === 0 ? '' : 8 + (t % 40), Actual_Hours: t % 3, Notification_Enabled: false
    });
  }
  for (let ms = 0; ms < 100; ms++) {
    milestones.push({ Milestone_ID: `MSX${ms}`, Project_ID: `PX${ms}`, Milestone_Name: `Gate ${ms}`, Target_Date: '2026-12-20' });
  }
  for (let issue = 0; issue < 50; issue++) {
    issues.push({ Issue_ID: `IX${issue}`, Project_ID: `PX${issue % 100}`, Description: `Issue ${issue}`,
      Severity: issue % 10 === 0 ? 'Critical' : 'Medium', Status: 'Open' });
  }

  fixtures.bulk(app, 'MEMBERS', members);
  fixtures.bulk(app, 'PROJECTS', projects);
  fixtures.bulk(app, 'SUBPROJECTS', subprojects);
  fixtures.bulk(app, 'TASKS', tasks);
  fixtures.bulk(app, 'MILESTONES', milestones);
  fixtures.bulk(app, 'ISSUES', issues);

  const timings = {};
  let started = Date.now();
  const metrics = context.Dashboard.refresh(today);
  timings.dashboardRefresh = Date.now() - started;

  started = Date.now();
  context.Dashboard.analyze(today);
  timings.analysis = Date.now() - started;

  started = Date.now();
  context.Planning.workloadData(today);
  timings.workload = Date.now() - started;

  started = Date.now();
  context.Progress.refresh();
  timings.progressRollup = Date.now() - started;

  started = Date.now();
  const scanResult = context.scanNotifications(`${today}T03:00:00Z`);
  timings.notificationScan = Date.now() - started;

  console.log('V1.1 scale timings (mock, not Workspace):', JSON.stringify(timings));

  assert.equal(metrics.activeProjects, 90);
  assert.equal(metrics.archivedProjects, 10);
  assert.equal(scanResult.mode, 'OFF', 'seeded defaults keep mail off at scale');
  assert.ok(metrics.unknownEstimateTasks > 0);
  assert.ok(timings.dashboardRefresh < 30000, `dashboard refresh took ${timings.dashboardRefresh}ms`);
  assert.ok(timings.analysis < 20000, `analysis took ${timings.analysis}ms`);
  assert.ok(timings.workload < 15000, `workload took ${timings.workload}ms`);
  assert.ok(timings.progressRollup < 15000, `progress rollup took ${timings.progressRollup}ms`);
  assert.ok(timings.notificationScan < 30000, `notification scan took ${timings.notificationScan}ms`);
  assert.equal(app.sentEmails.length, 0);
  assert.equal(app.triggers.length, 0);
});

test('source and repository stay free of credentials, live identifiers and stray send paths', () => {
  const root = path.resolve(__dirname, '..');
  const sourceDir = path.join(root, 'src');
  const files = fs.readdirSync(sourceDir);
  assert.ok(files.filter(name => name.endsWith('.gs')).length >= 20);
  assert.ok(files.filter(name => name.endsWith('.html')).length >= 3, 'bound UI templates are packaged');

  for (const name of files) {
    const content = fs.readFileSync(path.join(sourceDir, name), 'utf8');
    assert.doesNotMatch(content, /BEGIN [A-Z ]*PRIVATE KEY/, `${name} contains a private key`);
    assert.doesNotMatch(content, /client_secret|refresh_token|ya29\.|AIza[0-9A-Za-z_-]{30}/, `${name} contains credentials`);
    // A hard-coded Google identifier is a long opaque token. Versioned migration IDs are
    // long too, but they are snake_case words, so they are allowed explicitly.
    const opaque = /["']([0-9][A-Za-z0-9_-]{32,})["']/g;
    let token;
    while ((token = opaque.exec(content)) !== null) {
      assert.match(token[1], /^[0-9]+(_[a-z][a-z0-9]*)+$/,
        `${name} contains a hard-coded Google identifier`);
    }
    assert.doesNotMatch(content, /@gmail\.com/, `${name} contains a real mailbox`);
  }
  for (const name of files.filter(item => item.endsWith('.gs'))) {
    const content = fs.readFileSync(path.join(sourceDir, name), 'utf8');
    if (name !== 'Notifications.gs') {
      assert.doesNotMatch(content, /MailApp\s*\.\s*sendEmail\s*\(/, `${name} bypasses the central mail gate`);
    }
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'appsscript.json'), 'utf8'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.send_mail'));
  assert.equal(require('./support/repository').tracked(root, '.clasp.json'), false);
  assert.equal(require('./support/repository').tracked(root, '.clasprc.json'), false);
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /\.clasp\.json/);

  const required = [
    'docs/AUTOMATION_SETTINGS.md', 'docs/MANAGER_WORKFLOW.md', 'docs/GOOGLE_WORKSPACE_SMOKE_TEST.md',
    'docs/PRODUCTION_READINESS.md', 'docs/SECURITY_MODEL.md', 'docs/OPERATIONS_RUNBOOK.md',
    'docs/checkgates/GATE_1.md', 'docs/checkgates/GATE_2.md', 'docs/checkgates/GATE_3.md',
    'docs/checkgates/GATE_4.md', 'docs/checkgates/GATE_5.md', 'docs/checkgates/GATE_6.md',
    'docs/checkgates/SECURITY_HARDENING.md', 'docs/checkgates/AUTOMATION_HARDENING.md',
    'docs/checkgates/CORRECTNESS_HARDENING.md',
    'AGENTS.md', 'ARCHITECTURE.md', 'DATA_SCHEMA.md', 'DEPLOYMENT.md', 'BACKUP_RESTORE.md', 'CHANGELOG.md'
  ];
  for (const file of required) assert.ok(fs.existsSync(path.join(root, file)), `missing documentation: ${file}`);

  // Documentation must not claim live verification that never happened.
  const readiness = fs.readFileSync(path.join(root, 'docs/PRODUCTION_READINESS.md'), 'utf8');
  assert.match(readiness, /NOT APPROVED FOR PRODUCTION/);
  assert.match(readiness, /UNVERIFIED/);
});

test('default configuration stays conservative for a fresh workbook', () => {
  const app = fixtures.app();
  const values = app.context.AutomationSettings.get();
  assert.equal(values.EMAIL_MODE, 'OFF');
  assert.equal(values.EMERGENCY_STOP, true);
  for (const key of ['ASSIGNMENT_EMAIL_ENABLED', 'REASSIGNMENT_EMAIL_ENABLED', 'DEADLINE_CHANGE_EMAIL_ENABLED',
    'DEADLINE_REMINDER_ENABLED', 'OVERDUE_REMINDER_ENABLED', 'WEEKLY_MANAGER_REPORT_ENABLED',
    'CALENDAR_SYNC_ENABLED', 'DAILY_BACKUP_ENABLED', 'AUTO_DASHBOARD_REFRESH_ENABLED', 'AUTO_WORKLOAD_REFRESH_ENABLED']) {
    assert.equal(values[key], false, `${key} must default to false`);
  }
  assert.equal(values.REMINDER_OFFSETS.slice().join(','), '7,2');
  assert.equal(app.context.Config.get().emailEnabled, false);
  assert.equal(app.context.Config.get().dryRun, true);
  assert.equal(app.sentEmails.length + app.triggers.length + app.calendarEvents.length, 0);
});
