'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixtures = require('./fixtures');
const { createDocument } = require('./support/dom');

const SRC = path.resolve(__dirname, '../src');

function scriptsOf(fileName) {
  const content = fs.readFileSync(path.join(SRC, fileName), 'utf8');
  const blocks = [];
  const pattern = /<script>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = pattern.exec(content)) !== null) blocks.push(match[1]);
  return blocks;
}

/**
 * Executes the assembled sidebar (template + included UiSafe partial) against the DOM shim.
 * The shim throws on innerHTML, so any HTML interpolation of spreadsheet text fails the test.
 */
function runSidebar(app, sidebarFn, data, overrides = {}) {
  app.context[sidebarFn]();
  const content = app.uiSidebars[app.uiSidebars.length - 1].getContent();
  const blocks = [];
  const pattern = /<script>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = pattern.exec(content)) !== null) blocks.push(match[1]);
  assert.ok(blocks.length >= 2, 'UiSafe partial must be included before the page script');

  const { document, elements } = createDocument();
  const success = { value: data };
  const runner = new Proxy({}, {
    get(target, key) {
      if (key === 'withSuccessHandler') return handler => { success.handler = handler; return runner; };
      if (key === 'withFailureHandler') return () => runner;
      return (...args) => { if (success.handler) success.handler({ ok: true, data: success.value }); };
    }
  });
  const sandbox = {
    document,
    window: { confirm: () => true, prompt: () => 'ENABLE LIVE EMAIL', ...overrides.window },
    google: { script: { run: runner } },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(blocks.join('\n'), sandbox, { filename: `${sidebarFn}.html` });
  return { document, elements, sandbox };
}

test('role grants require ADMIN and cannot be self-elevated through any payload', () => {
  const admin = fixtures.base();
  assert.equal(admin.context.updateMember('M-ENG', { Role: 'MANAGER' }).Role, 'MANAGER');
  assert.equal(admin.context.updateMember('M-ENG', { Role: 'MEMBER' }).Role, 'MEMBER');

  const manager = fixtures.base({ actor: 'manager@example.test' });
  assert.throws(() => manager.context.updateMember('M-ENG', { Role: 'MANAGER' }), /Insufficient role: ADMIN/);
  const viaUi = manager.context.Ui.saveMember({ memberId: 'M-ENG', name: '設計 次郎', email: 'engineer@example.test', role: 'ADMIN' });
  assert.equal(viaUi.ok, false);
  assert.match(viaUi.error, /Insufficient role: ADMIN/);

  const member = fixtures.base({ actor: 'engineer@example.test' });
  const selfPromotion = member.context.Ui.saveMember({ memberId: 'M-ENG', name: '設計 次郎', email: 'engineer@example.test', role: 'ADMIN' });
  assert.equal(selfPromotion.ok, false);
  assert.match(selfPromotion.error, /Insufficient role: MANAGER/);
  assert.equal(member.context.Database.find('MEMBERS', 'M-ENG').Role, 'MEMBER');

  // Even a MANAGER cannot change their own role record; another ADMIN must do it.
  const selfManager = fixtures.base({ actor: 'manager@example.test' });
  const selfChange = selfManager.context.Ui.saveMember({ memberId: 'M-MGR', name: '管理 花子', email: 'manager@example.test', role: 'ADMIN' });
  assert.equal(selfChange.ok, false);
  assert.match(selfChange.error, /cannot be changed by the account it belongs to/);
  assert.equal(selfManager.context.Database.find('MEMBERS', 'M-MGR').Role, 'MANAGER');

  assert.throws(() => manager.context.createMember({ Name: 'X', Email: 'x@example.test', Role: 'ADMIN' }), /Insufficient role: ADMIN/);
  assert.equal(admin.context.createMember({ Name: 'Y', Email: 'y@example.test' }).Role, 'MEMBER');
  assert.equal(admin.context.createMember({ Name: 'Z', Email: 'z@example.test', Role: 'MANAGER' }).Role, 'MANAGER');
});

test('the last active administrator cannot be demoted or deactivated', () => {
  const app = fixtures.base();
  assert.throws(() => app.context.Members.deactivate('M-ADMIN'), /last active administrator/);
  assert.throws(() => app.context.updateMember('M-ADMIN', { Role: 'MEMBER' }), /cannot be changed by the account it belongs to/);

  // With a second administrator the operation is allowed and the remaining admin is protected.
  app.context.Database.insert('MEMBERS', { Member_ID: 'M-ADMIN2', Name: '管理 次郎', Email: 'admin2@example.test', Active: true, Role: 'ADMIN', Weekly_Capacity_Hours: 0 });
  assert.equal(app.context.updateMember('M-ADMIN2', { Role: 'VIEWER' }).Role, 'VIEWER');
  assert.throws(() => app.context.Members.deactivate('M-ADMIN'), /last active administrator/);
});

test('invalid role text is rejected instead of silently downgraded', () => {
  const app = fixtures.base();
  assert.throws(() => app.context.updateMember('M-ENG', { Role: 'SuperUser' }), /Role must be one of/);
  assert.throws(() => app.context.updateMember('M-ENG', { Role: 'root' }), /Role must be one of/);
  assert.equal(app.context.Database.find('MEMBERS', 'M-ENG').Role, 'MEMBER');
});

test('members may update only their own tasks; managers stay inside their scope', () => {
  const app = fixtures.base({ actor: 'engineer@example.test', properties: { ALLOW_MEMBER_SELF_SERVICE: 'true' } });
  const db = app.context.Database;
  db.insert('TASKS', { Task_ID: 'T-FOREIGN', Project_ID: 'P1', Task_Name: '他人の作業', Owner_Member_ID: 'M-MGR', Status: 'Assigned', Due_Date: '2026-12-20', Estimated_Hours: 4 });

  assert.equal(app.context.Ui.updateProgress({ taskId: 'T1', progress: 40 }).ok, true);
  const foreign = app.context.Ui.updateProgress({ taskId: 'T-FOREIGN', progress: 40 });
  assert.equal(foreign.ok, false);
  assert.match(foreign.error, /outside the authorized scope/);
  assert.equal(db.find('TASKS', 'T-FOREIGN').Progress_Percent, 0);

  const forged = app.context.Ui.updateProgress({ taskId: 'T-FOREIGN', progress: 90, actor: 'admin@example.test', role: 'ADMIN', ownerId: 'M-MGR' });
  assert.equal(forged.ok, false, 'a role or owner supplied by the browser is ignored');
  assert.equal(app.context.Ui.assignTask({ projectId: 'P1', taskName: '偽装', ownerId: 'M-ENG' }).ok, false);

  const viewer = fixtures.base({ actor: 'viewer@example.test' });
  assert.equal(viewer.context.Ui.updateProgress({ taskId: 'T1', progress: 10 }).ok, false);
  assert.equal(viewer.context.Database.find('TASKS', 'T1').Progress_Percent, 25);

  const manager = fixtures.base({ actor: 'manager@example.test' });
  manager.context.Database.insert('PROJECTS', { Project_ID: 'P-MINE', Project_Name: '管理案件', Status: 'Active', Project_Owner_ID: 'M-MGR' });
  manager.context.Database.insert('TASKS', { Task_ID: 'T-MINE', Project_ID: 'P-MINE', Task_Name: '管理下の作業', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2026-12-20' });
  assert.equal(manager.context.Ui.updateProgress({ taskId: 'T-MINE', progress: 30 }).ok, true);
  assert.equal(manager.context.Ui.updateProgress({ taskId: 'T1', progress: 30 }).ok, true, 'M-MGR owns P1');
  manager.context.Database.insert('PROJECTS', { Project_ID: 'P-ENG', Project_Name: '設計主導案件', Status: 'Active', Project_Owner_ID: 'M-ENG' });
  manager.context.Database.insert('TASKS', { Task_ID: 'T-ENG', Project_ID: 'P-ENG', Task_Name: '設計主導の作業', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2026-12-20' });
  assert.equal(manager.context.Ui.updateProgress({ taskId: 'T-ENG', progress: 30 }).ok, false,
    'a manager cannot edit work of a project they do not own');

  const admin = fixtures.base();
  admin.context.Database.insert('TASKS', { Task_ID: 'T-ADMIN', Project_ID: 'P1', Task_Name: '管理者確認', Owner_Member_ID: 'M-MGR', Status: 'Assigned', Due_Date: '2026-12-20' });
  assert.equal(admin.context.Ui.updateProgress({ taskId: 'T-ADMIN', progress: 55 }).ok, true);
});

test('member-scoped data hides other assessments, roles and unrelated projects', () => {
  const app = fixtures.base({ actor: 'engineer@example.test', properties: { ALLOW_MEMBER_SELF_SERVICE: 'true' } });
  app.context.Database.insert('SKILLS', { Skill_ID: 'SK1', Skill_Name: '機械設計' });
  app.context.Database.insert('MEMBER_SKILLS', { Member_Skill_ID: 'MS1', Member_ID: 'M-MGR', Skill_ID: 'SK1', Current_Level: 4 });
  app.context.Database.insert('PROJECTS', { Project_ID: 'P-OTHER', Project_Name: '他部署案件', Status: 'Active', Project_Owner_ID: 'M-MGR' });

  const scoped = app.context.Ui.context();
  assert.equal(scoped.ok, true);
  assert.equal(scoped.data.canManage, false);
  assert.deepEqual(scoped.data.tasks.map(task => task.id).sort(), ['T1', 'T2', 'T3']);
  assert.deepEqual(scoped.data.projects.map(project => project.id).sort(), ['P1', 'P2']);
  const others = scoped.data.members.filter(member => member.id !== 'M-ENG');
  assert.equal(others.every(member => member.email === undefined && member.role === undefined), true);
  const own = scoped.data.members.find(member => member.id === 'M-ENG');
  assert.equal(own.email, 'engineer@example.test');

  const skills = app.context.Ui.skills();
  assert.equal(skills.ok, true);
  assert.equal(skills.data.gaps.length, 0);
  assert.equal(skills.data.matrix.length, 2, 'header plus own row only');
  assert.equal(app.context.Ui.members().ok, false);

  const manager = fixtures.base({ actor: 'manager@example.test' });
  const full = manager.context.Ui.context();
  assert.equal(full.data.canManage, true);
  assert.ok(full.data.members.every(member => member.email));
  assert.ok(full.data.projects.some(project => project.id === 'P2'));
});

test('stored spreadsheet text is rendered as text, never as markup', () => {
  const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const app = fixtures.base({ actor: 'manager@example.test' });
  app.context.Database.update('MEMBERS', 'M-ENG', { Name: payload });
  app.context.Database.update('PROJECTS', 'P1', { Project_Name: payload });
  app.context.Database.update('TASKS', 'T1', { Task_Name: payload });

  const ui = runSidebar(app, 'showManagerSidebar', app.context.Ui.context().data);
  assert.equal(ui.elements.get('memberList').textContent.includes(payload), true);
  assert.equal(ui.elements.get('actor').textContent.includes('manager@example.test'), true);

  const safe = runSidebar(app, 'showAutomationSidebar', {
    settings: [],
    status: { mode: 'OFF', reason: 'EMAIL_MODE_OFF', configured: true, activated: true },
    history: [{ created: '2026-10-25', type: payload, recipient: payload, result: '<b>PENDING</b>', error: payload }]
  });
  const history = safe.elements.get('history').textContent;
  assert.equal(history.includes(payload), true);
  assert.equal(history.includes('<img'), true);

  const system = runSidebar(app, 'showSystemSidebar', {
    health: { environment: 'DEVELOPMENT', emailMode: 'OFF', emailModeReason: payload, notificationsActivated: false, calendarEnabled: false, automationConfigured: true },
    valid: false, errorCount: 1, errors: [payload], rowCounts: { TASKS: 1 },
    triggers: { installed: [], missing: [], obsolete: [], duplicates: [], scheduleMatches: true }
  });
  assert.equal(system.elements.get('output').textContent.includes(payload), true);
  assert.equal(system.elements.get('output').textContent.includes('<img'), true);
});

test('no sidebar template builds markup from data', () => {
  for (const name of fs.readdirSync(SRC).filter(file => file.endsWith('.html'))) {
    const content = fs.readFileSync(path.join(SRC, name), 'utf8');
    assert.doesNotMatch(content, /\.(?:innerHTML|outerHTML)\s*=/, `${name} assigns innerHTML`);
    assert.doesNotMatch(content, /insertAdjacentHTML|document\.write/, `${name} uses unsafe HTML APIs`);
  }
  const menu = fs.readFileSync(path.join(SRC, 'UiMenu.html'), 'utf8');
  assert.match(menu, /include\('UiSafe'\)/, 'the shared safe renderer must be included');
  const safeScript = scriptsOf('UiSafe.html').join('\n');
  assert.match(safeScript, /textContent/, 'safe renderer must use textContent');
});

test('the shared renderer keeps hostile strings inert', () => {
  const { document, elements } = createDocument();
  const sandbox = { document, window: { confirm: () => true }, console };
  vm.createContext(sandbox);
  vm.runInContext(scriptsOf('UiSafe.html').join('\n'), sandbox);
  const target = document.getElementById('target');
  const hostile = '<svg onload=alert(1)>"><script>x</script>';
  sandbox.EH.renderRecords(target, [{ name: hostile }, { name: 'ok' }], record => record.name);
  assert.equal(target.textContent, hostile + 'ok');
  assert.equal(target.childNodes.length, 2);
  assert.equal(target.childNodes[0].textContent, hostile);
  sandbox.EH.setStatus(document.getElementById('status'), 'error', hostile);
  assert.equal(document.getElementById('status').textContent, hostile);
  assert.equal(document.getElementById('status').className, 'error');
});

test('first administrator bootstrap is allowlisted, one-time and audited', () => {
  const properties = { ADMIN_BOOTSTRAP_ALLOWLIST: 'bootstrap@example.test' };
  function seed(options = {}) {
    const app = fixtures.app({ actor: 'bootstrap@example.test', properties });
    app.context.Database.insert('MEMBERS', { Member_ID: 'M-BOOT', Name: '初期管理者', Email: 'bootstrap@example.test', Active: true, Role: 'MEMBER', Weekly_Capacity_Hours: 40 });
    return app;
  }

  const app = seed();
  assert.throws(() => app.context.bootstrapFirstAdministrator('bootstrap@example.test', 'BOOTSTRAP ADMIN'), /confirmation/);
  assert.throws(() => app.context.bootstrapFirstAdministrator('other@example.test', 'BOOTSTRAP ADMIN other@example.test'), /verified/);
  assert.equal(app.context.Database.find('MEMBERS', 'M-BOOT').Role, 'MEMBER');

  const denied = fixtures.app({ actor: 'bootstrap@example.test', properties: { ADMIN_BOOTSTRAP_ALLOWLIST: 'someone@example.test' } });
  denied.context.Database.insert('MEMBERS', { Member_ID: 'M-BOOT', Name: '初期管理者', Email: 'bootstrap@example.test', Active: true, Role: 'MEMBER' });
  assert.throws(() => denied.context.bootstrapFirstAdministrator('bootstrap@example.test', 'BOOTSTRAP ADMIN bootstrap@example.test'), /allowlist/);

  const noAllowlist = fixtures.app({ actor: 'bootstrap@example.test', properties: {} });
  noAllowlist.context.Database.insert('MEMBERS', { Member_ID: 'M-BOOT', Name: '初期管理者', Email: 'bootstrap@example.test', Active: true, Role: 'MEMBER' });
  assert.throws(() => noAllowlist.context.bootstrapFirstAdministrator('bootstrap@example.test', 'BOOTSTRAP ADMIN bootstrap@example.test'), /deployment allowlist/);

  const result = app.context.bootstrapFirstAdministrator('bootstrap@example.test', 'BOOTSTRAP ADMIN bootstrap@example.test');
  assert.equal(result.memberId, 'M-BOOT');
  assert.equal(app.context.Database.find('MEMBERS', 'M-BOOT').Role, 'ADMIN');
  assert.ok(app.properties.getProperty('ADMIN_BOOTSTRAP_COMPLETED_AT'));
  const audit = app.context.Database.read('AUDIT_LOG').filter(row => row.Action === 'ADMIN_BOOTSTRAPPED');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].Entity_ID, 'M-BOOT');
  assert.match(audit[0].New_Value, /bootstrap@example\.test/);

  assert.throws(() => app.context.bootstrapFirstAdministrator('bootstrap@example.test', 'BOOTSTRAP ADMIN bootstrap@example.test'), /already been used/);

  const withAdmin = seed();
  withAdmin.context.Database.update('MEMBERS', 'M-BOOT', { Role: 'ADMIN' });
  assert.throws(() => withAdmin.context.bootstrapFirstAdministrator('bootstrap@example.test', 'BOOTSTRAP ADMIN bootstrap@example.test'), /administrator already exists/);

  const again = fixtures.app({ actor: 'bootstrap@example.test', properties });
  again.context.Database.insert('MEMBERS', { Member_ID: 'M-BOOT', Name: '初期管理者', Email: 'bootstrap@example.test', Active: true, Role: 'ADMIN' });
  assert.throws(() => again.context.bootstrapFirstAdministrator('bootstrap@example.test', 'BOOTSTRAP ADMIN bootstrap@example.test'), /administrator already exists/);
});

test('bootstrap refuses an operational workbook', () => {
  const properties = { ADMIN_BOOTSTRAP_ALLOWLIST: 'bootstrap@example.test' };
  const app = fixtures.app({ actor: 'bootstrap@example.test', properties });
  app.context.Database.insert('MEMBERS', { Member_ID: 'M-BOOT', Name: '初期管理者', Email: 'bootstrap@example.test', Active: true, Role: 'MEMBER' });
  app.context.Database.insert('NOTIFICATION_LOG', { Notification_Key: 'k', Result: 'SENT' });
  assert.throws(() => app.context.bootstrapFirstAdministrator('bootstrap@example.test', 'BOOTSTRAP ADMIN bootstrap@example.test'), /Notification history exists/);

  const activated = fixtures.app({ actor: 'bootstrap@example.test', properties });
  activated.context.Database.insert('MEMBERS', { Member_ID: 'M-BOOT', Name: '初期管理者', Email: 'bootstrap@example.test', Active: true, Role: 'MEMBER' });
  activated.properties.setProperties({ NOTIFICATION_ACTIVATION_AT: new Date().toISOString(), NOTIFICATION_AUTHORIZED_BY: 'bootstrap@example.test' });
  assert.throws(() => activated.context.bootstrapFirstAdministrator('bootstrap@example.test', 'BOOTSTRAP ADMIN bootstrap@example.test'), /already activated/);

  const missingMember = fixtures.app({ actor: 'bootstrap@example.test', properties });
  assert.throws(() => missingMember.context.bootstrapFirstAdministrator('bootstrap@example.test', 'BOOTSTRAP ADMIN bootstrap@example.test'), /Create an active member record/);
});
