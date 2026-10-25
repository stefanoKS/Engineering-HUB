'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers');

function fixture(properties = {}, options = {}) {
  const app = loadApp({
    properties: {
      EMAIL_ENABLED: 'true', DRY_RUN: 'false',
      ALLOWED_RECIPIENT_DOMAINS: 'example.test', ...properties
    }, ...options
  });
  app.run(`
    Object.keys(Schema.tables).forEach(function(name) {
      var sheet = Database.book().insertSheet(name);
      sheet.appendRow(Schema.tables[name].fields.map(function(field) { return field.name; }));
    });
    Database.insert('MEMBERS', {Member_ID:'m1',Name:'Owner',Email:'owner@example.test',Active:true});
    Database.insert('MEMBERS', {Member_ID:'m2',Name:'Manager',Email:'admin@example.test',Active:true});
    Database.insert('PROJECTS', {Project_ID:'p1',Project_Name:'Project',Status:'Active'});
    Database.insert('TASKS', {Task_ID:'t1',Project_ID:'p1',Task_Name:'Task',
      Owner_Member_ID:'m1',Status:'Assigned',Due_Date:'2030-02-01',Notification_Enabled:true});
  `);
  return app;
}

function activate(app) {
  app.run(`activateNotifications('admin@example.test','ACTIVATE NOTIFICATIONS')`);
}
function approve(app, id = 't1') {
  app.run(`approveTaskNotifications(${JSON.stringify(id)},'admin@example.test','APPROVE ASSIGNMENT')`);
}
function scan(app, now = '2030-01-01T12:00:00Z') {
  return app.context.Notifications.scan(now);
}
function rows(app, name) {
  return app.context.Database.read(name);
}
function rawEdit(app, table, id, field, value) {
  const definition = app.context.Schema.tables[table];
  const sheet = app.book.getSheetByName(table);
  const headers = sheet.rows[0];
  const row = sheet.rows.findIndex(row => row[headers.indexOf(definition.id)] === id);
  sheet.getRange(row + 1, headers.indexOf(field) + 1).setValue(value);
}

test('unbound environments fail closed; activation needs verified actor and exact confirmation', () => {
  const unbound = loadApp({ properties: { BOUND_ENVIRONMENT: 'PRODUCTION' } });
  assert.throws(() => unbound.context.scanNotifications(), /binding/);
  const app = fixture();
  assert.throws(() => app.context.activateNotifications('admin@example.test', 'yes'), /confirmation/);
  assert.throws(() => app.context.activateNotifications('other@example.test', 'ACTIVATE NOTIFICATIONS'), /verified/);
  assert.equal(app.properties.getProperty('NOTIFICATION_ACTIVATION_AT'), null);
  activate(app);
  assert.throws(() => activate(app), /already/);
});

test('activation baselines historical tasks silently and requires explicit later approval', () => {
  const app = fixture();
  app.context.Database.update('TASKS', 't1', { Assignment_Approved_At: '2020-01-01T00:00:00Z' });
  activate(app);
  assert.equal(rows(app, 'TASKS')[0].Assignment_Approved_At, '');
  scan(app);
  assert.equal(app.sentEmails.length, 0);
  approve(app);
  scan(app);
  scan(app);
  assert.equal(app.sentEmails.length, 1);
  assert.equal(rows(app, 'NOTIFICATION_LOG')[0].Result, 'SENT');
  assert.equal(rows(app, 'NOTIFICATION_LOG')[0].Notification_Type, 'NEW_ASSIGNMENT');
});

test('first observation and direct owner/deadline changes revoke approval without sending', () => {
  const app = fixture({
    NOTIFICATION_ACTIVATION_AT: '2020-01-01T00:00:00Z',
    NOTIFICATION_AUTHORIZED_BY: 'admin@example.test'
  });
  app.context.Database.update('TASKS', 't1', { Assignment_Approved_At: '2021-01-01T00:00:00Z' });
  scan(app);
  assert.equal(app.sentEmails.length, 0);
  approve(app);
  scan(app);
  const previousVersion = rows(app, 'TASKS')[0].Assignment_Version;
  rawEdit(app, 'TASKS', 't1', 'Due_Date', '2030-03-01');
  scan(app);
  assert.equal(app.sentEmails.length, 1);
  assert.equal(rows(app, 'TASKS')[0].Assignment_Approved_At, '');
  assert.equal(rows(app, 'TASKS')[0].Assignment_Version, previousVersion + 1);
  approve(app);
  scan(app);
  assert.equal(rows(app, 'NOTIFICATION_LOG')[1].Notification_Type, 'DEADLINE_CHANGE');
  rawEdit(app, 'TASKS', 't1', 'Owner_Member_ID', 'm2');
  scan(app);
  assert.equal(app.sentEmails.length, 2);
  approve(app);
  scan(app);
  assert.equal(app.sentEmails[2].to, 'admin@example.test');
  assert.equal(rows(app, 'NOTIFICATION_LOG')[2].Notification_Type, 'REASSIGNMENT');
});

test('dry runs never send or consume future live dedupe keys', () => {
  const app = fixture({ DRY_RUN: 'true' });
  activate(app);
  approve(app);
  assert.equal(scan(app).dryRun, 1);
  assert.equal(rows(app, 'NOTIFICATION_LOG').length, 0);
  assert.equal(app.sentEmails.length, 0);
  app.properties.setProperty('DRY_RUN', 'false');
  scan(app);
  assert.equal(app.sentEmails.length, 1);
});

test('pending is persisted before sending and ambiguous delivery is never retried', () => {
  const app = fixture();
  activate(app);
  approve(app);
  let attempts = 0;
  app.context.MailApp.sendEmail = () => {
    attempts++;
    assert.equal(rows(app, 'NOTIFICATION_LOG')[0].Result, 'PENDING');
    throw new Error('Network failed after possible delivery');
  };
  assert.equal(scan(app).pending, 1);
  scan(app);
  assert.equal(attempts, 1);
  assert.equal(rows(app, 'NOTIFICATION_LOG')[0].Result, 'PENDING');
});

test('7-day and 2-day reminders have distinct persistent stages', () => {
  const app = fixture();
  activate(app);
  approve(app);
  scan(app);
  scan(app, '2030-01-25T12:00:00Z');
  scan(app, '2030-01-25T12:00:00Z');
  scan(app, '2030-01-30T12:00:00Z');
  assert.equal(app.sentEmails.length, 3);
  assert.match(rows(app, 'NOTIFICATION_LOG')[1].Notification_Key, /"7"/);
  assert.match(rows(app, 'NOTIFICATION_LOG')[2].Notification_Key, /"2"/);
});

test('recipient validation and cancelled parents suppress delivery', () => {
  for (const mutate of [
    app => app.context.Database.update('MEMBERS', 'm1', { Active: false }),
    app => app.context.Database.update('MEMBERS', 'm1', { Email: 'owner@outside.test' }),
    app => app.context.Database.update('PROJECTS', 'p1', { Status: 'Cancelled' }),
    app => app.context.Database.update('PROJECTS', 'p1', { Status: 'On Hold' }),
    app => app.context.Database.update('TASKS', 't1', { Notification_Enabled: false }),
    app => app.context.Database.update('TASKS', 't1', { Status: 'Done' })
  ]) {
    const app = fixture();
    activate(app);
    approve(app);
    mutate(app);
    scan(app);
    assert.equal(app.sentEmails.length, 0);
  }
});

test('weekly management summaries are deduped and count toward the shared run limit', () => {
  const app = fixture({ MAX_EMAILS_PER_RUN: '1', MANAGEMENT_RECIPIENTS: 'admin@example.test,admin@example.test,unsafe@outside.test' });
  activate(app);
  approve(app);
  scan(app, '2030-02-04T12:00:00Z');
  assert.equal(app.sentEmails.length, 1);
  scan(app, '2030-02-04T12:00:00Z');
  assert.equal(app.sentEmails.length, 2);
  assert.equal(rows(app, 'NOTIFICATION_LOG')[1].Notification_Type, 'OVERDUE');
  scan(app, '2030-02-04T12:00:00Z');
  assert.equal(app.sentEmails.length, 3);
  assert.equal(rows(app, 'NOTIFICATION_LOG')[2].Notification_Type, 'OVERDUE_SUMMARY');
  scan(app, '2030-02-05T12:00:00Z');
  assert.equal(app.sentEmails.length, 3);
  scan(app, '2030-02-11T12:00:00Z');
  assert.equal(app.sentEmails.length, 4);
  assert.equal(rows(app, 'NOTIFICATION_LOG')[3].Notification_Type, 'OVERDUE');
});

test('calendar is disabled by default; opt-in maintains owned IDs and marks cancellation', () => {
  const app = fixture();
  app.context.Database.insert('MILESTONES', {
    Milestone_ID: 'ms1', Project_ID: 'p1', Milestone_Name: 'Gate', Target_Date: '2030-02-01'
  });
  assert.equal(app.context.syncMilestoneCalendar().disabled, true);
  assert.equal(app.calendarEvents.length, 0);
  app.properties.setProperties({ CALENDAR_ENABLED: 'true', CALENDAR_ID: 'hub@group.calendar.google.com' });
  app.addCalendar('hub@group.calendar.google.com');
  assert.equal(app.context.syncMilestoneCalendar().created, 1);
  const eventId = rows(app, 'MILESTONES')[0].Calendar_Event_ID;
  app.context.syncMilestoneCalendar();
  assert.equal(app.calendarEvents.length, 1);
  app.context.Database.update('PROJECTS', 'p1', { Status: 'Cancelled' });
  assert.equal(app.context.syncMilestoneCalendar().updated, 1);
  assert.match(app.calendarEvents[0].title, /^\[CANCELLED\]/);
  assert.equal(rows(app, 'MILESTONES')[0].Calendar_Event_ID, eventId);
  assert.equal(app.calendarEvents[0].deleted, undefined);
});

test('calendar refuses to modify a foreign stored event or create replacement for missing ID', () => {
  const app = fixture({ CALENDAR_ENABLED: 'true', CALENDAR_ID: 'hub@group.calendar.google.com' });
  const foreign = app.calendars.get('hub@group.calendar.google.com')
    .createAllDayEvent('Personal event', new Date(), { description: 'Not owned' });
  app.context.Database.insert('MILESTONES', {
    Milestone_ID: 'ms1', Project_ID: 'p1', Milestone_Name: 'Gate',
    Target_Date: '2030-02-01', Calendar_Event_ID: foreign.getId()
  });
  app.context.syncMilestoneCalendar();
  assert.equal(foreign.title, 'Personal event');
  app.context.Database.update('MILESTONES', 'ms1', { Calendar_Event_ID: 'missing' });
  app.context.syncMilestoneCalendar();
  assert.equal(app.calendarEvents.length, 1);
});

test('authorized trigger installation is explicit, idempotent, and preserves unrelated handlers', () => {
  const app = fixture();
  const unrelated = app.context.ScriptApp.newTrigger('unrelated').timeBased().everyDays(1).create();
  assert.throws(() => app.context.installAuthorizedTriggers('admin@example.test', 'yes'), /confirmation/);
  assert.equal(app.triggers.length, 1);
  app.context.installAuthorizedTriggers('admin@example.test', 'INSTALL AUTHORIZED TRIGGERS');
  app.context.ScriptApp.newTrigger('scheduledNotificationScan').timeBased().everyHours(1).create();
  app.context.installAuthorizedTriggers('admin@example.test', 'INSTALL AUTHORIZED TRIGGERS');
  assert.equal(app.triggers.length, 4);
  assert.ok(app.triggers.includes(unrelated));
  assert.equal(app.triggers.find(trigger => trigger.handler === 'scheduledDailyBackup').everyDays, 1);
});

test('audit actor stays blank when identity is unavailable', () => {
  const app = fixture({}, { actor: '' });
  app.context.AuditLog.write('TEST', 'SYSTEM', '', {});
  assert.equal(rows(app, 'AUDIT_LOG')[0].Actor, '');
  assert.throws(() => activate(app), /verified/);
});

test('health and validation report the explicitly bound book and broken direct-sheet references', () => {
  const app = fixture();
  assert.equal(app.context.healthCheck().spreadsheetId, 'test-db');
  assert.equal(app.context.validateSystem().valid, true);
  rawEdit(app, 'TASKS', 't1', 'Project_ID', 'missing-project');
  const validation = app.context.validateSystem();
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.includes('Project_ID: missing reference')));
});

test('management entrypoint refreshes generated views without mail or triggers', () => {
  const app = fixture();
  const result = app.context.refreshManagement('2030-01-01');
  assert.equal(result.dashboard.activeProjects, 1);
  assert.ok(app.book.getSheetByName('DASHBOARD'));
  assert.ok(app.book.getSheetByName('WORKLOAD'));
  assert.ok(app.book.getSheetByName('SKILL_MATRIX'));
  assert.equal(app.sentEmails.length, 0);
  assert.equal(app.triggers.length, 0);
});

test('Japanese task messages include details and safely escape rich HTML', () => {
  const app = fixture();
  app.context.Database.update('TASKS', 't1', {
    Task_Name: '<script>alert("x")</script>', Next_Action: '設計を確認', Acceptance_Criteria: '試験合格'
  });
  activate(app);
  approve(app);
  scan(app);
  const mail = app.sentEmails[0];
  assert.match(mail.subject, /新規割当/);
  assert.match(mail.body, /設計を確認/);
  assert.match(mail.body, /試験合格/);
  assert.match(mail.body, /2030-02-01/);
  assert.match(mail.htmlBody, /&lt;script&gt;/);
  assert.doesNotMatch(mail.htmlBody, /<script>/);
});
