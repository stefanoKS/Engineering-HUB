'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

test('management surfaces reject unverified or under-privileged callers', () => {
  const outsider = fixtures.base({ actor: 'outsider@example.test' });
  const denied = outsider.context.Ui.context();
  assert.equal(denied.ok, false);
  assert.match(denied.error, /verified active member/);

  // Default V1.1 posture: trusted managers only.
  const viewer = fixtures.base({ actor: 'viewer@example.test' });
  const viewerRead = viewer.context.Ui.context();
  assert.equal(viewerRead.ok, false);
  assert.match(viewerRead.error, /Member self-service is disabled/);

  const member = fixtures.base({ actor: 'engineer@example.test' });
  assert.equal(member.context.Ui.context().ok, false, 'member self-service is off by default');
  const memberWrite = member.context.Ui.createProject({ name: '不可' });
  assert.equal(memberWrite.ok, false);
  assert.match(memberWrite.error, /Insufficient role: MANAGER/);
  assert.equal(member.context.Ui.saveAutomationSettings({ changes: { ASSIGNMENT_EMAIL_ENABLED: true } }).ok, false);
  assert.equal(member.context.Ui.members().ok, false, 'member administration requires MANAGER');

  // Opt-in self-service: a MEMBER gets an own-scope view, a VIEWER still does not.
  const selfService = fixtures.base({ actor: 'engineer@example.test', properties: { ALLOW_MEMBER_SELF_SERVICE: 'true' } });
  assert.equal(selfService.context.Ui.context().ok, true);
  const selfViewer = fixtures.base({ actor: 'viewer@example.test', properties: { ALLOW_MEMBER_SELF_SERVICE: 'true' } });
  assert.equal(selfViewer.context.Ui.context().ok, false);
  assert.match(selfViewer.context.Ui.context().error, /Insufficient role: MEMBER/);
});

test('manager can create a project, subproject and deadline-only assignment through the UI adapter', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const context = app.context;
  const created = context.Ui.createProject({ name: '新規ライン', ownerId: 'M-MGR', deadline: '2027-03-31' });
  assert.equal(created.ok, true, created.error);
  assert.equal(created.data.Project_Name, '新規ライン');
  assert.equal(created.data.Original_Deadline, '2027-03-31');

  const subproject = context.Ui.createSubproject({ projectId: created.data.Project_ID, name: '設計', ownerId: 'M-ENG' });
  assert.equal(subproject.ok, true, subproject.error);
  assert.equal(context.Database.find('SUBPROJECTS', subproject.data.Subproject_ID).Project_ID, created.data.Project_ID);

  const assigned = context.Ui.assignTask({
    projectId: created.data.Project_ID, subprojectId: subproject.data.Subproject_ID,
    taskName: '期限のみの割当', ownerId: 'M-ENG', deadline: '2027-03-01', notify: true
  });
  assert.equal(assigned.ok, true, assigned.error);
  assert.equal(assigned.data.task.Estimated_Hours, '', 'no fabricated estimate');
  assert.equal(assigned.data.task.Planned_Start, '', 'no fabricated start date');
  assert.equal(assigned.data.task.Notification_Enabled, true);
  assert.equal(app.sentEmails.length, 0, 'the UI never sends mail directly');

  const invalid = context.Ui.assignTask({ projectId: created.data.Project_ID, taskName: '', ownerId: 'M-ENG' });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /タスク名/);

  const foreignSubproject = context.Ui.assignTask({
    projectId: 'P1', subprojectId: subproject.data.Subproject_ID, taskName: '不整合', ownerId: 'M-ENG'
  });
  assert.equal(foreignSubproject.ok, false);
  assert.match(foreignSubproject.error, /Subproject/);
});

test('UI progress updates and validation keep task invariants', () => {
  const app = fixtures.base({ actor: 'engineer@example.test', properties: { ALLOW_MEMBER_SELF_SERVICE: 'true' } });
  const context = app.context;
  const updated = context.Ui.updateProgress({ taskId: 'T1', progress: 100 });
  assert.equal(updated.ok, true, updated.error);
  assert.equal(context.Database.find('TASKS', 'T1').Status, 'Done');

  const invalid = context.Ui.updateProgress({ taskId: 'T2', progress: 120 });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /0〜100/);
});

test('skill gaps are advisory and assessment metadata is retained', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const context = app.context;
  const db = context.Database;
  db.insert('SKILLS', { Skill_ID: 'SK1', Skill_Name: '機械設計', Required_Level: 3 });
  context.setMemberSkill('M-ENG', 'SK1', 2, { assessedBy: 'M-MGR', evidence: '過去案件2件', trainingAction: 'OJT', nextReviewDate: '2027-03-31' });
  db.update('TASKS', 'T1', { Required_Skill_ID: 'SK1', Required_Skill_Level: 3 });

  const gaps = context.Skills.gaps();
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].Gap, 1);
  assert.equal(gaps[0].NeedsSupervision, true);
  assert.equal(gaps[0].TrainingAction, 'OJT');
  const record = db.read('MEMBER_SKILLS')[0];
  assert.equal(record.Evidence, '過去案件2件');
  assert.equal(record.Next_Review_Date, '2027-03-31');

  const denied = fixtures.base({ actor: 'viewer@example.test' }).context.Ui.setSkill({ memberId: 'M-ENG', skillId: 'X', level: 4 });
  assert.equal(denied.ok, false);
  assert.throws(() => context.setMemberSkill('M-ENG', 'SK1', 5), /range/);
});

test('member deactivation is blocked while open work still needs reassignment', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const context = app.context;
  const blocked = context.Ui.deactivateMember({ memberId: 'M-ENG' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Reassign open tasks/);

  for (const task of context.Database.read('TASKS').filter(item => item.Owner_Member_ID === 'M-ENG')) {
    context.updateTask(task.Task_ID, { Owner_Member_ID: 'M-MGR' });
  }
  const deactivated = context.Ui.deactivateMember({ memberId: 'M-ENG' });
  assert.equal(deactivated.ok, true, deactivated.error);
  assert.equal(context.Database.find('MEMBERS', 'M-ENG').Active, false);
});

test('bound menu and sidebar use the packaged HTML templates', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const context = app.context;
  context.onOpen();
  assert.equal(context.showManagerSidebar(), '表示しました: UiMenu');
  assert.equal(context.showAutomationSidebar(), '表示しました: UiSettings');
  assert.equal(context.showSystemSidebar(), '表示しました: UiSystem');
  assert.equal(app.uiSidebars.length, 3);
  assert.match(app.uiSidebars[0].getContent(), /プロジェクト作成/);
  assert.match(app.uiSidebars[1].getContent(), /自動化設定/);
  assert.match(app.uiSidebars[2].getContent(), /システム状態/);
});
