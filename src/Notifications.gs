/**
 * Centralized outgoing-mail service.
 *
 * Every notification, reminder and management report passes through this module, which
 * resolves the effective automation mode once, enforces the per-feature switches and the
 * run cap, reserves a persistent ledger row before sending, and never blind-retries an
 * ambiguous delivery. Exactly-once delivery is not promised.
 */
var Notifications = (function () {
  var DAY = 86400000;
  var UNCERTAIN_MINUTES = 15;
  function email(value) { return String(value || '').trim().toLowerCase(); }
  function yes(value) { return value === true || String(value).toLowerCase() === 'true'; }
  function date(value) {
    if (!value) return null;
    var parsed = value instanceof Date ? value : new Date(value);
    if (isNaN(parsed.getTime())) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        parsed.toISOString().slice(0, 10) !== value) return null;
    return parsed;
  }
  function day(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    var parsed = date(value);
    return parsed ? Utilities.formatDate(parsed, 'Asia/Tokyo', 'yyyy-MM-dd') : '';
  }
  function owner(task) { return String(task.Owner_Member_ID || '').trim(); }
  function baseline(task) {
    try { return JSON.parse(task.Notification_Baseline || 'null'); } catch (error) { return null; }
  }
  function matches(task) {
    var previous = baseline(task);
    return !!previous && previous.owner === owner(task) && previous.due === day(task.Due_Date);
  }
  function snapshot(task, type) {
    if (!type) {
      var previous = baseline(task);
      type = !previous ? 'NEW_ASSIGNMENT' : previous.owner !== owner(task) ? 'REASSIGNMENT' :
        previous.due !== day(task.Due_Date) ? 'DEADLINE_CHANGE' : previous.type;
    }
    return JSON.stringify({owner: owner(task), due: day(task.Due_Date), type: type || 'NEW_ASSIGNMENT'});
  }
  function actorMatches(value) {
    var actual = AuditLog.actor();
    if (!actual || email(value) !== actual) throw new Error('A verified active account is required');
    return actual;
  }
  function boundConfig() {
    Config.require('SPREADSHEET_ID');
    Config.require('ENVIRONMENT');
    return Config.get();
  }
  function writeBaselines(patches) {
    // Only the changed system cells are written; untouched rows keep their cells and formulas.
    if (patches.length) Database.updateMany('TASKS', patches);
  }
  function reconcileRows(tasks) {
    var changed = 0;
    var patches = [];
    tasks.forEach(function (task) {
      if (matches(task)) return;
      var previous = baseline(task);
      var type = !previous ? 'NEW_ASSIGNMENT' :
        previous.owner !== owner(task) ? 'REASSIGNMENT' : 'DEADLINE_CHANGE';
      var patch = {Notification_Baseline: snapshot(task, type), Assignment_Approved_At: ''};
      patch.Assignment_Version = Number(task.Assignment_Version || 0) + 1;
      patches.push({id: task.Task_ID, patch: patch});
      Object.keys(patch).forEach(function (key) { task[key] = patch[key]; });
      changed++;
    });
    writeBaselines(patches);
    return changed;
  }
  function reconcile() {
    boundConfig();
    return Database.withLock(function () { return reconcileRows(Database.read('TASKS')); });
  }
  function activate(actorEmail, confirmation) {
    if (confirmation !== 'ACTIVATE NOTIFICATIONS') throw new Error('Explicit activation confirmation required');
    var actor = actorMatches(actorEmail);
    boundConfig();
    return Database.withLock(function () {
      var config = Config.get();
      if (config.notificationActivationAt) throw new Error('Notifications already activated');
      var now = new Date();
      var patches = Database.read('TASKS').map(function (task) {
        return {id: task.Task_ID, patch: {
          Notification_Baseline: snapshot(task), Assignment_Approved_At: '',
          Assignment_Version: Number(task.Assignment_Version || 0) + 1
        }};
      });
      writeBaselines(patches);
      var properties = PropertiesService.getScriptProperties();
      properties.setProperties({
        NOTIFICATION_ACTIVATION_AT: now.toISOString(),
        NOTIFICATION_AUTHORIZED_BY: actor
      });
      AuditLog.write('NOTIFICATIONS_ACTIVATED', 'SYSTEM', '', {authorizedBy: actor});
      return {activatedAt: now.toISOString(), authorizedBy: actor};
    });
  }
  function approveAssignment(taskId, actorEmail, confirmation) {
    if (confirmation !== 'APPROVE ASSIGNMENT') throw new Error('Explicit assignment confirmation required');
    actorMatches(actorEmail);
    var config = boundConfig();
    var activated = date(config.notificationActivationAt);
    if (!activated || !config.notificationAuthorizedBy) throw new Error('Activate notifications first');
    return Database.withLock(function () {
      var task = Database.find('TASKS', taskId);
      if (!task) throw new Error('Unknown task');
      reconcileRows([task]);
      task = Database.find('TASKS', taskId);
      var patch = Tasks.approvalPatch(task);
      var approvedAt = new Date(Math.max(Date.now(), activated.getTime() + 1));
      patch.Assignment_Approved_At = approvedAt;
      patch.Notification_Baseline = snapshot(Object.assign({}, task, {Assignment_Approved_At: approvedAt}));
      Database.updateMany('TASKS', [{id: taskId, patch: patch}]);
      AuditLog.write('ASSIGNMENT_APPROVED', 'TASK', taskId, {version: task.Assignment_Version});
      return {taskId: taskId, approvedAt: approvedAt.toISOString(), version: task.Assignment_Version};
    });
  }
  function index(rows, key) {
    var result = Object.create(null);
    rows.forEach(function (row) { result[String(row[key])] = row; });
    return result;
  }
  function recipient(address, config, members) {
    address = email(address);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return '';
    var domains = (config.allowedDomains || []).map(function (domain) { return email(domain); });
    if (domains.indexOf(address.split('@')[1]) === -1) return '';
    var member = members[address];
    return member && member.Active === true ? address : '';
  }
  function eligible(task, projects, subprojects, activated) {
    var approved = date(task.Assignment_Approved_At);
    var project = projects[task.Project_ID];
    // The whole ancestor chain decides: a task beneath an archived parent is not reminded.
    return Eligibility.taskNotifiable(task, project, subprojects) &&
      Number.isInteger(Number(task.Assignment_Version)) && Number(task.Assignment_Version) > 0 &&
      !!date(task.Due_Date) && !!approved && approved.getTime() > activated.getTime() &&
      matches(task);
  }
  function week(now) {
    var d = new Date(day(now) + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    return day(d);
  }
  function html(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, function (character) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character];
    });
  }
  function taskBody(task, project, member, config, label) {
    return [
      label, '',
      'プロジェクト: ' + (project.Project_Name || task.Project_ID),
      'タスク: ' + (task.Task_Name || task.Task_ID),
      'タスクID: ' + task.Task_ID,
      '担当者: ' + (member.Name || member.Email),
      '期限: ' + day(task.Due_Date),
      '状態: ' + task.Status,
      '次のアクション: ' + (task.Next_Action || '未設定'),
      '完了条件: ' + (task.Acceptance_Criteria || '未設定'),
      '',
      '管理台帳: https://docs.google.com/spreadsheets/d/' + encodeURIComponent(config.spreadsheetId) + '/edit'
    ].join('\n');
  }

  /** Most relevant unsent reminder stage inside a bounded catch-up window. */
  function stageDue(days, state) {
    if (days < 0) return null;
    var offsets = state.offsets && state.offsets.length ? state.offsets : [7, 2];
    var catchup = Number(state.catchupDays || 0);
    var candidates = offsets.filter(function (offset) { return days <= offset && days >= offset - catchup; });
    if (!candidates.length) return null;
    return Math.min.apply(null, candidates);
  }

  function overdueBucket(now, state) {
    if (!state.configured) return week(now);
    var frequency = Math.max(1, Number(state.overdueFrequencyDays || 7));
    var index = Math.floor(new Date(day(now) + 'T00:00:00Z').getTime() / DAY);
    return 'B' + Math.floor(index / frequency);
  }

  function reminderWindowOpen(state, now) {
    if (!state.configured) return true;
    var dayText = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
    var weekday = new Date(dayText + 'T00:00:00Z').getUTCDay();
    if (state.weekdayOnly && (weekday === 0 || weekday === 6)) return false;
    var clock = Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm');
    if (state.windowStart && state.windowEnd && (clock < state.windowStart || clock > state.windowEnd)) return false;
    return true;
  }

  function ledgerSeen(logs) {
    var seen = Object.create(null), previewSeen = Object.create(null);
    logs.forEach(function (log) {
      var result = String(log.Result).toUpperCase();
      if (result === 'PREVIEW') previewSeen[String(log.Notification_Key)] = true;
      else if (result === 'DRY_RUN' || result === 'SKIPPED') return;
      else seen[String(log.Notification_Key)] = true;
    });
    return {seen: seen, previewSeen: previewSeen};
  }

  /** Single send gate used by the task scanner and the weekly report. */
  function createMailer(context) {
    var config = context.config, state = context.state, now = context.now, mode = context.mode;
    var options = context.options || {}, result = context.result;
    var seen = context.seen, previewSeen = context.previewSeen, taskMap = context.taskMap || {};
    var nowDay = day(now);
    var maximum = Number(config.maxEmailsPerRun);
    if (!isFinite(maximum) || maximum < 0) maximum = 10;
    maximum = Math.floor(maximum);
    var budget = 0;

    return function deliver(key, to, subject, body, taskId, type, stage) {
      if (seen[key] || budget >= maximum) { result.skipped++; return false; }
      if (mode === 'PREVIEW') {
        if (!state.configured && !options.forcePreview) { result.dryRun++; return false; }
        var previewKey = 'PREVIEW:' + key + ':' + nowDay;
        if (previewSeen[previewKey]) { result.skipped++; return false; }
        previewSeen[previewKey] = true;
        budget++;
        result.preview++;
        if (options.previews) options.previews.push({
          taskId: taskId || '', type: type, stage: stage, recipient: to, subject: subject, body: body
        });
        if (options.writeLedger) {
          Database.insert('NOTIFICATION_LOG', {
            Notification_ID: Utilities.getUuid(), Created_At: now, Task_ID: taskId || '',
            Recipient: to, Notification_Type: type, Notification_Key: previewKey,
            Assignment_Version: taskId && taskMap[taskId] ? Number(taskMap[taskId].Assignment_Version) : '',
            Result: 'PREVIEW', Error_Details: ''
          });
        }
        return true;
      }
      var id = Utilities.getUuid();
      Database.insert('NOTIFICATION_LOG', {
        Notification_ID: id, Created_At: now, Task_ID: taskId || '',
        Recipient: to, Notification_Type: type, Notification_Key: key,
        Assignment_Version: taskId && taskMap[taskId] ? Number(taskMap[taskId].Assignment_Version) : '',
        Result: 'PENDING', Error_Details: ''
      });
      seen[key] = true;
      budget++;
      result.pending++;
      try {
        MailApp.sendEmail({to: to, subject: subject, body: body,
          htmlBody: '<div lang="ja"><p>' + html(body).replace(/\n/g, '<br>') + '</p></div>'});
      } catch (error) {
        // PENDING intentionally survives failures, including ambiguous delivery.
        Database.update('NOTIFICATION_LOG', id, {Error_Details: String(error.message || error).slice(0, 500)});
        return false;
      }
      Database.update('NOTIFICATION_LOG', id, {Result: 'SENT', Sent_At: new Date()});
      result.pending--;
      result.sent++;
      return true;
    };
  }

  function emptyResult(state) {
    return {sent: 0, pending: 0, dryRun: 0, skipped: 0, preview: 0, reconciled: 0,
      mode: state.mode, reason: state.reason};
  }

  function run(nowValue, options) {
    options = options || {};
    var config = boundConfig();
    var now = date(nowValue) || new Date();
    return Database.withLock(function () {
      var state = AutomationSettings.emailState(config);
      var mode = options.forcePreview ? 'PREVIEW' : state.mode;
      var tasks = Database.read('TASKS');
      var result = emptyResult(state);
      result.mode = mode;
      result.reconciled = reconcileRows(tasks);
      var previews = options.collect ? [] : null;
      var activated = date(config.notificationActivationAt);
      if (!activated || !config.notificationAuthorizedBy) { result.reason = 'NOT_ACTIVATED'; return result; }
      if (mode === 'OFF' && !options.forcePreview) return result;

      var projects = index(Database.read('PROJECTS'), 'Project_ID');
      var subprojects = index(Database.read('SUBPROJECTS'), 'Subproject_ID');
      var taskMap = index(tasks, 'Task_ID');
      var members = Object.create(null);
      var memberIds = Object.create(null);
      Database.read('MEMBERS').forEach(function (member) {
        members[email(member.Email)] = member;
        memberIds[String(member.Member_ID)] = member;
      });
      var logs = ledgerSeen(Database.read('NOTIFICATION_LOG'));
      var deliver = createMailer({config: config, state: state, mode: mode, now: now, options: options,
        result: result, seen: logs.seen, previewSeen: logs.previewSeen, taskMap: taskMap});
      var overdue = [];
      var nowDay = day(now);

      tasks.forEach(function (task) {
        if (!eligible(task, projects, subprojects, activated)) { result.skipped++; return; }
        var project = projects[task.Project_ID];
        if (!Eligibility.projectNotificationsAllowed(project)) { result.skipped++; return; }
        var member = memberIds[owner(task)];
        var to = recipient(member && member.Email, config, members);
        if (!to) { result.skipped++; return; }
        var due = day(task.Due_Date);
        var days = Math.round((new Date(due + 'T00:00:00Z').getTime() - new Date(nowDay + 'T00:00:00Z').getTime()) / DAY);
        if (days < 0) overdue.push(task);
        var base = [task.Task_ID, owner(task), to, task.Assignment_Version, due];
        var type = baseline(task).type || 'NEW_ASSIGNMENT';
        var label = {NEW_ASSIGNMENT: '新規割当', REASSIGNMENT: '担当者変更', DEADLINE_CHANGE: '期限変更'}[type] || '割当確認';
        if (state.toggles[type] !== false) {
          deliver(JSON.stringify(base.concat([type, 'approved'])), to,
            '【' + label + '】' + (task.Task_Name || task.Task_ID),
            taskBody(task, project, member, config, label), task.Task_ID, type, 'approved');
        } else {
          result.skipped++;
        }
        var stage = stageDue(days, state);
        if (stage !== null && state.toggles.DEADLINE && reminderWindowOpen(state, now)) {
          deliver(JSON.stringify(base.concat(['DEADLINE', String(stage)])), to,
            '【期限' + stage + '日前】' + (task.Task_Name || task.Task_ID),
            taskBody(task, project, member, config, '期限まで残り' + stage + '日です。'),
            task.Task_ID, 'DEADLINE', String(stage));
        }
        if (days < 0 && state.toggles.OVERDUE && reminderWindowOpen(state, now)) {
          var bucket = overdueBucket(now, state);
          deliver(JSON.stringify(base.concat(['OVERDUE', bucket])), to,
            '【期限超過・週次確認】' + (task.Task_Name || task.Task_ID),
            taskBody(task, project, member, config, '期限を超過しています。進捗と次の対応を確認してください。'),
            task.Task_ID, 'OVERDUE', bucket);
        }
      });

      if (overdue.length && state.toggles.OVERDUE_SUMMARY && reminderWindowOpen(state, now)) {
        var taskKeys = overdue.map(function (task) {
          return [task.Task_ID, owner(task), task.Assignment_Version, day(task.Due_Date)].join(':');
        }).sort();
        var bucketKey = overdueBucket(now, state);
        var configuredRecipients = state.configured ? state.managementRecipients : (config.managementRecipients || []);
        var uniqueRecipients = Object.create(null);
        configuredRecipients.forEach(function (address) {
          var to = recipient(address, config, members);
          if (!to || uniqueRecipients[to]) return;
          uniqueRecipients[to] = true;
          var weeklyPrefix = JSON.stringify(['OVERDUE_SUMMARY', bucketKey, to]).slice(0, -1) + ',';
          if (Object.keys(logs.seen).some(function (key) { return key.indexOf(weeklyPrefix) === 0; })) return;
          var key = JSON.stringify(['OVERDUE_SUMMARY', bucketKey, to, taskKeys]);
          var summary = overdue.map(function (task) {
            return [task.Task_Name || task.Task_ID, 'ID: ' + task.Task_ID, '担当: ' + owner(task), '期限: ' + day(task.Due_Date)].join(' / ');
          }).join('\n');
          deliver(key, to, '【週次管理サマリー】期限超過タスク',
            '承認済みの期限超過タスク:\n' + summary, '', 'OVERDUE_SUMMARY', bucketKey);
        });
      }
      if (previews) result.previews = previews;
      return result;
    });
  }

  function scan(nowValue) { return run(nowValue, {writeLedger: true}); }

  /** Read-only preview of what the next scan would send. Never sends or reserves live keys. */
  function preview(nowValue) {
    var result = run(nowValue, {writeLedger: false, forcePreview: true, collect: true});
    return result.previews || [];
  }

  /** Weekly management report: separate content, same centralized send gate. */
  function sendWeeklyReport(nowValue) {
    var config = boundConfig();
    var now = date(nowValue) || new Date();
    return Database.withLock(function () {
      var state = AutomationSettings.emailState(config);
      var result = emptyResult(state);
      var activated = date(config.notificationActivationAt);
      if (!activated || !config.notificationAuthorizedBy) { result.reason = 'NOT_ACTIVATED'; return result; }
      if (!state.toggles.WEEKLY_REPORT) { result.reason = 'WEEKLY_REPORT_DISABLED'; return result; }
      if (state.mode === 'OFF') return result;
      var members = Object.create(null);
      Database.read('MEMBERS').forEach(function (member) { members[email(member.Email)] = member; });
      var addresses = state.configured ? state.managementRecipients : (config.managementRecipients || []);
      var recipients = [], seenTo = Object.create(null);
      addresses.forEach(function (address) {
        var to = recipient(address, config, members);
        if (!to || seenTo[to]) return;
        seenTo[to] = true;
        recipients.push(to);
      });
      if (!recipients.length) { result.reason = 'NO_VALID_RECIPIENTS'; return result; }
      var report = Reports.weekly(day(now));
      if (report.empty) { result.reason = 'EMPTY_REPORT'; return result; }
      var logs = ledgerSeen(Database.read('NOTIFICATION_LOG'));
      var deliver = createMailer({config: config, state: state, mode: state.mode, now: now,
        options: {writeLedger: true}, result: result, seen: logs.seen, previewSeen: logs.previewSeen, taskMap: {}});
      recipients.forEach(function (to) {
        var key = JSON.stringify(['WEEKLY_REPORT', report.weekStart, to]);
        deliver(key, to, '【週次管理レポート】' + report.weekStart + ' 週', report.body, '', 'WEEKLY_REPORT', report.weekStart);
      });
      AutomationSettings.setStatus('LAST_WEEKLY_REPORT_AT', Domain.now());
      return result;
    });
  }

  /**
   * V1.3 request notifications. Same gate, same switches, OFF by default.
   *
   * Only the requesting employee's self-reported name, the task identity and the dates are
   * sent: no credentials, no client token, no private workbook identifier.
   */
  function requestRecipients(state, config) {
    var members = Object.create(null);
    Database.read('MEMBERS').forEach(function (member) { members[email(member.Email)] = member; });
    var addresses = state.configured ? state.managementRecipients : (config.managementRecipients || []);
    var out = [], seen = Object.create(null);
    addresses.forEach(function (address) {
      var to = recipient(address, config, members);
      if (!to || seen[to]) return;
      seen[to] = true;
      out.push(to);
    });
    return out;
  }

  function requestToggle(state, request) {
    return String(request && request.Request_Type) === 'COMPLETION_REPORT'
      ? state.toggles.COMPLETION_REPORT === true
      : state.toggles.DEADLINE_REQUEST === true;
  }

  function requestBody(request, kind, status) {
    var typeLabel = String(request.Request_Type) === 'COMPLETION_REPORT' ? '完了報告' : '納期変更申請';
    var lines = [
      typeLabel + '（' + (kind === 'REQUEST_SUBMITTED' ? '受付' : '判断: ' + status) + '）',
      '申請ID: ' + String(request.Request_ID || ''),
      'プロジェクトID: ' + String(request.Project_ID || ''),
      'タスクID: ' + String(request.Task_ID || ''),
      '申請者（自己申告・未確認）: ' + String(request.Requester_Name || ''),
      '申請日時: ' + String(request.Submitted_At || '')
    ];
    if (String(request.Request_Type) === 'COMPLETION_REPORT') {
      lines.push('報告メモ: ' + String(request.Completion_Note || ''));
    } else {
      lines.push('現在の期限: ' + String(request.Original_Due_Date || ''));
      lines.push('希望期限: ' + String(request.Requested_Due_Date || ''));
      lines.push('理由: ' + String(request.Reason || ''));
      lines.push('詳細: ' + String(request.Explanation || ''));
    }
    lines.push('', '判断は管理アプリの「申請一覧 / 承認待ち」で行ってください。');
    return lines.join('\n');
  }

  function deliverRequest(request, kind, now) {
    var config = boundConfig();
    var state = AutomationSettings.emailState(config);
    var result = emptyResult(state);
    var activated = date(config.notificationActivationAt);
    if (!activated || !config.notificationAuthorizedBy) { result.reason = 'NOT_ACTIVATED'; return result; }
    if (!requestToggle(state, request)) { result.reason = 'REQUEST_NOTIFICATIONS_DISABLED'; return result; }
    if (state.mode === 'OFF') return result;
    var recipients = requestRecipients(state, config);
    if (!recipients.length) { result.reason = 'NO_VALID_RECIPIENTS'; return result; }
    var logs = ledgerSeen(Database.read('NOTIFICATION_LOG'));
    var deliver = createMailer({config: config, state: state, mode: state.mode, now: now,
      options: {writeLedger: true}, result: result, seen: logs.seen, previewSeen: logs.previewSeen, taskMap: {}});
    var subject = kind === 'REQUEST_SUBMITTED'
      ? '【申請受付】' + (String(request.Request_Type) === 'COMPLETION_REPORT' ? '完了報告' : '納期変更申請')
      : '【申請判断】' + String(request.Request_ID || '');
    var body = requestBody(request, kind, request.Status);
    recipients.forEach(function (to) {
      deliver(JSON.stringify([kind, String(request.Request_ID || ''), to]), to, subject, body,
        String(request.Task_ID || ''), kind, String(request.Request_ID || ''));
    });
    return result;
  }

  function notifyRequestSubmitted(request) {
    if (!request) return null;
    return deliverRequest(request, 'REQUEST_SUBMITTED', new Date());
  }

  function notifyRequestDecision(request, status) {
    if (!request) return null;
    return deliverRequest(request, 'REQUEST_DECISION', new Date());
  }

  /** Bounded daily reminder about requests that are still waiting for approval. */
  function sendPendingRequestReminder(nowValue) {
    var config = boundConfig();
    var now = date(nowValue) || new Date();
    var state = AutomationSettings.emailState(config);
    var result = emptyResult(state);
    var activated = date(config.notificationActivationAt);
    if (!activated || !config.notificationAuthorizedBy) { result.reason = 'NOT_ACTIVATED'; return result; }
    if (!state.toggles.PENDING_REQUEST_REMINDER) { result.reason = 'PENDING_REQUEST_REMINDER_DISABLED'; return result; }
    if (state.mode === 'OFF') return result;
    var pending = Database.read('TASK_REQUESTS').filter(function (request) {
      var status = String(request.Status).toUpperCase();
      return status === 'PENDING' || status === 'STALE';
    });
    if (!pending.length) { result.reason = 'NOTHING_PENDING'; return result; }
    var recipients = requestRecipients(state, config);
    if (!recipients.length) { result.reason = 'NO_VALID_RECIPIENTS'; return result; }
    var logs = ledgerSeen(Database.read('NOTIFICATION_LOG'));
    var deliver = createMailer({config: config, state: state, mode: state.mode, now: now,
      options: {writeLedger: true}, result: result, seen: logs.seen, previewSeen: logs.previewSeen, taskMap: {}});
    var body = ['承認待ちの申請が ' + pending.length + ' 件あります。', '',
      pending.slice(0, 20).map(function (request) {
        return '- ' + String(request.Request_ID) + ' / タスク ' + String(request.Task_ID) +
          ' / 状態 ' + String(request.Status);
      }).join('\n'),
      '', '管理アプリの「申請一覧 / 承認待ち」で判断してください。'].join('\n');
    recipients.forEach(function (to) {
      deliver(JSON.stringify(['PENDING_REQUEST_REMINDER', day(now), to]), to,
        '【申請リマインド】承認待ち ' + pending.length + ' 件', body, '', 'PENDING_REQUEST_REMINDER', day(now));
    });
    AutomationSettings.setStatus('LAST_PENDING_REQUEST_REMINDER_AT', Domain.now());
    return result;
  }

  function history(limit) {
    var rows = Database.read('NOTIFICATION_LOG').slice();
    rows.sort(function (a, b) { return String(b.Created_At).localeCompare(String(a.Created_At)); });
    return rows.slice(0, Math.max(1, Math.min(500, Number(limit) || 50)));
  }

  /** Administrative reconciliation: mark old PENDING rows uncertain. Never resends. */
  function reconcileUncertain(actorEmail, confirmation) {
    if (confirmation !== 'RECONCILE DELIVERY') throw new Error('Explicit reconciliation confirmation required');
    var actor = Roles.requireAtLeast('MANAGER', actorEmail);
    boundConfig();
    return Database.withLock(function () {
      var now = Date.now();
      var rows = Database.read('NOTIFICATION_LOG').filter(function (row) {
        var created = date(row.Created_At);
        return String(row.Result).toUpperCase() === 'PENDING' && created &&
          (now - created.getTime()) >= UNCERTAIN_MINUTES * 60000;
      });
      rows.forEach(function (row) {
        Database.update('NOTIFICATION_LOG', row.Notification_ID, {
          Result: 'DELIVERY_UNCERTAIN',
          Reconciled_At: new Date(),
          Reconciled_By: actor.email,
          Error_Details: String(row.Error_Details || '') + ' | marked uncertain; automatic resend is never attempted'
        });
        AuditLog.write('DELIVERY_RECONCILED', 'NOTIFICATION_LOG', row.Notification_ID, {result: 'DELIVERY_UNCERTAIN'});
      });
      return {marked: rows.length};
    });
  }

  function effectiveStatus() {
    var config = boundConfig();
    var state = AutomationSettings.emailState(config);
    return {
      mode: state.mode, reason: state.reason, configured: state.configured,
      emergencyStop: state.emergencyStop, toggles: state.toggles,
      offsets: state.offsets, catchupDays: state.catchupDays,
      activated: !!(config.notificationActivationAt && config.notificationAuthorizedBy),
      activationAt: config.notificationActivationAt, authorizedBy: config.notificationAuthorizedBy,
      allowedDomains: config.allowedDomains, maxEmailsPerRun: config.maxEmailsPerRun,
      legacyEmailEnabled: config.emailEnabled, legacyDryRun: config.dryRun
    };
  }

  return {
    activate: activate,
    approveAssignment: approveAssignment,
    reconcile: reconcile,
    scan: scan,
    preview: preview,
    sendWeeklyReport: sendWeeklyReport,
    notifyRequestSubmitted: notifyRequestSubmitted,
    notifyRequestDecision: notifyRequestDecision,
    sendPendingRequestReminder: sendPendingRequestReminder,
    history: history,
    reconcileUncertain: reconcileUncertain,
    effectiveStatus: effectiveStatus,
    snapshot: snapshot,
    stageDue: stageDue,
    week: week
  };
})();