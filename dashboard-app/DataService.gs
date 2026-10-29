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
  var DEFAULT_CONTRACT = '1.6';
  var META_SHEET = 'PUBLISHED_META';
  var CACHE_TTL_SECONDS = 300;
  var CACHE_MAX_CHARS = 90000;
  var MAX_PROJECT_TASKS = 500;
  var MAX_REQUESTED_TASKS = 1000;
  var DUE_SOON_DAYS = 7;
  var RISK = ['RED', 'YELLOW', 'UNKNOWN'];
  // Contract 1.6 fields that carry a JSON name list instead of a scalar cell value.
  var LIST_FIELDS = ['assigneeNames'];

  // Must match SharedDashboardModel.PROJECT_PUBLIC_FIELDS / ... in the manager project.
  // The pairing is asserted by tests/v1_2-dashboard.test.js so the two apps cannot drift.
  var TABLES = {
    responsibilities: {sheet: 'PUBLISHED_RESPONSIBILITIES',
      fields: ['responsibilityId', 'name', 'sortOrder', 'retired', 'color']},
    projects: {sheet: 'PUBLISHED_PROJECTS', fields: ['projectId', 'projectName', 'category', 'responsibilityId',
      'responsibilityName', 'ownerName', 'status', 'progress', 'health', 'committedDeadline', 'forecastDeadline',
      'summary', 'lastUpdated', 'terminal', 'openTasks', 'doneTasks', 'overdueTasks', 'blockedTasks',
      'dueSoonTasks', 'totalTasks']},
    subprojects: {sheet: 'PUBLISHED_SUBPROJECTS', fields: ['subprojectId', 'projectId', 'parentSubprojectId',
      'level', 'name', 'ownerName', 'status', 'progress', 'directTasks', 'totalTasks', 'deadline', 'terminal']},
    tasks: {sheet: 'PUBLISHED_TASKS', fields: ['taskId', 'projectId', 'subprojectId', 'parentTaskId', 'container',
      'name', 'ownerName', 'status', 'priority', 'plannedStart', 'dueDate', 'progress', 'publicNote', 'revision',
      'pendingRequest', 'reviewState', 'completedAt']},
    milestones: {sheet: 'PUBLISHED_MILESTONES', fields: ['milestoneId', 'projectId', 'subprojectId', 'name',
      'targetDate', 'actualDate', 'status']}
  };

  /**
   * Every published contract this reader understands.
   *
   * Contract 1.5 added the task tree, the review state and the completion date, and the
   * responsibility colour. Contract 1.4 stays readable so a snapshot published by the
   * previous manager release is not blanked out by an application update. Each version is
   * validated against its own exact header row, so an unknown, mixed or hand-edited snapshot
   * still fails closed instead of being guessed at.
   */
  var CONTRACTS = {
    '1.4': {
      responsibilities: {sheet: 'PUBLISHED_RESPONSIBILITIES',
        fields: ['responsibilityId', 'name', 'sortOrder', 'retired']},
      projects: TABLES.projects,
      subprojects: TABLES.subprojects,
      tasks: {sheet: 'PUBLISHED_TASKS', fields: ['taskId', 'projectId', 'subprojectId', 'name', 'ownerName',
        'status', 'priority', 'plannedStart', 'dueDate', 'progress', 'publicNote', 'revision', 'pendingRequest']},
      milestones: TABLES.milestones
    },
    '1.5': TABLES,
    // Contract 1.6 adds an allowlisted display-name list per task. `ownerName` keeps its
    // meaning, so a reader that only understands 1.5 stays correct.
    '1.6': Object.assign({}, TABLES, {
      tasks: {sheet: TABLES.tasks.sheet, fields: TABLES.tasks.fields.concat(['assigneeNames'])}
    })
  };
  var SUPPORTED_CONTRACTS = ['1.4', '1.5', '1.6'];

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

  // Contract date-only fields may be materialized by Sheets as Date objects.
  function snapshotDate(field, value) {
    if (["committedDeadline","forecastDeadline","deadline","plannedStart","dueDate","targetDate","actualDate","lastUpdated","completedAt"].indexOf(field) >= 0 && value instanceof Date) {
      return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
    }
    return value;
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
    var contract = text(meta.CONTRACT_VERSION);
    if (SUPPORTED_CONTRACTS.indexOf(contract) < 0) throw new Error('SNAPSHOT_CONTRACT_UNSUPPORTED');
    var tables = CONTRACTS[contract];
    var snapshot = {book: book, meta: meta, slot: active, contract: contract, tables: {}};
    Object.keys(tables).forEach(function (key) {
      snapshot.tables[key] = readTable(book, active, tables[key]);
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
        table.fields.forEach(function (field, index) {
          record[field] = LIST_FIELDS.indexOf(field) >= 0 ? nameList(row[index]) : snapshotDate(field, row[index]);
        });
        return record;
      });
  }

  /** A published display-name list is JSON text; anything unreadable degrades to an empty list. */
  function nameList(value) {
    if (value === '' || value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.map(text).filter(function (name) { return !!name; });
    try {
      var parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed.map(text).filter(function (name) { return !!name; }) : [];
    } catch (error) {
      return [];
    }
  }

  function metaPayload(snapshot, config) {
    var publishedAt = text(snapshot.meta.PUBLISHED_AT);
    var published = publishedAt ? new Date(publishedAt) : null;
    var ageHours = published && !isNaN(published.getTime())
      ? Math.max(0, Math.floor((Date.now() - published.getTime()) / 3600000)) : null;
    return {
      contractVersion: text(snapshot.contract),
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
      responsibilityId: text(project.responsibilityId),
      responsibilityName: text(project.responsibilityName),
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

  function taskSummary(task, today, projectName, subprojectName, depth) {
    var completed = text(task.status) === 'Done';
    var remaining = deadline(text(task.dueDate), completed, today);
    var review = text(task.reviewState);
    return {
      taskId: text(task.taskId),
      projectId: text(task.projectId),
      projectName: projectName || '',
      subprojectId: text(task.subprojectId),
      subprojectName: subprojectName || '',
      parentTaskId: text(task.parentTaskId),
      container: bool(task.container),
      depth: Math.max(0, Number(depth) || 0),
      name: text(task.name),
      ownerName: text(task.ownerName),
      // Contract 1.6: every assignee's display name, primary first. A 1.4/1.5 snapshot has no
      // list, so the primary owner remains the only known assignee.
      assigneeNames: Array.isArray(task.assigneeNames) && task.assigneeNames.length
        ? task.assigneeNames : (text(task.ownerName) ? [text(task.ownerName)] : []),
      sharedAssignment: (Array.isArray(task.assigneeNames) ? task.assigneeNames.length : 0) > 1,
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
      reviewState: review,
      reviewLabel: review === 'PENDING' ? '承認待ち' : review === 'STALE' ? '再報告が必要' : '',
      completedAt: text(task.completedAt),
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

  /**
   * Responsibility filter options.
   *
   * Only responsibilities that label at least one visible project are offered, in their
   * configured display order. A retired responsibility keeps its label so historical
   * projects never lose their grouping; the flag lets the viewer mark it.
   */
  function responsibilityOptions(snapshot, projects) {
    var used = Object.create(null);
    projects.forEach(function (project) {
      if (project.responsibilityId) used[project.responsibilityId] = true;
    });
    var rows = snapshot.tables.responsibilities
      .filter(function (row) { return !!used[text(row.responsibilityId)]; })
      .map(function (row) {
        return {
          responsibilityId: text(row.responsibilityId),
          name: text(row.name),
          retired: bool(row.retired)
        };
      });
    rows.sort(function (left, right) { return left.name.localeCompare(right.name, 'ja'); });
    return rows;
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
          statuses: unique(projects.map(function (project) { return project.status; })),
          // Contract 1.6: every published assignee display name, primary first per task.
          workers: unique(snapshot.tables.tasks.reduce(function (list, row) {
            return list.concat(taskAssigneeNames(row));
          }, [])),
          responsibilities: responsibilityOptions(snapshot, projects)
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
            parentSubprojectId: text(subproject.parentSubprojectId),
            level: Math.max(1, Number(subproject.level) || 1),
            name: text(subproject.name),
            ownerName: text(subproject.ownerName),
            status: text(subproject.status),
            statusLabel: label('status', text(subproject.status)),
            progress: number(subproject.progress),
            deadline: text(subproject.deadline),
            daysRemaining: remaining.days,
            deadlineKind: remaining.kind,
            deadlineLabel: remaining.label,
            total: 0,
            subtreeTotal: number(subproject.totalTasks) || 0
          };
          subprojectNames[subProjectSummary.subprojectId] = subProjectSummary.name;
          return subProjectSummary;
        });
      // Order the tree so a nested subproject always follows its parent.
      var byParent = Object.create(null);
      subprojects.forEach(function (subproject) {
        var parent = subproject.parentSubprojectId;
        if (!byParent[parent]) byParent[parent] = [];
        byParent[parent].push(subproject);
      });
      var orderedSubprojects = [];
      var seenSubprojects = Object.create(null);
      (function walk(parentId, level) {
        if (level > 4) return;
        (byParent[parentId] || []).forEach(function (subproject) {
          if (seenSubprojects[subproject.subprojectId]) return;
          seenSubprojects[subproject.subprojectId] = true;
          orderedSubprojects.push(subproject);
          walk(subproject.subprojectId, level + 1);
        });
      }('', 0));
      subprojects.forEach(function (subproject) {
        if (orderedSubprojects.indexOf(subproject) < 0) orderedSubprojects.push(subproject);
      });
      subprojects = orderedSubprojects;

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

      var counts = {total: 0, open: 0, done: 0, overdue: 0, blocked: 0};
      var perSubproject = Object.create(null);
      // A task that contains subtasks is a container: only leaf work is counted, so a parent
      // and its children are never counted twice.
      var ownedById = Object.create(null);
      owned.forEach(function (task) { ownedById[text(task.taskId)] = task; });
      var parentIds = Object.create(null);
      owned.forEach(function (task) {
        var parent = text(task.parentTaskId);
        if (parent && ownedById[parent] && parent !== text(task.taskId)) parentIds[parent] = true;
      });
      var leaves = owned.filter(function (task) { return !parentIds[text(task.taskId)]; });
      counts.total = leaves.length;
      leaves.forEach(function (task) {
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

      // Parents precede their children; the bounded walk also keeps malformed data from looping.
      var childrenOf = Object.create(null), roots = [], seenTasks = Object.create(null);
      owned.forEach(function (task) {
        var parent = text(task.parentTaskId);
        if (parent && ownedById[parent] && parent !== text(task.taskId)) {
          if (!childrenOf[parent]) childrenOf[parent] = [];
          childrenOf[parent].push(task);
          return;
        }
        roots.push(task);
      });
      var orderedTasks = [];
      (function walk(list, level) {
        (list || []).forEach(function (task) {
          var key = text(task.taskId);
          if (seenTasks[key] || level > 3) return;
          seenTasks[key] = true;
          task.__depth = level;
          orderedTasks.push(task);
          walk(childrenOf[key], level + 1);
        });
      }(roots, 0));
      owned.forEach(function (task) {
        if (seenTasks[text(task.taskId)]) return;
        task.__depth = 0;
        orderedTasks.push(task);
      });
      owned = orderedTasks;

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
          return taskSummary(task, today, summary.projectName, name || '', task.__depth);
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
   * A worker's assigned work across every published project (contract 1.6).
   *
   * The query runs entirely inside the published snapshot: restricted projects, private
   * descriptions and member identifiers are not present, so no filter can leak them. The
   * worker name is a self-selected display filter, not authentication — two people sharing a
   * name are indistinguishable here by design (docs/dashboard/DATA_CONTRACT.md).
   */
  function workerTasks(request) {
    return respond(function () {
      DashboardApp.requireViewer();
      request = request || {};
      var config = DashboardApp.config();
      var snapshot = openTab();
      var today = todayJst();
      var worker = text(request.worker).trim();
      var projectId = text(request.projectId).trim();
      var responsibilityId = text(request.responsibilityId).trim();
      var priority = text(request.priority).trim();
      var query = DashboardApp.cleanQuery(request.query).trim().toLowerCase();
      var group = text(request.group) === 'completed' ? 'completed' : (text(request.group) === 'all' ? 'all' : 'open');
      var overdueOnly = request.overdue === true;
      var dueWithin = Number(request.dueWithin) > 0 ? Number(request.dueWithin) : 0;
      var offset = Math.max(0, Math.floor(Number(request.offset) || 0));
      var limit = Math.min(100, Math.max(1, Math.floor(Number(request.limit) || 20)));
      var cacheKey = 'sd:worker:' + text(snapshot.meta.SNAPSHOT_VERSION) + ':' + today + ':' + encodeHash(JSON.stringify({
        worker: worker, projectId: projectId, responsibilityId: responsibilityId, priority: priority,
        query: query, group: group, overdue: overdueOnly, dueWithin: dueWithin, offset: offset, limit: limit
      }));
      var cached = cacheGet(cacheKey);
      if (cached) return cached;

      var projects = Object.create(null), projectOrder = [];
      snapshot.tables.projects.forEach(function (row) {
        projects[text(row.projectId)] = row;
        projectOrder.push(text(row.projectId));
      });
      var subprojects = Object.create(null);
      snapshot.tables.subprojects.forEach(function (row) {
        subprojects[text(row.subprojectId)] = text(row.name);
      });
      function terminal(status) { return status === 'Done' || status === 'Cancelled'; }
      var horizon = '';
      if (dueWithin) {
        var date = new Date(today + 'T00:00:00Z');
        date.setUTCDate(date.getUTCDate() + dueWithin);
        horizon = date.toISOString().slice(0, 10);
      }
      var matched = [], workers = Object.create(null);
      snapshot.tables.tasks.forEach(function (row) {
        var assignees = taskAssigneeNames(row);
        assignees.forEach(function (name) { if (name) workers[name] = true; });
        if (worker && assignees.indexOf(worker) < 0) return;
        var project = projects[text(row.projectId)] || {};
        if (projectId && text(row.projectId) !== projectId) return;
        var projectResponsibility = text(project.responsibilityId);
        if (responsibilityId === '__none__') { if (projectResponsibility) return; }
        else if (responsibilityId && projectResponsibility !== responsibilityId) return;
        if (priority && text(row.priority) !== priority) return;
        var status = text(row.status);
        if (group === 'open' && terminal(status)) return;
        if (group === 'completed' && status !== 'Done') return;
        var dueDate = text(row.dueDate);
        if (overdueOnly && !(dueDate && dueDate < today && !terminal(status))) return;
        if (horizon && !(dueDate && dueDate >= today && dueDate <= horizon && !terminal(status))) return;
        if (query) {
          var haystack = [text(row.taskId), text(row.name), text(project.projectName),
            subprojects[text(row.subprojectId)] || ''].join(' ').toLowerCase();
          if (haystack.indexOf(query) < 0) return;
        }
        matched.push(row);
      });
      // Overdue first, then today, then the nearest deadline, then work without a deadline.
      function bucket(row) {
        var dueDate = text(row.dueDate);
        if (terminal(text(row.status))) return 3;
        if (!dueDate) return 3;
        if (dueDate < today) return 0;
        if (dueDate === today) return 1;
        return 2;
      }
      matched.sort(function (a, b) {
        var order = bucket(a) - bucket(b);
        if (order) return order;
        var left = text(a.dueDate) || '9999-12-31', right = text(b.dueDate) || '9999-12-31';
        if (left !== right) return left < right ? -1 : 1;
        return text(a.taskId).localeCompare(text(b.taskId));
      });
      var page = matched.slice(offset, offset + limit).map(function (row) {
        var project = projects[text(row.projectId)] || {};
        return taskSummary(row, today, text(project.projectName), subprojects[text(row.subprojectId)] || '',
          nestingDepth(row, snapshot.tables.tasks));
      });
      var openCount = matched.filter(function (row) { return !terminal(text(row.status)); }).length;
      var payload = {
        meta: metaPayload(snapshot, config),
        workers: Object.keys(workers).sort(function (a, b) { return a.localeCompare(b, 'ja'); }),
        projects: projectOrder.map(function (id) {
          return {projectId: id, projectName: text(projects[id].projectName),
            responsibilityId: text(projects[id].responsibilityId)};
        }),
        responsibilities: responsibilityOptions(snapshot, snapshot.tables.projects.map(function (row) {
          return projectSummary(row, today);
        })),
        totals: {matched: matched.length, open: openCount, completed: matched.length - openCount,
          overdue: matched.filter(function (row) { return text(row.dueDate) && text(row.dueDate) < today && !terminal(text(row.status)); }).length},
        filters: {worker: worker, projectId: projectId, responsibilityId: responsibilityId, priority: priority,
          query: query, group: group, overdue: overdueOnly, dueWithin: dueWithin},
        tasks: page,
        offset: offset, limit: limit, total: matched.length
      };
      cachePut(cacheKey, payload);
      return payload;
    });
  }

  /** Contract 1.6 name list, with the 1.4/1.5 primary owner as the honest fallback. */
  function taskAssigneeNames(task) {
    if (Array.isArray(task.assigneeNames) && task.assigneeNames.length) return task.assigneeNames;
    return text(task.ownerName) ? [text(task.ownerName)] : [];
  }

  /** Bounded parent walk: a malformed or circular link stops instead of recursing forever. */
  function nestingDepth(task, tasks) {
    var byId = Object.create(null);
    tasks.forEach(function (row) { byId[text(row.taskId)] = row; });
    var depth = 0, cursor = text(task.parentTaskId), seen = Object.create(null);
    while (cursor && depth < 3 && !seen[cursor]) {
      seen[cursor] = true;
      var parent = byId[cursor];
      if (!parent) break;
      depth++;
      cursor = text(parent.parentTaskId);
    }
    return depth;
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
      snapshotVersion: text(snapshot.meta.SNAPSHOT_VERSION),
      // Contract 1.5 publishes the container flag; a 1.4 snapshot has no nested tasks, so an
      // absent field means "ordinary work item" and never blocks the form.
      container: bool(record.container),
      contract: text(snapshot.contract)
    };
  }

  return {
    CONTRACT_VERSION: DEFAULT_CONTRACT,
    CONTRACTS: CONTRACTS,
    SUPPORTED_CONTRACTS: SUPPORTED_CONTRACTS,
    TABLES: TABLES,
    LABELS: LABELS,
    MAX_PROJECT_TASKS: MAX_PROJECT_TASKS,
    DUE_SOON_DAYS: DUE_SOON_DAYS,
    deadline: deadline,
    requestTarget: requestTarget,
    portfolio: portfolio,
    project: project,
    task: task,
    workerTasks: workerTasks,
    taskAssigneeNames: taskAssigneeNames
  };
}());
