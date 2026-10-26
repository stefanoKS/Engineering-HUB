/**
 * Management dashboard, Gantt fallback and team view.
 *
 * Everything is derived from the operational tables on every refresh; no second
 * project database exists. Generated sheets are disposable output. Operational
 * columns are only updated for the two computed project fields (progress, health)
 * and only when their value actually changes.
 */
var Dashboard = (function () {
  var TERMINAL = ['Archived', 'Cancelled', 'Completed'];

  function indexBy(rows, key) {
    var result = Object.create(null);
    rows.forEach(function (row) {
      var id = String(row[key] || '');
      if (!id) return;
      if (!result[id]) result[id] = [];
      result[id].push(row);
    });
    return result;
  }

  function sameValue(current, next) {
    var left = current === null || current === undefined ? '' : current;
    var right = next === null || next === undefined ? '' : next;
    return String(left) === String(right);
  }

  function analyze(asOf) {
    asOf = Domain.date(asOf || Domain.today());
    var projects = Database.read('PROJECTS');
    var subprojects = Database.read('SUBPROJECTS');
    var tasks = Database.read('TASKS');
    var issues = Database.read('ISSUES');
    var milestones = Database.read('MILESTONES');
    var members = Database.read('MEMBERS');
    var limits = Health.thresholds();
    var projectById = Object.create(null), subprojectById = Object.create(null), memberById = Object.create(null);
    projects.forEach(function (project) { projectById[project.Project_ID] = project; });
    subprojects.forEach(function (subproject) { subprojectById[subproject.Subproject_ID] = subproject; });
    members.forEach(function (member) { memberById[member.Member_ID] = member; });
    var tasksByProject = indexBy(tasks, 'Project_ID');
    var tasksBySubproject = indexBy(tasks, 'Subproject_ID');
    // Nested subprojects roll up their own tasks plus every descendant task exactly once.
    var subprojectChildren = Subprojects.childrenMap(subprojects);
    function subprojectTasks(subprojectId) {
      return Progress.subtreeTasks(subprojectId, subprojectChildren, tasksBySubproject);
    }
    var tasksByOwner = indexBy(tasks, 'Owner_Member_ID');
    var milestonesByProject = indexBy(milestones, 'Project_ID');
    var issuesByProject = indexBy(issues, 'Project_ID');

    var patches = {projects: [], subprojects: []};
    var warnings = [];
    var projectItems = [];
    var projectRows = [['プロジェクトID', 'プロジェクト', '責任者', '確定期限', '進捗率', '現在フェーズ', '健全性', '次のアクション', '最終更新', '状態', '理由']];
    var timeline = [['タスクID', 'タスク', 'プロジェクトID', '担当者', '開始日', '終了日', '進捗率', '状態']];
    var gantt = [['種別', 'ID', '名称', 'プロジェクト', '開始日', '終了日', '予測終了', '進捗率', '状態', '備考']];
    var attention = {
      pendingApprovals: [], tasksWithoutOwner: [], tasksNeedingReassignment: [],
      unknownScheduleProjects: [], atRiskProjects: [], staleProjects: [],
      overdueTasks: [], blockedTasks: [], criticalIssues: [],
      dueWithin7: [], dueWithin30: [], overcapacity: []
    };

    subprojects.forEach(function (subproject) {
      var rolled = Progress.rollup(subprojectTasks(subproject.Subproject_ID));
      var value = rolled.calculated ? rolled.percent : '';
      if (!sameValue(subproject.Progress_Percent, value)) {
        patches.subprojects.push({id: subproject.Subproject_ID, patch: {Progress_Percent: value}});
      }
    });

    projects.forEach(function (project) {
      var owned = tasksByProject[project.Project_ID] || [];
      var rolled = Progress.rollup(owned);
      var progressValue = rolled.calculated ? rolled.percent : '';
      var classified = Health.classify(project, {
        today: asOf, tasks: owned,
        milestones: milestonesByProject[project.Project_ID] || [],
        issues: issuesByProject[project.Project_ID] || [],
        limits: limits
      });
      var patch = {};
      if (!sameValue(project.Progress_Percent, progressValue)) patch.Progress_Percent = progressValue;
      if (!sameValue(project.Health, classified.health)) patch.Health = classified.health;
      if (Object.keys(patch).length) patches.projects.push({id: project.Project_ID, patch: patch});

      var owner = memberById[project.Project_Owner_ID];
      var deadline = project.Committed_Deadline || project.Forecast_End || '';
      var terminal = TERMINAL.indexOf(project.Status) >= 0;
      // Independent categories: a missing schedule is not the same condition as a health colour.
      var missingSchedule = !project.Committed_Deadline && !project.Forecast_End;
      if (!terminal && missingSchedule) attention.unknownScheduleProjects.push(project.Project_ID);
      if (!terminal && (classified.health === 'YELLOW' || classified.health === 'RED')) {
        attention.atRiskProjects.push(project.Project_ID);
      }
      var stale = Health.staleDays(project, asOf);
      if (!terminal && stale !== null && stale > limits.staleDays && limits.staleAlert) attention.staleProjects.push(project.Project_ID);

      projectItems.push({
        project: project, progress: rolled, health: classified, ownerName: owner ? owner.Name : '',
        deadline: deadline, staleDays: stale
      });
      projectRows.push([project.Project_ID, project.Project_Name, owner ? owner.Name : '', deadline,
        Progress.display(rolled), project.Next_Milestone || '', Health.label(classified.health),
        project.Next_Action || '', Health.day(project.Last_Updated), project.Status, classified.reasons.join(', ')]);
      gantt.push(['プロジェクト', project.Project_ID, project.Project_Name, project.Project_Name,
        project.Planned_Start || '', project.Committed_Deadline || '', project.Forecast_End || '',
        Progress.display(rolled), project.Status, Health.label(classified.health)]);
      (milestonesByProject[project.Project_ID] || []).forEach(function (milestone) {
        gantt.push(['マイルストーン', milestone.Milestone_ID, milestone.Milestone_Name, project.Project_Name,
          '', milestone.Target_Date || '', '', '', milestone.Status || '', milestone.Actual_Date ? '達成' : '予定']);
      });
      (subprojects.filter(function (subproject) { return subproject.Project_ID === project.Project_ID; })).forEach(function (subproject) {
        var subRolled = Progress.rollup(subprojectTasks(subproject.Subproject_ID));
        gantt.push(['サブプロジェクト', subproject.Subproject_ID, subproject.Subproject_Name, project.Project_Name,
          subproject.Planned_Start || '', subproject.Deadline || subproject.Planned_End || '', '',
          Progress.display(subRolled), subproject.Status, '']);
      });
      owned.forEach(function (task) {
        var unscheduled = !task.Planned_Start || !task.Due_Date;
        gantt.push(['タスク', task.Task_ID, task.Task_Name, project.Project_Name,
          task.Planned_Start || '', task.Due_Date || '', '', Progress.percent(task), task.Status,
          unscheduled ? '日程未設定' : '']);
        timeline.push([task.Task_ID, task.Task_Name, task.Project_ID,
          memberById[task.Owner_Member_ID] ? memberById[task.Owner_Member_ID].Name : '',
          task.Planned_Start || '', task.Due_Date || '', Progress.percent(task), task.Status]);
      });
    });

    var workload = Planning.workloadData(asOf);
    var teamRows = [['メンバーID', 'メンバー', '担当タスク数', '残作業時間', '週容量', '負荷率', '期限超過', '未見積タスク数', '実績時間', '状態']];
    workload.members.forEach(function (item) {
      var assigned = (tasksByOwner[item.Member_ID] || []).filter(function (task) {
        return Eligibility.taskInActiveWork(task, projectById, subprojectById);
      }).length;
      teamRows.push([item.Member_ID, item.Name, assigned, item.Remaining_Hours, item.Capacity_Hours,
        item.Utilization === null ? '' : Math.round(item.Utilization * 100) / 100, item.Overdue_Tasks,
        item.Unknown_Tasks, item.Actual_Hours, item.Overallocated ? '容量超過' : '']);
      if (item.Overallocated) attention.overcapacity.push(item.Member_ID);
    });

    var open = tasks.filter(function (task) {
      return Eligibility.taskInActiveWork(task, projectById, subprojectById);
    });
    var openIssues = issues.filter(function (issue) { return issue.Status !== 'Closed'; });
    var today = asOf;
    function dueIn(task, limit) {
      if (!task.Due_Date) return false;
      var remaining = Health.day(task.Due_Date) >= today ? Health.day(task.Due_Date) : '';
      if (!remaining) return false;
      var days = Math.round((new Date(remaining + 'T00:00:00Z').getTime() - new Date(today + 'T00:00:00Z').getTime()) / 86400000);
      return days <= limit;
    }
    open.forEach(function (task) {
      var due = Health.day(task.Due_Date);
      if (due && due < today) attention.overdueTasks.push(task.Task_ID);
      if (task.Status === 'Blocked') attention.blockedTasks.push(task.Task_ID);
      if (task.Owner_Member_ID && due && due >= today) {
        if (dueIn(task, 7)) attention.dueWithin7.push(task.Task_ID);
        if (dueIn(task, 30)) attention.dueWithin30.push(task.Task_ID);
      }
      if (!task.Owner_Member_ID) attention.tasksWithoutOwner.push(task.Task_ID);
      var taskOwner = task.Owner_Member_ID ? memberById[task.Owner_Member_ID] : null;
      if (task.Owner_Member_ID && (!taskOwner || taskOwner.Active !== true)) attention.tasksNeedingReassignment.push(task.Task_ID);
      if (!task.Assignment_Approved_At && task.Owner_Member_ID) attention.pendingApprovals.push(task.Task_ID);
    });
    openIssues.forEach(function (issue) {
      if (issue.Severity === 'Critical') attention.criticalIssues.push(issue.Issue_ID);
    });

    var metrics = {
      activeProjects: projects.filter(function (project) { return project.Status === 'Active'; }).length,
      plannedProjects: projects.filter(function (project) { return project.Status === 'Planned'; }).length,
      onHoldProjects: projects.filter(function (project) { return project.Status === 'On Hold'; }).length,
      completedProjects: projects.filter(function (project) { return project.Status === 'Completed'; }).length,
      archivedProjects: projects.filter(function (project) { return project.Status === 'Archived'; }).length,
      atRiskProjects: attention.atRiskProjects.length,
      openTasks: open.length,
      overdueTasks: attention.overdueTasks.length,
      blockedTasks: attention.blockedTasks.length,
      openIssues: openIssues.length,
      criticalIssues: attention.criticalIssues.length,
      upcomingMilestones: milestones.filter(function (milestone) {
        return !milestone.Actual_Date && milestone.Target_Date && Health.day(milestone.Target_Date) >= today;
      }).length,
      staleProjects: attention.staleProjects.length,
      unknownEstimateTasks: open.filter(function (task) { return Estimates.unknown(task.Estimated_Hours); }).length,
      unplannedTasks: open.filter(function (task) { return !task.Planned_Start || !task.Due_Date; }).length,
      unownedTasks: attention.tasksWithoutOwner.length,
      pendingApprovals: attention.pendingApprovals.length,
      dueWithin7: attention.dueWithin7.length,
      dueWithin30: attention.dueWithin30.length,
      unknownScheduleProjects: attention.unknownScheduleProjects.length,
      overallocatedMembers: attention.overcapacity.length
    };

    return {
      asOf: asOf, metrics: metrics, attention: attention, warnings: warnings,
      projectRows: projectRows, teamRows: teamRows, timeline: timeline, gantt: gantt,
      projects: projectItems, members: workload.members, patches: patches, limits: limits
    };
  }

  function dashboardRows(analysis) {
    var metrics = analysis.metrics;
    return [
      ['設計・開発課 管理 ダッシュボード（自動生成・編集禁止）', ''],
      ['基準日', analysis.asOf],
      ['最終更新', Domain.now()],
      ['', ''],
      ['■ ポートフォリオ', '件数'],
      ['進行中プロジェクト', metrics.activeProjects],
      ['計画中プロジェクト', metrics.plannedProjects],
      ['保留プロジェクト', metrics.onHoldProjects],
      ['完了プロジェクト', metrics.completedProjects],
      ['アーカイブ済みプロジェクト', metrics.archivedProjects],
      ['要注意プロジェクト', metrics.atRiskProjects],
      ['未完了タスク', metrics.openTasks],
      ['期限超過タスク', metrics.overdueTasks],
      ['ブロック中タスク', metrics.blockedTasks],
      ['未解決課題', metrics.openIssues],
      ['重大未解決課題', metrics.criticalIssues],
      ['今後のマイルストーン', metrics.upcomingMilestones],
      ['更新停滞プロジェクト', metrics.staleProjects],
      ['', ''],
      ['■ 経営アテンション', '件数'],
      ['承認待ちタスク', metrics.pendingApprovals],
      ['担当者未設定タスク', metrics.unownedTasks],
      ['再割当が必要なタスク', analysis.attention.tasksNeedingReassignment.length],
      ['日程不明プロジェクト', metrics.unknownScheduleProjects],
      ['期限超過タスク', metrics.overdueTasks],
      ['ブロック中タスク', metrics.blockedTasks],
      ['重大未解決課題', metrics.criticalIssues],
      ['更新停滞プロジェクト', metrics.staleProjects],
      ['要注意プロジェクト（黄/赤）', metrics.atRiskProjects],
      ['7日以内に期限', metrics.dueWithin7],
      ['30日以内に期限', metrics.dueWithin30],
      ['見積未設定タスク', metrics.unknownEstimateTasks],
      ['負荷超過メンバー', metrics.overallocatedMembers],
      ['', ''],
      ['■ 生成シート', '内容'],
      ['PROJECT_OVERVIEW', 'プロジェクト別の進捗・健全性・次のアクション'],
      ['TEAM_VIEW', 'メンバー別の残作業・容量・未見積'],
      ['GANTT_OVERVIEW', 'ポートフォリオ/詳細タイムライン（代替Gantt）'],
      ['TIMELINE_DATA', 'タスク別タイムライン（ネイティブTimelineの手動設定用）'],
      ['WORKLOAD', '週次負荷'],
      ['SKILL_MATRIX', 'スキルマトリクス'],
      ['BACKPLAN', 'プロジェクト別の逆算計画'],
      ['AUTOMATION_STATUS', '自動化の有効状態']
    ];
  }

  function applyPatches(patches, warnings) {
    try {
      if (patches.projects.length) Database.updateMany('PROJECTS', patches.projects);
    } catch (error) {
      warnings.push('project computed fields: ' + error.message);
      console.error('Computed project fields were not written: ' + error.message);
    }
    try {
      if (patches.subprojects.length) Database.updateMany('SUBPROJECTS', patches.subprojects);
    } catch (error) {
      warnings.push('subproject progress: ' + error.message);
      console.error('Computed subproject progress was not written: ' + error.message);
    }
  }

  function refresh(asOf) {
    return Database.withLock(function () {
      var analysis = analyze(asOf);
      applyPatches(analysis.patches, analysis.warnings);
      Database.writeGenerated('DASHBOARD', dashboardRows(analysis));
      Database.writeGenerated('PROJECT_OVERVIEW', analysis.projectRows);
      Database.writeGenerated('TEAM_VIEW', analysis.teamRows);
      Database.writeGenerated('TIMELINE_DATA', analysis.timeline);
      Database.writeGenerated('GANTT_OVERVIEW', analysis.gantt);
      Database.writeGenerated('AUTOMATION_STATUS', AutomationSettings.viewRows());
      AutomationSettings.setStatus('LAST_DASHBOARD_REFRESH_AT', Domain.now());
      return analysis.metrics;
    });
  }

  return {analyze: analyze, refresh: refresh, dashboardRows: dashboardRows};
})();
function refreshDashboard(asOf) { return Dashboard.refresh(asOf); }
function analyzeManagement(asOf) { return Dashboard.analyze(asOf); }