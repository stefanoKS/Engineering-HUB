/**
 * Weekly management report content. Delivery is performed by the centralized
 * notification service, so the report obeys the same mode, switches, allowlist and cap.
 * The report is deliberately separate from the per-task overdue reminder.
 */
var Reports = (function () {
  var TERMINAL = ['Archived', 'Cancelled', 'Completed'];

  function weekStart(asOf) {
    var date = new Date(asOf + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return date.toISOString().slice(0, 10);
  }

  function names(tasks, memberById) {
    return tasks.slice(0, 10).map(function (task) {
      var owner = memberById[task.Owner_Member_ID];
      return '- ' + (task.Task_Name || task.Task_ID) + '（担当: ' + (owner ? owner.Name : '未設定') + ' / 期限: ' + (Health.day(task.Due_Date) || '未設定') + '）';
    });
  }

  function weekly(asOf) {
    asOf = Domain.date(asOf || Domain.today());
    var analysis = Dashboard.analyze(asOf);
    var metrics = analysis.metrics;
    var start = weekStart(asOf);
    var memberById = Object.create(null);
    Database.read('MEMBERS').forEach(function (member) { memberById[member.Member_ID] = member; });
    var tasks = Database.read('TASKS');
    var projects = Database.read('PROJECTS'), projectById = Object.create(null);
    projects.forEach(function (project) { projectById[project.Project_ID] = project; });
    var subprojectById = Object.create(null);
    Database.read('SUBPROJECTS').forEach(function (subproject) { subprojectById[subproject.Subproject_ID] = subproject; });

    var completed = tasks.filter(function (task) {
      if (task.Status !== 'Done') return false;
      var done = Health.day(task.Completed_At);
      return done && done >= start && done <= asOf;
    });
    var overdue = tasks.filter(function (task) {
      return task.Status !== 'Done' && task.Status !== 'Cancelled' && task.Due_Date &&
        Health.day(task.Due_Date) < asOf &&
        Eligibility.taskInActiveWork(task, projectById, subprojectById);
    });
    var blocked = tasks.filter(function (task) {
      return task.Status === 'Blocked' && Eligibility.taskInActiveWork(task, projectById, subprojectById);
    });
    var missingEstimates = tasks.filter(function (task) {
      return Eligibility.taskInActiveWork(task, projectById, subprojectById) && Estimates.unknown(task.Estimated_Hours);
    });
    var projectsAtRisk = analysis.projects.filter(function (item) {
      return TERMINAL.indexOf(item.project.Status) < 0 && Health.isAttention(item.health.health);
    });
    var issues = Database.read('ISSUES').filter(function (issue) {
      return issue.Status !== 'Closed' && issue.Severity === 'Critical';
    });
    var highLoad = analysis.members.filter(function (member) { return member.Overallocated; });
    var upcoming = tasks.filter(function (task) {
      if (!task.Due_Date || task.Status === 'Done' || task.Status === 'Cancelled') return false;
      var due = Health.day(task.Due_Date);
      return due >= asOf && (new Date(due + 'T00:00:00Z') - new Date(asOf + 'T00:00:00Z')) / 86400000 <= 14 &&
        Eligibility.taskInActiveWork(task, projectById, subprojectById);
    });

    var recentProjects = analysis.projects.filter(function (item) {
      var elapsed = item.staleDays;
      return TERMINAL.indexOf(item.project.Status) < 0 && elapsed !== null && elapsed > analysis.limits.staleDays && analysis.limits.staleAlert;
    });

    var lines = [];
    lines.push('【週次管理レポート】' + start + ' 〜 ' + asOf);
    lines.push('');
    lines.push('■ 進行中プロジェクト: ' + metrics.activeProjects + '件（要注意 ' + metrics.atRiskProjects + '件 / 保留 ' + metrics.onHoldProjects + '件）');
    projectsAtRisk.slice(0, 10).forEach(function (item) {
      lines.push('- ' + item.project.Project_Name + '（' + Health.label(item.health.health) + ': ' + item.health.reasons.join(', ') + '）');
    });
    lines.push('');
    lines.push('■ 期間中の完了タスク: ' + completed.length + '件');
    lines.push('■ 期限超過タスク: ' + overdue.length + '件');
    names(overdue, memberById).forEach(function (line) { lines.push(line); });
    lines.push('■ ブロック中タスク: ' + blocked.length + '件');
    names(blocked, memberById).forEach(function (line) { lines.push(line); });
    lines.push('■ 14日以内の期限: ' + upcoming.length + '件');
    lines.push('■ 今後のマイルストーン: ' + metrics.upcomingMilestones + '件');
    lines.push('■ 更新停滞プロジェクト: ' + recentProjects.length + '件');
    recentProjects.slice(0, 10).forEach(function (item) {
      lines.push('- ' + item.project.Project_Name + '（最終更新から ' + item.staleDays + ' 日）');
    });
    lines.push('■ 経営判断待ちの重大課題: ' + issues.length + '件');
    lines.push('■ 高負荷メンバー: ' + highLoad.length + '名');
    highLoad.slice(0, 10).forEach(function (member) {
      lines.push('- ' + member.Name + '（負荷率 ' + Math.round(member.Utilization * 100) / 100 + '）');
    });
    lines.push('■ 日程未設定タスク: ' + metrics.unplannedTasks + '件 / 見積未設定タスク: ' + missingEstimates.length + '件');
    lines.push('');
    lines.push('管理台帳: https://docs.google.com/spreadsheets/d/' + encodeURIComponent(Config.get().spreadsheetId) + '/edit');

    var empty = metrics.activeProjects === 0 && metrics.onHoldProjects === 0 && completed.length === 0 &&
      overdue.length === 0 && blocked.length === 0 && upcoming.length === 0 && issues.length === 0 &&
      highLoad.length === 0 && recentProjects.length === 0 && metrics.unplannedTasks === 0;

    return {
      weekStart: start, asOf: asOf, empty: empty,
      body: lines.join('\n'),
      sections: {
        activeProjects: metrics.activeProjects, atRisk: projectsAtRisk.length, completed: completed.length,
        overdue: overdue.length, blocked: blocked.length, upcoming: upcoming.length,
        stale: recentProjects.length, criticalIssues: issues.length, highLoad: highLoad.length
      }
    };
  }

  return {weekly: weekly, weekStart: weekStart};
}());
function weeklyManagementReportPreview(asOf) { return Reports.weekly(asOf); }
