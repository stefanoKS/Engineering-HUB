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
 * - A decision is applied at most once, and only *this* request may claim an effect.
 *   V1.6.2 replaced the state-based `alreadyApplied` guess with a request-specific journal
 *   in `AUDIT_LOG`: a matching Done row or deadline is never evidence that this request was
 *   the one that produced it.
 * - A request submitted against an older task revision is flagged STALE and never
 *   overwrites a newer deadline or assignee, even when the target value already matches.
 * - Rejection and return never change a task. Only an approval may change the deadline or
 *   mark a task done.
 * - An interrupted or unattributable attempt stays PROCESSING (an open, reviewable state)
 *   until a manager reconciles it; nothing is auto-approved and no effect is repeated.
 */
var Requests = (function () {
  var INBOX_PROPERTY = 'REQUEST_INBOX_SPREADSHEET_ID';
  var INBOX_SHEET = 'REQUESTS';
  var DECISION_CONFIRMATION = 'DECIDE REQUEST';
  var RECONCILE_CONFIRMATION = 'RECONCILE REQUESTS';
  var INBOX_RECONCILE_CONFIRMATION = 'RECONCILE REQUEST INBOX';
  var MAX_TEXT = 1000;
  var MAX_NAME = 120;
  /**
   * Append-only request journal. Reusing `AUDIT_LOG` keeps schema 7 unchanged: `Request_ID`
   * is the idempotency key and the payload is JSON in `New_Value`. A new schema column or
   * table would require an approved migration, which this corrective release must not add.
   */
  var PREPARED_ACTION = 'REQUEST_DECISION_PREPARED';
  var APPLIED_ACTION = 'REQUEST_EFFECT_APPLIED';
  var DECIDED_ACTION = 'REQUEST_DECIDED';
  var FAILED_ACTION = 'REQUEST_APPROVAL_FAILED';
  var REVIEW_ACTION = 'REQUEST_RECONCILE_REQUIRED';
  var STALE_ACTION = 'REQUEST_STALE';
  var TERMINAL_STATUSES = ['APPROVED', 'REJECTED', 'RETURNED', 'WITHDRAWN'];
  // Only a final manager outcome is mirrored to the employee receipt. PENDING and PROCESSING
  // are internal review states and must never appear in the inbox.
  var MIRRORED_STATUSES = ['APPROVED', 'REJECTED', 'RETURNED', 'STALE'];
  var RESOLUTIONS = ['CONFIRM_APPLIED', 'MARK_STALE'];
  // Bounded scan: reconciliation reads the inbox once and refuses to guess when the sheet is
  // larger than the bound instead of reporting a false MISSING_INBOX_ROW.
  var INBOX_SCAN_LIMIT = 5000;

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

  /**
   * Normalises a DATE-ONLY value without ever shifting the calendar day.
   *
   * V1.6.2: the previous version converted the input to text *before* testing
   * `instanceof Date`, so a real Date object returned by Google Sheets for a date cell fell
   * through the regex and became an empty string — the deadline silently disappeared.
   * A Date is now resolved in Asia/Tokyo, and a text value keeps its own `yyyy-MM-dd` day:
   * re-deriving it from an ISO timestamp could move it across midnight.
   */
  function day(value) {
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? '' : Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
    }
    if (value === null || value === undefined) return '';
    var raw = String(value).trim();
    if (!raw || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return '';
    var candidate = raw.slice(0, 10);
    var parsed = new Date(candidate + 'T00:00:00Z');
    if (isNaN(parsed.getTime())) return '';
    // An impossible calendar date (2027-02-29) normalises to another day and is refused.
    return parsed.toISOString().slice(0, 10) === candidate ? candidate : '';
  }

  function message(error) { return String(error && error.message ? error.message : error); }

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
  function normalize(row, containerIds) {
    var id = clip(row.Request_ID, 80);
    var type = text(row.Request_Type).toUpperCase();
    var taskId = clip(row.Task_ID, 80);
    if (!id) return validationError('MISSING_REQUEST_ID');
    if (type !== 'DEADLINE_CHANGE' && type !== 'COMPLETION_REPORT') return validationError('INVALID_TYPE');
    if (!taskId) return validationError('MISSING_TASK');
    var task = Database.find('TASKS', taskId);
    if (!task) return validationError('UNKNOWN_TASK');
    // V1.6.1: a container task is completed by its children, so a completion report for it
    // can never be approved. It is refused on import instead of being accepted and then
    // failing at decision time.
    if (type === 'COMPLETION_REPORT') {
      var containers = containerIds || TaskTree.containerIds(Database.read('TASKS'));
      if (TaskTree.isContainer(taskId, containers)) return validationError('CONTAINER_TASK');
    }
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
      var containers = TaskTree.containerIds(Database.read('TASKS'));
      Database.read('TASK_REQUESTS').forEach(function (request) { existing[text(request.Inbox_Request_ID)] = true; });
      var imported = 0, skipped = 0, rejected = 0, containerRejected = 0, created = [];
      rows.forEach(function (row) {
        var id = clip(row.Request_ID, 80);
        if (!id || existing[id]) { skipped++; return; }
        var normalized = normalize(row, containers);
        if (normalized.skipped) {
          rejected++;
          if (normalized.reason === 'CONTAINER_TASK') containerRejected++;
          return;
        }
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
          {imported: imported, skipped: skipped, rejected: rejected, containerRejected: containerRejected, actor: identity.email});
        AutomationSettings.setStatus('LAST_REQUEST_IMPORT_AT', Domain.now());
      }
      // A refused container report stays in the inbox; recording it keeps the refusal visible
      // without pretending the row was imported or silently accepting it.
      if (containerRejected) {
        AuditLog.write('REQUEST_CONTAINER_REFUSED', 'TASK_REQUESTS', String(containerRejected),
          {count: containerRejected, actor: identity.email});
      }
      return {imported: imported, skipped: skipped, rejected: rejected, containerRejected: containerRejected, created: created};
    });
    result.created.forEach(function (request) {
      try {
        Notifications.notifyRequestSubmitted(request);
      } catch (error) {
        // Mail problems never roll back an accepted import.
        console.warn('Request notification failed: ' + error.message);
      }
    });
    return {configured: true, imported: result.imported, skipped: result.skipped,
      rejected: result.rejected, containerRejected: result.containerRejected};
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
    AuditLog.write(STALE_ACTION, 'TASK_REQUEST', request.Request_ID, {reason: reason});
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
      return false;
    } catch (error) {
      console.warn('Request inbox state update failed: ' + error.message);
      // An unconfigured inbox is a normal state; a configured inbox that cannot be updated is
      // not, so the failed mirror is recorded and stays visible to the manager.
      if (inboxConfigured()) {
        try {
          AuditLog.write('INBOX_MIRROR_FAILED', 'TASK_REQUEST', text(requestId),
            {status: String(status), reason: String(error && error.message || error)});
        } catch (ignored) { /* the decision itself stays authoritative */ }
      }
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

  function journalDetail(row) {
    try {
      var parsed = JSON.parse(text(row.New_Value) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) { return {}; }
  }

  /**
   * Request-specific operation evidence, keyed by the permanent `Request_ID`.
   *
   * Task state is deliberately not consulted here: the same Done row or the same deadline can
   * be reached by another report, an ADMIN correction, a separate approval or a manual edit.
   * Only the journal rows that carry this exact request ID may attest that *this* request was
   * applied. The first preparation wins, because a later one would already record the
   * post-mutation revision.
   */
  function evidence(requestId) {
    var id = text(requestId);
    var result = {prepared: null, applied: null, decided: null, failed: null, review: null};
    if (!id) return result;
    Database.read('AUDIT_LOG').forEach(function (row) {
      if (text(row.Entity_Type) !== 'TASK_REQUEST' || text(row.Entity_ID) !== id) return;
      var action = text(row.Action);
      var entry = {action: action, at: String(row.Timestamp || ''), actor: text(row.Actor), detail: journalDetail(row)};
      if (action === PREPARED_ACTION) { if (!result.prepared) result.prepared = entry; }
      else if (action === APPLIED_ACTION) { if (!result.applied) result.applied = entry; }
      else if (action === DECIDED_ACTION) { if (!result.decided) result.decided = entry; }
      else if (action === FAILED_ACTION) result.failed = entry;
      else if (action === REVIEW_ACTION) { if (!result.review) result.review = entry; }
    });
    return result;
  }

  /** The end state the request asks for. Only used to verify, never to claim, an application. */
  function taskShowsEffect(request, task) {
    if (!task) return false;
    if (text(request.Request_Type) === 'COMPLETION_REPORT') {
      return text(task.Status) === 'Done' && Number(task.Progress_Percent) === 100;
    }
    var requested = day(request.Requested_Due_Date);
    return !!requested && day(task.Due_Date) === requested;
  }

  /**
   * True when the task provably still holds the state the preparation recorded.
   *
   * A recorded failure plus an unchanged revision means the mutation never landed, so a
   * guarded retry is safe. Anything else is ambiguous and must be reviewed by a manager.
   */
  function unchangedSincePreparation(request, task, prepared) {
    if (!prepared || !task) return false;
    var revision = text(prepared.detail.revision);
    if (revision && revision !== SharedDashboardModel.revision(task)) return false;
    return !taskShowsEffect(request, task);
  }

  /** Records the deadline history once per request, from the pre-state when it is known. */
  function ensureHistory(request, before, after, identity) {
    if (text(request.Request_Type) !== 'DEADLINE_CHANGE') return null;
    var settled = after || Database.find('TASKS', request.Task_ID);
    if (!settled) return null;
    return recordHistory(request, before || settled, settled, identity);
  }

  function applyApproval(request, actor) {
    var task = Database.find('TASKS', request.Task_ID);
    if (!task) {
      markStale(request, 'Task no longer exists');
      return null;
    }
    if (text(request.Request_Type) === 'COMPLETION_REPORT') {
      // Manager approval is the only ordinary path to Done / 100 %.
      return Completion.withApproval(function () {
        return Tasks.update(task.Task_ID, {Status: 'Done', Progress_Percent: 100});
      });
    }
    return Tasks.update(task.Task_ID, {Due_Date: day(request.Requested_Due_Date)});
  }

  /**
   * Leaves an ambiguous approval in an explicit, reviewable state.
   *
   * The task may or may not hold the effect and no durable record ties it to this request, so
   * nothing is approved automatically. The request keeps its PROCESSING claim — an open
   * status, so it stays in the manager queue — and one journal row asks for a manual review.
   */
  function reviewRequired(request, journal, reason) {
    var detail = clip(reason, 300);
    try {
      Database.update('TASK_REQUESTS', request.Request_ID, {
        Decision_Note: clip('手動確認が必要です: ' + detail, 500)
      });
    } catch (ignored) { /* the journal row below is the durable evidence */ }
    if (!journal || !journal.review) {
      try {
        AuditLog.write(REVIEW_ACTION, 'TASK_REQUEST', request.Request_ID, {
          reason: detail, type: text(request.Request_Type), task: request.Task_ID,
          preparedAt: journal && journal.prepared ? journal.prepared.at : ''
        });
      } catch (ignored) { /* the thrown error still stops the operation */ }
    }
    throw new Error('申請の反映状態を確認できません（二重反映を避けるため自動承認しません）。' +
      '管理者は previewRequestDecisionReconciliation で内容を確認し、' +
      'reconcileRequestDecision で確定してください: ' + detail);
  }

  /**
   * Finalization: publish the decision and its audit record.
   *
   * Repeating it never repeats the effect. The `REQUEST_DECIDED` row is written once per
   * accepted decision, and a request that already reached its terminal status is only
   * *repaired* — its reviewer, timestamp and acceptance value are kept as recorded.
   */
  function finalizeLocked(request, status, journal, note, identity, before, after) {
    var decided = journal.decided;
    var repair = !!decided;
    var resumed = TERMINAL_STATUSES.indexOf(text(request.Status)) >= 0 || text(request.Status) === 'PROCESSING';
    var reviewer = repair ? (text(request.Reviewer) || (decided && decided.actor) || identity.email) : identity.email;
    var decidedAt = repair ? (request.Decided_At || (decided && decided.at) || new Date()) : new Date();
    var decisionNote = repair ? text(request.Decision_Note) : clip(note, 500);
    var accepted = '';
    if (status === 'APPROVED' && text(request.Request_Type) === 'COMPLETION_REPORT') {
      accepted = repair
        ? (request.Accepted_Completion_At || (decided && decided.at) || decidedAt)
        : decidedAt;
    }
    Database.update('TASK_REQUESTS', request.Request_ID, {
      Status: status, Reviewer: reviewer, Decided_At: decidedAt,
      Decision_Note: decisionNote, Accepted_Completion_At: accepted
    });
    if (!decided) {
      try {
        AuditLog.write(DECIDED_ACTION, 'TASK_REQUEST', request.Request_ID, {
          action: status, type: text(request.Request_Type), task: request.Task_ID,
          previous: before ? day(before.Due_Date) : '', next: after ? day(after.Due_Date) : '',
          reviewer: identity.email,
          preparedAt: journal.prepared ? journal.prepared.at : '',
          appliedEvidence: journal.applied ? journal.applied.at : '',
          recovered: resumed
        });
      } catch (error) {
        // The decision is already stored. Repeating the same decision repairs exactly this
        // missing record, so the manager is told how to finish it instead of seeing a success
        // that was never audited.
        throw new Error('申請の判断は記録しましたが、監査記録の確定に失敗しました。' +
          '同じ承認操作をもう一度実行すると監査記録だけが確定します: ' + message(error));
      }
    }
    updateInboxState(request.Request_ID, status);
    try {
      Notifications.notifyRequestDecision(request, status);
    } catch (error) {
      // Notification problems must never roll back an accepted decision.
      console.warn('Request decision notification failed: ' + message(error));
    }
    return {
      requestId: request.Request_ID,
      status: status,
      taskId: request.Task_ID,
      deadline: after ? day(after.Due_Date) : '',
      plannedStart: after ? day(after.Planned_Start) : ''
    };
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
    var journal = evidence(request.Request_ID);

    // CASE C — a terminal request never applies its effect again. A retry either reports the
    // stored result or completes the audit record a failed finalization left missing.
    if (TERMINAL_STATUSES.indexOf(text(request.Status)) >= 0) {
      if (text(request.Status) !== status || journal.decided) throw new Error('Request already decided: ' + request.Status);
      var settledTask = Database.find('TASKS', request.Task_ID);
      if (status === 'APPROVED') ensureHistory(request, settledTask, settledTask, identity);
      return finalizeLocked(request, status, journal, note, identity, settledTask, settledTask);
    }
    if (status !== 'APPROVED' && text(request.Status) !== 'PENDING' && text(request.Status) !== 'STALE') {
      throw new Error('Request already decided: ' + request.Status);
    }

    var task = Database.find('TASKS', request.Task_ID);
    if (!task) return markStale(request, 'Task no longer exists');
    // V1.6.1: a container task derives completion from its children, so a completion approval
    // can never apply to it. The refusal happens *before* the request is claimed, so the row
    // keeps its decidable state instead of being left in PROCESSING.
    if (text(request.Request_Type) === 'COMPLETION_REPORT' &&
        TaskTree.isContainer(task.Task_ID, TaskTree.containerIds(Database.read('TASKS')))) {
      throw new Error('親タスクは子タスクの完了状況から完了します。子タスクの完了申請を承認してください');
    }

    if (status === 'APPROVED') {
      // CASE B — an interrupted attempt. Only request-specific evidence may resume it, and a
      // resume never repeats the mutation.
      if (text(request.Status) === 'PROCESSING') {
        if (journal.decided || journal.applied) {
          ensureHistory(request, task, task, identity);
          return finalizeLocked(request, status, journal, note, identity, task, task);
        }
        if (!(journal.failed && unchangedSincePreparation(request, task, journal.prepared))) {
          return reviewRequired(request, journal, 'durable evidence for this request is missing');
        }
        // The recorded failure provably left the task untouched, so a guarded retry is safe.
      } else {
        // CASE A — a pending request. Matching values are not proof of prior application, and
        // the revision check is never bypassed because the target state already matches.
        if (text(request.Task_Revision_At_Submission) &&
            SharedDashboardModel.revision(task) !== text(request.Task_Revision_At_Submission)) {
          return markStale(request, 'Task changed after submission');
        }
        if (text(request.Original_Due_Date) && day(task.Due_Date) !== day(request.Original_Due_Date)) {
          return markStale(request, 'Deadline changed after submission');
        }
        if (taskShowsEffect(request, task)) {
          // Another operation produced this end state; this request must not claim it.
          return markStale(request, text(request.Request_Type) === 'COMPLETION_REPORT'
            ? 'Task was completed by another operation'
            : 'Deadline was changed by another operation');
        }
      }
    }

    // Phase 1: write the durable intent, then claim the request. If the intent cannot be
    // written the request is left untouched, so a failure never starts an unattributable
    // mutation. A claimed request that already carries a recorded failure keeps its original
    // preparation, which holds the true pre-mutation revision.
    var before = Database.find('TASKS', request.Task_ID);
    if (text(request.Status) !== 'PROCESSING') {
      try {
        AuditLog.write(PREPARED_ACTION, 'TASK_REQUEST', request.Request_ID, {
          type: text(request.Request_Type), task: request.Task_ID, action: status,
          revision: SharedDashboardModel.revision(before),
          previousDue: day(before.Due_Date), requestedDue: day(request.Requested_Due_Date),
          reviewer: identity.email
        });
      } catch (error) {
        throw new Error('申請の処理を記録できないため中止しました（タスクは変更されていません）: ' + message(error));
      }
      Database.update('TASK_REQUESTS', request.Request_ID, {Status: 'PROCESSING'});
    }

    var after = null;
    if (status === 'APPROVED') {
      try {
        after = applyApproval(request, identity);
      } catch (error) {
        // The claim stays PROCESSING on purpose: the effect may or may not have been written,
        // so an automatic retry would be unsafe. The failure is recorded durably and the
        // manager is told to retry, which resumes through the request-specific journal.
        var reason = clip(message(error), 400);
        try {
          Database.update('TASK_REQUESTS', request.Request_ID, {Decision_Note: clip('再試行が必要です: ' + reason, 500)});
        } catch (ignored) { /* the audit row below is the durable evidence */ }
        try {
          AuditLog.write(FAILED_ACTION, 'TASK_REQUEST', request.Request_ID,
            {reason: reason, type: text(request.Request_Type), task: request.Task_ID, reviewer: identity.email});
        } catch (ignored) { /* never mask the original failure */ }
        throw new Error('申請の反映に失敗しました。申請は PROCESSING のまま保持されています。再試行してください: ' + reason);
      }
      if (!after) return {requestId: request.Request_ID, status: 'STALE'};
      // Proof that the mutation belongs to this request, written before the status change so
      // a later retry can finish the record instead of repeating the effect.
      try {
        AuditLog.write(APPLIED_ACTION, 'TASK_REQUEST', request.Request_ID, {
          type: text(request.Request_Type), task: request.Task_ID,
          revision: SharedDashboardModel.revision(after), due: day(after.Due_Date),
          status: text(after.Status), reviewer: identity.email
        });
      } catch (error) {
        return reviewRequired(request, journal, 'the applied effect could not be recorded: ' + message(error));
      }
      ensureHistory(request, before, after, identity);
    }

    // Phase 2: finalize. Repeating this step is harmless.
    return finalizeLocked(request, status, evidence(request.Request_ID), note, identity, before, after);
  }

  /* ---------------------------------------------------------------- *
   * Manual recovery of an ambiguous approval (V1.6.2)
   * ---------------------------------------------------------------- */

  /**
   * Read-only preview of every request that is claimed but not attributable.
   *
   * `REVIEW_REQUIRED` items are the ones a manager must settle. `READY_TO_FINALIZE` items
   * already carry request-specific evidence, so an ordinary retry completes them and they are
   * only listed for context.
   */
  function previewDecisionReconciliation() {
    var items = [];
    Database.read('TASK_REQUESTS').forEach(function (request) {
      if (text(request.Status) !== 'PROCESSING') return;
      var journal = evidence(request.Request_ID);
      var task = Database.find('TASKS', request.Task_ID);
      items.push({
        requestId: text(request.Request_ID),
        type: text(request.Request_Type),
        taskId: text(request.Task_ID),
        projectId: text(request.Project_ID),
        state: journal.decided || journal.applied ? 'READY_TO_FINALIZE' : 'REVIEW_REQUIRED',
        preparedAt: journal.prepared ? journal.prepared.at : '',
        preparedBy: journal.prepared ? journal.prepared.actor : '',
        preparedRevision: journal.prepared ? text(journal.prepared.detail.revision) : '',
        currentRevision: task ? SharedDashboardModel.revision(task) : '',
        failureRecordedAt: journal.failed ? journal.failed.at : '',
        reviewRequestedAt: journal.review ? journal.review.at : '',
        effectPresent: taskShowsEffect(request, task),
        safeToConfirm: !!(task && taskShowsEffect(request, task)),
        taskStatus: task ? text(task.Status) : '',
        taskDue: task ? day(task.Due_Date) : '',
        requestedDue: day(request.Requested_Due_Date)
      });
    });
    return {items: items, count: items.length};
  }

  /**
   * Settles one ambiguous approval. The task is never written here, so a manual reconciliation
   * can only *record* an existing effect, never repeat one.
   *
   * CONFIRM_APPLIED requires the task to currently hold the requested end state; the reviewing
   * manager's confirmation becomes the request-specific evidence. MARK_STALE records that the
   * effect was not applied, which closes the request without approving it.
   */
  function resolveDecisionLocked(requestId, resolution, note, confirmation) {
    if (confirmation !== RECONCILE_CONFIRMATION) {
      throw new Error('手動確認には「' + RECONCILE_CONFIRMATION + '」の入力が必要です');
    }
    var identity = Roles.requireAtLeast('MANAGER', AuditLog.actor());
    var target = text(resolution).toUpperCase();
    if (RESOLUTIONS.indexOf(target) < 0) throw new Error('Unknown reconciliation resolution: ' + resolution);
    var request = Database.find('TASK_REQUESTS', text(requestId));
    if (!request) throw new Error('Unknown request: ' + requestId);
    var journal = evidence(request.Request_ID);
    // A finalization that already has its audit row must never gain a second one.
    if (journal.decided) throw new Error('Request already decided: ' + request.Status);
    if (text(request.Status) !== 'PROCESSING') {
      throw new Error('この申請は手動確認の対象ではありません（PROCESSING ではありません）: ' + request.Status);
    }
    if (target === 'MARK_STALE') {
      // An applied effect must be finalized, never discarded as stale.
      if (journal.applied) {
        throw new Error('この申請には反映済みの記録があります。通常の承認操作で確定してください');
      }
      return markStale(request, '手動確認により未反映と判断しました' + (text(note) ? ': ' + clip(note, 200) : ''));
    }
    var task = Database.find('TASKS', request.Task_ID);
    if (!task) throw new Error('Task no longer exists: ' + request.Task_ID);
    if (!taskShowsEffect(request, task)) {
      throw new Error('タスクは申請どおりの状態ではありません。確定する前に内容を確認してください');
    }
    AuditLog.write(APPLIED_ACTION, 'TASK_REQUEST', request.Request_ID, {
      type: text(request.Request_Type), task: request.Task_ID,
      revision: SharedDashboardModel.revision(task), due: day(task.Due_Date),
      status: text(task.Status), reviewer: identity.email, reconciled: true, note: clip(note, 300)
    });
    ensureHistory(request, task, task, identity);
    return finalizeLocked(request, 'APPROVED', evidence(request.Request_ID), note, identity, task, task);
  }

  function resolveDecision(requestId, resolution, note, confirmation) {
    return Database.withLock(function () {
      return resolveDecisionLocked(requestId, resolution, note, confirmation);
    });
  }

  /* ---------------------------------------------------------------- *
   * Employee receipt reconciliation (V1.6.2)
   * ---------------------------------------------------------------- */

  /** Reads the inbox once, bounded and header-checked. Returns row positions and identity. */
  function inboxIndex(sheet) {
    var values = sheet.getDataRange().getValues();
    if (!values.length) return {rows: Object.create(null), truncated: false};
    var header = values[0].map(function (value) { return text(value); });
    INBOX_FIELDS.forEach(function (field, index) {
      if (header[index] !== field) throw new Error('Request inbox header mismatch: ' + field);
    });
    var idColumn = header.indexOf('Request_ID');
    var taskColumn = header.indexOf('Task_ID');
    var projectColumn = header.indexOf('Project_ID');
    var stateColumn = header.indexOf('Inbox_State');
    var rows = Object.create(null), truncated = false;
    for (var row = 1; row < values.length; row++) {
      if (row > INBOX_SCAN_LIMIT) { truncated = true; break; }
      var id = text(values[row][idColumn]);
      if (!id || rows[id]) continue;
      rows[id] = {
        sheetRow: row + 1,
        state: text(values[row][stateColumn]),
        taskId: text(values[row][taskColumn]),
        projectId: text(values[row][projectColumn])
      };
    }
    return {rows: rows, truncated: truncated};
  }

  /** Compares one already-read inbox index with the authoritative decisions. */
  function compareInbox(index) {
    var counts = {synced: 0, needsSync: 0, missing: 0, mismatch: 0};
    var items = [];
    Database.read('TASK_REQUESTS').forEach(function (request) {
      var status = text(request.Status).toUpperCase();
      // Only a final outcome is mirrored; PENDING and PROCESSING stay internal.
      if (MIRRORED_STATUSES.indexOf(status) < 0) return;
      var id = text(request.Request_ID), taskId = text(request.Task_ID), projectId = text(request.Project_ID);
      var row = index.rows[id];
      var item = {requestId: id, taskId: taskId, projectId: projectId,
        managerStatus: status, inboxState: row ? row.state : '', sheetRow: row ? row.sheetRow : 0};
      if (!row) { item.state = 'MISSING_INBOX_ROW'; counts.missing++; }
      else if ((row.taskId && row.taskId !== taskId) || (row.projectId && row.projectId !== projectId)) {
        // A conflicting row is reported and never overwritten.
        item.state = 'IDENTITY_MISMATCH'; counts.mismatch++;
      } else if (row.state === status) { item.state = 'ALREADY_SYNCED'; counts.synced++; }
      else { item.state = 'NEEDS_SYNC'; counts.needsSync++; }
      items.push(item);
    });
    return {items: items, counts: counts, truncated: index.truncated};
  }

  /**
   * Read-only preview of the employee receipt against the authoritative decision.
   *
   * Only the request ID, the task identity and the two states are returned: employee text,
   * the requester and the request content never enter this payload. Nothing is written.
   */
  function previewInboxReconciliation() {
    var index;
    try {
      index = inboxIndex(openInbox());
    } catch (error) {
      return {available: false, error: message(error), truncated: false, items: [], count: 0,
        counts: {synced: 0, needsSync: 0, missing: 0, mismatch: 0}};
    }
    var comparison = compareInbox(index);
    return {available: true, error: '', truncated: comparison.truncated,
      items: comparison.items.slice(0, 500).map(function (item) {
        return {requestId: item.requestId, taskId: item.taskId, projectId: item.projectId,
          managerStatus: item.managerStatus, inboxState: item.inboxState, state: item.state};
      }),
      count: comparison.items.length, counts: comparison.counts};
  }

  /**
   * Repairs the employee receipt for requests whose manager decision is authoritative.
   *
   * Only the `Inbox_State` cell is written, only for a row whose task and project identity
   * match, and only when the value really differs. Original request content, task rows,
   * revisions and manager decisions are never touched, and `REQUEST_SUBMISSION_ENABLED` is
   * neither read nor changed.
   */
  function reconcileInboxStatesLocked(confirmation) {
    if (confirmation !== INBOX_RECONCILE_CONFIRMATION) {
      throw new Error('受信箱の再同期には「' + INBOX_RECONCILE_CONFIRMATION + '」の入力が必要です');
    }
    var identity = Roles.requireAtLeast('MANAGER', AuditLog.actor());
    var sheet, index;
    try {
      sheet = openInbox();
      index = inboxIndex(sheet);
    } catch (error) {
      throw new Error('申請受付（受信箱）を読み取れませんでした。管理データは変更していません: ' + message(error));
    }
    if (index.truncated) {
      throw new Error('申請受付（受信箱）が上限件数を超えています。安全に再同期できないため中止しました');
    }
    var comparison = compareInbox(index);
    var column = INBOX_FIELDS.indexOf('Inbox_State') + 1;
    var updated = [], failed = [];
    // The script lock is held, so the single read above is still authoritative for the writes.
    comparison.items.forEach(function (item) {
      if (item.state !== 'NEEDS_SYNC') return;
      try {
        sheet.getRange(item.sheetRow, column).setValue(String(item.managerStatus));
        updated.push({requestId: item.requestId, status: item.managerStatus});
      } catch (error) {
        failed.push({requestId: item.requestId, reason: message(error)});
      }
    });
    try {
      AuditLog.write('REQUEST_INBOX_RECONCILED', 'REQUEST_INBOX', '',
        {actor: identity.email, updated: updated.length, failed: failed.length,
          missing: comparison.counts.missing, mismatch: comparison.counts.mismatch});
    } catch (error) {
      throw new Error('受信箱の再同期後に記録を書き込めませんでした。再同期は完了しています: ' + message(error));
    }
    return {updated: updated.length, alreadySynced: comparison.counts.synced,
      missing: comparison.counts.missing, mismatch: comparison.counts.mismatch,
      failed: failed.slice(0, 100), details: updated.slice(0, 200)};
  }

  function reconcileInboxStates(confirmation) {
    return Database.withLock(function () { return reconcileInboxStatesLocked(confirmation); });
  }

  return {
    INBOX_PROPERTY: INBOX_PROPERTY,
    INBOX_FIELDS: INBOX_FIELDS,
    DECISION_CONFIRMATION: DECISION_CONFIRMATION,
    RECONCILE_CONFIRMATION: RECONCILE_CONFIRMATION,
    INBOX_RECONCILE_CONFIRMATION: INBOX_RECONCILE_CONFIRMATION,
    PREPARED_ACTION: PREPARED_ACTION,
    APPLIED_ACTION: APPLIED_ACTION,
    DECIDED_ACTION: DECIDED_ACTION,
    REVIEW_ACTION: REVIEW_ACTION,
    TERMINAL_STATUSES: TERMINAL_STATUSES,
    inboxConfigured: inboxConfigured,
    importInbox: importInbox,
    initializeInbox: initializeInbox,
    normalize: normalize,
    updateInboxState: updateInboxState,
    queue: queue,
    history: history,
    pendingByTask: pendingByTask,
    pendingCompletionStates: pendingCompletionStates,
    summary: summary,
    decide: decide,
    evidence: evidence,
    previewDecisionReconciliation: previewDecisionReconciliation,
    resolveDecision: resolveDecision,
    previewInboxReconciliation: previewInboxReconciliation,
    reconcileInboxStates: reconcileInboxStates
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
/* V1.6.2 recovery entry points. Both re-check the verified role before delegating. */
function previewRequestDecisionReconciliation() {
  Access.requireManager();
  return Requests.previewDecisionReconciliation();
}
function reconcileRequestDecision(requestId, resolution, note, confirmation) {
  Access.requireManager();
  return Requests.resolveDecision(requestId, resolution, note, confirmation);
}
function previewRequestInboxReconciliation() {
  Access.requireManager();
  return Requests.previewInboxReconciliation();
}
function reconcileRequestInbox(confirmation) {
  Access.requireManager();
  return Requests.reconcileInboxStates(confirmation);
}
