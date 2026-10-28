'use strict';

/**
 * V1.4.2 database correctness guards.
 *
 * Google Sheets materializes an unchecked checkbox as FALSE, so a freshly initialized sheet
 * already "ends" at row 1000 with 999 FALSE values and no stable IDs. Those preformatted rows
 * are not records: they must not be read as phantom rows and they must be reusable for the
 * first real record without ever overwriting data, formulas or custom columns.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

const FIRST = { Name: '管理 太郎', Email: 'first@example.test', Department: '設計', Active: true, Role: 'MEMBER' };
const SECOND = { Name: '設計 次郎', Email: 'second@example.test', Department: '設計', Active: true, Role: 'MEMBER' };

/** Reproduces the live sheet state: unchecked checkboxes written below the header. */
function preformat(app, table, field, startRow = 2) {
  const sheet = app.book.getSheetByName(table);
  const column = sheet.rows[0].indexOf(field);
  assert.ok(column >= 0, `${table}.${field} must exist`);
  const count = 1000 - startRow + 1;
  if (count > 0) {
    sheet.getRange(startRow, column + 1, count, 1)
      .setValues(Array.from({ length: count }, () => [false]));
  }
  return sheet;
}

function cell(sheet, row, field) {
  return sheet.getRange(row, sheet.rows[0].indexOf(field) + 1).getValue();
}

test('a MEMBERS sheet holding only 999 unchecked checkboxes reports no records', () => {
  const app = fixtures.app();
  const sheet = preformat(app, 'MEMBERS', 'Active');
  assert.equal(sheet.getLastRow(), 1000, 'the checkbox-only region is what live Sheets exposes');
  assert.equal(cell(sheet, 2, 'Active'), false);
  assert.equal(app.context.Database.read('MEMBERS').length, 0);
  assert.equal(app.context.Database.find('MEMBERS', 'MEMBER_unknown'), null);
});

test('the first and second members land on physical rows 2 and 3 of a preformatted sheet', () => {
  const app = fixtures.app();
  const context = app.context;
  const sheet = preformat(app, 'MEMBERS', 'Active');

  const first = context.Members.create(FIRST);
  assert.match(first.Member_ID, /^MEMBER_[0-9a-f-]{36}$/);
  assert.equal(cell(sheet, 2, 'Member_ID'), first.Member_ID);
  assert.equal(cell(sheet, 2, 'Name'), FIRST.Name);
  assert.equal(context.Database.read('MEMBERS').length, 1);

  const second = context.Members.create(SECOND);
  assert.notEqual(second.Member_ID, first.Member_ID);
  assert.equal(cell(sheet, 3, 'Member_ID'), second.Member_ID);
  const members = context.Database.read('MEMBERS');
  assert.equal(members.length, 2);
  assert.deepEqual(members.map(member => member.Member_ID), [first.Member_ID, second.Member_ID]);

  // Preformatted rows stay in place: nothing is deleted to make room.
  assert.equal(sheet.getLastRow(), 1000);
  assert.equal(cell(sheet, 1000, 'Active'), false);
});

test('a real record with Active = FALSE stays readable and keeps its stable ID', () => {
  const app = fixtures.app();
  const db = app.context.Database;
  preformat(app, 'MEMBERS', 'Active');
  db.insert('MEMBERS', { Member_ID: 'M-OFF', Name: '休職 花子', Email: 'off@example.test', Active: false, Role: 'MEMBER' });
  const members = db.read('MEMBERS');
  assert.equal(members.length, 1);
  assert.equal(members[0].Member_ID, 'M-OFF');
  assert.equal(members[0].Active, false);
  assert.equal(db.find('MEMBERS', 'M-OFF').Name, '休職 花子');
});

test('every operational table with a checkbox column ignores its empty preformatted rows', () => {
  const app = fixtures.base();
  const db = app.context.Database;
  const tables = {
    MEMBERS: 'Active',
    PROJECTS: 'Notification_Enabled',
    TASKS: 'Notification_Enabled',
    PROJECT_PHASES: 'Active',
    SCHEDULE_CONFIRMATIONS: 'Active'
  };
  const before = Object.keys(tables).map(name => db.read(name).length);
  Object.keys(tables).forEach(name => {
    const sheet = app.book.getSheetByName(name);
    preformat(app, name, tables[name], sheet.getLastRow() + 1);
    assert.equal(sheet.getLastRow(), 1000, `${name} keeps its preformatted rows`);
  });
  assert.deepEqual(Object.keys(tables).map(name => db.read(name).length), before);
  assert.equal(db.read('MEMBERS').length, 4);
  assert.equal(db.read('TASKS').length, 3);
});

test('a meaningful row without a stable ID is reported and never overwritten', () => {
  const app = fixtures.app();
  const db = app.context.Database;
  const sheet = preformat(app, 'MEMBERS', 'Active');
  sheet.getRange(2, sheet.rows[0].indexOf('Name') + 1).setValue('手入力の行');

  assert.throws(() => db.read('MEMBERS'), /Malformed record in MEMBERS at row 2: Member_ID is missing/);
  assert.throws(() => db.insert('MEMBERS', FIRST), /Malformed record in MEMBERS/);
  assert.equal(cell(sheet, 2, 'Name'), '手入力の行', 'the unlabelled row must survive');
  assert.equal(cell(sheet, 2, 'Member_ID'), '');
});

test('preformatted formulas and custom columns are preserved while records stay contiguous', () => {
  const app = fixtures.app();
  const db = app.context.Database;
  const sheet = preformat(app, 'MEMBERS', 'Active');
  sheet.rows[0].push('Manual_Note');
  const noteColumn = sheet.rows[0].indexOf('Manual_Note') + 1;

  db.insert('MEMBERS', { Member_ID: 'M-1', Name: '一', Email: 'one@example.test', Active: true });
  sheet.getRange(2, noteColumn).setValue('keep this note');
  // A prefilled formula that evaluates to blank is still content and must never be overwritten.
  sheet.setFormulaCell(3, noteColumn, '=IF($A3="","",$B3)');
  db.insert('MEMBERS', { Member_ID: 'M-2', Name: '二', Email: 'two@example.test', Active: true });

  assert.equal(sheet.getRange(2, noteColumn).getValue(), 'keep this note');
  assert.equal(sheet.getRange(3, noteColumn).getFormula(), '=IF($A3="","",$B3)');
  assert.equal(cell(sheet, 3, 'Member_ID'), '', 'a formula row never becomes a record');
  assert.equal(cell(sheet, 4, 'Member_ID'), 'M-2', 'the next record continues after the formula row');
  const members = db.read('MEMBERS');
  assert.equal(members.length, 2);
  assert.equal(members[0].Manual_Note, 'keep this note');
});

test('duplicate stable IDs are still rejected on a preformatted sheet', () => {
  const app = fixtures.app();
  const db = app.context.Database;
  const sheet = preformat(app, 'MEMBERS', 'Active');
  db.insert('MEMBERS', { Member_ID: 'M-1', Name: '一', Email: 'one@example.test', Active: true });
  sheet.getRange(3, sheet.rows[0].indexOf('Member_ID') + 1).setValue('M-1');
  sheet.getRange(3, sheet.rows[0].indexOf('Name') + 1).setValue('重複 二');
  assert.throws(() => db.find('MEMBERS', 'M-1'), /Duplicate stable ID/);
  assert.throws(() => db.insert('MEMBERS', { Member_ID: 'M-1', Name: '三', Email: 'three@example.test', Active: true }), /Duplicate/);
});

test('initialization and migration stay additive with preformatted checkbox rows', () => {
  const app = fixtures.base();
  const context = app.context;
  const members = app.book.getSheetByName('MEMBERS');
  const tasks = app.book.getSheetByName('TASKS');
  const before = { members: context.Database.read('MEMBERS').length, tasks: context.Database.read('TASKS').length };
  preformat(app, 'MEMBERS', 'Active', members.getLastRow() + 1);
  preformat(app, 'TASKS', 'Notification_Enabled', tasks.getLastRow() + 1);

  assert.equal(context.Migrations.upgrade(), 7, 'a current workbook still verifies with phantom rows present');
  assert.equal(members.getLastRow(), 1000, 'no sheet row is deleted');
  assert.equal(context.Database.read('MEMBERS').length, before.members);
  assert.equal(context.Database.read('TASKS').length, before.tasks);
  assert.equal(context.Database.find('MEMBERS', 'M-ADMIN').Active, true);
  assert.equal(app.backups.length, 0, 'no migration ran on an already current workbook');
});

test('a version 5 workbook with preformatted checkbox rows upgrades additively', () => {
  const app = fixtures.base();
  const context = app.context;
  const history = app.book.getSheetByName('SCHEMA_MIGRATIONS');
  const versionColumn = history.rows[0].indexOf('New_Version');
  history.rows.forEach((row, index) => { if (index > 0) row[versionColumn] = 5; });
  app.properties.setProperty('APPROVED_MIGRATIONS', '006_responsibilities_and_nested_subprojects,007_responsibility_hierarchy_and_lifecycle');
  const members = app.book.getSheetByName('MEMBERS');
  const snapshot = members.rows.slice(0, 5).map(row => [...row]);
  preformat(app, 'MEMBERS', 'Active', 6);
  assert.equal(context.Migrations.currentVersion(), 5);

  assert.equal(context.Migrations.upgrade(), 7);
  assert.equal(app.backups.length, 2);
  snapshot.forEach((row, index) => {
    assert.deepEqual(members.rows[index], row, `MEMBERS row ${index + 1} changed during migration`);
  });
  assert.equal(members.getLastRow(), 1000);
  assert.equal(context.Database.read('MEMBERS').length, 4);
  assert.equal(context.Database.read('RESPONSIBILITIES').length, 0);
});
