/**
 * Explicit activation and approval are required before mail. A persisted pending
 * attempt is never automatically retried: delivery cannot be made exactly once.
 */
var Notifications = (function () {
  var DAY = 86400000;
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
    return parsed ? Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
  }
  function owner(task) { return String(task.Owner_Member_ID || '').trim(); }
  function baseline(task) {
    try { return JSON.parse(task.Notification_Baseline || 'null'); } catch (error) { return null; }
  }
  function matches(task) {
    var previous = baseline(task);
    return previous && previous.owner === owner(task) && previous.due === day(task.Due_Date);
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
    if (!patches.length) return;
    var sheet = Database.book().getSheetByName('TASKS');
    var values = sheet.getDataRange().getValues();
    var headers = values[0];
    var idColumn = headers.indexOf('Task_ID');
    var fields = ['Notification_Baseline', 'Assignment_Approved_At', 'Assignment_Version'];
    if (idColumn < 0 || fields.some(function (field) { return headers.indexOf(field) < 0; })) {
      throw new Error('Task notification system columns are missing');
    }
    var byId = Object.create(null);
    patches.forEach(function (patch) { byId[patch.id] = patch.values; });
    // Only system-owned columns are batched; user data and formulas stay intact.
    fields.forEach(function (field) {
      var column = headers.indexOf(field);
      var cells = values.slice(1).map(function (row) {
        var patch = byId[row[idColumn]];
        return [patch ? patch[field] : row[column]];
      });
      if (cells.length) sheet.getRange(2, column + 1, cells.length, 1).setValues(cells);
    });
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
      patches.push({id: task.Task_ID, values: patch});
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
        return {id: task.Task_ID, values: {
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
      var now = new Date(Math.max(Date.now(), activated.getTime() + 1));
      Database.update('TASKS', taskId, {Assignment_Approved_At: now});
      AuditLog.write('ASSIGNMENT_APPROVED', 'TASK', taskId, {version: task.Assignment_Version});
      return {taskId: taskId, approvedAt: now.toISOString(), version: task.Assignment_Version};
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
  function openProject(project) {
    return project && ['Active', 'Planned'].indexOf(project.Status) !== -1;
  }
  function eligible(task, projects, subprojects, activated) {
    var approved = date(task.Assignment_Approved_At);
    return task.Notification_Enabled === true && openProject(projects[task.Project_ID]) &&
      (!task.Subproject_ID || (subprojects[task.Subproject_ID] &&
        subprojects[task.Subproject_ID].Project_ID === task.Project_ID && openProject(subprojects[task.Subproject_ID]))) &&
      ['Not Started', 'Assigned', 'In Progress', 'Blocked'].indexOf(task.Status) !== -1 &&
      Number.isInteger(Number(task.Assignment_Version)) && Number(task.Assignment_Version) > 0 &&
      date(task.Due_Date) && approved && approved.getTime() > activated.getTime() &&
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
  function scan(nowValue) {
    var config = boundConfig();
    var now = date(nowValue) || new Date();
    return Database.withLock(function () {
      var tasks = Database.read('TASKS');
      var reconciled = reconcileRows(tasks);
      var result = {sent: 0, pending: 0, dryRun: 0, skipped: 0, reconciled: reconciled};
      var activated = date(config.notificationActivationAt);
      if (!activated || !config.notificationAuthorizedBy) return result;
      var projects = index(Database.read('PROJECTS'), 'Project_ID');
      var subprojects = index(Database.read('SUBPROJECTS'), 'Subproject_ID');
      var taskMap = index(tasks, 'Task_ID');
      var members = Object.create(null);
      var memberIds = Object.create(null);
      Database.read('MEMBERS').forEach(function (member) {
        members[email(member.Email)] = member;
        memberIds[String(member.Member_ID)] = member;
      });
      var logs = Database.read('NOTIFICATION_LOG');
      var seen = Object.create(null);
      logs.forEach(function (log) {
        if (String(log.Result).toUpperCase() !== 'DRY_RUN') seen[String(log.Notification_Key)] = true;
      });
      var maximum = Number(config.maxEmailsPerRun);
      if (!isFinite(maximum) || maximum < 0) maximum = 10;
      maximum = Math.floor(maximum);
      var attempts = 0;
      var overdue = [];
      function deliver(key, to, subject, body, taskId, type, stage) {
        if (seen[key] || attempts >= maximum) { result.skipped++; return; }
        if (!yes(config.emailEnabled) || yes(config.dryRun)) { result.dryRun++; return; }
        var id = Utilities.getUuid();
        Database.insert('NOTIFICATION_LOG', {
          Notification_ID: id, Created_At: now, Task_ID: taskId || '',
          Recipient: to, Notification_Type: type, Notification_Key: key,
          Assignment_Version: taskId ? Number(taskMap[taskId].Assignment_Version) : '',
          Result: 'PENDING', Error_Details: ''
        });
        seen[key] = true;
        attempts++;
        result.pending++;
        try {
          MailApp.sendEmail({to: to, subject: subject, body: body,
            htmlBody: '<div lang="ja"><p>' + html(body).replace(/\n/g, '<br>') + '</p></div>'});
        } catch (error) {
          // PENDING intentionally survives failures, including ambiguous delivery.
          Database.update('NOTIFICATION_LOG', id, {Error_Details: String(error.message || error).slice(0, 500)});
          return;
        }
        Database.update('NOTIFICATION_LOG', id, {Result: 'SENT', Sent_At: new Date()});
        result.pending--;
        result.sent++;
      }
      tasks.forEach(function (task) {
        if (!eligible(task, projects, subprojects, activated)) { result.skipped++; return; }
        var member = memberIds[owner(task)];
        var to = recipient(member && member.Email, config, members);
        if (!to) { result.skipped++; return; }
        var due = day(task.Due_Date);
        var days = Math.round((new Date(due + 'T00:00:00Z').getTime() - new Date(day(now) + 'T00:00:00Z').getTime()) / DAY);
        if (days < 0) overdue.push(task);
        var base = [task.Task_ID, owner(task), to, task.Assignment_Version, due];
        var type = baseline(task).type || 'NEW_ASSIGNMENT';
        var label = {NEW_ASSIGNMENT: '新規割当', REASSIGNMENT: '担当者変更', DEADLINE_CHANGE: '期限変更'}[type] || '割当確認';
        deliver(JSON.stringify(base.concat([type, 'approved'])), to,
          '【' + label + '】' + (task.Task_Name || task.Task_ID),
          taskBody(task, projects[task.Project_ID], member, config, label), task.Task_ID, type, 'approved');
        if (days === 7 || days === 2) {
          deliver(JSON.stringify(base.concat(['DEADLINE', String(days)])), to,
            '【期限' + days + '日前】' + (task.Task_Name || task.Task_ID),
            taskBody(task, projects[task.Project_ID], member, config, '期限まで残り' + days + '日です。'),
            task.Task_ID, 'DEADLINE', String(days));
        }
        if (days < 0) {
          deliver(JSON.stringify(base.concat(['OVERDUE', week(now)])), to,
            '【期限超過・週次確認】' + (task.Task_Name || task.Task_ID),
            taskBody(task, projects[task.Project_ID], member, config, '期限を超過しています。進捗と次の対応を確認してください。'),
            task.Task_ID, 'OVERDUE', week(now));
        }
      });
      if (overdue.length) {
        var taskKeys = overdue.map(function (task) {
          return [task.Task_ID, owner(task), task.Assignment_Version, day(task.Due_Date)].join(':');
        }).sort();
        var uniqueRecipients = Object.create(null);
        (config.managementRecipients || []).forEach(function (address) {
          var to = recipient(address, config, members);
          if (!to || uniqueRecipients[to]) return;
          uniqueRecipients[to] = true;
          var weeklyPrefix = JSON.stringify(['OVERDUE_SUMMARY', week(now), to]).slice(0, -1) + ',';
          if (Object.keys(seen).some(function (key) { return key.indexOf(weeklyPrefix) === 0; })) return;
          var key = JSON.stringify(['OVERDUE_SUMMARY', week(now), to, taskKeys]);
          var summary = overdue.map(function (task) {
            return [task.Task_Name || task.Task_ID, 'ID: ' + task.Task_ID, '担当: ' + owner(task), '期限: ' + day(task.Due_Date)].join(' / ');
          }).join('\n');
          deliver(key, to, '【週次管理サマリー】期限超過タスク',
            '承認済みの期限超過タスク:\n' + summary, '', 'OVERDUE_SUMMARY', week(now));
        });
      }
      return result;
    });
  }
  return {activate: activate, approveAssignment: approveAssignment, reconcile: reconcile, scan: scan, snapshot: snapshot};
})();
