/**
 * Deterministic project health.
 *
 * The classification is a documented heuristic, not a forecast: reasons are returned
 * with the label so a manager can see why a project is not green. Thresholds come from
 * the persisted automation settings (defaults: 7 stale days, 14 days milestone notice,
 * 0 days delay tolerance).
 */
var Health = (function () {
  var RED = 'RED', YELLOW = 'YELLOW', GREEN = 'GREEN', UNKNOWN = 'UNKNOWN';

  function day(value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    var parsed = value instanceof Date ? value : new Date(value);
    if (isNaN(parsed.getTime())) return '';
    return Utilities.formatDate(parsed, 'Asia/Tokyo', 'yyyy-MM-dd');
  }

  function daysBetween(from, to) {
    if (!from || !to) return null;
    return Math.round((new Date(to + 'T00:00:00Z').getTime() - new Date(from + 'T00:00:00Z').getTime()) / 86400000);
  }

  function thresholds() {
    var settings = AutomationSettings.get();
    function positive(value, fallback) {
      var number = Number(value);
      return isFinite(number) && number >= 0 ? number : fallback;
    }
    return {
      staleDays: positive(settings.PROJECT_STALE_DAYS, 7),
      milestoneApproachDays: positive(settings.HEALTH_MILESTONE_APPROACH_DAYS, 14),
      delayToleranceDays: positive(settings.HEALTH_DELAY_TOLERANCE_DAYS, 0),
      staleAlert: settings.PROJECT_STALE_ALERT_ENABLED !== false
    };
  }

  function staleDays(project, today) {
    var updated = day(project.Last_Updated) || day(project.Created_At);
    var elapsed = daysBetween(updated, today);
    return elapsed === null ? null : elapsed;
  }

  /**
   * @param {object} project project row
   * @param {object} context {today, tasks, milestones, issues, progress}
   */
  function classify(project, context) {
    var today = day(context.today) || Domain.today();
    var limits = context.limits || thresholds();
    var reasons = [];
    var status = String(project.Status || '');
    var tasks = context.tasks || [];
    var milestones = context.milestones || [];
    var issues = context.issues || [];

    if (status === 'Archived') return result('ARCHIVED', ['ARCHIVED'], today, limits, project);
    if (status === 'Cancelled') return result('CANCELLED', ['CANCELLED'], today, limits, project);
    if (status === 'Completed') return result('COMPLETED', ['COMPLETED'], today, limits, project);

    var committed = day(project.Committed_Deadline);
    var forecast = day(project.Forecast_End);
    var completion = day(project.Actual_Completion);
    if (!committed && !forecast) reasons.push({level: YELLOW, code: 'UNKNOWN_SCHEDULE'});

    var critical = issues.filter(function (issue) {
      return issue.Status !== 'Closed' && issue.Severity === 'Critical';
    });
    if (critical.length) reasons.push({level: RED, code: 'CRITICAL_ISSUE'});

    if (committed && !completion && today > committed) reasons.push({level: RED, code: 'MISSED_COMMITMENT'});

    var tolerance = limits.delayToleranceDays;
    if (committed && forecast && !completion) {
      var delay = daysBetween(committed, forecast);
      if (delay !== null && delay > tolerance) {
        reasons.push({
          level: project.Next_Action ? YELLOW : RED,
          code: project.Next_Action ? 'RECOVERY_ACTION_PENDING' : 'FORECAST_EXCEEDS_COMMITMENT'
        });
      }
    }

    var openMilestones = milestones.filter(function (milestone) { return milestone.Status !== 'Cancelled'; });
    var missed = openMilestones.filter(function (milestone) {
      var target = day(milestone.Target_Date);
      return target && !day(milestone.Actual_Date) && target < today;
    });
    if (missed.length) reasons.push({level: RED, code: 'MISSED_MILESTONE'});

    var approaching = openMilestones.filter(function (milestone) {
      var target = day(milestone.Target_Date);
      if (!target || day(milestone.Actual_Date)) return false;
      var remaining = daysBetween(today, target);
      return remaining !== null && remaining >= 0 && remaining <= limits.milestoneApproachDays;
    });
    if (approaching.length) reasons.push({level: YELLOW, code: 'MILESTONE_APPROACHING'});

    if (tasks.some(function (task) { return task.Status === 'Blocked'; })) reasons.push({level: YELLOW, code: 'BLOCKED_TASK'});

    if (limits.staleAlert) {
      var elapsed = staleDays(project, today);
      if (elapsed !== null && elapsed > limits.staleDays) reasons.push({level: YELLOW, code: 'STALE_UPDATE'});
    }

    if (!project.Project_Owner_ID) reasons.push({level: YELLOW, code: 'MISSING_OWNER'});

    var overdue = tasks.filter(function (task) {
      var due = day(task.Due_Date);
      return due && task.Status !== 'Done' && task.Status !== 'Cancelled' && due < today;
    });
    if (overdue.length) reasons.push({level: YELLOW, code: 'OVERDUE_TASK'});

    if (status === 'On Hold') return result('ON_HOLD', codes(reasons).concat(['ON_HOLD']), today, limits, project);
    if (status === 'Planned' && !hasRed(reasons)) return result('PLANNED', codes(reasons).concat(['PLANNED']), today, limits, project);

    if (!committed && !forecast && !hasRed(reasons)) {
      return result(UNKNOWN, codes(reasons).concat(['UNKNOWN_SCHEDULE']), today, limits, project);
    }

    var levels = reasons.map(function (reason) { return reason.level; });
    if (levels.indexOf(RED) >= 0) return result(RED, codes(reasons), today, limits, project);
    if (levels.indexOf(YELLOW) >= 0) return result(YELLOW, codes(reasons), today, limits, project);
    return result(GREEN, ['ON_TRACK'], today, limits, project);
  }

  function result(health, reasons, today, limits, project) {
    return {
      health: health,
      reasons: reasons,
      // Numeric days since the last meaningful project update (null when unknown).
      staleDays: project ? staleDays(project, today) : null,
      thresholds: {
        staleDays: limits.staleDays,
        milestoneApproachDays: limits.milestoneApproachDays,
        delayToleranceDays: limits.delayToleranceDays,
        staleAlert: limits.staleAlert
      },
      evaluatedOn: today
    };
  }

  function codes(reasons) {
    var seen = Object.create(null), out = [];
    reasons.forEach(function (reason) {
      if (seen[reason.code]) return;
      seen[reason.code] = true;
      out.push(reason.code);
    });
    return out;
  }

  function hasRed(reasons) { return reasons.some(function (reason) { return reason.level === RED; }); }

  function isAttention(health) { return health === RED || health === YELLOW || health === UNKNOWN; }

  function label(health) {
    return {
      GREEN: '順調', YELLOW: '注意', RED: '危険', UNKNOWN: '日程不明',
      PLANNED: '計画中', ON_HOLD: '保留', COMPLETED: '完了', CANCELLED: '中止', ARCHIVED: 'アーカイブ'
    }[health] || String(health || '');
  }

  return {classify: classify, staleDays: staleDays, thresholds: thresholds, isAttention: isAttention, label: label, day: day};
}());
function evaluateProjectHealth(projectId, asOf) {
  var project = Domain.required('PROJECTS', projectId);
  return Health.classify(project, {
    today: asOf || Domain.today(),
    tasks: Database.read('TASKS').filter(function (task) { return task.Project_ID === projectId; }),
    milestones: Database.read('MILESTONES').filter(function (milestone) { return milestone.Project_ID === projectId; }),
    issues: Database.read('ISSUES').filter(function (issue) { return issue.Project_ID === projectId; })
  });
}
