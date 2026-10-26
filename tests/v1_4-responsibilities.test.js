'use strict';

/**
 * V1.4 responsibilities: configurable organizational areas that group projects without
 * becoming a permission boundary or a second project database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

const ADMIN = 'admin@example.test';
const MANAGER = 'manager@example.test';

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function withResponsibilities(options = {}) {
  const app = fixtures.base(options);
  const context = app.context;
  context.Responsibilities.create({Name: '製品設計', Description: '製品の設計を担当', Owner_Member_ID: 'M-MGR'});
  context.Responsibilities.create({Name: '自動化・工程設計', Owner_Member_ID: 'M-MGR'});
  return app;
}

function byName(context, name) {
  return context.Database.read('RESPONSIBILITIES').filter(row => row.Name === name)[0];
}

function version5() {
  const app = fixtures.base();
  ['Responsibility_ID'].forEach(field => {
    const sheet = app.book.getSheetByName('PROJECTS');
    const column = sheet.rows[0].indexOf(field);
    if (column >= 0) sheet.rows.forEach(row => row.splice(column, 1));
  });
  const subprojects = app.book.getSheetByName('SUBPROJECTS');
  const parentColumn = subprojects.rows[0].indexOf('Parent_Subproject_ID');
  if (parentColumn >= 0) subprojects.rows.forEach(row => row.splice(parentColumn, 1));
  app.book.sheets = app.book.sheets.filter(sheet => sheet.name !== 'RESPONSIBILITIES');
  const history = app.book.getSheetByName('SCHEMA_MIGRATIONS');
  const versionColumn = history.rows[0].indexOf('New_Version');
  history.rows.forEach((row, index) => { if (index > 0) row[versionColumn] = 5; });
  app.properties.setProperty('APPROVED_MIGRATIONS', '006_responsibilities_and_nested_subprojects');
  return app;
}

test('schema version 6 adds the responsibility table and project link with a blank default', () => {
  const app = fixtures.app();
  const context = app.context;
  assert.equal(context.Schema.version, 6);
  assert.ok(context.Schema.tables.RESPONSIBILITIES);
  const link = context.Schema.tables.PROJECTS.fields.find(field => field.name === 'Responsibility_ID');
  assert.equal(link.defaultValue, '');
  assert.equal(link.ref, 'RESPONSIBILITIES');
  const parent = context.Schema.tables.SUBPROJECTS.fields.find(field => field.name === 'Parent_Subproject_ID');
  assert.equal(parent.defaultValue, '');
  assert.equal(parent.ref, 'SUBPROJECTS');
  // The project category is a different concept and must survive.
  assert.ok(context.Schema.tables.PROJECTS.fields.some(field => field.name === 'Category'));
});

test('a responsibility gets a stable ID and can be renamed without touching projects', () => {
  const app = withResponsibilities();
  const context = app.context;
  const created = byName(context, '製品設計');
  assert.match(created.Responsibility_ID, /^RESP_/);
  assert.equal(created.Status, 'Active');
  assert.equal(created.Retired_At, '');
  assert.ok(created.Created_At);

  context.Database.update('PROJECTS', 'P1', {Responsibility_ID: created.Responsibility_ID});
  const projectBefore = plain(context.Database.find('PROJECTS', 'P1'));

  context.Responsibilities.update(created.Responsibility_ID, {Name: '製品設計（更新）'});
  const renamed = context.Database.find('RESPONSIBILITIES', created.Responsibility_ID);
  assert.equal(renamed.Name, '製品設計（更新）');
  assert.equal(renamed.Responsibility_ID, created.Responsibility_ID, 'the ID is immutable');
  const projectAfter = plain(context.Database.find('PROJECTS', 'P1'));
  assert.equal(projectAfter.Responsibility_ID, created.Responsibility_ID, 'the link is by ID');
  assert.equal(projectAfter.Project_Name, projectBefore.Project_Name);
  assert.equal(projectAfter.Project_Owner_ID, projectBefore.Project_Owner_ID);
});

test('a name must be present, bounded and unique among active responsibilities', () => {
  const app = withResponsibilities();
  const context = app.context;
  assert.throws(() => context.Responsibilities.create({Name: '  '}), /担当領域名を入力してください/);
  assert.throws(() => context.Responsibilities.create({Name: 'あ'.repeat(61)}), /60文字以内/);
  assert.throws(() => context.Responsibilities.create({Name: '製品設計'}), /同じ名前の担当領域/);
  // A retired name is free for reuse: history keeps the retired row.
  const automation = byName(context, '自動化・工程設計');
  context.Responsibilities.retire(automation.Responsibility_ID, {confirmed: true});
  const reused = context.Responsibilities.create({Name: '自動化・工程設計'});
  assert.notEqual(reused.Responsibility_ID, automation.Responsibility_ID);
});

test('only ADMIN may change the responsibility owner', () => {
  const app = withResponsibilities();
  const context = app.context;
  const created = byName(context, '製品設計');
  app.setActor(MANAGER);
  assert.throws(() => context.Responsibilities.update(created.Responsibility_ID, {Owner_Member_ID: 'M-ENG'}),
    /ADMIN のみ/);
  app.setActor(ADMIN);
  const updated = context.Responsibilities.update(created.Responsibility_ID, {Owner_Member_ID: 'M-ENG'});
  assert.equal(updated.Owner_Member_ID, 'M-ENG');
});

test('a manager may only administer the responsibility they own', () => {
  const app = fixtures.base();
  const context = app.context;
  const mine = context.Responsibilities.create({Name: '製品設計', Owner_Member_ID: 'M-MGR'});
  const other = context.Responsibilities.create({Name: '品質改善', Owner_Member_ID: 'M-ADMIN'});

  app.setActor(MANAGER);
  context.Responsibilities.update(mine.Responsibility_ID, {Name: '製品設計 v2'});
  assert.throws(() => context.Responsibilities.update(other.Responsibility_ID, {Name: '乗っ取り'}),
    /権限がありません/);
  assert.throws(() => context.Responsibilities.retire(other.Responsibility_ID, {confirmed: true}),
    /権限がありません/);

  app.setActor('engineer@example.test');
  assert.throws(() => context.Responsibilities.create({Name: '無断作成'}), /MANAGER/);
});

test('responsibility ownership never grants access to the projects inside it', () => {
  const app = fixtures.base();
  const context = app.context;
  const area = context.Responsibilities.create({Name: '自動化・工程設計', Owner_Member_ID: 'M-MGR'});
  // P2 belongs to M-MGR, P1 also belongs to M-MGR in the fixture; create a private one instead.
  context.Database.insert('PROJECTS', {
    Project_ID: 'P-PRIVATE', Project_Name: '他の管理者の案件', Status: 'Active',
    Project_Owner_ID: 'M-ADMIN', Responsibility_ID: area.Responsibility_ID
  });
  app.setActor(MANAGER);
  const identity = context.Roles.describe();
  assert.equal(context.Access.canManageResponsibility(identity, context.Database.find('RESPONSIBILITIES', area.Responsibility_ID)), true);
  assert.throws(() => context.Access.requireProjectWrite('P-PRIVATE'), /outside the authorized scope/);
  const refused = context.Ui.updateProject({
    projectId: 'P-PRIVATE', name: '書き換え',
    updatedAt: JSON.stringify(context.Database.find('PROJECTS', 'P-PRIVATE').Last_Updated)
  });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /outside the authorized scope|権限/);
});

test('reordering changes the display order only', () => {
  const app = withResponsibilities();
  const context = app.context;
  const before = plain(context.Responsibilities.all().map(row => ({id: row.Responsibility_ID, name: row.Name, order: row.Sort_Order})));
  const second = before[1];
  const result = context.Ui.moveResponsibility({responsibilityId: second.id, direction: 'up'});
  assert.equal(result.ok, true);
  const after = plain(context.Responsibilities.all().map(row => ({id: row.Responsibility_ID, name: row.Name})));
  assert.equal(after[0].id, second.id, 'the moved row is first');
  assert.deepEqual(after.map(row => row.id).sort(), before.map(row => row.id).sort(), 'no record is created or lost');
  const audit = context.Database.read('AUDIT_LOG').filter(row => row.Action === 'RESPONSIBILITY_REORDERED');
  assert.ok(audit.length);
});

test('retiring keeps every project visible and marks it for reassignment', () => {
  const app = fixtures.base();
  const context = app.context;
  const area = context.Responsibilities.create({Name: '製品設計', Owner_Member_ID: 'M-MGR'});
  context.Projects.update('P1', {Responsibility_ID: area.Responsibility_ID});
  context.Database.update('PROJECTS', 'P1', {Health: 'GREEN'});

  const counts = context.Responsibilities.counts()[area.Responsibility_ID];
  assert.equal(counts.activeProjects, 1);

  const result = context.Responsibilities.retire(area.Responsibility_ID, {confirmed: true});
  assert.equal(result.openProjects, 1);
  const retired = context.Database.find('RESPONSIBILITIES', area.Responsibility_ID);
  assert.equal(retired.Status, 'Retired');
  assert.ok(retired.Retired_At);

  const project = context.Database.find('PROJECTS', 'P1');
  assert.equal(project.Responsibility_ID, area.Responsibility_ID, 'the project keeps its link');
  assert.equal(project.Status, 'Active', 'the project is not archived or completed');
  assert.equal(context.Database.read('TASKS').filter(task => task.Project_ID === 'P1').length, 2);

  const view = context.Ui.context().data;
  const item = view.projects.filter(entry => entry.id === 'P1')[0];
  assert.equal(item.responsibilityName, '製品設計');
  assert.equal(item.needsReassignment, true);

  // Retirement needs explicit confirmation and cannot be repeated.
  assert.throws(() => context.Responsibilities.retire(area.Responsibility_ID, {confirmed: true}), /すでに退職/);
});

test('retiring without confirmation is refused, and reactivation restores selectability', () => {
  const app = withResponsibilities();
  const context = app.context;
  const area = byName(context, '製品設計');
  assert.throws(() => context.Responsibilities.retire(area.Responsibility_ID, {}), /確認が必要/);
  context.Responsibilities.retire(area.Responsibility_ID, {confirmed: true});
  const refused = context.Ui.createProject({name: '新案件', responsibilityId: area.Responsibility_ID});
  assert.equal(refused.ok, false);
  assert.match(refused.error, /退職した担当領域/);
  const restored = context.Responsibilities.reactivate(area.Responsibility_ID);
  assert.equal(restored.Status, 'Active');
  assert.equal(restored.Retired_At, '');
  assert.equal(context.Responsibilities.active().some(row => row.Responsibility_ID === area.Responsibility_ID), true);
});

test('a project transfer changes only the responsibility and is audited with both values', () => {
  const app = withResponsibilities();
  const context = app.context;
  const products = byName(context, '製品設計');
  const automation = byName(context, '自動化・工程設計');
  context.Projects.update('P1', {Responsibility_ID: products.Responsibility_ID});
  const before = plain(context.Database.find('PROJECTS', 'P1'));

  const result = context.Responsibilities.transferProject('P1', automation.Responsibility_ID,
    {confirmed: true, reason: '工程設計へ移管'});
  assert.equal(result.changed, true);
  const after = context.Database.find('PROJECTS', 'P1');
  assert.equal(after.Responsibility_ID, automation.Responsibility_ID);
  ['Project_ID', 'Project_Name', 'Project_Owner_ID', 'Committed_Deadline', 'Original_Deadline', 'Status']
    .forEach(field => assert.equal(after[field], before[field], field + ' must not change'));
  assert.equal(after.Progress_Percent, before.Progress_Percent);
  assert.equal(context.Database.read('SUBPROJECTS').filter(row => row.Project_ID === 'P1').length, 1);
  assert.equal(context.Database.read('TASKS').filter(row => row.Project_ID === 'P1').length, 2);

  const audit = context.Database.read('AUDIT_LOG').filter(row => row.Action === 'RESPONSIBILITY_TRANSFERRED');
  assert.equal(audit.length, 1);
  const details = JSON.parse(audit[0].New_Value);
  assert.equal(details.previousResponsibilityId, products.Responsibility_ID);
  assert.equal(details.newResponsibilityId, automation.Responsibility_ID);
  assert.equal(details.reason, '工程設計へ移管');
  assert.equal(audit[0].Actor, ADMIN);
});

test('a transfer requires confirmation and the authorization of the target project', () => {
  const app = withResponsibilities();
  const context = app.context;
  const area = byName(context, '製品設計');
  assert.throws(() => context.Responsibilities.transferProject('P1', area.Responsibility_ID, {}), /確認が必要/);
  assert.throws(() => context.Responsibilities.transferProject('P1', 'RESP_MISSING', {confirmed: true}),
    /not found|見つかりません/);

  app.setActor(MANAGER);
  context.Database.insert('PROJECTS', {
    Project_ID: 'P-OTHER', Project_Name: '他の案件', Status: 'Active', Project_Owner_ID: 'M-ADMIN'
  });
  assert.throws(() => context.Responsibilities.transferProject('P-OTHER', area.Responsibility_ID, {confirmed: true}),
    /outside the authorized scope/);
});

test('a retired responsibility is only a destination for an ADMIN with an extra confirmation', () => {
  const app = withResponsibilities();
  const context = app.context;
  const area = byName(context, '製品設計');
  context.Responsibilities.retire(area.Responsibility_ID, {confirmed: true});
  assert.throws(() => context.Responsibilities.transferProject('P1', area.Responsibility_ID, {confirmed: true}),
    /追加の確認/);
  const result = context.Responsibilities.transferProject('P1', area.Responsibility_ID,
    {confirmed: true, confirmRetired: true});
  assert.equal(result.changed, true);
});

test('projects without a responsibility stay unassigned rather than invented', () => {
  const app = withResponsibilities();
  const context = app.context;
  const view = context.Ui.context().data;
  const p2 = view.projects.filter(entry => entry.id === 'P2')[0];
  assert.equal(p2.responsibilityId, '');
  assert.equal(p2.responsibilityName, '');
  assert.equal(p2.needsReassignment, false);
  assert.equal(context.Responsibilities.needsReassignment(context.Database.find('PROJECTS', 'P2')), false);
});

test('migration 006 is additive and preserves every legacy cell, formula and custom column', () => {
  const app = version5();
  const projects = app.book.getSheetByName('PROJECTS');
  projects.rows[0].push('Manual_Notes');
  projects.rows[1].push('retain this note');
  const custom = projects.rows[0].indexOf('Manual_Notes');
  const formulaRange = app.book.getSheetByName('TASKS');
  formulaRange.rows[0].push('Manual_Formula');
  const formulaColumn = formulaRange.rows[0].indexOf('Manual_Formula');
  formulaRange.rows[1][formulaColumn] = '=1+1';
  app.book.getSheetByName('TASKS').formulas = app.book.getSheetByName('TASKS').formulas || {};
  assert.equal(app.context.Migrations.currentVersion(), 5);

  const before = JSON.parse(JSON.stringify(app.context.Backup.snapshot(app.book)));
  assert.equal(app.context.Migrations.upgrade(), 6);

  const legacy = app.context.Database.find('PROJECTS', 'P1');
  assert.equal(legacy.Responsibility_ID, '', 'existing projects stay unassigned');
  assert.equal(legacy.Manual_Notes, 'retain this note');
  assert.equal(app.context.Database.find('SUBPROJECTS', 'S1').Parent_Subproject_ID, '', 'legacy subprojects stay root');
  assert.equal(app.context.Database.read('RESPONSIBILITIES').length, 0, 'no example responsibility is seeded');

  for (const old of before) {
    if (['SCHEMA_MIGRATIONS', 'BACKUP_LOG'].includes(old.name)) continue;
    const sheet = app.book.getSheetByName(old.name);
    const values = sheet.getDataRange().getValues();
    old.values.forEach((row, r) => row.forEach((cell, c) => {
      assert.equal(values[r][c], cell, `${old.name} row ${r + 1} column ${c + 1} changed`);
    }));
  }
  assert.equal(projects.getDataRange().getValues()[1][custom], 'retain this note');
});

test('repeating migration 006 changes nothing and duplicates no column', () => {
  const app = version5();
  app.context.Migrations.upgrade();
  const after = JSON.stringify(app.context.Backup.snapshot(app.book));
  const headers = app.book.getSheetByName('PROJECTS').rows[0].slice();
  app.context.Migrations.upgrade();
  assert.equal(JSON.stringify(app.context.Backup.snapshot(app.book)), after);
  assert.deepEqual(app.book.getSheetByName('PROJECTS').rows[0], headers);
  assert.equal(app.context.Database.read('RESPONSIBILITIES').length, 0);
});

test('migration 006 refuses to run without explicit approval and takes a verified backup', () => {
  const app = version5();
  app.properties.setProperty('APPROVED_MIGRATIONS', '005_task_planning_and_requests');
  assert.throws(() => app.context.Migrations.upgrade(), /not approved/);
  assert.equal(app.backups.length, 0);
  assert.equal(app.book.getSheetByName('RESPONSIBILITIES'), null);

  app.properties.setProperty('APPROVED_MIGRATIONS', '006_responsibilities_and_nested_subprojects');
  assert.equal(app.context.Migrations.upgrade(), 6);
  assert.equal(app.backups.length, 1);
});

test('a new database initializes with the responsibility table and no seed rows', () => {
  const app = fixtures.app();
  assert.ok(app.book.getSheetByName('RESPONSIBILITIES'));
  assert.equal(app.context.Database.read('RESPONSIBILITIES').length, 0);
  assert.equal(app.context.Migrations.currentVersion(), 6);
});
