var Dashboard = (function () {
  function refresh(asOf) {
    asOf = Domain.date(asOf || Domain.today());
    var projects = Database.read('PROJECTS'), tasks = Database.read('TASKS');
    var issues = Database.read('ISSUES'), milestones = Database.read('MILESTONES');
    var members = Database.read('MEMBERS'), names = {};
    members.forEach(function (member) { names[member.Member_ID] = member.Name; });
    var open = tasks.filter(function (task) { return task.Status !== 'Done' && task.Status !== 'Cancelled'; });
    var metrics = {
      activeProjects: projects.filter(function (project) { return project.Status === 'Active'; }).length,
      openTasks: open.length,
      overdueTasks: open.filter(function (task) { return task.Due_Date && Domain.date(task.Due_Date) < asOf; }).length,
      openIssues: issues.filter(function (issue) { return issue.Status !== 'Closed'; }).length,
      upcomingMilestones: milestones.filter(function (milestone) { return !milestone.Actual_Date && milestone.Target_Date && Domain.date(milestone.Target_Date) >= asOf; }).length,
      unplannedTasks: open.filter(function (task) { return !task.Planned_Start || !task.Due_Date; }).length
    };
    Database.writeGenerated('DASHBOARD', [
      ['指標', '件数'], ['進行中プロジェクト', metrics.activeProjects], ['未完了タスク', metrics.openTasks],
      ['期限超過タスク', metrics.overdueTasks], ['未解決課題', metrics.openIssues],
      ['今後のマイルストーン', metrics.upcomingMilestones], ['日程未設定タスク', metrics.unplannedTasks]
    ]);
    var timeline = [['タスクID', 'タスク', 'プロジェクトID', '担当者', '開始日', '終了日', '進捗率', '状態']];
    var gantt = [['タスクID', 'タスク', '開始日', '終了日', '期間（日）', '進捗率', '状態']];
    tasks.forEach(function (task) {
      var start = task.Planned_Start ? Domain.date(task.Planned_Start) : '';
      var end = task.Due_Date ? Domain.date(task.Due_Date) : '';
      var status = !start || !end ? '日程未設定' : task.Status;
      timeline.push([task.Task_ID, task.Task_Name, task.Project_ID, names[task.Owner_Member_ID] || '', start, end, Number(task.Progress_Percent || 0), status]);
      gantt.push([task.Task_ID, task.Task_Name, start, end, start && end ? Math.round((new Date(end) - new Date(start)) / 86400000) + 1 : '', Number(task.Progress_Percent || 0), status]);
    });
    Database.writeGenerated('TIMELINE_DATA', timeline);
    Database.writeGenerated('GANTT_OVERVIEW', gantt);
    return metrics;
  }
  return { refresh: refresh };
})();
function refreshDashboard(asOf) { return Dashboard.refresh(asOf); }
