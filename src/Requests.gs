/**
 * Worker request processing (V1.3).
 *
 * Employees submit deadline-change requests and completion reports from the shared
 * dashboard into a *separate* request inbox spreadsheet. This module is the only place
 * that reads that inbox and the only place that applies a decision to the authoritative
 * task rows of the private management workbook.
 *
 * Safety properties:
 * - The dashboard never receives the private workbook ID; the manager never trusts a
 *   role, approval flag or actor supplied by the inbox.
 * - Import is idempotent: the inbox request ID is the permanent request ID, so a retried
 *   import can never duplicate a request.
 * - A decision is applied at most once. The request is marked PROCESSING before the task
 *   is touched, and a resumed (retried) decision detects an already-applied effect instead
 *   of applying it twice.
 * - A request submitted against an older task revision is flagged STALE and never
 *   overwrites a newer deadline or assignee.
 * - Rejection and return never change a task. Only an approval may change the deadline or
 *   mark a task done.
 */
var Requests = (function () {
  var INBOX_PROPERTY = 'REQUEST_INBOX_SPREADSHEET_ID';
  var INBOX_SHEET = 'REQUESTS';
  var DECISION_CONFIRMATION = 'DECIDE REQUEST';
  var MAX_TEXT = 1000;
  var MAX_NAME = 120;

  // Contract written by the dashboard application (dashboard-app/RequestService.gs).
  var INBOX_FIELDS = ['Request_ID', 'Request_Type', 'Task_ID', 'Project_ID', 'Requester_Name',
    'Submitted_At', 'Current_Due_Date', 'Requested_Due_Date', 'Reason', 'Explanation',
    'Completion_Note', 'Task_Revision', 'Snapshot_Version', 'Client_Token', 'Inbox_State'];

  var ACTIONS = {APPROVE: 'APPROVED', REJECT: 'REJECTED', RETURN: 'RETURNED'};
  var OPEN_STATUSES = ['PENDING', 'PROCESSING', 'STALE'];

  function text(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function clip(value, maximum) {
    return text(value).slice(0, maximum === undefined ? MAX_TEXT : maximum);
  }

  function day(value) {
    var raw = text(value);
    if (!raw) return '';
    if (raw instanceof Date) return Utilities.formatDate(raw, 'Asia/Tokyo', 'yyyy-MM-dd');
    if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return '';
    var candidate = raw.slice(0, 10);
    return new Date(candidate + 'T00:00:00Z').toISOString().slice(0, 10) === candidate ? candidate : '';
  }

  function inboxId() {
    var value = PropertiesService.getScriptProperties().getProperty(INBOX_PROPERTY);
    return value ? String(value).trim() : '';
  }

  function inboxConfigured() { return !!inboxId(); }

  function openInbox() {
    var id = inboxId();
    if (!id) throw new Error('Request inbox is not configured');
    var book;
    try {
      book = SpreadsheetApp.openById(id);
    } catch (error) {
      throw new Error('Request inbox is not available');
    }
    var master = '';
    try { master = String(Database.book().getId()); } catch (error) { master = ''; }
    if (master && String(book.getId()) === master) throw new Error('Request inbox must be a separate spreadsheet');
    var sheet = book.getSheetByName(INBOX_SHEET);
    if (!sheet) throw new Error('Request inbox is not initialised');
    return sheet;
  }

  /** Reads the inbox with a strict header contract; an unexpected layout fails closed. */
  function readInbox() {
    var sheet = openInbox();
    var values = sheet.getDataRange().getValues();
    if (!values.length) return [];
    var header = values[0].map(function (value) { return text(value); });
    INBOX_FIELDS.forEach(function (field, index) {
      if (header[index] !== field) throw new Error('Request inbox header mismatch: ' + field);
    });
    return values.slice(1)
      .filter(function (row) { return row.some(function (value) { return text(value) !== ''; }); })
      .map(function (row) {
        var record = {};
        INBOX_FIELDS.forEach(function (field, index) { record[field] = row[index]; });
        return record;
      });
  }

  function validationError(message) { return {skipped: true, reason: message}; }

  /** Converts one inbox row into a validated TASK_REQUESTS row (or a rejection reason). */
  function normalize(row) {
    var id = clip(row.Request_ID, 80);
    var type = text(row.Request_Type).toUpperCase();
    var taskId = clip(row.Task_ID, 80);
    if (!id) return validationError('MISSING_REQUEST_ID');
    if (type !== 'DEADLINE_CHANGE' && type !== 'COMPLETION_REPORT') return validationError('INVALID_TYPE');
    if (!taskId) return validationError('MISSING_TASK');
    if (!Database.find('TASKS', taskId)) return validationError('UNKNOWN_TASK');
    var current = day(row.Current_Due_Date);
    var requested = day(row.Requested_Due_Date);
    if (type === 'DEADLINE_CHANGE') {
      if (!requested) return validationError('INVALID_DATE');
      if (current && requested === current) return validationError('UNCHANGED_DATE');
    }
    var submitted = text(row.Submitted_At);
    if (submitted && isNaN(new Date(submitted).getTime())) return validationError('INVALID_TIMESTAMP');
    return {
      skipped: false,
      row: {
        Request_ID: id,
        Request_Type: type,
        Task_ID: taskId,
        Project_ID: clip(row.Project_ID, 80),
        Requester_Name: clip(row.Requester_Name, MAX_NAME),
        Submitted_At: submitted,
        Original_Due_Date: current,
        Requested_Due_Date: requested,
        Reason: clip(row.Reason, 200),
        Explanation: clip(row.Explanation),
        Completion_Note: clip(row.Completion_Note),
        Status: 'PENDING',
        Task_Revision_At_Submission: clip(row.Task_Revision, 64),
        Due_Date_At_Submission: current,
        Reported_Completion_At: type === 'COMPLETION_REPORT' ? submitted : '',
        Inbox_Request_ID: id,
        Imported_At: new Date(),
        Snapshot_Version: clip(row.Snapshot_Version, 40)
      }
    };
  }

  /**
   * Imports new inbox rows. Safe to repeat: rows already linked to a request are skipped.
   * Returns counts only: no inbox text is returned to the browser.
   */
  function importInbox(actorEmail) {
    var identity = Roles.requireAtLeast('MANAGER', actorEmail);
    if (!inboxConfigured()) return {configured: false, imported: 0, skipped: 0, rejected: 0};
    var rows;
    try {
      rows = readInbox();
    } catch (error) {
      return {configured: true, imported: 0, skipped: 0, rejected: 0, error: error.message};
    }
    // Serialized so two managers opening the queue at the same moment cannot both claim
    // the same inbox row. The inbox request ID is the permanent request ID.
    var result = Database.withLock(function () {
      var existing = Object.create(null);
      Database.read('TASK_REQUESTS').forEach(function (request) { existing[text(request.Inbox_Request_ID)] = true; });
      var imported = 0, skipped = 0, rejected = 0, created = [];
      rows.forEach(function (row) {
        var id = clip(row.Request_ID, 80);
        if (!id || existing[id]) { skipped++; return; }
        var normalized = normalize(row);
        if (normalized.skipped) { rejected++; return; }
        try {
          Database.insert('TASK_REQUESTS', normalized.row);
        } catch (error) {
          // A repeated or concurrent import must never duplicate a request.
          if (!/Duplicate/.test(String(error && error.message))) throw error;
          skipped++;
          existing[id] = true;
          return;
        }
        existing[id] = true;
        created.push(normalized.row);
        imported++;
      });
      if (imported) {
        AuditLog.write('REQUEST_IMPORTED', 'TASK_REQUESTS', String(imported),
          {imported: imported, skipped: skipped, rejected: rejected, actor: identity.email});
        AutomationSettings.setStatus('LAST_REQUEST_IMPORT_AT', Domain.now());
      }
      return {imported: imported, skipped: skipped, rejected: rejected, created: created};
    });
    result.created.forEach(function (request) {
      try {
        Notifications.notifyRequestSubmitted(request);
      } catch (error) {
        // Mail problems never roll back an accepted import.
        console.warn('Request notification failed: ' + error.message);
      }
    });
    return {configured: true, imported: result.imported, skipped: result.skipped, rejected: result.rejected};
  }

  function memberNames() {
    var names = Object.create(null);
    Database.read('MEMBERS').forEach(function (member) {
      names[String(member.Member_ID)] = text(member.Name);
    });
    return names;
  }

  function differenceDays(from, to) {
    if (!from || !to) return null;
    return Math.round((new Date(to + 'T00:00:00Z').getTime() - new Date(from + 'T00:00:00Z').getTime()) / 86400000);
  }

  /**
   * Manager queue. Self-reported requester names and stored free text are returned exactly
   * as stored: the browser never translates them.
   */
  function queue(options) {
    options = options || {};
    var includeDecided = options.includeDecided === true;
    var tasks = Object.create(null);
    Database.read('TASKS').forEach(function (task) { tasks[task.Task_ID] = task; });
    var projects = Object.create(null);
    Database.read('PROJECTS').forEach(function (project) { projects[project.Project_ID] = project; });
    var names = memberNames();
    return Database.read('TASK_REQUESTS')
      .filter(function (request) { return includeDecided || OPEN_STATUSES.indexOf(text(request.Status)) >= 0; })
      .map(function (request) {
        var task = tasks[request.Task_ID] || null;
        var project = projects[request.Project_ID] || (task ? projects[task.Project_ID] : null);
        var current = task ? day(task.Due_Date) : day(request.Due_Date_At_Submission);
        var requested = day(request.Requested_Due_Date);
        return {
          requestId: text(request.Request_ID),
          type: text(request.Request_Type),
          status: text(request.Status),
          taskId: text(request.Task_ID),
          taskName: task ? text(task.Task_Name) : '',
          projectId: project ? text(project.Project_ID) : text(request.Project_ID),
          projectName: project ? text(project.Project_Name) : '',
          ownerName: task && task.Owner_Member_ID ? (names[String(task.Owner_Member_ID)] || '') : '',
          requesterName: text(request.Requester_Name),
          submittedAt: text(request.Submitted_At),
          currentDeadline: current,
          requestedDeadline: requested,
          differenceDays: differenceDays(current, requested),
          originalDeadline: day(request.Original_Due_Date),
          reason: text(request.Reason),
          explanation: text(request.Explanation),
          completionNote: text(request.Completion_Note),
          reviewer: text(request.Reviewer),
          decidedAt: text(request.Decided_At),
          decisionNote: text(request.Decision_Note),
          reportedCompletionAt: text(request.Reported_Completion_At),
          acceptedCompletionAt: text(request.Accepted_Completion_At),
          stale: text(request.Status) === 'STALE'
        };
      })
      .sort(function (a, b) {
        var openLeft = a.status === 'PENDING' || a.status === 'STALE' ? 0 : 1;
        var openRight = b.status === 'PENDING' || b.status === 'STALE' ? 0 : 1;
        if (openLeft !== openRight) return openLeft - openRight;
        return String(b.submittedAt).localeCompare(String(a.submittedAt));
      });
  }

  function history(taskId) {
    return Database.read('TASK_DEADLINE_HISTORY')
      .filter(function (row) { return !taskId || text(row.Task_ID) === text(taskId); })
      .map(function (row) {
        return {
          historyId: text(row.History_ID),
          taskId: text(row.Task_ID),
          requestId: text(row.Request_ID),
          previousDeadline: day(row.Previous_Due_Date),
          newDeadline: day(row.New_Due_Date),
          previousStart: day(row.Previous_Planned_Start),
          newStart: day(row.New_Planned_Start),
          reason: text(row.Reason),
          changedAt: text(row.Changed_At),
          changedBy: text(row.Changed_By),
          source: text(row.Source)
        };
      })
      .sort(function (a, b) { return String(b.changedAt).localeCompare(String(a.changedAt)); });
  }

    /** Tasks with at least one open request. Published as a boolean indicator only. */
  function pendingByTask() {
    var pending = Object.create(null);
    Database.read('TASK_REQUESTS').forEach(function (request) {
      if (OPEN_STATUSES.indexOf(text(request.Status)) < 0) return;
      pending[text(request.Task_ID)] = true;
    });
    return pending;
  }

    /**
     * Open completion reports keyed by task ID.
     *
     * Only the review state is exposed ('PENDING' / 'STALE'); the note, the requester and the
     * decision text stay in the private workbook.
     */
    function pendingCompletionStates() {
      var states = Object.create(null);
      Database.read('TASK_REQUESTS').forEach(function (request) {
        if (text(request.Request_Type) !== 'COMPLETION_REPORT') return;
        var status = text(request.Status).toUpperCase();
        if (OPEN_STATUSES.indexOf(status) < 0) return;
        states[text(request.Task_ID)] = status === 'STALE' ? 'STALE' : 'PENDING';
      });
      return states;
    }

  function summary() {
    var counts = {PENDING: 0, STALE: 0, APPROVED: 0, REJECTED: 0, RETURNED: 0, PROCESSING: 0, WITHDRAWN: 0};
    Database.read('TASK_REQUESTS').forEach(function (request) {
      var status = text(request.Status).toUpperCase();
      if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status]++;
    });
    return {counts: counts, inboxConfigured: inboxConfigured()};
  }

  function markStale(request, reason) {
    Database.update('TASK_REQUESTS', request.Request_ID, {
      Status: 'STALE',
      Decision_Note: clip(reason, 500)
    });
    updateInboxState(request.Request_ID, 'STALE');
    AuditLog.write('REQUEST_STALE', 'TASK_REQUEST', request.Request_ID, {reason: reason});
    return {requestId: request.Request_ID, status: 'STALE', reason: reason};
  }

  /**
   * Mirrors the decision into the request inbox so the worker receipt can show it.
   * A failure here never changes the authoritative decision.
   */
  function updateInboxState(requestId, status) {
    try {
      var sheet = openInbox();
      var values = sheet.getDataRange().getValues();
      var column = INBOX_FIELDS.indexOf('Inbox_State') + 1;
      for (var row = 1; row < values.length; row++) {
        if (text(values[row][0]) !== text(requestId)) continue;
        sheet.getRange(row + 1, column).setValue(String(status));
        return true;
      }
    } catch (error) {
      console.warn('Request inbox state update failed: ' + error.message);
    }
    return false;
  }

  /** Creates the request inbox layout in an explicitly identified, empty spreadsheet. */
  function initializeInbox(confirmation) {
    var identity = Roles.requireAtLeast('ADMIN', AuditLog.actor());
    if (confirmation !== 'INITIALIZE REQUEST INBOX') throw new Error('Explicit request inbox confirmation required');
    var id = inboxId();
    if (!id) throw new Error('REQUEST_INBOX_SPREADSHEET_ID is not configured');
    var book = SpreadsheetApp.openById(id);
    var master = Database.book();
    if (String(book.getId()) === String(master.getId())) throw new Error('Request inbox must be a separate spreadsheet');
    var sheet = book.getSheetByName(INBOX_SHEET);
    if (sheet && sheet.getLastRow()) {
      var occupied = sheet.getDataRange().getValues().some(function (row) {
        return row.some(function (value) { return text(value) !== ''; });
      });
      if (occupied) throw new Error('Request inbox already contains content');
    }
    if (!sheet) sheet = book.insertSheet(INBOX_SHEET);
    sheet.getRange(1, 1, 1, INBOX_FIELDS.length).setValues([INBOX_FIELDS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    AuditLog.write('REQUEST_INBOX_INITIALIZED', 'REQUEST_INBOX', '', {actor: identity.email});
    return {initialized: true, fields: INBOX_FIELDS.length};
  }

  function recordHistory(request, before, after, actor) {
    var historyId = 'HIST-' + request.Request_ID;
    // Idempotent: a resumed decision must never duplicate the history row.
    if (Database.find('TASK_DEADLINE_HISTORY', historyId)) return null;
    var previousDue = day(before.Due_Date);
    var previousStart = day(before.Planned_Start);
    // A resumed decision may find the task already updated; recover the original deadline
    // from the request instead of recording an unchanged value.
    if (previousDue === day(request.Requested_Due_Date) && day(request.Original_Due_Date)) {
      previousDue = day(request.Original_Due_Date);
      previousStart = '';
    }
    return Database.insert('TASK_DEADLINE_HISTORY', {
      History_ID: historyId,
      Task_ID: request.Task_ID,
      Request_ID: request.Request_ID,
      Previous_Due_Date: previousDue,
      New_Due_Date: day(after.Due_Date),
      Previous_Planned_Start: previousStart,
      New_Planned_Start: day(after.Planned_Start),
      Reason: clip(request.Reason, 200),
      Changed_At: new Date(),
      Changed_By: actor.email,
      Source: 'REQUEST_APPROVED'
    });
  }

  /** True when the effect of an approved request is already present in the task row. */
  function alreadyApplied(request, task) {
    if (text(request.Request_Type) === 'COMPLETION_REPORT') {
      return text(task.Status) === 'Done' && Number(task.Progress_Percent) === 100;
    }
    return day(task.Due_Date) === day(request.Requested_Due_Date);
  }

  function applyApproval(request, actor) {
    var task = Database.find('TASKS', request.Task_ID);
    if (!task) {
      markStale(request, 'Task no longer exists');
      return null;
    }
    if (alreadyApplied(request, task)) return task;
    if (text(request.Request_Type) === 'COMPLETION_REPORT') {
      // Manager approval is the only ordinary path to Done / 100 %.
      return Completion.withApproval(function () {
        return Tasks.update(task.Task_ID, {Status: 'Done', Progress_Percent: 100});
      });
    }
    return Tasks.update(task.Task_ID, {Due_Date: day(request.Requested_Due_Date)});
  }

  /**
   * Applies a manager decision.
   *
   * @param {string} requestId permanent request ID
   * @param {string} action APPROVE / REJECT / RETURN
   * @param {string} note decision note (optional)
   * @param {string} confirmation must equal DECIDE REQUEST
   */
  function decide(requestId, action, note, confirmation) {
    return Database.withLock(function () { return decideLocked(requestId, action, note, confirmation); });
  }

  function decideLocked(requestId, action, note, confirmation) {
    if (confirmation !== DECISION_CONFIRMATION) throw new Error('Explicit request decision confirmation required');
    var identity = Roles.requireAtLeast('MANAGER', AuditLog.actor());
    var target = text(action).toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, target)) throw new Error('Unknown request action: ' + action);
    var status = ACTIONS[target];

    var request = Database.find('TASK_REQUESTS', text(requestId));
    if (!request) throw new Error('Unknown request: ' + requestId);
    if (status === 'APPROVED') {
      if (['APPROVED', 'REJECTED', 'RETURNED', 'WITHDRAWN'].indexOf(text(request.Status)) >= 0) {
        throw new Error('Request already decided: ' + request.Status);
      }
    } else if (text(request.Status) !== 'PENDING' && text(request.Status) !== 'STALE') {
      throw new Error('Request already decided: ' + request.Status);
    }

    var task = Database.find('TASKS', request.Task_ID);
    if (!task) return markStale(request, 'Task no longer exists');

    if (status === 'APPROVED') {
      var currentRevision = SharedDashboardModel.revision(task);
      if (text(request.Task_Revision_At_Submission) &&
          currentRevision !== text(request.Task_Revision_At_Submission) && !alreadyApplied(request, task)) {
        return markStale(request, 'Task changed after submission');
      }
      if (text(request.Original_Due_Date) && day(task.Due_Date) !== day(request.Original_Due_Date) &&
          !alreadyApplied(request, task)) {
        return markStale(request, 'Deadline changed after submission');
      }
    }

    // Phase 1: claim the request so a partial failure can be recovered without re-applying.
    if (text(request.Status) !== 'PROCESSING') {
      Database.update('TASK_REQUESTS', request.Request_ID, {Status: 'PROCESSING'});
    }

    var before = null, after = null;
    if (status === 'APPROVED') {
      before = Database.find('TASKS', request.Task_ID);
      after = applyApproval(request, identity);
      if (!after) return {requestId: request.Request_ID, status: 'STALE'};
      if (text(request.Request_Type) === 'DEADLINE_CHANGE') recordHistory(request, before, after, identity);
    }

    // Phase 2: finalize. Repeating this step is harmless.
    Database.update('TASK_REQUESTS', request.Request_ID, {
      Status: status,
      Reviewer: identity.email,
      Decided_At: new Date(),
      Decision_Note: clip(note, 500),
      Accepted_Completion_At: status === 'APPROVED' && text(request.Request_Type) === 'COMPLETION_REPORT'
        ? new Date() : ''
    });
    AuditLog.write('REQUEST_DECIDED', 'TASK_REQUEST', request.Request_ID, {
      action: status, type: text(request.Request_Type), task: request.Task_ID,
      previous: before ? day(before.Due_Date) : '', next: after ? day(after.Due_Date) : '',
      reviewer: identity.email
    });
    updateInboxState(request.Request_ID, status);
    try {
      Notifications.notifyRequestDecision(request, status);
    } catch (error) {
      // Notification problems must never roll back an accepted decision.
      console.warn('Request decision notification failed: ' + error.message);
    }
    return {
      requestId: request.Request_ID,
      status: status,
      taskId: request.Task_ID,
      deadline: after ? day(after.Due_Date) : '',
      plannedStart: after ? day(after.Planned_Start) : ''
    };
  }

  return {
    INBOX_PROPERTY: INBOX_PROPERTY,
    INBOX_FIELDS: INBOX_FIELDS,
    DECISION_CONFIRMATION: DECISION_CONFIRMATION,
    inboxConfigured: inboxConfigured,
    importInbox: importInbox,
    initializeInbox: initializeInbox,
    updateInboxState: updateInboxState,
    queue: queue,
    history: history,
    pendingByTask: pendingByTask,
    pendingCompletionStates: pendingCompletionStates,
    summary: summary,
    decide: decide
  };
}());

/* Administrative entry points (Apps Script editor / triggers). */
function importRequestInbox() { return Requests.importInbox(AuditLog.actor()); }
function initializeRequestInbox(confirmation) { return Requests.initializeInbox(confirmation); }
function pendingRequests() {
  Access.requireManager();
  return Requests.queue();
}
function pendingRequestReminders() { return Notifications.sendPendingRequestReminder(); }
