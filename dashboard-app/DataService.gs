/**
 * Read-only data service for the shared dashboard.
 *
 * Reads exactly one workbook (the sanitized snapshot) and never the private management
 * database. Table headers are validated against the published contract, unknown columns
 * fail closed, and every response is built from explicit fields: there is no
 * "return the row" path, and no write API exists in this project.
 *
 * Payload sizes are bounded. The portfolio returns project summaries only; a project's
 * tasks are read on demand and capped (see MAX_PROJECT_TASKS) instead of shipping every
 * task row to the browser.
 */
var DashboardData = (function () {
  var CONTRACT_VERSION = '1.3';
  var META_SHEET = 'PUBLISHED_META';
  var CACHE_TTL_SECONDS = 300;
  var CACHE_MAX_CHARS = 90000;
  var MAX_PROJECT_TASKS = 500;
  var MAX_REQUESTED_TASKS = 1000;
  var DUE_SOON_DAYS = 7;
  var RISK = ['RED', 'YELLOW', 'UNKNOWN'];

  // Must match SharedDashboardModel.PROJECT_PUBLIC_FIELDS / ... in the manager project.
  // The pairing is asserted by tests/v1_2-dashboard.test.js so the two apps cannot drift.
  var TABLES = {
    projects: {sheet: 'PUBLISHED_PROJECTS', fields: ['projectId', 'projectName', 'category', 'ownerName',
      'status', 'progress', 'health', 'committedDeadline', 'forecastDeadline', 'summary', 'lastUpdated',
      'terminal', 'openTasks', 'doneTasks', 'overdueTasks', 'blockedTasks', 'dueSoonTasks', 'totalTasks']},
    subprojects: {sheet: 'PUBLISHED_SUBPROJECTS', fields: ['subprojectId', 'projectId', 'name', 'ownerName',
      'status', 'progress', 'deadline', 'terminal']},
    tasks: {sheet: 'PUBLISHED_TASKS', fields: ['taskId', 'projectId', 'subprojectId', 'name', 'ownerName',
      'status', 'priority', 'plannedStart', 'dueDate', 'progress', 'publicNote', 'revision', 'pendingRequest']},
    milestones: {sheet: 'PUBLISHED_MILESTONES', fields: ['milestoneId', 'projectId', 'subprojectId', 'name',
      'targetDate', 'actualDate', 'status']}
  };

  var LABELS = {
    status: {
      'Not Started': '未着手', 'Assigned': '割当済', 'In Progress': '進行中', 'Blocked': 'ブロック',
      'On Hold': '保留', 'Done': '完了', 'Cancelled': '中止',
      'Planned': '計画中', 'Active': '進行中', 'Completed': '完了', 'Archived': 'アーカイブ'
    },
    health: {
      GREEN: '順調', YELLOW: '注意', RED: '危険', UNKNOWN: '日程不明',
      PLANNED: '計画中', ON_HOLD: '保留', COMPLETED: '完了', CANCELLED: '中止', ARCHIVED: 'アーカイブ'
    },
    priority: {Low: '低', Medium: '中', High: '高', Critical: '最優先'}
  };

  var MESSAGES = {
    DASHBOARD_NOT_CONFIGURED: 'ダッシュボードがまだ設定されていません。管理者に連絡してください。',
    VIEWER_NOT_ALLOWED: 'このダッシュボードを表示する権限がありません。会社のアカウントで開いてください。',
    SNAPSHOT_NOT_PUBLISHED: '公開データがまだ作成されていません。管理者に連絡してください。',
    SNAPSHOT_UNREADABLE: '公開データを読み込めませんでした。時間をおいて再試行してください。',
    SNAPSHOT_CONTRACT_UNSUPPORTED: '公開データの形式が新しいため表示できません。管理者に連絡してください。',
    NOT_FOUND: '対象のデータが見つかりませんでした。一覧に戻って選び直してください。',
    UNEXPECTED_ERROR: 'データを読み込めませんでした。時間をおいて再試行してください。'
  };

  function ok(data) { return {ok: true, data: data}; }

  function failure(code, message) {
    return {ok: false, error: {code: code, message: message || MESSAGES[code] || MESSAGES.UNEXPECTED_ERROR}};
  }

  function respond(fn) {
    try {
      return ok(fn());
    } catch (error) {
      var code = String((error && error.message) || '');
      if (!Object.prototype.hasOwnProperty.call(MESSAGES, code)) {
        console.error('Dashboard request failed: ' + code);
        code = 'UNEXPECTED_ERROR';
      }
      return failure(code, MESSAGES[code]);
    }
  }

  function text(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function number(value) {
    if (value === '' || value === null || value === undefined) return null;
    var parsed = Number(value);
    return isFinite(parsed) ? parsed : null;
  }

  function bool(value) {
    return value === true || String(value).toUpperCase() === 'TRUE';
  }

  function todayJst() {
    return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  }

  function formatJst(value) {
    if (!value) return '';
    var date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '';
    return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  }

  function dayDiff(from, to) {
    if (!from || !to) return null;
    return Math.round((new Date(to + 'T00:00:00Z').getTime() - new Date(from + 'T00:00:00Z').getTime()) / 86400000);
  }

  /** Deadline wording required by the specification: 完了 / 本日期限 / X日超過 / 期限未設定. */
  function deadline(dueDate, completed, today) {
    if (completed) return {kind: 'done', days: null, label: '完了'};
    if (!dueDate) return {kind: 'none', days: null, label: '期限未設定'};
    var days = dayDiff(today, dueDate);
    if (days === null) return {kind: 'none', days: null, label: '期限未設定'};
    if (days === 0) return {kind: 'today', days: 0, label: '本日期限'};
    if (days < 0) return {kind: 'overdue', days: days, label: Math.abs(days) + '日超過'};
    return {kind: 'future', days: days, label: 'あと' + days + '日'};
  }

  function label(map, value) {
    return Object.prototype.hasOwnProperty.call(LABELS[map], value) ? LABELS[map][value] : text(value);
  }

  function openTab() {
    var config = DashboardApp.config();
    if (!config.spreadsheetId) throw new Error('DASHBOARD_NOT_CONFIGURED');
    var book = SpreadsheetApp.openById(config.spreadsheetId);
    ['PROJECTS', 'MEMBERS', 'AUTOMATION_SETTINGS'].forEach(function (operational) {
      if (book.getSheetByName(operational)) throw new Error('SNAPSHOT_UNREADABLE');
    });
    var metaSheet = book.getSheetByName(META_SHEET);
    if (!metaSheet) throw new Error('SNAPSHOT_NOT_PUBLISHED');
    var values = metaSheet.getDataRange().getValues();
    var meta = Object.create(null);
    values.slice(1).forEach(function (row) {
      if (!row[0]) return;
      meta[String(row[0])] = row[1] === undefined ? '' : row[1];
    });
    var active = text(meta.ACTIVE_SLOT);
    if (!active) throw new Error('SNAPSHOT_NOT_PUBLISHED');
    if (text(meta.CONTRACT_VERSION) !== CONTRACT_VERSION) throw new Error('SNAPSHOT_CONTRACT_UNSUPPORTED');
    var snapshot = {book: book, meta: meta, slot: active, tables: {}};
    Object.keys(TABLES).forEach(function (key) {
      snapshot.tables[key] = readTable(book, active, TABLES[key]);
    });
    return snapshot;
  }

  function readTable(book, slot, table) {
    var sheet = book.getSheetByName(table.sheet + '_' + slot);
    if (!sheet) throw new Error('SNAPSHOT_UNREADABLE');
    var values = sheet.getDataRange().getValues();
    var header = values[0] || [];
    // Fail closed: a snapshot written with a different contract is not guessed at.
    if (header.length !== table.fields.length ||
        table.fields.some(function (field, index) { return header[index] !== field; })) {
      throw new Error('SNAPSHOT_CONTRACT_UNSUPPORTED');
    }
    return values.slice(1)
      .filter(function (row) { return row.some(function (value) { return value !== ''; }); })
      .map(function (row) {
        var record = {};
        table.fields.forEach(function (field, index) { record[field] = row[index]; });
        return record;
      });
  }

  function metaPayload(snapshot, config) {
    var publishedAt = text(snapshot.meta.PUBLISHED_AT);
    var published = publishedAt ? new Date(publishedAt) : null;
    var ageHours = published && !isNaN(published.getTime())
      ? Math.max(0, Math.floor((Date.now() - published.getTime()) / 3600000)) : null;
    return {
      contractVersion: text(snapshot.meta.CONTRACT_VERSION),
      snapshotVersion: Number(snapshot.meta.SNAPSHOT_VERSION || 0),
      publishedAt: publishedAt,
      publishedAtLabel: formatJst(publishedAt),
      ageHours: ageHours,
      stale: ageHours !== null && ageHours >= config.staleHours,
      staleAfterHours: config.staleHours,
      asOf: text(snapshot.meta.AS_OF),
      today: todayJst(),
      generatedAt: new Date().toISOString()
    };
  }

  function projectSummary(project, today) {
    var completed = bool(project.terminal) || project.status === 'Completed' || project.status === 'Cancelled' ||
      project.status === 'Archived';
    var remaining = deadline(text(project.committedDeadline) || text(project.forecastDeadline), completed, today);
    return {
      projectId: text(project.projectId),
      projectName: text(project.projectName),
      category: text(project.category),
      ownerName: text(project.ownerName),
      status: text(project.status),
      statusLabel: label('status', text(project.status)),
      progress: number(project.progress),
      health: text(project.health),
      healthLabel: label('health', text(project.health)),
      atRisk: !completed && RISK.indexOf(text(project.health)) >= 0,
      committedDeadline: text(project.committedDeadline),
      forecastDeadline: text(project.forecastDeadline),
      summary: text(project.summary),
      lastUpdated: text(project.lastUpdated),
      terminal: completed,
      openTasks: number(project.openTasks) || 0,
      doneTasks: number(project.doneTasks) || 0,
      overdueTasks: number(project.overdueTasks) || 0,
      blockedTasks: number(project.blockedTasks) || 0,
      dueSoonTasks: number(project.dueSoonTasks) || 0,
      totalTasks: number(project.totalTasks) || 0,
      daysRemaining: remaining.days,
      deadlineKind: remaining.kind,
      deadlineLabel: remaining.label
    };
  }

  function taskSummary(task, today, projectName, subprojectName) {
    var completed = text(task.status) === 'Done';
    var remaining = deadline(text(task.dueDate), completed, today);
    return {
      taskId: text(task.taskId),
      projectId: text(task.projectId),
      projectName: projectName || '',
      subprojectId: text(task.subprojectId),
      subprojectName: subprojectName || '',
      name: text(task.name),
      ownerName: text(task.ownerName),
      status: text(task.status),
      statusLabel: label('status', text(task.status)),
      priority: text(task.priority),
      priorityLabel: label('priority', text(task.priority)),
      plannedStart: text(task.plannedStart),
      dueDate: text(task.dueDate),
      progress: number(task.progress),
      publicNote: text(task.publicNote),
      revision: text(task.revision),
      pendingRequest: bool(task.pendingRequest),
      daysRemaining: remaining.days,
      deadlineKind: remaining.kind,
      deadlineLabel: remaining.label
    };
  }

  function indicators(projects) {
    var today = todayJst();
    var value = {activeProjects: 0, atRiskProjects: 0, dueWithin7Days: 0, overdueTasks: 0};
    projects.forEach(function (project) {
      if (!project.terminal && project.status === 'Active') value.activeProjects++;
      if (project.atRisk) value.atRiskProjects++;
      value.overdueTasks += project.overdueTasks;
      var due = project.committedDeadline;
      if (!project.terminal && due) {
        var days = dayDiff(today, due);
        if (days !== null && days >= 0 && days <= DUE_SOON_DAYS) value.dueWithin7Days++;
      }
    });
    return value;
  }

  function searchableProjects(snapshot, query) {
    var projects = snapshot.tables.projects;
    if (!query) return projects;
    var needle = query.toLowerCase();
    var matches = Object.create(null);
    projects.forEach(function (project) {
      var haystack = (text(project.projectName) + ' ' + text(project.projectId)).toLowerCase();
      if (haystack.indexOf(needle) >= 0) matches[text(project.projectId)] = true;
    });
    // Approved (published) task names are searchable; private descriptions are not.
    snapshot.tables.tasks.forEach(function (task) {
      if (matches[text(task.projectId)]) return;
      if (text(task.name).toLowerCase().indexOf(needle) >= 0) matches[text(task.projectId)] = true;
    });
    return projects.filter(function (project) { return !!matches[text(project.projectId)]; });
  }

  function unique(values) {
    var seen = Object.create(null), out = [];
    values.forEach(function (value) {
      if (!value || seen[value]) return;
      seen[value] = true;
      out.push(value);
    });
    return out.sort(function (a, b) { return a.localeCompare(b, 'ja'); });
  }

  function cacheGet(key) {
    try {
      var cached = CacheService.getScriptCache().get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) { return null; }
  }

  function cachePut(key, value) {
    try {
      var payload = JSON.stringify(value);
      // CacheService keys are limited to 100 KB; larger payloads are simply not cached.
      if (payload.length > CACHE_MAX_CHARS) return;
      CacheService.getScriptCache().put(key, payload, CACHE_TTL_SECONDS);
    } catch (error) { /* cache is an optimisation only */ }
  }

  function portfolio(request) {
    return respond(function () {
      DashboardApp.requireViewer();
      request = request || {};
      var query = DashboardApp.cleanQuery(request.query).trim();
      var config = DashboardApp.config();
      var snapshot = openTab();
      var today = todayJst();
      var cacheKey = 'sd:portfolio:' + snapshot.meta.SNAPSHOT_VERSION + ':' + today + ':' +
        (query ? encodeHash(query) : '');
      var cached = cacheGet(cacheKey);
      if (cached) return cached;

      var projects = searchableProjects(snapshot, query)
        .map(function (project) { return projectSummary(project, today); });
      var payload = {
        meta: metaPayload(snapshot, config),
        indicators: indicators(projects),
        projects: projects,
        filters: {
          categories: unique(projects.map(function (project) { return project.category; })),
          owners: unique(projects.map(function (project) { return project.ownerName; })),
          statuses: unique(projects.map(function (project) { return project.status; }))
        },
        query: query
      };
      cachePut(cacheKey, payload);
      return payload;
    });
  }

  function encodeHash(value) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
    return bytes.slice(0, 6).map(function (byte) {
      var current = ((byte % 256) + 256) % 256;
      return (current < 16 ? '0' : '') + current.toString(16);
    }).join('');
  }

  function project(projectId, options) {
    return respond(function () {
      DashboardApp.requireViewer();
      var id = DashboardApp.cleanQuery(projectId).trim();
      if (!id) throw new Error('NOT_FOUND');
      options = options || {};
      var requested = Number(options.limit);
      var limit = isFinite(requested) && requested > 0
        ? Math.min(MAX_REQUESTED_TASKS, Math.max(1, Math.floor(requested)))
        : MAX_PROJECT_TASKS;
      var config = DashboardApp.config();
      var snapshot = openTab();
      var today = todayJst();
      var record = snapshot.tables.projects.filter(function (project) { return text(project.projectId) === id; })[0];
      if (!record) throw new Error('NOT_FOUND');
      var summary = projectSummary(record, today);
      var subprojectNames = Object.create(null);
      var subprojects = snapshot.tables.subprojects
        .filter(function (subproject) { return text(subproject.projectId) === id; })
        .map(function (subproject) {
          var remaining = deadline(text(subproject.deadline), bool(subproject.terminal), today);
          var subProjectSummary = {
            subprojectId: text(subproject.subprojectId),
            name: text(subproject.name),
            ownerName: text(subproject.ownerName),
            status: text(subproject.status),
            statusLabel: label('status', text(subproject.status)),
            progress: number(subproject.progress),
            deadline: text(subproject.deadline),
            daysRemaining: remaining.days,
            deadlineKind: remaining.kind,
            deadlineLabel: remaining.label,
            total: 0
          };
          subprojectNames[subProjectSummary.subprojectId] = subProjectSummary.name;
          return subProjectSummary;
        });

      var owned = snapshot.tables.tasks.filter(function (task) { return text(task.projectId) === id; });
      var order = Object.create(null);
      subprojects.forEach(function (subproject, index) { order[subproject.subprojectId] = index; });
      owned.sort(function (a, b) {
        var left = text(a.subprojectId), right = text(b.subprojectId);
        var leftOrder = left && order[left] !== undefined ? order[left] : subprojects.length;
        var rightOrder = right && order[right] !== undefined ? order[right] : subprojects.length;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        var leftDue = text(a.dueDate) || '9999-12-31', rightDue = text(b.dueDate) || '9999-12-31';
        if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
        return text(a.name).localeCompare(text(b.name), 'ja');
      });

      var counts = {total: owned.length, open: 0, done: 0, overdue: 0, blocked: 0};
      var perSubproject = Object.create(null);
      owned.forEach(function (task) {
        var status = text(task.status);
        if (status === 'Done') counts.done++;
        else if (status !== 'Cancelled') counts.open++;
        if (status === 'Blocked') counts.blocked++;
        var due = deadline(text(task.dueDate), status === 'Done', today);
        if (due.kind === 'overdue') counts.overdue++;
        var key = text(task.subprojectId);
        perSubproject[key] = (perSubproject[key] || 0) + 1;
      });
      subprojects.forEach(function (subproject) { subproject.total = perSubproject[subproject.subprojectId] || 0; });

      var visible = owned.slice(0, limit);
      var payload = {
        meta: metaPayload(snapshot, config),
        project: summary,
        subprojects: subprojects,
        ungrouped: {name: '全体タスク', total: perSubproject[''] || 0},
        counts: counts,
        tasks: visible.map(function (task) {
          var subprojectId = text(task.subprojectId);
          var name = subprojectId ? subprojectNames[subprojectId] : '';
          return taskSummary(task, today, summary.projectName, name || '');
        }),
        taskTotal: owned.length,
        taskLimit: limit,
        truncated: owned.length > visible.length,
        milestones: snapshot.tables.milestones
          .filter(function (milestone) { return text(milestone.projectId) === id; })
          .map(function (milestone) {
            return {
              milestoneId: text(milestone.milestoneId),
              subprojectId: text(milestone.subprojectId),
              name: text(milestone.name),
              targetDate: text(milestone.targetDate),
              actualDate: text(milestone.actualDate),
              status: text(milestone.status),
              reached: !!text(milestone.actualDate)
            };
          })
          .sort(function (a, b) {
            var left = a.targetDate || '9999-12-31', right = b.targetDate || '9999-12-31';
            return left === right ? 0 : (left < right ? -1 : 1);
          })
      };
      return payload;
    });
  }

  function task(projectId, taskId) {
    return respond(function () {
      DashboardApp.requireViewer();
      var projectKey = DashboardApp.cleanQuery(projectId).trim();
      var taskKey = DashboardApp.cleanQuery(taskId).trim();
      if (!projectKey || !taskKey) throw new Error('NOT_FOUND');
      var snapshot = openTab();
      var today = todayJst();
      var record = snapshot.tables.tasks.filter(function (row) {
        return text(row.taskId) === taskKey && text(row.projectId) === projectKey;
      })[0];
      if (!record) throw new Error('NOT_FOUND');
      var projectRecord = snapshot.tables.projects.filter(function (row) {
        return text(row.projectId) === projectKey;
      })[0];
      if (!projectRecord) throw new Error('NOT_FOUND');
      var subprojectRecord = snapshot.tables.subprojects.filter(function (row) {
        return text(row.subprojectId) === text(record.subprojectId) && text(row.projectId) === projectKey;
      })[0];
      return {
        task: taskSummary(record, today, text(projectRecord.projectName), subprojectRecord ? text(subprojectRecord.name) : ''),
        project: {projectId: text(projectRecord.projectId), projectName: text(projectRecord.projectName)},
        canEdit: false
      };
    });
  }

  /**
   * Published identity of one task, used to validate a request submission.
   *
   * Only published rows resolve, so a restricted project can never receive a request. The
   * revision is an opaque string: it contains no member IDs or internal version numbers.
   */
  function requestTarget(taskId) {
    var key = text(taskId).trim();
    if (!key) return null;
    var snapshot = openTab();
    var record = snapshot.tables.tasks.filter(function (row) { return text(row.taskId) === key; })[0];
    if (!record) return null;
    return {
      taskId: text(record.taskId),
      projectId: text(record.projectId),
      dueDate: text(record.dueDate),
      revision: text(record.revision),
      snapshotVersion: text(snapshot.meta.SNAPSHOT_VERSION)
    };
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    TABLES: TABLES,
    LABELS: LABELS,
    MAX_PROJECT_TASKS: MAX_PROJECT_TASKS,
    DUE_SOON_DAYS: DUE_SOON_DAYS,
    deadline: deadline,
    requestTarget: requestTarget,
    portfolio: portfolio,
    project: project,
    task: task
  };
}());
