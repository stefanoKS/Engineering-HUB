'use strict';

/**
 * V1.3 deadline + duration planning.
 *
 * The calculation must be pure and independently testable: no locale-dependent parsing,
 * no implicit labour-hour conversion, and no overlap rejection (the manager decides).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

function planning() {
  const app = fixtures.base();
  return app.context.Planning;
}

function holidays(rows) {
  return (rows || []).map(date => ({ Date: date, Name: 'holiday' }));
}

test('three working days from a Friday deadline starts on the Wednesday', () => {
  const plan = planning().planFromDuration('2026-11-20', 3, 'DAY', 'WORKING_DAYS', []);
  assert.equal(plan.startDate, '2026-11-18');
  assert.equal(plan.endDate, '2026-11-20');
  assert.equal(plan.length, 3);
});

test('one working week is five working days and starts on the Monday', () => {
  const plan = planning().planFromDuration('2026-11-20', 1, 'WEEK', 'WORKING_DAYS', []);
  assert.equal(plan.startDate, '2026-11-16');
  assert.equal(plan.length, 5);
});

test('weekends and holidays are excluded on the working-day basis', () => {
  const plan = planning().planFromDuration('2026-11-24', 4, 'DAY', 'WORKING_DAYS', holidays(['2026-11-23']));
  // 2026-11-24 (Tue) -> 24, 20 (Fri; 21/22 weekend, 23 holiday), 19 (Thu), 18 (Wed)
  assert.equal(plan.startDate, '2026-11-18');
  assert.equal(plan.length, 4);
});

test('calendar-day basis counts every date including weekends', () => {
  const module = planning();
  assert.equal(module.planFromDuration('2026-11-20', 3, 'DAY', 'CALENDAR_DAYS', []).startDate, '2026-11-18');
  assert.equal(module.planFromDuration('2026-11-20', 1, 'WEEK', 'CALENDAR_DAYS', []).startDate, '2026-11-14');
});

test('the range is inclusive: one day starts and ends on the deadline', () => {
  const module = planning();
  ['WORKING_DAYS', 'CALENDAR_DAYS'].forEach(basis => {
    const plan = module.planFromDuration('2026-11-20', 1, 'DAY', basis, []);
    assert.equal(plan.startDate, '2026-11-20');
    assert.equal(plan.endDate, '2026-11-20');
  });
});

test('a non-working deadline warns and never moves the committed deadline', () => {
  const app = fixtures.base();
  const warnings = app.context.Planning.planningWarnings({
    deadline: '2026-11-21', durationValue: 2, durationUnit: 'DAY',
    durationBasis: 'WORKING_DAYS', holidays: [], today: '2026-11-01'
  });
  assert.ok(warnings.some(warning => warning.code === 'NON_WORKING_DEADLINE'));
  const plan = app.context.Planning.planFromDuration('2026-11-21', 2, 'DAY', 'WORKING_DAYS', []);
  assert.equal(plan.endDate, '2026-11-21');
  assert.equal(plan.plannedEnd, '2026-11-20');
});

test('missing duration, missing deadline and past dates are reported', () => {
  const module = planning();
  assert.deepEqual(Array.from(module.planningWarnings({ deadline: '', today: '2026-11-01' }).map(item => item.code)),
    ['MISSING_DEADLINE']);
  assert.deepEqual(Array.from(module.planningWarnings({ deadline: '2026-11-20', today: '2026-11-01' }).map(item => item.code)),
    ['MISSING_DURATION']);
  const past = Array.from(module.planningWarnings({
    deadline: '2026-11-20', durationValue: 3, today: '2026-11-19', holidays: []
  }).map(item => item.code));
  assert.ok(past.indexOf('PAST_START') >= 0);
  assert.ok(module.planningWarnings({ deadline: '2026-11-01', durationValue: 2, today: '2026-11-20' })
    .some(item => item.code === 'PAST_DEADLINE'));
});

test('a related milestone inside the planned range is reported', () => {
  const module = planning();
  const warnings = module.planningWarnings({
    deadline: '2026-11-20', durationValue: 3, today: '2026-11-01', holidays: [],
    milestones: [{ Milestone_ID: 'M1', Milestone_Name: '設計審査', Target_Date: '2026-11-19' }]
  });
  const overlap = warnings.filter(item => item.code === 'MILESTONE_OVERLAP');
  assert.equal(overlap.length, 1);
  assert.equal(overlap[0].params.name, '設計審査');
});

test('only a manager-entered duration derives the planned start', () => {
  const app = fixtures.base();
  const tasks = app.context.Tasks;
  const derived = tasks.create({
    Task_ID: 'T-DERIVED', Project_ID: 'P1', Task_Name: '検査工程の設計', Owner_Member_ID: 'M-ENG',
    Status: 'Assigned', Due_Date: '2026-11-20', Planned_Duration_Value: 3,
    Planned_Duration_Unit: 'DAY', Planned_Duration_Basis: 'WORKING_DAYS'
  });
  assert.equal(derived.Planned_Start, '2026-11-18');
  assert.equal(derived.Planned_Start_Source, 'DERIVED');

  const legacy = tasks.create({
    Task_ID: 'T-LEGACY', Project_ID: 'P1', Task_Name: '従来の作業', Owner_Member_ID: 'M-ENG',
    Status: 'Assigned', Planned_Start: '2026-11-02', Due_Date: '2026-11-30'
  });
  assert.equal(legacy.Planned_Start, '2026-11-02');
  assert.notEqual(legacy.Planned_Start_Source, 'DERIVED');
  assert.equal(legacy.Planned_Duration_Value, '');
});

test('a legacy start survives an unrelated update and no duration is invented', () => {
  const app = fixtures.base();
  const before = app.context.Database.find('TASKS', 'T1');
  assert.equal(before.Planned_Start, '2026-11-01');
  const after = app.context.Tasks.update('T1', { Progress_Percent: 40 });
  assert.equal(after.Planned_Start, before.Planned_Start);
  assert.equal(after.Planned_Duration_Value, '');
  assert.equal(after.Planned_Start_Source, '');
});

test('duration never converts to labour hours and the project deadline is untouched', () => {
  const app = fixtures.base();
  const projectBefore = app.context.Database.find('PROJECTS', 'P1');
  const task = app.context.Tasks.create({
    Task_ID: 'T-HOURS', Project_ID: 'P1', Task_Name: '見積なしの作業', Owner_Member_ID: 'M-ENG',
    Status: 'Assigned', Due_Date: '2026-11-20', Estimated_Hours: 12,
    Planned_Duration_Value: 3, Planned_Duration_Unit: 'DAY', Planned_Duration_Basis: 'CALENDAR_DAYS'
  });
  assert.equal(task.Estimated_Hours, 12);
  assert.equal(task.Planned_Duration_Value, 3);
  assert.equal(task.Planned_Start, '2026-11-18');
  assert.equal(app.context.Database.find('PROJECTS', 'P1').Committed_Deadline, projectBefore.Committed_Deadline);
});

test('overlapping assignments are allowed for an authorized manager', () => {
  const app = fixtures.base();
  const tasks = app.context.Tasks;
  tasks.create({
    Task_ID: 'T-A', Project_ID: 'P1', Task_Name: '作業A', Owner_Member_ID: 'M-ENG', Status: 'Assigned',
    Due_Date: '2026-11-20', Planned_Duration_Value: 5, Planned_Duration_Unit: 'DAY', Planned_Duration_Basis: 'WORKING_DAYS'
  });
  const second = tasks.create({
    Task_ID: 'T-B', Project_ID: 'P1', Task_Name: '作業B', Owner_Member_ID: 'M-ENG', Status: 'Assigned',
    Due_Date: '2026-11-19', Planned_Duration_Value: 5, Planned_Duration_Unit: 'DAY', Planned_Duration_Basis: 'WORKING_DAYS'
  });
  const first = app.context.Database.find('TASKS', 'T-A');
  assert.equal(first.Planned_Start, '2026-11-16');
  assert.equal(second.Planned_Start, '2026-11-13');
  // The ranges overlap completely: nothing blocks the assignment.
  assert.ok(second.Planned_Start <= first.Planned_Start);
});

test('the calculated start invalidates the schedule confirmation', () => {
  const app = fixtures.base();
  app.context.Tasks.create({
    Task_ID: 'T-CONF', Project_ID: 'P1', Task_Name: '確認対象', Owner_Member_ID: 'M-ENG', Status: 'Assigned',
    Due_Date: '2026-11-20', Estimated_Hours: 8, Planned_Duration_Value: 2,
    Planned_Duration_Unit: 'DAY', Planned_Duration_Basis: 'WORKING_DAYS'
  });
  app.context.Tasks.confirmSchedule('T-CONF', 'admin@example.test', 'CONFIRM SCHEDULE');
  const confirmed = app.context.ScheduleConfirmations.active('T-CONF');
  assert.ok(confirmed);
  app.context.Tasks.update('T-CONF', { Due_Date: '2026-11-25' });
  assert.equal(app.context.ScheduleConfirmations.active('T-CONF'), null);
});

test('migration 005 is additive and keeps every legacy cell intact', () => {
  const app = fixtures.base();
  const tasks = app.book.getSheetByName('TASKS');
  ['Planned_Duration_Value', 'Planned_Duration_Unit', 'Planned_Duration_Basis', 'Planned_Start_Source']
    .forEach(field => {
      const column = tasks.rows[0].indexOf(field);
      if (column >= 0) tasks.rows.forEach(row => row.splice(column, 1));
    });
  app.book.sheets = app.book.sheets.filter(sheet =>
    sheet.name !== 'TASK_REQUESTS' && sheet.name !== 'TASK_DEADLINE_HISTORY');
  const history = app.book.getSheetByName('SCHEMA_MIGRATIONS');
  const versionColumn = history.rows[0].indexOf('New_Version');
  history.rows.forEach((row, index) => { if (index > 0) row[versionColumn] = 4; });
  assert.equal(app.context.Migrations.currentVersion(), 4);

  const before = JSON.parse(JSON.stringify(app.context.Backup.snapshot(app.book)));
  app.properties.setProperty('APPROVED_MIGRATIONS', '005_task_planning_and_requests,006_responsibilities_and_nested_subprojects,007_responsibility_hierarchy_and_lifecycle,008_task_and_responsibility_members');
  assert.equal(app.context.Migrations.upgrade(), 8);

  assert.ok(app.book.getSheetByName('TASK_REQUESTS'));
  assert.ok(app.book.getSheetByName('TASK_DEADLINE_HISTORY'));
  const legacy = app.context.Database.find('TASKS', 'T1');
  assert.equal(legacy.Planned_Start, '2026-11-01');
  assert.equal(legacy.Due_Date, '2026-12-15');
  assert.equal(legacy.Planned_Duration_Value, '');
  for (const old of before) {
    if (['SCHEMA_MIGRATIONS', 'BACKUP_LOG'].includes(old.name)) continue;
    const values = app.book.getSheetByName(old.name).getDataRange().getValues();
    old.values.forEach((row, r) => row.forEach((cell, c) => {
      assert.equal(values[r][c], cell, `${old.name} row ${r + 1} column ${c + 1} changed`);
    }));
  }
});

test('invalid durations and units are refused', () => {
  const module = planning();
  assert.throws(() => module.planFromDuration('2026-11-20', 0, 'DAY', 'WORKING_DAYS', []), /必要期間/);
  assert.throws(() => module.planFromDuration('2026-11-20', 1.5, 'DAY', 'WORKING_DAYS', []), /必要期間/);
  assert.throws(() => module.planFromDuration('2026-11-20', 1, 'MONTH', 'WORKING_DAYS', []), /unit/);
  assert.throws(() => module.planFromDuration('2026-11-20', 1, 'DAY', 'FORTNIGHT', []), /basis/);
  assert.throws(() => module.planFromDuration('', 1, 'DAY', 'WORKING_DAYS', []), /完了期限/);
});
