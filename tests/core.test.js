'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers');

function ready(options = {}) {
  const app = loadApp({ properties: { BACKUP_FOLDER_ID: 'restricted-backups', ...options.properties }, ...options });
  app.context.initializeNewDatabase('INITIALIZE test-db');
  return app;
}

function oldDatabase() {
  const app = ready();
  const db = app.context.Database;
  db.insert('MEMBERS', { Member_ID: 'M001', Name: '架空 太郎', Email: 'fictional@example.test', Active: true });
  db.insert('PROJECTS', { Project_ID: 'P001', Project_Name: 'Inspection cell', Status: 'Active', Project_Owner_ID: 'M001' });
  db.insert('SKILLS', { Skill_ID: 'S001', Skill_Name: 'Machine vision' });
  db.insert('MEMBER_SKILLS', { Member_Skill_ID: 'MS001', Member_ID: 'M001', Skill_ID: 'S001', Current_Level: 3 });
  db.insert('TASKS', { Task_ID: 'T001', Project_ID: 'P001', Task_Name: 'Camera selection', Owner_Member_ID: 'M001', Status: 'Assigned', Progress_Percent: 25 });
  const history = app.book.getSheetByName('SCHEMA_MIGRATIONS');
  history.rows[1][history.rows[0].indexOf('New_Version')] = 1;
  const tasks = app.book.getSheetByName('TASKS');
  for (const field of ['Assignment_Version', 'Assignment_Approved_At', 'Notification_Baseline']) {
    const col = tasks.rows[0].indexOf(field);
    tasks.rows.forEach(row => row.splice(col, 1));
  }
  app.properties.setProperty('APPROVED_MIGRATIONS', '002_task_assignment_safety,003_management_reliability,004_shared_dashboard,005_task_planning_and_requests,006_responsibilities_and_nested_subprojects,007_responsibility_hierarchy_and_lifecycle');
  return app;
}

test('initialization requires explicit designation and confirmation, creates no external automation', () => {
  const app = loadApp();
  assert.throws(() => app.context.initializeNewDatabase('wrong'), /confirmation/);
  app.context.initializeNewDatabase('INITIALIZE test-db');
  assert.equal(app.context.Migrations.currentVersion(), 7);
  assert.equal(app.sentEmails.length, 0);
  assert.equal(app.triggers.length, 0);
  assert.equal(app.calendarEvents.length, 0);
  assert.equal(app.context.Config.get().emailEnabled, false);
  assert.equal(app.context.Config.get().dryRun, true);
  assert.equal(app.properties.getProperty('INITIALIZATION_SPREADSHEET_ID'), null);
});

test('initializer refuses any existing content or formula, including production', () => {
  for (const content of ['existing production record', '=IF(1,"","")']) {
    const app = loadApp({ properties: { ENVIRONMENT: 'PRODUCTION', BOUND_ENVIRONMENT: 'PRODUCTION' },
      sheets: { PROJECTS: [[content]] } });
    assert.throws(() => app.context.initializeNewDatabase('INITIALIZE test-db'), /existing content/);
    assert.equal(app.book.getSheets().length, 1);
    assert.equal(app.book.getSheetByName('PROJECTS').rows[0][0], content);
  }
});

test('configuration refuses missing or inconsistent environment bindings', () => {
  const app = loadApp({ properties: { BOUND_ENVIRONMENT: 'PRODUCTION' } });
  assert.throws(() => app.context.Config.get(), /environment binding/);
});

test('workbook environment marker prevents development from accessing production records', () => {
  const app = ready();
  app.properties.setProperty('ENVIRONMENT', 'PRODUCTION').setProperty('BOUND_ENVIRONMENT', 'PRODUCTION');
  assert.throws(() => app.context.Database.read('PROJECTS'), /Workbook environment mismatch/);
});

test('approved upgrade preserves project, task ownership, skill records and existing cell positions', () => {
  const app = oldDatabase();
  const before = JSON.parse(JSON.stringify(app.context.Backup.snapshot(app.book)));
  assert.equal(app.context.upgradeExistingDatabase(), 7);
  // Each approved migration takes its own verified pre-migration backup.
  assert.equal(app.backups.length, 6);
  assert.equal(app.context.Database.find('PROJECTS', 'P001').Project_Name, 'Inspection cell');
  assert.equal(app.context.Database.find('TASKS', 'T001').Owner_Member_ID, 'M001');
  assert.equal(app.context.Database.find('TASKS', 'T001').Assignment_Approved_At, '');
  assert.equal(app.context.Database.find('MEMBER_SKILLS', 'MS001').Current_Level, 3);
  for (const old of before) {
    if (['SCHEMA_MIGRATIONS', 'BACKUP_LOG'].includes(old.name)) continue;
    const rows = app.book.getSheetByName(old.name).getDataRange().getValues();
    old.values.forEach((row, r) => row.forEach((cell, c) => assert.equal(rows[r][c], cell)));
  }
});

test('repeating an applied migration changes no cells and creates no further backup', () => {
  const app = oldDatabase();
  app.context.upgradeExistingDatabase();
  const before = JSON.stringify(app.context.Backup.snapshot(app.book));
  app.context.upgradeExistingDatabase();
  assert.equal(JSON.stringify(app.context.Backup.snapshot(app.book)), before);
  assert.equal(app.backups.length, 6);
});

test('missing tables and missing columns are appended without replacing manual columns', () => {
  const app = oldDatabase();
  const projects = app.book.getSheetByName('PROJECTS');
  projects.rows[0].push('Manual_Notes');
  projects.rows[1].push('retain this note');
  app.book.sheets = app.book.sheets.filter(s => s.getName() !== 'HOLIDAYS');
  app.context.upgradeExistingDatabase();
  assert.equal(app.context.Database.find('PROJECTS', 'P001').Manual_Notes, 'retain this note');
  assert.ok(app.book.getSheetByName('HOLIDAYS'));
  // The removed V1.1 columns are appended again and the V1.6 columns are added, without
  // reordering or replacing the manual columns that were already there.
  const taskHeaders = app.book.getSheetByName('TASKS').rows[0];
  ['Assignment_Version', 'Assignment_Approved_At', 'Notification_Baseline', 'Parent_Task_ID', 'Deleted_At']
    .forEach(field => assert.ok(taskHeaders.indexOf(field) >= 0, field + ' must be restored or added'));
});

test('migration refuses unapproved changes without a backup or schema writes', () => {
  const app = oldDatabase();
  app.properties.setProperty('APPROVED_MIGRATIONS', 'unapproved');
  const before = JSON.stringify(app.context.Backup.snapshot(app.book));
  assert.throws(() => app.context.upgradeExistingDatabase(), /not approved/);
  assert.equal(app.backups.length, 0);
  assert.equal(JSON.stringify(app.context.Backup.snapshot(app.book)), before);
});

test('publicly shared backup folder prevents migration and preserves schema', () => {
  const app = oldDatabase();
  app.addFolder('restricted-backups', { sharingAccess: 'ANYONE_WITH_LINK' });
  const before = [...app.book.getSheetByName('TASKS').rows[0]];
  assert.throws(() => app.context.upgradeExistingDatabase(), /must not allow/);
  assert.deepEqual(app.book.getSheetByName('TASKS').rows[0], before);
  assert.equal(app.context.Migrations.currentVersion(), 1);
  assert.equal(app.context.Database.read('BACKUP_LOG').at(-1).Result, 'FAILED');
});

test('backup verification failure stops before adding schema', () => {
  const app = oldDatabase();
  const source = app.files.get('test-db');
  const originalCopy = source.makeCopy.bind(source);
  source.makeCopy = (...args) => {
    const file = originalCopy(...args);
    app.spreadsheets.get(file.getId()).getSheetByName('PROJECTS').rows[1][1] = 'CORRUPTED';
    return file;
  };
  const before = [...app.book.getSheetByName('TASKS').rows[0]];
  assert.throws(() => app.context.upgradeExistingDatabase(), /verified/);
  assert.deepEqual(app.book.getSheetByName('TASKS').rows[0], before);
  assert.equal(app.context.Migrations.currentVersion(), 1);
});

test('invalid or duplicate stable IDs stop migration before schema changes', () => {
  const app = oldDatabase();
  const projects = app.book.getSheetByName('PROJECTS');
  projects.rows.push([...projects.rows[1]]);
  assert.throws(() => app.context.upgradeExistingDatabase(), /duplicate stable ID/);
  assert.equal(app.backups.length, 0);
});

test('header-based updates retain IDs after sorting and preserve unknown formulas', () => {
  const app = ready(), db = app.context.Database;
  db.insert('PROJECTS', { Project_ID: 'P1', Project_Name: 'Z project', Status: 'Planned' });
  db.insert('PROJECTS', { Project_ID: 'P2', Project_Name: 'A project', Status: 'Active' });
  const sheet = app.book.getSheetByName('PROJECTS');
  sheet.rows[0].push('Manual_Calculation');
  sheet.rows[1].push('=1+1');
  sheet.rows[2].push('=2+2');
  sheet.rows = [sheet.rows[0], ...sheet.rows.slice(1).reverse()];
  db.update('PROJECTS', 'P1', { Project_Name: 'Renamed' });
  assert.equal(db.find('PROJECTS', 'P1').Project_Name, 'Renamed');
  assert.equal(db.find('PROJECTS', 'P2').Project_Name, 'A project');
  assert.equal(db.find('PROJECTS', 'P1').Manual_Calculation, '=1+1');
  assert.throws(() => db.update('PROJECTS', 'P1', { Project_ID: 'changed' }), /immutable/);
});

test('values, references, progress, date validity and skill levels are validated', () => {
  const { context: { Database: db } } = ready();
  assert.throws(() => db.insert('PROJECTS', { Project_Name: 'Bad', Status: 'Unknown' }), /enum/);
  assert.throws(() => db.insert('PROJECTS', { Project_Name: 'Bad', Status: 'Active', Project_Owner_ID: 'missing' }), /reference/);
  assert.throws(() => db.insert('PROJECTS', { Project_Name: 'Bad', Status: 'Active', Progress_Percent: 101 }), /range/);
  assert.throws(() => db.insert('PROJECTS', { Project_Name: 'Bad', Status: 'Active', Planned_Start: '2026-02-30' }), /calendar date/);
  assert.throws(() => db.insert('SKILLS', { Skill_Name: 'PLC', Required_Level: 2.5 }), /Integer/);
});

test('only generated worksheets can be cleared by refresh', () => {
  const { context: { Database: db } } = ready();
  assert.throws(() => db.writeGenerated('PROJECTS', [['replacement']]), /Not a generated/);
  db.writeGenerated('DASHBOARD', [['指標', '値'], ['稼働中', 0]]);
  assert.equal(db.book().getSheetByName('DASHBOARD').rows[1][0], '稼働中');
});

test('formula-like input is escaped and application load has no Workspace side effects', () => {
  const app = loadApp();
  assert.equal(app.book.getSheets().length, 0);
  assert.equal(app.backups.length + app.triggers.length + app.sentEmails.length, 0);
  app.context.initializeNewDatabase('INITIALIZE test-db');
  app.context.Database.insert('PROJECTS', { Project_ID: 'P1', Project_Name: '=IMPORTXML("https://invalid.test")', Status: 'Planned' });
  const sheet = app.book.getSheetByName('PROJECTS');
  assert.equal(sheet.rows[1][sheet.rows[0].indexOf('Project_Name')].startsWith("'="), true);
});

test('batch updates validate all changes before writing and preserve unmodified cells', () => {
  const app = ready(), db = app.context.Database;
  db.insert('PROJECTS', { Project_ID: 'P1', Project_Name: 'A', Status: 'Planned' });
  db.insert('PROJECTS', { Project_ID: 'P2', Project_Name: 'B', Status: 'Active' });
  assert.throws(() => db.updateMany('PROJECTS', [
    { id: 'P1', patch: { Project_Name: 'changed' } },
    { id: 'P2', patch: { Status: 'invalid' } }
  ]), /enum/);
  assert.equal(db.find('PROJECTS', 'P1').Project_Name, 'A');
  db.updateMany('PROJECTS', [
    { id: 'P1', patch: { Project_Name: 'renamed A' } },
    { id: 'P2', patch: { Project_Name: 'renamed B' } }
  ]);
  assert.equal(db.find('PROJECTS', 'P1').Status, 'Planned');
  assert.equal(db.find('PROJECTS', 'P2').Project_Name, 'renamed B');
});
