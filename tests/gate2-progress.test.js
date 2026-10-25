'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

function project(app, id, overrides = {}) {
  return app.context.Database.insert('PROJECTS', Object.assign({
    Project_ID: id, Project_Name: id, Status: 'Active', Project_Owner_ID: '',
    Committed_Deadline: '2099-12-31', Last_Updated: app.context.Domain.today()
  }, overrides));
}

test('effort-weighted progress reproduces the documented example and falls back to weight 1', () => {
  const app = fixtures.base();
  const db = app.context.Database;
  project(app, 'PP');
  const own = () => db.read('TASKS').filter(task => task.Project_ID === 'PP');
  db.insert('TASKS', { Task_ID: 'A', Project_ID: 'PP', Task_Name: 'A', Owner_Member_ID: 'M-ENG', Status: 'Done', Progress_Percent: 100, Estimated_Hours: 40 });
  db.insert('TASKS', { Task_ID: 'B', Project_ID: 'PP', Task_Name: 'B', Owner_Member_ID: 'M-ENG', Status: 'In Progress', Progress_Percent: 50, Estimated_Hours: 60 });
  db.insert('TASKS', { Task_ID: 'C', Project_ID: 'PP', Task_Name: 'C', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Progress_Percent: 0, Estimated_Hours: 20 });

  const result = app.context.Progress.rollup(own());
  assert.equal(result.percent, 58.33);
  assert.equal(result.unknown, 0);

  db.insert('TASKS', { Task_ID: 'D', Project_ID: 'PP', Task_Name: 'D', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Progress_Percent: 0 });
  const withUnknown = app.context.Progress.rollup(own());
  assert.equal(withUnknown.unknown, 1);
  assert.equal(withUnknown.percent, Math.round((7000 / 121) * 100) / 100);

  db.insert('TASKS', { Task_ID: 'E', Project_ID: 'PP', Task_Name: 'E', Owner_Member_ID: 'M-ENG', Status: 'Cancelled', Estimated_Hours: 1000, Progress_Percent: 0 });
  assert.equal(app.context.Progress.rollup(own()).percent, withUnknown.percent);
  assert.equal(app.context.Progress.display({ calculated: false, percent: null }), '未計算');
});

test('project rollup counts direct and subproject tasks exactly once', () => {
  const app = fixtures.base();
  const db = app.context.Database;
  project(app, 'PD');
  db.insert('SUBPROJECTS', { Subproject_ID: 'SD', Project_ID: 'PD', Subproject_Name: 'Sub', Status: 'Active' });
  db.insert('TASKS', { Task_ID: 'D1', Project_ID: 'PD', Subproject_ID: 'SD', Task_Name: 'Sub task', Owner_Member_ID: 'M-ENG', Status: 'Done', Progress_Percent: 100, Estimated_Hours: 40 });
  db.insert('TASKS', { Task_ID: 'D2', Project_ID: 'PD', Task_Name: 'Direct task', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Progress_Percent: 0, Estimated_Hours: 10 });

  const direct = app.context.Progress.rollup(db.read('TASKS').filter(task => task.Project_ID === 'PD'));
  assert.equal(direct.tasks, 2);
  assert.equal(direct.percent, 80);

  const patched = app.context.Progress.refresh();
  assert.ok(patched.projects >= 1);
  assert.ok(patched.subprojects >= 1);
  assert.equal(db.find('PROJECTS', 'PD').Progress_Percent, 80);
  assert.equal(db.find('SUBPROJECTS', 'SD').Progress_Percent, 100);

  project(app, 'PEMPTY');
  app.context.Progress.refresh();
  assert.equal(db.find('PROJECTS', 'PEMPTY').Progress_Percent, '');
});

test('project health is deterministic and never green without schedule information', () => {
  const app = fixtures.base();
  const context = app.context;
  const today = context.Domain.today();
  project(app, 'H-GREEN', { Forecast_End: '2099-12-20', Project_Owner_ID: 'M-MGR' });
  project(app, 'H-UNKNOWN', { Committed_Deadline: '', Forecast_End: '' });
  project(app, 'H-RED', { Committed_Deadline: '2020-01-01', Forecast_End: '2020-02-01' });
  project(app, 'H-PLAN', { Status: 'Planned', Committed_Deadline: '' });
  project(app, 'H-HOLD', { Status: 'On Hold' });
  project(app, 'H-STALE', { Last_Updated: '2026-01-01T00:00:00.000Z' });

  const analysis = context.Dashboard.analyze(today);
  const health = Object.create(null);
  analysis.projects.forEach(item => { health[item.project.Project_ID] = item.health.health; });

  assert.equal(health['H-GREEN'], 'GREEN');
  assert.equal(health['H-UNKNOWN'], 'UNKNOWN');
  assert.equal(health['H-RED'], 'RED');
  assert.equal(health['H-PLAN'], 'PLANNED');
  assert.equal(health['H-HOLD'], 'ON_HOLD');
  assert.equal(health['H-STALE'], 'YELLOW');
  assert.equal(health['P2'], 'ARCHIVED');

  const stale = analysis.projects.find(item => item.project.Project_ID === 'H-STALE');
  assert.ok(stale.health.reasons.indexOf('STALE_UPDATE') >= 0);

  const again = context.Dashboard.analyze(today);
  const repeat = Object.create(null);
  again.projects.forEach(item => { repeat[item.project.Project_ID] = item.health.health; });
  assert.deepEqual(repeat, health);
});

test('reverse planning keeps each project plan and honors Japanese holidays', () => {
  const app = fixtures.base();
  const context = app.context;
  const db = context.Database;
  db.insert('HOLIDAYS', { Date: '2026-11-03', Name: '文化の日' });
  const phases = [
    { Phase_ID: 'design', Phase_Name: '設計', Duration_Days: 2, Buffer_Days: 0, Dependency_IDs: '' },
    { Phase_ID: 'build', Phase_Name: '製作', Duration_Days: 2, Buffer_Days: 0, Dependency_IDs: 'design' }
  ];

  const first = context.reversePlan('P1', '2026-11-04', phases);
  assert.equal(first[1].Start_Date, '2026-11-02');
  assert.equal(first[0].End_Date, '2026-10-30');
  assert.equal(first[0].Start_Date, '2026-10-29');

  context.reversePlan('P2', '2026-11-30', phases);
  let active = db.read('PROJECT_PHASES').filter(row => row.Active === true);
  assert.equal(active.filter(row => row.Project_ID === 'P1').length, 2);
  assert.equal(active.filter(row => row.Project_ID === 'P2').length, 2);

  context.reversePlan('P1', '2026-11-06', phases);
  active = db.read('PROJECT_PHASES').filter(row => row.Active === true);
  assert.equal(active.filter(row => row.Project_ID === 'P1').length, 2);
  assert.equal(active.filter(row => row.Project_ID === 'P2').length, 2);
  const p2 = db.read('PROJECT_PHASES').filter(row => row.Project_ID === 'P2');
  assert.equal(p2.every(row => row.Active === true), true);
  assert.equal(Number(p2[0].Plan_Version), 1);
  assert.equal(db.read('PROJECT_PHASES').filter(row => row.Project_ID === 'P1' && row.Active === false).length, 2);

  const p1Active = active.filter(row => row.Project_ID === 'P1');
  assert.equal(p1Active[0].Committed_Deadline, '2026-11-06');
  assert.equal(Number(p1Active[0].Plan_Version), 2);

  const backplan = app.book.getSheetByName('BACKPLAN').getDataRange().getValues();
  const projects = new Set(backplan.slice(1).map(row => row[0]));
  assert.ok(projects.has('P1'));
  assert.ok(projects.has('P2'));
});

test('dashboard refresh never clears operational sheets or user columns', () => {
  const app = fixtures.base();
  const db = app.context.Database;
  const sheet = app.book.getSheetByName('PROJECTS');
  sheet.rows[0].push('Manual_Notes');
  sheet.rows[1].push('retain this note');
  const tasksBefore = JSON.stringify(db.read('TASKS'));

  app.context.Dashboard.refresh('2026-11-02');

  assert.equal(db.find('PROJECTS', 'P1').Manual_Notes, 'retain this note');
  assert.equal(JSON.stringify(db.read('TASKS')), tasksBefore);
  assert.ok(db.find('PROJECTS', 'P1').Health);
  assert.notEqual(db.find('PROJECTS', 'P1').Progress_Percent, '');
  assert.ok(app.book.getSheetByName('PROJECT_OVERVIEW'));
  assert.ok(app.book.getSheetByName('TEAM_VIEW'));
});
