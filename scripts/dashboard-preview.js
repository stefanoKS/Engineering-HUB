'use strict';

/**
 * Local static preview for the shared dashboard.
 *
 * Development tooling only: it assembles dashboard-app/Index.html with the real Styles and
 * Client partials, publishes a fictional in-memory snapshot through the real publisher and
 * viewer services, and injects the resulting read-only payload as
 * `window.__DASHBOARD_PREVIEW__`. The browser then renders the **real** client script, which
 * is what makes screenshots from this file meaningful.
 *
 * The preview payload exists only when `google.script.run` is absent (a static file). In a
 * deployed Apps Script page the server path is always used.
 *
 * Usage:
 *   node scripts/dashboard-preview.js [--out <file>]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixtures = require(path.join(root, 'tests/fixtures'));
const dashboardFixtures = require(path.join(root, 'tests/dashboard-fixtures'));

function jstDate(offsetDays) {
  const now = new Date(Date.now() + 9 * 3600000);
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight + offsetDays * 86400000).toISOString().slice(0, 10);
}

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

function buildFixtureWorkbook() {
  const manager = fixtures.app();
  fixtures.bulk(manager, 'MEMBERS', [
    {Member_ID: 'M-ADMIN', Name: '開発 管理者', Email: 'admin@example.test', Active: true, Role: 'ADMIN'},
    {Member_ID: 'M1', Name: '設計 太郎', Email: 'taro@example.test', Active: true, Role: 'MANAGER', Weekly_Capacity_Hours: 40},
    {Member_ID: 'M2', Name: '設計 花子', Email: 'hanako@example.test', Active: true, Role: 'MEMBER', Weekly_Capacity_Hours: 40},
    {Member_ID: 'M3', Name: '製造 次郎', Email: 'jiro@example.test', Active: true, Role: 'MEMBER', Weekly_Capacity_Hours: 40},
    {Member_ID: 'M4', Name: '品質 三郎', Email: 'saburo@example.test', Active: true, Role: 'MEMBER', Weekly_Capacity_Hours: 40}
  ]);
  fixtures.bulk(manager, 'RESPONSIBILITIES', [
    {Responsibility_ID: 'RX1', Name: '製品設計', Description: '製品の機構・電気設計を担当します。',
      Owner_Member_ID: 'M1', Status: 'Active', Sort_Order: 1},
    {Responsibility_ID: 'RX2', Name: '自動化・工程設計', Description: '生産設備と工程設計を担当します。',
      Owner_Member_ID: 'M3', Status: 'Active', Sort_Order: 2},
    {Responsibility_ID: 'RX3', Name: '研究開発（旧）', Description: '終了した領域です。',
      Owner_Member_ID: 'M4', Status: 'Retired', Sort_Order: 3}
  ]);
  fixtures.bulk(manager, 'PROJECTS', [
    {Project_ID: 'PX1', Project_Name: '外観検査装置 立ち上げ', Category: '設計', Responsibility_ID: 'RX2',
      Project_Owner_ID: 'M1',
      Status: 'Active', Committed_Deadline: jstDate(12), Forecast_End: jstDate(18), Dashboard_Visibility: 'INTERNAL',
      Dashboard_Summary: '新ライン向けの外観検査装置を設計・製作し、量産立ち上げまでを担当します。光学系の選定は完了し、現在は搬送系の詳細設計を進めています。',
      Last_Updated: isoHoursAgo(3)},
    {Project_ID: 'PX2', Project_Name: '組立ライン更新', Category: '製造', Responsibility_ID: 'RX2',
      Project_Owner_ID: 'M1',
      Status: 'Active', Committed_Deadline: jstDate(31), Dashboard_Visibility: 'INTERNAL',
      Dashboard_Summary: '既存組立ラインの制御盤と搬送機構を更新します。停止時間を最小化するため、夜間の段取り替えで施工します。',
      Last_Updated: isoHoursAgo(20)},
    {Project_ID: 'PX3', Project_Name: '検査データ収集基盤', Category: 'ソフトウェア', Responsibility_ID: 'RX1',
      Project_Owner_ID: 'M2',
      Status: 'Active', Committed_Deadline: jstDate(6), Forecast_End: jstDate(9), Dashboard_Visibility: 'INTERNAL',
      Dashboard_Summary: '計測データを一元管理する基盤を整備します。既存装置からのデータ取得は完了済みです。',
      Last_Updated: isoHoursAgo(30)},
    {Project_ID: 'PX4', Project_Name: '治具標準化（第2期）', Category: '設計', Responsibility_ID: 'RX1',
      Project_Owner_ID: 'M2',
      Status: 'On Hold', Committed_Deadline: jstDate(45), Dashboard_Visibility: 'INTERNAL',
      Dashboard_Summary: '標準治具の設計ルールを整理します。量産計画の確定待ちで一時停止中です。',
      Last_Updated: isoHoursAgo(72)},
    {Project_ID: 'PX5', Project_Name: '出荷検査 自動化', Category: '製造', Responsibility_ID: 'RX3',
      Project_Owner_ID: 'M3',
      Status: 'Active', Committed_Deadline: jstDate(-4), Dashboard_Visibility: 'INTERNAL',
      Dashboard_Summary: '出荷検査の自動化を進めています。カメラ設置位置の調整が残っています。',
      Last_Updated: isoHoursAgo(8)},
    {Project_ID: 'PX6', Project_Name: '設備保全アプリ', Category: 'ソフトウェア',
      Project_Owner_ID: 'M4',
      Status: 'Planned', Committed_Deadline: jstDate(60), Dashboard_Visibility: 'INTERNAL',
      Dashboard_Summary: '保全記録をタブレットで入力できるようにします。要件定義の段階です。',
      Last_Updated: isoHoursAgo(50)},
    {Project_ID: 'PX7', Project_Name: '旧ライン移設（完了分）', Category: '製造', Responsibility_ID: 'RX2',
      Project_Owner_ID: 'M3',
      Status: 'Completed', Committed_Deadline: jstDate(-30), Actual_Completion: jstDate(-28),
      Dashboard_Visibility: 'INTERNAL', Dashboard_Summary: '旧ラインの移設が完了しました。現在は運用のみです。',
      Last_Updated: isoHoursAgo(200)},
    {Project_ID: 'PX8', Project_Name: '社外秘 評価案件', Category: '設計', Responsibility_ID: 'RX1',
      Project_Owner_ID: 'M1',
      Status: 'Active', Committed_Deadline: jstDate(10), Last_Updated: isoHoursAgo(10)}
  ]);
  fixtures.bulk(manager, 'SUBPROJECTS', [
    {Subproject_ID: 'SX1', Project_ID: 'PX1', Subproject_Name: '機構設計', Owner_ID: 'M2', Status: 'Active', Deadline: jstDate(10)},
    {Subproject_ID: 'SX1A', Project_ID: 'PX1', Parent_Subproject_ID: 'SX1', Subproject_Name: '光学系設計',
      Owner_ID: 'M2', Status: 'Active', Deadline: jstDate(6)},
    {Subproject_ID: 'SX1B', Project_ID: 'PX1', Parent_Subproject_ID: 'SX1', Subproject_Name: '搬送系設計',
      Owner_ID: 'M1', Status: 'Active', Deadline: jstDate(14)},
    {Subproject_ID: 'SX2', Project_ID: 'PX1', Subproject_Name: '電気設計', Owner_ID: 'M3', Status: 'Active', Deadline: jstDate(12)},
    {Subproject_ID: 'SX2A', Project_ID: 'PX1', Parent_Subproject_ID: 'SX2', Subproject_Name: 'PLC制御',
      Owner_ID: 'M3', Status: 'Active', Deadline: jstDate(12)},
    {Subproject_ID: 'SX3', Project_ID: 'PX2', Subproject_Name: '制御盤更新', Owner_ID: 'M3', Status: 'Active', Deadline: jstDate(28)},
    {Subproject_ID: 'SX4', Project_ID: 'PX3', Subproject_Name: 'データ収集', Owner_ID: 'M2', Status: 'Active', Deadline: jstDate(6)}
  ]);
  fixtures.bulk(manager, 'TASKS', [
    {Task_ID: 'TX1', Project_ID: 'PX1', Subproject_ID: 'SX1A', Task_Name: 'レンズ選定と光学シミュレーション',
      Owner_Member_ID: 'M2', Status: 'In Progress', Priority: 'High', Progress_Percent: 70,
      Planned_Start: jstDate(-20), Due_Date: jstDate(4), Estimated_Hours: 40, Public_Note: '光学系は選定済みです。最終評価を進めています。'},
    {Task_ID: 'TX2', Project_ID: 'PX1', Subproject_ID: 'SX1B', Task_Name: '搬送機構の詳細設計',
      Owner_Member_ID: 'M1', Status: 'Blocked', Priority: 'Critical', Progress_Percent: 30,
      Planned_Start: jstDate(-10), Due_Date: jstDate(-2), Estimated_Hours: 60, Public_Note: '部品の納期回答待ちです。'},
    {Task_ID: 'TX3', Project_ID: 'PX1', Subproject_ID: 'SX1B', Task_Name: '安全カバー設計',
      Owner_Member_ID: 'M2', Status: 'Assigned', Priority: 'Medium', Progress_Percent: 0,
      Due_Date: jstDate(9), Estimated_Hours: 16},
    {Task_ID: 'TX4', Project_ID: 'PX1', Task_Name: '客先仕様の最終確認',
      Owner_Member_ID: 'M1', Status: 'In Progress', Priority: 'High', Progress_Percent: 55,
      Planned_Start: jstDate(-5), Due_Date: jstDate(0), Estimated_Hours: '', Public_Note: '本日、仕様の最終合意を予定しています。'},
    {Task_ID: 'TX5', Project_ID: 'PX1', Task_Name: '検査基準書のドラフト作成',
      Owner_Member_ID: 'M4', Status: 'Not Started', Priority: 'Low', Progress_Percent: 0},
    {Task_ID: 'TX6', Project_ID: 'PX2', Subproject_ID: 'SX3', Task_Name: '制御盤の盤面設計',
      Owner_Member_ID: 'M3', Status: 'Done', Priority: 'Medium', Progress_Percent: 100,
      Due_Date: jstDate(-6), Estimated_Hours: 24, Completed_At: isoHoursAgo(150), Public_Note: '盤面設計は完了し、製作に回しました。'},
    {Task_ID: 'TX7', Project_ID: 'PX2', Subproject_ID: 'SX3', Task_Name: '現地据付と配線',
      Owner_Member_ID: 'M3', Status: 'Assigned', Priority: 'High', Progress_Percent: 10,
      Planned_Start: jstDate(5), Due_Date: jstDate(25), Estimated_Hours: 48},
    {Task_ID: 'TX8', Project_ID: 'PX3', Subproject_ID: 'SX4', Task_Name: '計測データの取り込み',
      Owner_Member_ID: 'M2', Status: 'In Progress', Priority: 'High', Progress_Percent: 80,
      Planned_Start: jstDate(-8), Due_Date: jstDate(2), Estimated_Hours: 20, Public_Note: '主要装置からの取得は完了しています。'},
    {Task_ID: 'TX9', Project_ID: 'PX3', Task_Name: '可視化ダッシュボード要件整理',
      Owner_Member_ID: 'M2', Status: 'Assigned', Priority: 'Medium', Progress_Percent: 15,
      Due_Date: jstDate(6), Estimated_Hours: 12},
    {Task_ID: 'TX10', Project_ID: 'PX5', Task_Name: 'カメラ設置位置の調整',
      Owner_Member_ID: 'M3', Status: 'In Progress', Priority: 'Critical', Progress_Percent: 45,
      Planned_Start: jstDate(-3), Due_Date: jstDate(-1), Estimated_Hours: 18, Public_Note: '照明条件の見直しを実施中です。'},
    {Task_ID: 'TX11', Project_ID: 'PX5', Task_Name: '判定アルゴリズムの調整',
      Owner_Member_ID: 'M4', Status: 'Blocked', Priority: 'High', Progress_Percent: 20,
      Due_Date: jstDate(3), Estimated_Hours: 30},
    {Task_ID: 'TX12', Project_ID: 'PX6', Task_Name: '保全記録の項目整理',
      Owner_Member_ID: 'M4', Status: 'Not Started', Priority: 'Low'},
    {Task_ID: 'TX13', Project_ID: 'PX7', Task_Name: '移設後の動作確認',
      Owner_Member_ID: 'M3', Status: 'Done', Priority: 'Medium', Progress_Percent: 100,
      Due_Date: jstDate(-30), Estimated_Hours: 8, Completed_At: isoHoursAgo(700)}
  ]);
  fixtures.bulk(manager, 'MILESTONES', [
    {Milestone_ID: 'MSX1', Project_ID: 'PX1', Subproject_ID: 'SX1A', Milestone_Name: '光学系 設計審査', Target_Date: jstDate(4)},
    {Milestone_ID: 'MSX2', Project_ID: 'PX1', Subproject_ID: 'SX1B', Milestone_Name: '搬送系 設計完了', Target_Date: jstDate(-2)},
    {Milestone_ID: 'MSX3', Project_ID: 'PX3', Subproject_ID: 'SX4', Milestone_Name: 'データ連携テスト', Target_Date: jstDate(12), Actual_Date: jstDate(-1)}
  ]);
  return manager;
}

function buildPreviewPayload() {
  const manager = buildFixtureWorkbook();
  const snapshot = dashboardFixtures.attachSnapshot(manager);
  manager.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + snapshot.getId());
  manager.context.publishSharedDashboard();
  const viewer = dashboardFixtures.dashboardFor(snapshot);

  const portfolio = viewer.context.dashboardPortfolio({query: ''});
  if (!portfolio.ok) throw new Error(portfolio.error.code + ': ' + portfolio.error.message);
  const projects = {};
  portfolio.data.projects.forEach(project => {
    const detail = viewer.context.dashboardProject(project.projectId);
    if (detail.ok) projects[project.projectId] = detail.data;
  });
  const tasks = [];
  Object.keys(projects).forEach(projectId => {
    projects[projectId].tasks.forEach(task => {
      const response = viewer.context.dashboardTask(projectId, task.taskId);
      if (response.ok) tasks.push(response.data);
    });
  });
  return {portfolio: portfolio.data, projects, tasks};
}

function assembleHtml(payload) {
  const read = name => fs.readFileSync(path.join(root, 'dashboard-app', `${name}.html`), 'utf8');
  const index = read('Index').replace(/<\?!=\s*include\('([^']+)'\)\s*\?>/g, (match, name) => read(name));
  const bootstrap = `<script>window.__DASHBOARD_PREVIEW__ = ${JSON.stringify(payload)};</script>`;
  // The preview payload must exist before the client script runs.
  return index.replace('<base target="_top">', `<base target="_top">\n  ${bootstrap}`);
}

function main() {
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex >= 0 && process.argv[outIndex + 1]
    ? path.resolve(process.argv[outIndex + 1])
    : path.join(os.tmpdir(), 'engineering-hub-dashboard-preview.html');
  const payload = buildPreviewPayload();
  fs.writeFileSync(out, assembleHtml(payload), 'utf8');
  console.log(JSON.stringify({
    file: out,
    projects: payload.portfolio.projects.length,
    details: Object.keys(payload.projects).length,
    tasks: payload.tasks.length,
    stale: payload.portfolio.meta.stale,
    publishedAt: payload.portfolio.meta.publishedAtLabel
  }, null, 2));
}

main();
