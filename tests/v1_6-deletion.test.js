'use strict';
/**
 * V1.6 gate 7: safe, ADMIN-only deletion of mistaken records.
 *
 * Archive stays the default. A permanent delete needs an empty dependency preflight, an exact
 * typed confirmation, a reason, a verified backup and the script lock, and it always leaves a
 * tombstone. Operational work with history can never be removed this way.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};

function app(actor = 'admin@example.test') {
  return fixtures.base({actor, properties: MANAGER_WEB});
}

/** A freshly created, completely empty task: the only kind that may be removed permanently. */
function emptyTask(instance, id = 'T-NEW') {
  return instance.context.Tasks.create({
    Task_ID: id, Project_ID: 'P1', Subproject_ID: 'S1', Task_Name: '誤登録', Owner_Member_ID: 'M-ENG',
    Status: 'Assigned'
  });
}

test('a record with operational history can never be deleted', () => {
  const instance = app();
  const summary = instance.context.preflightRecordDeletion('TASKS', 'T1');
  assert.equal(summary.deletable, false);
  assert.ok(summary.blocking.some(item => item.code === 'RECORDED_PROGRESS' || item.code === 'RECORDED_EFFORT'));
  assert.throws(() => instance.context.deleteRecord('TASKS', 'T1', {
    reason: '誤登録', confirmation: 'DELETE T1'
  }), /安全に削除できません/);
  assert.ok(instance.context.Database.find('TASKS', 'T1'), 'the row is untouched');
});

test('a completely empty mistaken task can be removed, with a backup and a tombstone', () => {
  const instance = app();
  emptyTask(instance, 'T-NEW');
  const summary = instance.context.preflightRecordDeletion('TASKS', 'T-NEW');
  assert.equal(summary.deletable, true, JSON.stringify(summary.blocking));
  const result = instance.context.deleteRecord('TASKS', 'T-NEW', {
    reason: 'テスト用の誤登録', confirmation: 'DELETE T-NEW'
  });
  assert.equal(result.deleted, true);
  assert.equal(result.needsPublication, true, 'the committed snapshot needs a new publication');
  assert.ok(result.backup, 'a verified backup was taken before the removal');
  assert.equal(instance.context.Database.find('TASKS', 'T-NEW'), null);
  const tombstone = instance.context.Database.read('AUDIT_LOG').filter(row => row.Action === 'RECORD_DELETED');
  assert.equal(tombstone.length, 1);
  assert.match(String(tombstone[0].New_Value), /テスト用の誤登録/);
  assert.equal(instance.backups.length >= 1, true);
});

test('the exact typed confirmation and a reason are both required', () => {
  const instance = app();
  emptyTask(instance, 'T-NEW');
  assert.throws(() => instance.context.deleteRecord('TASKS', 'T-NEW', {reason: '誤登録', confirmation: 'DELETE'}),
    /DELETE T-NEW/);
  assert.throws(() => instance.context.deleteRecord('TASKS', 'T-NEW', {reason: '', confirmation: 'DELETE T-NEW'}),
    /理由/);
  assert.ok(instance.context.Database.find('TASKS', 'T-NEW'));
});

test('only an administrator may delete', () => {
  const manager = app('manager@example.test');
  emptyTask(manager, 'T-NEW');
  assert.throws(() => manager.context.deleteRecord('TASKS', 'T-NEW', {
    reason: '誤登録', confirmation: 'DELETE T-NEW'
  }), /ADMIN/);
  const viewer = fixtures.base({actor: 'viewer@example.test', properties: MANAGER_WEB});
  assert.throws(() => viewer.context.preflightRecordDeletion('TASKS', 'T-NEW'), /ADMIN|Insufficient/);
});

test('a project with children is refused, and a fully empty mistaken project can cascade', () => {
  const instance = app();
  // P1 holds subprojects and tasks: hard deletion is refused, archive is the documented alternative.
  assert.throws(() => instance.context.deleteRecord('PROJECTS', 'P1', {
    reason: '誤登録', confirmation: 'DELETE P1'
  }), /安全に削除できません/);

  const mistaken = instance.context.Projects.create({
    Project_ID: 'P-MISTAKE', Project_Name: '誤って作成', Status: 'Planned',
    Project_Owner_ID: 'M-MGR', Dashboard_Visibility: 'RESTRICTED'
  });
  instance.context.Subprojects.create({Subproject_ID: 'S-M1', Project_ID: mistaken.Project_ID, Subproject_Name: '誤り'});
  instance.context.Tasks.create({Task_ID: 'T-M1', Project_ID: mistaken.Project_ID, Subproject_ID: 'S-M1',
    Task_Name: '誤り', Owner_Member_ID: 'M-ENG', Status: 'Assigned'});
  const summary = instance.context.preflightRecordDeletion('PROJECTS', mistaken.Project_ID);
  assert.equal(summary.deletable, false, 'children block a plain delete');
  const result = instance.context.deleteRecord('PROJECTS', mistaken.Project_ID, {
    reason: '誤って作成', confirmation: 'DELETE ' + mistaken.Project_ID, cascade: true
  });
  assert.equal(result.deleted, true);
  assert.equal(result.removed, 3, 'the project, its subproject and its task');
  assert.equal(instance.context.Database.find('PROJECTS', mistaken.Project_ID), null);
  assert.equal(instance.context.Database.find('SUBPROJECTS', 'S-M1'), null);
  assert.equal(instance.context.Database.find('TASKS', 'T-M1'), null);
});

test('a published or archived project is never hard-deleted', () => {
  const instance = app();
  const published = instance.context.Projects.create({
    Project_ID: 'P-PUB', Project_Name: '公開中', Status: 'Active', Project_Owner_ID: 'M-MGR',
    Dashboard_Visibility: 'INTERNAL'
  });
  assert.throws(() => instance.context.deleteRecord('PROJECTS', published.Project_ID, {
    reason: '誤登録', confirmation: 'DELETE ' + published.Project_ID
  }), /安全に削除できません/);
});

test('the dependencies of a record are reported before anything is removed', () => {
  const instance = app();
  const summary = instance.context.preflightRecordDeletion('SUBPROJECTS', 'S1');
  assert.equal(summary.table, 'SUBPROJECTS');
  assert.equal(summary.id, 'S1');
  assert.ok(summary.blocking.some(item => item.table === 'TASKS'), 'the tasks of S1 are reported');
  const empty = instance.context.Subprojects.create({Subproject_ID: 'S-EMPTY', Project_ID: 'P1', Subproject_Name: '空'});
  const clean = instance.context.preflightRecordDeletion('SUBPROJECTS', empty.Subproject_ID);
  assert.equal(clean.deletable, true, JSON.stringify(clean.blocking));
});

test('a removed identifier is never reused', () => {
  const instance = app();
  emptyTask(instance, 'T-REUSE');
  instance.context.deleteRecord('TASKS', 'T-REUSE', {reason: '誤登録', confirmation: 'DELETE T-REUSE'});
  assert.equal(instance.context.Deletion.isDeletedId('TASKS', 'T-REUSE'), true);
  assert.throws(() => instance.context.Deletion.assertFreshId('TASKS', 'T-REUSE'), /再利用/);
});

test('the manager web exposes deletion only through the ADMIN actions', () => {
  const instance = app();
  emptyTask(instance, 'T-WEB');
  const revision = instance.context.managerWebRead('task', {id: 'T-WEB'}).data.record._revision;
  const summary = instance.context.managerWebRead('deletion', {table: 'TASKS', id: 'T-WEB'});
  assert.equal(summary.ok, true, summary.error);
  assert.equal(summary.data.deletable, true);
  const refused = instance.context.managerWebWrite('taskDelete', {
    taskId: 'T-WEB', revision, reason: '誤登録', confirmed: false
  });
  assert.equal(refused.ok, false, 'an explicit confirmation is required');
  const removed = instance.context.managerWebWrite('taskDelete', {
    taskId: 'T-WEB', revision, reason: '誤登録', confirmation: 'DELETE T-WEB', confirmed: true
  });
  assert.equal(removed.ok, true, removed.error);
  assert.equal(instance.context.Database.find('TASKS', 'T-WEB'), null);
});

test('a role or confirmation supplied by the browser is never authority', () => {
  const instance = app('manager@example.test');
  emptyTask(instance, 'T-SPOOF');
  const revision = instance.context.managerWebRead('task', {id: 'T-SPOOF'}).data.record._revision;
  const spoofed = instance.context.managerWebWrite('taskDelete', {
    taskId: 'T-SPOOF', revision, reason: '誤登録', confirmation: 'DELETE T-SPOOF', confirmed: true, role: 'ADMIN'
  });
  assert.equal(spoofed.ok, false);
  assert.ok(instance.context.Database.find('TASKS', 'T-SPOOF'));
});
