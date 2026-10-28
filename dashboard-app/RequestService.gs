/**
 * Worker request submission for the shared dashboard (V1.3).
 *
 * The dashboard deployment keeps read-only access to the sanitized snapshot and gains a
 * single narrow write capability: appending a validated request row to a *separate*
 * request inbox spreadsheet. It never receives the private management workbook ID and
 * cannot update authoritative task rows.
 *
 * Everything the browser sends is untrusted: the task must exist in the currently
 * published snapshot, the submitted values are validated and length-limited, unexpected
 * fields are rejected, duplicates and rapid repeats are bounded, submission is serialized
 * with the script lock, and the requester name is stored as unverified self-reported text.
 */
var DashboardRequests = (function () {
  var INBOX_PROPERTY = 'REQUEST_INBOX_SPREADSHEET_ID';
  var ENABLED_PROPERTY = 'REQUEST_SUBMISSION_ENABLED';
  var INBOX_SHEET = 'REQUESTS';
  var MAX_EXPLANATION = 1000;
  var MAX_NOTE = 500;
  var MAX_NAME = 120;
  var MAX_ID = 80;
  var RATE_LIMIT = 5;
  var RATE_WINDOW_SECONDS = 3600;
  var DUPLICATE_HOURS = 24;

  // Contract shared with src/Requests.gs (INBOX_FIELDS). Both sides fail closed on drift.
  var FIELDS = ['Request_ID', 'Request_Type', 'Task_ID', 'Project_ID', 'Requester_Name',
    'Submitted_At', 'Current_Due_Date', 'Requested_Due_Date', 'Reason', 'Explanation',
    'Completion_Note', 'Task_Revision', 'Snapshot_Version', 'Client_Token', 'Inbox_State'];

  var REASONS = ['部品・材料の納期遅延', '技術的問題', '工数不足・他業務', '仕様変更', '工程間の依存関係', 'その他'];

  var DEADLINE_KEYS = ['projectId', 'taskId', 'requestedDate', 'reason', 'explanation', 'requesterName', 'clientToken'];
  var COMPLETION_KEYS = ['projectId', 'taskId', 'note', 'reporterName', 'clientToken'];

  var MESSAGES = {
    REQUEST_DISABLED: '現在、申請の受付は停止しています。',
    REQUEST_UNKNOWN_TASK: '対象のタスクは公開されていません。',
    REQUEST_CONTAINER_TASK: 'このタスクは子タスクの完了状況から完了します。子タスクから報告してください。',
    REQUEST_INVALID_DATE: '希望期限が正しくありません。',
    REQUEST_DATE_UNCHANGED: '現在の期限と異なる日付を指定してください。',
    REQUEST_REASON_INVALID: '変更理由を選択してください。',
    REQUEST_REQUESTER_REQUIRED: '申請者名を入力してください。',
    REQUEST_TOO_LONG: '入力が長すぎます。',
    REQUEST_DUPLICATE: '同じ内容の申請がすでに受け付けられています。',
    REQUEST_RATE_LIMITED: '申請の回数が上限に達しました。',
    REQUEST_UNEXPECTED_FIELDS: '入力内容を確認してください。',
    REQUEST_NOT_FOUND: '申請が見つかりませんでした。',
    REQUEST_INBOX_UNAVAILABLE: '申請の受付先に接続できませんでした。',
    REQUEST_UNEXPECTED: '申請を送信できませんでした。'
  };

  function property(name) {
    var value = PropertiesService.getScriptProperties().getProperty(name);
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function inboxId() { return property(INBOX_PROPERTY); }

  /**
   * Request submission is explicitly OFF by default (V1.3.1 trial rule): a configured
   * inbox alone is not permission to accept submissions. An operator must set
   * REQUEST_SUBMISSION_ENABLED=true on the dashboard project after the inbox is ready.
   */
  function enabled() {
    if (!inboxId()) return false;
    return property(ENABLED_PROPERTY).toLowerCase() === 'true';
  }

  function fail(code) { throw new Error(code); }

  function respond(fn) {
    try {
      return {ok: true, data: fn()};
    } catch (error) {
      var code = String((error && error.message) || '');
      if (!Object.prototype.hasOwnProperty.call(MESSAGES, code)) {
        console.error('Request submission failed: ' + code);
        code = 'REQUEST_UNEXPECTED';
      }
      return {ok: false, error: {code: code, message: MESSAGES[code]}};
    }
  }

  function text(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function clip(value, maximum, code) {
    var value2 = text(value);
    if (value2.length > maximum) fail(code || 'REQUEST_TOO_LONG');
    return value2;
  }

  function isoDay(value) {
    var raw = text(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) fail('REQUEST_INVALID_DATE');
    if (new Date(raw + 'T00:00:00Z').toISOString().slice(0, 10) !== raw) fail('REQUEST_INVALID_DATE');
    return raw;
  }

  function todayJst() {
    return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  }

  function nowIso() {
    return new Date().toISOString();
  }

  /** Only the documented keys are accepted; anything else is refused. */
  function assertKeys(payload, allowed) {
    Object.keys(payload || {}).forEach(function (key) {
      if (allowed.indexOf(key) < 0) fail('REQUEST_UNEXPECTED_FIELDS');
    });
  }

  function openInbox() {
    var id = inboxId();
    if (!id) fail('REQUEST_DISABLED');
    var book;
    try {
      book = SpreadsheetApp.openById(id);
    } catch (error) {
      fail('REQUEST_INBOX_UNAVAILABLE');
    }
    var sheet = book.getSheetByName(INBOX_SHEET);
    if (!sheet) fail('REQUEST_INBOX_UNAVAILABLE');
    var header = sheet.getLastRow() ? sheet.getRange(1, 1, 1, FIELDS.length).getValues()[0].map(text) : [];
    if (header.length !== FIELDS.length || FIELDS.some(function (field, index) { return header[index] !== field; })) {
      fail('REQUEST_INBOX_UNAVAILABLE');
    }
    return sheet;
  }

  function readInbox(sheet) {
    var values = sheet.getDataRange().getValues();
    return values.slice(1)
      .filter(function (row) { return row.some(function (value) { return text(value) !== ''; }); })
      .map(function (row) {
        var record = {};
        FIELDS.forEach(function (field, index) { record[field] = row[index]; });
        return record;
      });
  }

  function rateLimited(clientToken) {
    try {
      var cache = CacheService.getScriptCache();
      var key = 'request-rate:' + clientToken;
      var used = Number(cache.get(key) || 0);
      if (used >= RATE_LIMIT) return true;
      cache.put(key, String(used + 1), RATE_WINDOW_SECONDS);
      return false;
    } catch (error) {
      // A cache failure must not block a legitimate request; the lock still serializes writes.
      return false;
    }
  }

  function hoursSince(value) {
    var parsed = new Date(String(value));
    if (isNaN(parsed.getTime())) return Number.MAX_SAFE_INTEGER;
    return (Date.now() - parsed.getTime()) / 3600000;
  }

  function newRequestId() {
    var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMddHHmmss');
    return 'REQ-' + stamp + '-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  }

  /**
   * Rejects a repeated identical submission. A retry from the same browser token returns
   * the original request ID instead of creating a second request.
   */
  function duplicateOf(rows, candidate) {
    return rows.filter(function (row) {
      if (text(row.Request_Type) !== candidate.Request_Type) return false;
      if (text(row.Task_ID) !== candidate.Task_ID) return false;
      if (text(row.Requested_Due_Date) !== candidate.Requested_Due_Date) return false;
      return true;
    }).map(function (row) {
      return {row: row, sameToken: !!candidate.Client_Token && text(row.Client_Token) === candidate.Client_Token};
    }).filter(function (item) {
      return item.sameToken || hoursSince(item.row.Submitted_At) <= DUPLICATE_HOURS;
    })[0] || null;
  }

  function submit(payload, type) {
    return respond(function () {
      DashboardApp.requireViewer();
      if (!enabled()) fail('REQUEST_DISABLED');
      payload = payload || {};
      assertKeys(payload, type === 'DEADLINE_CHANGE' ? DEADLINE_KEYS : COMPLETION_KEYS);

      var taskId = clip(payload.taskId, MAX_ID);
      if (!taskId) fail('REQUEST_UNKNOWN_TASK');
      var target = DashboardData.requestTarget(taskId);
      if (!target) fail('REQUEST_UNKNOWN_TASK');
      if (text(payload.projectId) && text(payload.projectId) !== target.projectId) fail('REQUEST_UNKNOWN_TASK');
      // V1.6.1: a container task is completed by its children. Refusing here means the inbox
      // never receives a report that a manager could not approve.
      if (type === 'COMPLETION_REPORT' && target.container) fail('REQUEST_CONTAINER_TASK');

      var clientToken = clip(payload.clientToken, 64);
      if (rateLimited(clientToken || 'anonymous')) fail('REQUEST_RATE_LIMITED');

      var candidate = {
        Request_ID: newRequestId(),
        Request_Type: type,
        Task_ID: taskId,
        Project_ID: target.projectId,
        Requester_Name: '',
        Submitted_At: nowIso(),
        Current_Due_Date: target.dueDate,
        Requested_Due_Date: '',
        Reason: '',
        Explanation: '',
        Completion_Note: '',
        Task_Revision: target.revision,
        Snapshot_Version: target.snapshotVersion,
        Client_Token: clientToken,
        Inbox_State: 'RECEIVED'
      };

      if (type === 'DEADLINE_CHANGE') {
        var requested = isoDay(payload.requestedDate);
        if (target.dueDate && requested === target.dueDate) fail('REQUEST_DATE_UNCHANGED');
        var reason = clip(payload.reason, 200);
        if (REASONS.indexOf(reason) < 0) fail('REQUEST_REASON_INVALID');
        candidate.Requested_Due_Date = requested;
        candidate.Reason = reason;
        candidate.Explanation = clip(payload.explanation, MAX_EXPLANATION);
        candidate.Requester_Name = clip(payload.requesterName, MAX_NAME);
      } else {
        candidate.Requester_Name = clip(payload.reporterName, MAX_NAME);
        candidate.Completion_Note = clip(payload.note, MAX_NOTE);
      }
      if (!candidate.Requester_Name) fail('REQUEST_REQUESTER_REQUIRED');

      var lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try {
        var sheet = openInbox();
        var rows = readInbox(sheet);
        var duplicate = duplicateOf(rows, candidate);
        if (duplicate) {
          if (duplicate.sameToken) return {requestId: text(duplicate.row.Request_ID), duplicate: true, status: text(duplicate.row.Inbox_State) || 'RECEIVED'};
          fail('REQUEST_DUPLICATE');
        }
        sheet.appendRow(FIELDS.map(function (field) {
          var value = candidate[field] === undefined ? '' : candidate[field];
          // Stored text must never become a spreadsheet formula.
          return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
        }));
        return {requestId: candidate.Request_ID, duplicate: false, status: 'RECEIVED', submittedAt: candidate.Submitted_At};
      } finally {
        lock.releaseLock();
      }
    });
  }

  function status(requestId) {
    return respond(function () {
      DashboardApp.requireViewer();
      if (!enabled()) fail('REQUEST_DISABLED');
      var id = clip(requestId, MAX_ID);
      if (!id) fail('REQUEST_NOT_FOUND');
      var sheet = openInbox();
      var row = readInbox(sheet).filter(function (item) { return text(item.Request_ID) === id; })[0];
      if (!row) fail('REQUEST_NOT_FOUND');
      return {
        requestId: text(row.Request_ID),
        type: text(row.Request_Type),
        status: text(row.Inbox_State) || 'RECEIVED',
        submittedAt: text(row.Submitted_At),
        taskId: text(row.Task_ID),
        currentDeadline: text(row.Current_Due_Date),
        requestedDeadline: text(row.Requested_Due_Date)
      };
    });
  }

  return {
    INBOX_PROPERTY: INBOX_PROPERTY,
    FIELDS: FIELDS,
    REASONS: REASONS,
    enabled: enabled,
    todayJst: todayJst,
    submitDeadlineRequest: function (payload) { return submit(payload, 'DEADLINE_CHANGE'); },
    submitCompletionReport: function (payload) { return submit(payload, 'COMPLETION_REPORT'); },
    status: status
  };
}());

/* Client-callable request API (the only write surface of this deployment). */
function submitDeadlineRequest(payload) { return DashboardRequests.submitDeadlineRequest(payload); }
function submitCompletionReport(payload) { return DashboardRequests.submitCompletionReport(payload); }
function requestSubmissionStatus(requestId) { return DashboardRequests.status(requestId); }
function requestSubmissionConfig() {
  return {ok: true, data: {enabled: DashboardRequests.enabled(), reasons: DashboardRequests.REASONS, today: DashboardRequests.todayJst()}};
}
