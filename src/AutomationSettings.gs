/**
 * Manager-controlled automation preferences persisted in the workbook.
 *
 * Values live in the AUTOMATION_SETTINGS table, therefore `git pull` / `clasp push`
 * never reset them. Credentials and Google resource identifiers stay in Script
 * Properties and are deliberately not editable or readable through this surface.
 *
 * Backward compatibility: a workbook without an EMAIL_MODE row keeps the legacy
 * Email flags only (`EMAIL_ENABLED` / `DRY_RUN`). As soon as a manager saves settings,
 * or a version-3 migration seeds the safe defaults, the persisted values govern and
 * legacy flags alone can no longer activate live mail.
 */
var AutomationSettings = (function () {
  var TABLE = 'AUTOMATION_SETTINGS';
  var MODES = ['OFF', 'PREVIEW', 'LIVE'];
  var WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

  var DEFAULTS = {
    EMAIL_MODE: 'OFF',
    EMERGENCY_STOP: true,
    ASSIGNMENT_EMAIL_ENABLED: false,
    REASSIGNMENT_EMAIL_ENABLED: false,
    DEADLINE_CHANGE_EMAIL_ENABLED: false,
    DEADLINE_REMINDER_ENABLED: false,
    OVERDUE_REMINDER_ENABLED: false,
    WEEKLY_MANAGER_REPORT_ENABLED: false,
    REMINDER_OFFSETS: [7, 2],
    REMINDER_CATCHUP_DAYS: 3,
    OVERDUE_FREQUENCY_DAYS: 7,
    WEEKDAY_ONLY_SENDING: true,
    EXECUTION_WINDOW_START: '08:00',
    EXECUTION_WINDOW_END: '20:00',
    MANAGEMENT_REPORT_RECIPIENTS: [],
    WEEKLY_REPORT_DAY: 'MONDAY',
    WEEKLY_REPORT_TIME: '08:30',
    CALENDAR_SYNC_ENABLED: false,
    DAILY_BACKUP_ENABLED: false,
    AUTO_DASHBOARD_REFRESH_ENABLED: false,
    AUTO_WORKLOAD_REFRESH_ENABLED: false,
    PROJECT_STALE_ALERT_ENABLED: true,
    PROJECT_STALE_DAYS: 7,
    HEALTH_MILESTONE_APPROACH_DAYS: 14,
    HEALTH_DELAY_TOLERANCE_DAYS: 0,
    // V1.2 shared dashboard publication. OFF until a manager reviews the snapshot.
    SHARED_DASHBOARD_PUBLISH_ENABLED: false,
    SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES: 30,
    // V1.3 worker requests. Every request notification defaults to OFF and still obeys
    // the master OFF / PREVIEW / LIVE mode, the emergency stop and the per-run cap.
    DEADLINE_REQUEST_EMAIL_ENABLED: false,
    COMPLETION_REPORT_EMAIL_ENABLED: false,
    PENDING_REQUEST_REMINDER_ENABLED: false,
    LAST_DASHBOARD_REFRESH_AT: '',
    LAST_WORKLOAD_REFRESH_AT: '',
    LAST_BACKUP_TIME: '',
    LAST_BACKUP_RESULT: '',
    CALENDAR_LAST_SYNC_AT: '',
    CALENDAR_LAST_SYNC_STATUS: '',
    LAST_WEEKLY_REPORT_AT: '',
    LAST_SHARED_DASHBOARD_PUBLISH_AT: '',
    LAST_SHARED_DASHBOARD_PUBLISH_RESULT: '',
    LAST_SHARED_DASHBOARD_PUBLISH_VERSION: '',
    LAST_SHARED_DASHBOARD_PUBLISH_ERROR: '',
    SHARED_DASHBOARD_PUBLISH_APPROVED_BY: '',
    LAST_REQUEST_IMPORT_AT: '',
    LAST_PENDING_REQUEST_REMINDER_AT: ''
  };

  var STATUS_KEYS = ['LAST_DASHBOARD_REFRESH_AT', 'LAST_WORKLOAD_REFRESH_AT', 'LAST_BACKUP_TIME',
    'LAST_BACKUP_RESULT', 'CALENDAR_LAST_SYNC_AT', 'CALENDAR_LAST_SYNC_STATUS', 'LAST_WEEKLY_REPORT_AT',
    'LAST_SHARED_DASHBOARD_PUBLISH_AT', 'LAST_SHARED_DASHBOARD_PUBLISH_RESULT',
    'LAST_SHARED_DASHBOARD_PUBLISH_VERSION', 'LAST_SHARED_DASHBOARD_PUBLISH_ERROR',
    'SHARED_DASHBOARD_PUBLISH_APPROVED_BY', 'LAST_REQUEST_IMPORT_AT', 'LAST_PENDING_REQUEST_REMINDER_AT'];

  var DESCRIPTIONS = {
    EMAIL_MODE: 'Outgoing mail mode: OFF / PREVIEW / LIVE.',
    EMERGENCY_STOP: 'Global stop for every outgoing automation message.',
    ASSIGNMENT_EMAIL_ENABLED: 'Send new assignment notifications.',
    REASSIGNMENT_EMAIL_ENABLED: 'Send reassignment notifications.',
    DEADLINE_CHANGE_EMAIL_ENABLED: 'Send deadline change notifications.',
    DEADLINE_REMINDER_ENABLED: 'Send deadline reminder stages.',
    OVERDUE_REMINDER_ENABLED: 'Send overdue reminders and overdue summaries.',
    WEEKLY_MANAGER_REPORT_ENABLED: 'Send the weekly management report.',
    REMINDER_OFFSETS: 'Reminder offsets in days before the deadline.',
    REMINDER_CATCHUP_DAYS: 'Bounded catch-up window for a missed reminder stage.',
    OVERDUE_FREQUENCY_DAYS: 'Overdue reminder repetition in days.',
    WEEKDAY_ONLY_SENDING: 'Suppress reminder mail on weekends.',
    EXECUTION_WINDOW_START: 'Reminder execution window start (Asia/Tokyo).',
    EXECUTION_WINDOW_END: 'Reminder execution window end (Asia/Tokyo).',
    MANAGEMENT_REPORT_RECIPIENTS: 'Approved management report recipients.',
    WEEKLY_REPORT_DAY: 'Weekly report weekday.',
    WEEKLY_REPORT_TIME: 'Weekly report approximate time (Asia/Tokyo).',
    CALENDAR_SYNC_ENABLED: 'Enable milestone calendar synchronization (requires CALENDAR_ENABLED).',
    DAILY_BACKUP_ENABLED: 'Enable the scheduled daily backup.',
    AUTO_DASHBOARD_REFRESH_ENABLED: 'Refresh generated dashboard views on schedule.',
    AUTO_WORKLOAD_REFRESH_ENABLED: 'Refresh workload on schedule.',
    PROJECT_STALE_ALERT_ENABLED: 'Flag projects without recent updates.',
    PROJECT_STALE_DAYS: 'Days without updates before a project is stale.',
    HEALTH_MILESTONE_APPROACH_DAYS: 'Days before a milestone that make a project yellow.',
    HEALTH_DELAY_TOLERANCE_DAYS: 'Accepted forecast delay in days before health degrades.',
    SHARED_DASHBOARD_PUBLISH_ENABLED: 'Publish the sanitized snapshot for the shared employee dashboard.',
    SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES: 'Scheduled snapshot publication interval in minutes.',
    LAST_SHARED_DASHBOARD_PUBLISH_AT: 'Last successful shared dashboard publication (Asia/Tokyo).',
    LAST_SHARED_DASHBOARD_PUBLISH_RESULT: 'Result of the last shared dashboard publication attempt.',
    LAST_SHARED_DASHBOARD_PUBLISH_VERSION: 'Snapshot version currently published.',
    LAST_SHARED_DASHBOARD_PUBLISH_ERROR: 'Last publication failure, truncated.',
    SHARED_DASHBOARD_PUBLISH_APPROVED_BY: 'Verified account that last enabled publication.',
    DEADLINE_REQUEST_EMAIL_ENABLED: 'Notify managers when a deadline change request is imported.',
    COMPLETION_REPORT_EMAIL_ENABLED: 'Notify managers when a completion report is imported.',
    PENDING_REQUEST_REMINDER_ENABLED: 'Send a bounded reminder about requests still pending approval.',
    LAST_REQUEST_IMPORT_AT: 'Last request inbox import (Asia/Tokyo).',
    LAST_PENDING_REQUEST_REMINDER_AT: 'Last pending-request reminder (Asia/Tokyo).'
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function parse(text) {
    if (text === '' || text === null || text === undefined) return '';
    try { return JSON.parse(text); } catch (error) { return String(text); }
  }

  function serialize(value) { return JSON.stringify(value); }

  function has(name) { return Object.prototype.hasOwnProperty.call(DEFAULTS, name); }

  function defaults() { return clone(DEFAULTS); }

  function readStored() {
    var sheet = Database.book().getSheetByName(TABLE);
    if (!sheet) return Object.create(null);
    var stored = Object.create(null);
    Database.read(TABLE).forEach(function (row) {
      stored[String(row.Setting_ID)] = {value: parse(row.Value), description: row.Description};
    });
    return stored;
  }

  function get() {
    var stored = readStored();
    var values = defaults();
    Object.keys(stored).forEach(function (key) {
      if (!has(key)) return;
      var value = stored[key].value;
      values[key] = value === '' && typeof DEFAULTS[key] !== 'string' ? DEFAULTS[key] : value;
    });
    return values;
  }

  function configured() {
    var stored = readStored();
    return Object.prototype.hasOwnProperty.call(stored, 'EMAIL_MODE');
  }

  function integer(value, name, min, max) {
    var number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
      throw new Error(name + ' must be an integer between ' + min + ' and ' + max);
    }
    return number;
  }

  function boolean(value, name) {
    if (typeof value !== 'boolean') throw new Error(name + ' must be true or false');
    return value;
  }

  function time(value, name) {
    var text = String(value || '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error(name + ' must be HH:mm');
    return text;
  }

  function offsets(value) {
    var list = Array.isArray(value) ? value : String(value || '').split(',');
    var numbers = list.map(function (item) { return Number(item); });
    if (!numbers.length) throw new Error('At least one reminder offset is required');
    if (numbers.length > 5) throw new Error('At most five reminder offsets are supported');
    var seen = Object.create(null);
    numbers.forEach(function (number) {
      if (!Number.isInteger(number) || number < 1 || number > 365) throw new Error('Reminder offsets must be integers between 1 and 365 days');
      if (seen[number]) throw new Error('Duplicate reminder offset: ' + number);
      seen[number] = true;
    });
    return numbers.sort(function (a, b) { return b - a; });
  }

  function recipients(value) {
    var list = Array.isArray(value) ? value : String(value || '').split(',');
    var domains = (Config.get().allowedDomains || []).map(function (domain) { return domain.toLowerCase(); });
    var seen = Object.create(null), out = [];
    list.forEach(function (item) {
      var address = String(item || '').trim().toLowerCase();
      if (!address) return;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Invalid recipient address: ' + address);
      if (domains.length && domains.indexOf(address.split('@')[1]) === -1) {
        throw new Error('Recipient domain is not allowed: ' + address);
      }
      if (seen[address]) return;
      seen[address] = true;
      out.push(address);
    });
    return out;
  }

  function validateValue(key, value) {
    if (key === 'EMAIL_MODE') {
      var mode = String(value).toUpperCase();
      if (MODES.indexOf(mode) < 0) throw new Error('EMAIL_MODE must be OFF, PREVIEW or LIVE');
      return mode;
    }
    if (key === 'EMERGENCY_STOP' || /_ENABLED$/.test(key)) return boolean(value, key);
    if (typeof DEFAULTS[key] === 'boolean') return boolean(value, key);
    if (key === 'REMINDER_OFFSETS') return offsets(value);
    if (key === 'MANAGEMENT_REPORT_RECIPIENTS') return recipients(value);
    if (key === 'WEEKLY_REPORT_DAY') {
      var weekday = String(value).toUpperCase();
      if (WEEKDAYS.indexOf(weekday) < 0) throw new Error('WEEKLY_REPORT_DAY must be a weekday name');
      return weekday;
    }
    if (key === 'WEEKLY_REPORT_TIME' || key === 'EXECUTION_WINDOW_START' || key === 'EXECUTION_WINDOW_END') {
      return time(value, key);
    }
    if (key === 'PROJECT_STALE_DAYS') return integer(value, key, 1, 365);
    if (key === 'HEALTH_MILESTONE_APPROACH_DAYS') return integer(value, key, 0, 365);
    if (key === 'HEALTH_DELAY_TOLERANCE_DAYS') return integer(value, key, 0, 365);
    if (key === 'REMINDER_CATCHUP_DAYS') return integer(value, key, 0, 31);
    if (key === 'OVERDUE_FREQUENCY_DAYS') return integer(value, key, 1, 90);
    if (key === 'SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES') return integer(value, key, 5, 1440);
    if (typeof DEFAULTS[key] === 'number') return integer(value, key, 0, Number.MAX_SAFE_INTEGER);
    return String(value === null || value === undefined ? '' : value);
  }

  function preflight(candidate) {
    var config = Config.get();
    var problems = [];
    if (!config.emailEnabled) problems.push('EMAIL_ENABLED is not true');
    if (config.dryRun) problems.push('DRY_RUN is not false');
    if (!config.allowedDomains.length) problems.push('ALLOWED_RECIPIENT_DOMAINS is empty');
    if (!config.notificationActivationAt || !config.notificationAuthorizedBy) problems.push('notifications are not activated');
    if (!config.spreadsheetId) problems.push('spreadsheet binding is missing');
    if (candidate.EMERGENCY_STOP === true) problems.push('emergency stop is engaged');
    if (candidate.EMAIL_MODE !== 'LIVE') problems.push('EMAIL_MODE is not LIVE');
    var windowStart = candidate.EXECUTION_WINDOW_START, windowEnd = candidate.EXECUTION_WINDOW_END;
    if (windowStart >= windowEnd) problems.push('execution window end must be after its start');
    return problems;
  }

  function writeRows(changes, actor, auditBefore) {
    var stored = readStored();
    var patches = [], inserts = [];
    Object.keys(changes).forEach(function (key) {
      var row = {
        Value: serialize(changes[key]),
        Description: DESCRIPTIONS[key] || '',
        Updated_At: Domain.now(),
        Updated_By: actor.email
      };
      if (stored[key]) patches.push({id: key, patch: row});
      else inserts.push(Object.assign({Setting_ID: key}, row));
    });
    if (patches.length) Database.updateMany(TABLE, patches);
    inserts.forEach(function (row) { Database.insert(TABLE, row); });
    Object.keys(changes).forEach(function (key) {
      AuditLog.record(TABLE, key, 'SETTING_CHANGED',
        {value: auditBefore[key]}, {value: changes[key], updatedBy: actor.email}, 'SUCCESS');
    });
  }

  function save(changes, actorEmail, confirmation) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Automation settings payload required');
    var keys = Object.keys(changes);
    if (!keys.length) throw new Error('No automation settings supplied');
    var actor = Roles.requireAtLeast('MANAGER', actorEmail);
    var config = Config.get();
    var before = get();
    var next = {};
    keys.forEach(function (key) {
      if (!has(key)) throw new Error('Unknown automation setting: ' + key);
      if (STATUS_KEYS.indexOf(key) >= 0) throw new Error('Status values are written by the application: ' + key);
      next[key] = validateValue(key, changes[key]);
    });
    var candidate = Object.assign({}, before, next);
    if (candidate.EXECUTION_WINDOW_START >= candidate.EXECUTION_WINDOW_END) {
      throw new Error('Execution window end must be after its start');
    }
    // The transition that matters is the EFFECTIVE state: clearing the emergency stop while
    // EMAIL_MODE is already LIVE re-activates delivery and needs the same fresh authorization.
    // Persisting LIVE while the emergency stop is engaged is refused as well, so a MANAGER can
    // never pre-position live delivery for a later restart.
    var beforeState = emailState(config);
    var afterState = resolve(config, candidate, true);
    var storedLive = before.EMAIL_MODE === 'LIVE';
    var enteringLive = afterState.mode === 'LIVE' && beforeState.mode !== 'LIVE';
    var selectingLive = next.EMAIL_MODE === 'LIVE' && !storedLive;
    if (enteringLive || selectingLive) {
      if (confirmation !== 'ENABLE LIVE EMAIL') throw new Error('Explicit LIVE email confirmation required');
      Roles.requireAtLeast('ADMIN', actorEmail);
      var problems = preflight(candidate);
      if (problems.length) throw new Error('LIVE email preflight failed: ' + problems.join('; '));
    }
    return Database.withLock(function () {
      writeRows(next, actor, before);
      if (enteringLive || selectingLive) {
        AuditLog.write('EMAIL_LIVE_ACTIVATED', TABLE, 'EMAIL_MODE',
          {actor: actor.email, previousMode: beforeState.mode, effectiveMode: afterState.mode,
            emergencyStop: candidate.EMERGENCY_STOP});
      } else if (afterState.mode !== 'LIVE' && beforeState.mode === 'LIVE') {
        AuditLog.write('EMAIL_LIVE_DEACTIVATED', TABLE, 'EMAIL_MODE',
          {actor: actor.email, mode: afterState.mode, reason: afterState.reason});
      }
      return {updated: keys, effective: emailState(Config.get())};
    });
  }

  function restoreDefaults(actorEmail, confirmation) {
    if (confirmation !== 'RESTORE SAFE DEFAULTS') throw new Error('Explicit restore confirmation required');
    var changes = {}, base = defaults();
    Object.keys(base).forEach(function (key) {
      if (STATUS_KEYS.indexOf(key) >= 0) return;
      changes[key] = base[key];
    });
    return save(changes, actorEmail);
  }

  /** Application-managed status (last run outcome). Never callable from the settings form. */
  function setStatus(key, value) {
    if (STATUS_KEYS.indexOf(key) < 0) throw new Error('Not an automation status key: ' + key);
    try {
      var stored = readStored();
      var row = {Value: serialize(value), Updated_At: Domain.now(), Updated_By: 'system'};
      if (stored[key]) Database.update(TABLE, key, row);
      else Database.insert(TABLE, Object.assign({Setting_ID: key, Description: DESCRIPTIONS[key] || 'Automation status'}, row));
    } catch (error) {
      console.warn('Automation status could not be recorded: ' + error.message);
    }
  }

  function seedDefaults() {
    var sheet = Database.book().getSheetByName(TABLE);
    if (!sheet || Database.read(TABLE).length) return 0;
    var base = defaults(), count = 0;
    Object.keys(base).forEach(function (key) {
      Database.insert(TABLE, {
        Setting_ID: key, Value: serialize(base[key]), Description: DESCRIPTIONS[key] || '',
        Updated_At: Domain.now(), Updated_By: 'initialization'
      });
      count++;
    });
    return count;
  }

  /**
   * Single effective-state resolver.
   *
   * A workbook without persisted automation settings stays OFF unless the deployment has
   * explicitly opted into the documented legacy compatibility path
   * (`ALLOW_LEGACY_EMAIL_CONFIG=true`). This keeps unmigrated or partially configured
   * workbooks from activating mail unexpectedly.
   */
  function resolve(config, values, isConfigured) {
    var legacyToggles = config.allowLegacyEmail === true;
    var toggles = {
      NEW_ASSIGNMENT: isConfigured ? values.ASSIGNMENT_EMAIL_ENABLED === true : legacyToggles,
      REASSIGNMENT: isConfigured ? values.REASSIGNMENT_EMAIL_ENABLED === true : legacyToggles,
      DEADLINE_CHANGE: isConfigured ? values.DEADLINE_CHANGE_EMAIL_ENABLED === true : legacyToggles,
      DEADLINE: isConfigured ? values.DEADLINE_REMINDER_ENABLED === true : legacyToggles,
      OVERDUE: isConfigured ? values.OVERDUE_REMINDER_ENABLED === true : legacyToggles,
      OVERDUE_SUMMARY: isConfigured ? values.OVERDUE_REMINDER_ENABLED === true : legacyToggles,
      WEEKLY_REPORT: isConfigured ? values.WEEKLY_MANAGER_REPORT_ENABLED === true : false,
      DEADLINE_REQUEST: isConfigured ? values.DEADLINE_REQUEST_EMAIL_ENABLED === true : false,
      COMPLETION_REPORT: isConfigured ? values.COMPLETION_REPORT_EMAIL_ENABLED === true : false,
      PENDING_REQUEST_REMINDER: isConfigured ? values.PENDING_REQUEST_REMINDER_ENABLED === true : false
    };
    var mode, reason = '';
    if (isConfigured && values.EMERGENCY_STOP === true) {
      mode = 'OFF';
      reason = 'EMERGENCY_STOP';
    } else if (isConfigured) {
      mode = MODES.indexOf(values.EMAIL_MODE) >= 0 ? values.EMAIL_MODE : 'OFF';
      if (MODES.indexOf(values.EMAIL_MODE) < 0) reason = 'INVALID_MODE';
      else if (mode === 'LIVE' && (!config.emailEnabled || config.dryRun)) {
        mode = 'OFF';
        reason = 'LEGACY_SAFETY_FLAGS_BLOCK_LIVE';
      } else if (mode === 'OFF') reason = 'EMAIL_MODE_OFF';
    } else if (!legacyToggles) {
      mode = 'OFF';
      reason = 'LEGACY_CONFIGURATION_BLOCKED';
    } else {
      mode = !config.emailEnabled ? 'OFF' : (config.dryRun ? 'PREVIEW' : 'LIVE');
      reason = 'LEGACY_CONFIGURATION_OPT_IN';
    }
    return {
      mode: mode,
      reason: reason,
      configured: isConfigured,
      legacyCompatibility: !isConfigured && legacyToggles,
      emergencyStop: isConfigured && values.EMERGENCY_STOP === true,
      toggles: toggles,
      offsets: isConfigured ? values.REMINDER_OFFSETS : [7, 2],
      catchupDays: isConfigured ? values.REMINDER_CATCHUP_DAYS : 0,
      overdueFrequencyDays: isConfigured ? values.OVERDUE_FREQUENCY_DAYS : 7,
      weekdayOnly: isConfigured ? values.WEEKDAY_ONLY_SENDING !== false : false,
      windowStart: isConfigured ? values.EXECUTION_WINDOW_START : '',
      windowEnd: isConfigured ? values.EXECUTION_WINDOW_END : '',
      managementRecipients: isConfigured ? values.MANAGEMENT_REPORT_RECIPIENTS : [],
      values: values
    };
  }

  function emailState(config) {
    config = config || Config.get();
    return resolve(config, get(), configured());
  }

  /** Effective state for a candidate settings set, used before anything is written. */
  function stateFor(values, config) {
    return resolve(config || Config.get(), Object.assign({}, defaults(), values || {}), true);
  }

  function describe() {
    var values = get();
    return Object.keys(DEFAULTS).map(function (key) {
      return {key: key, value: values[key], description: DESCRIPTIONS[key] || '', status: STATUS_KEYS.indexOf(key) >= 0};
    });
  }

  function viewRows() {
    var rows = [['自動化設定（自動生成・編集禁止）', '値', '説明']];
    try {
      var state = emailState(Config.get());
      rows.push(['有効なメールモード', state.mode, state.reason || '']);
      rows.push(['自動化設定の保存', state.configured ? 'あり' : 'なし',
        state.configured ? '' : '自動化設定が未保存です。保存するまでメール送信は無効です（旧設定の互換利用は明示的な設定が必要）']);
      rows.push(['緊急停止', state.emergencyStop ? '有効' : '無効', '']);
      Object.keys(state.toggles).forEach(function (type) {
        rows.push(['通知: ' + type, state.toggles[type] ? 'ON' : 'OFF', '']);
      });
      rows.push(['期限前リマインド日数', state.offsets.join(', '), '']);
      rows.push(['キャッチアップ日数', state.catchupDays, '']);
      var values = state.values;
      rows.push(['最終ダッシュボード更新', values.LAST_DASHBOARD_REFRESH_AT, '']);
      rows.push(['最終週次レポート', values.LAST_WEEKLY_REPORT_AT, '']);
      rows.push(['最終バックアップ', values.LAST_BACKUP_TIME, values.LAST_BACKUP_RESULT]);
      rows.push(['カレンダー最終同期', values.CALENDAR_LAST_SYNC_AT, values.CALENDAR_LAST_SYNC_STATUS]);
      rows.push(['共有ダッシュボード公開', values.SHARED_DASHBOARD_PUBLISH_ENABLED ? 'ON' : 'OFF',
        values.LAST_SHARED_DASHBOARD_PUBLISH_RESULT || '']);
      rows.push(['最終公開', values.LAST_SHARED_DASHBOARD_PUBLISH_AT,
        'version ' + (values.LAST_SHARED_DASHBOARD_PUBLISH_VERSION || '-')]);
    } catch (error) {
      rows.push(['状態を取得できません', error.message, '']);
    }
    return rows;
  }

  return {
    TABLE: TABLE,
    DEFAULTS: DEFAULTS,
    defaults: defaults,
    get: get,
    configured: configured,
    validateValue: validateValue,
    save: save,
    restoreDefaults: restoreDefaults,
    setStatus: setStatus,
    seedDefaults: seedDefaults,
    emailState: emailState,
    stateFor: stateFor,
    describe: describe,
    preflight: preflight,
    viewRows: viewRows
  };
}());
