/**
 * Sanitized snapshot publication for the shared employee dashboard.
 *
 * Publication is a one-way projection of operational data into a *different* spreadsheet
 * that employees may read. The private management workbook is only ever read here.
 *
 * Safety properties:
 * - The destination spreadsheet ID lives in Script Properties and is never returned to
 *   a browser, logged as a URL, or written into a generated sheet.
 * - Publication refuses the private master workbook, and refuses any workbook that looks
 *   like an operational database (PROJECTS / MEMBERS / AUTOMATION_SETTINGS sheets).
 * - Two data slots (A/B) are written in full before a single metadata write flips the
 *   active slot. A failure therefore leaves the previously committed snapshot readable and
 *   a partially written slot is never active.
 * - Only allowlisted DTO fields are written (SharedDashboardModel); source rows never reach
 *   the destination, and row counts plus a content hash are verified before the flip.
 * - Runs are serialized with the script lock and are idempotent: repeating a publication
 *   with unchanged data produces identical rows under a new monotonic version, and never
 *   duplicates tasks.
 */
var SharedDashboardPublisher = (function () {
  var PUBLISHER_VERSION = '1.4.1';
  var CONTRACT_VERSION = SharedDashboardModel.CONTRACT_VERSION;
  var DESTINATION_PROPERTY = 'SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID';
  var META_SHEET = 'PUBLISHED_META';
  var SLOTS = ['A', 'B'];
  var TABLES = [
    {key: 'responsibilities', sheet: 'PUBLISHED_RESPONSIBILITIES',
      fields: SharedDashboardModel.RESPONSIBILITY_PUBLIC_FIELDS, modelKey: 'responsibilities',
      label: 'RESPONSIBILITY_COUNT'},
    {key: 'projects', sheet: 'PUBLISHED_PROJECTS', fields: SharedDashboardModel.PROJECT_PUBLIC_FIELDS,
      modelKey: 'projects', label: 'PROJECT_COUNT'},
    {key: 'subprojects', sheet: 'PUBLISHED_SUBPROJECTS', fields: SharedDashboardModel.SUBPROJECT_PUBLIC_FIELDS,
      modelKey: 'subprojects', label: 'SUBPROJECT_COUNT'},
    {key: 'tasks', sheet: 'PUBLISHED_TASKS', fields: SharedDashboardModel.TASK_PUBLIC_FIELDS,
      modelKey: 'tasks', label: 'TASK_COUNT'},
    {key: 'milestones', sheet: 'PUBLISHED_MILESTONES', fields: SharedDashboardModel.MILESTONE_PUBLIC_FIELDS,
      modelKey: 'milestones', label: 'MILESTONE_COUNT'}
  ];
  var META_KEYS = ['CONTRACT_VERSION', 'ACTIVE_SLOT', 'SNAPSHOT_VERSION', 'PUBLISHED_AT', 'PUBLISHER_VERSION',
    'CONTENT_HASH', 'AS_OF', 'PREVIOUS_SLOT', 'RESPONSIBILITY_COUNT', 'PROJECT_COUNT', 'SUBPROJECT_COUNT',
    'TASK_COUNT', 'MILESTONE_COUNT', 'RESULT'];
  var OPERATIONAL_SHEETS = ['PROJECTS', 'MEMBERS', 'AUTOMATION_SETTINGS', 'NOTIFICATION_LOG', 'AUDIT_LOG'];

  function slotSheet(name, slot) {
    if (SLOTS.indexOf(slot) < 0) throw new Error('Invalid snapshot slot');
    return name + '_' + slot;
  }

  function destinationId() {
    var value = PropertiesService.getScriptProperties().getProperty(DESTINATION_PROPERTY);
    if (!value) throw new Error('Shared dashboard snapshot destination is not configured');
    return String(value).trim();
  }

  function destinationConfigured() {
    try { return !!destinationId(); } catch (error) { return false; }
  }

  /** Refuses the private master workbook and anything that looks like an operational database. */
  function assertSnapshotDestination(book, masterId) {
    if (String(book.getId()) === String(masterId)) {
      throw new Error('Publication destination must never be the private master workbook');
    }
    OPERATIONAL_SHEETS.forEach(function (name) {
      if (book.getSheetByName(name)) {
        throw new Error('Publication destination contains the operational table ' + name + '; refusing to write');
      }
    });
    return true;
  }

  function openDestination() {
    var config = Config.get();
    var id = destinationId();
    var book = SpreadsheetApp.openById(id);
    assertSnapshotDestination(book, config.spreadsheetId);
    return {book: book, config: config};
  }

  function cell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean' || typeof value === 'number') return value;
    var text = String(value);
    // A public string must never become a formula in the snapshot workbook.
    return /^[=+\-@]/.test(text) ? "'" + text : text;
  }

  function rowFor(dto, fields) {
    return fields.map(function (field) { return cell(dto[field]); });
  }

  function tableRows(snapshot, table) {
    return (snapshot[table.modelKey] || []).map(function (dto) { return rowFor(dto, table.fields); });
  }

  function hashSnapshot(snapshot) {
    var payload = {contractVersion: CONTRACT_VERSION};
    TABLES.forEach(function (table) { payload[table.key] = tableRows(snapshot, table); });
    return SharedDashboardModel.hash(payload);
  }

  /**
   * Writes a complete slot sheet without clearing it: stale trailing rows from a previous,
   * larger snapshot are blanked explicitly so no deleted task can survive a republication.
   */
  function writeSlotSheet(sheet, header, rows) {
    var previousRows = sheet.getLastRow();
    var matrix = [header].concat(rows);
    Database.ensureSize(sheet, matrix.length + 1, header.length);
    sheet.getRange(1, 1, matrix.length, header.length).setValues(matrix);
    var trailing = previousRows - matrix.length;
    if (trailing > 0) {
      var blanks = [];
      for (var i = 0; i < trailing; i++) {
        var line = [];
        for (var c = 0; c < Math.max(header.length, sheet.getLastColumn() || header.length); c++) line.push('');
        blanks.push(line);
      }
      sheet.getRange(matrix.length + 1, 1, blanks.length, blanks[0].length).setValues(blanks);
    }
    return matrix.length;
  }

  function preparedSlot(book, slot) {
    var result = {slot: slot, sheets: {}};
    TABLES.forEach(function (table) {
      var name = slotSheet(table.sheet, slot);
      var sheet = book.getSheetByName(name);
      if (!sheet) sheet = book.insertSheet(name);
      result.sheets[table.key] = sheet;
    });
    return result;
  }

  function writeSlot(book, slot, snapshot) {
    var prepared = preparedSlot(book, slot);
    TABLES.forEach(function (table) {
      writeSlotSheet(prepared.sheets[table.key], table.fields, tableRows(snapshot, table));
    });
    return prepared;
  }

  function readTable(book, slot, table) {
    var sheet = book.getSheetByName(slotSheet(table.sheet, slot));
    if (!sheet) throw new Error('Snapshot table is missing: ' + slotSheet(table.sheet, slot));
    var values = sheet.getDataRange().getValues();
    var header = values[0] || [];
    var expected = table.fields;
    if (header.length < expected.length || expected.some(function (field, i) { return header[i] !== field; })) {
      throw new Error('Snapshot table headers do not match contract ' + CONTRACT_VERSION + ': ' + sheet.getName());
    }
    return values.slice(1).filter(function (row) { return row.some(function (value) { return value !== ''; }); })
      .map(function (row) { return expected.map(function (field, i) { return row[i]; }); });
  }

  function verifySlot(book, slot, snapshot) {
    var recomputed = {contractVersion: CONTRACT_VERSION};
    var counts = {};
    TABLES.forEach(function (table) {
      var rows = readTable(book, slot, table);
      var expectedRows = tableRows(snapshot, table);
      if (rows.length !== expectedRows.length) {
        throw new Error('Snapshot row count mismatch in ' + slotSheet(table.sheet, slot) + ': ' +
          rows.length + ' != ' + expectedRows.length);
      }
      counts[table.label] = rows.length;
      // Tolerate the documented apostrophe escape: Sheets stores '=x as the text =x.
      rows.forEach(function (row, r) {
        row.forEach(function (value, c) {
          var written = expectedRows[r][c];
          var escaped = typeof written === 'string' && written.charAt(0) === "'" && /^[=+\-@]/.test(written.slice(1));
          if (value === written) return;
          if (escaped && value === written.slice(1)) return;
          if (String(value) === String(written)) return;
          throw new Error('Snapshot value mismatch in ' + slotSheet(table.sheet, slot) + ' row ' + (r + 2) + ' column ' + (c + 1));
        });
      });
      recomputed[table.key] = rows;
    });
    var hash = SharedDashboardModel.hash(recomputed);
    return {counts: counts, hash: hash, ok: hash === hashSnapshot(snapshot)};
  }

  function readMeta(book) {
    var sheet = book.getSheetByName(META_SHEET);
    if (!sheet) return null;
    var values = sheet.getDataRange().getValues();
    if (!values.length) return null;
    var meta = Object.create(null);
    values.slice(1).forEach(function (row) {
      if (!row[0]) return;
      meta[String(row[0])] = row[1] === undefined ? '' : row[1];
    });
    return meta;
  }

  function writeMeta(book, meta) {
    var sheet = book.getSheetByName(META_SHEET);
    if (!sheet) sheet = book.insertSheet(META_SHEET);
    var rows = [['Key', 'Value']];
    META_KEYS.forEach(function (key) { rows.push([key, meta[key] === undefined ? '' : meta[key]]); });
    Database.ensureSize(sheet, rows.length + 1, 2);
    var previousRows = sheet.getLastRow();
    // One contiguous write is the commit point: readers see either the old or the new slot.
    sheet.getRange(1, 1, rows.length, 2).setValues(rows);
    if (previousRows > rows.length) {
      var blanks = [];
      for (var i = 0; i < previousRows - rows.length; i++) blanks.push(['', '']);
      sheet.getRange(rows.length + 1, 1, blanks.length, 2).setValues(blanks);
    }
    return meta;
  }

  function activeSlotFrom(meta) {
    if (!meta) return '';
    var slot = String(meta.ACTIVE_SLOT || '');
    return SLOTS.indexOf(slot) >= 0 ? slot : '';
  }

  function collect() {
    return {
      today: Domain.today(),
      responsibilities: Database.read('RESPONSIBILITIES'),
      projects: Database.read('PROJECTS'),
      subprojects: Database.read('SUBPROJECTS'),
      tasks: Database.read('TASKS'),
      milestones: Database.read('MILESTONES'),
      members: Database.read('MEMBERS'),
      issues: Database.read('ISSUES'),
      limits: Health.thresholds(),
      pendingRequests: pendingRequests()
    };
  }

  /** A boolean pending-request indicator only; request text never leaves the workbook. */
  function pendingRequests() {
    try {
      return Requests.pendingByTask();
    } catch (error) {
      return Object.create(null);
    }
  }

  /** Manager or administrator, verified server-side. Scheduled runs use the trigger owner. */
  function requirePublisher(mode, actorEmail) {
    if (mode === 'SCHEDULED') {
      var current = Roles.describe();
      if (!current.verified || !current.active || !Roles.isManager(current)) {
        throw new Error('Scheduled publication requires an active manager or administrator account');
      }
      return current;
    }
    return Access.requireManager(actorEmail);
  }

  function recordFailure(error) {
    var message = String((error && error.message) || error || 'unknown').slice(0, 200);
    AutomationSettings.setStatus('LAST_SHARED_DASHBOARD_PUBLISH_RESULT', 'FAILED');
    AutomationSettings.setStatus('LAST_SHARED_DASHBOARD_PUBLISH_ERROR', message);
    try {
      AuditLog.write('SHARED_DASHBOARD_PUBLICATION_FAILED', 'SHARED_DASHBOARD', '', {error: message});
    } catch (auditError) { console.error('Publication failure audit failed: ' + auditError.message); }
    return message;
  }

  function recordSuccess(meta) {
    AutomationSettings.setStatus('LAST_SHARED_DASHBOARD_PUBLISH_AT', Domain.now());
    AutomationSettings.setStatus('LAST_SHARED_DASHBOARD_PUBLISH_RESULT', 'SUCCESS');
    AutomationSettings.setStatus('LAST_SHARED_DASHBOARD_PUBLISH_VERSION', String(meta.SNAPSHOT_VERSION));
    AutomationSettings.setStatus('LAST_SHARED_DASHBOARD_PUBLISH_ERROR', '');
    AuditLog.write('SHARED_DASHBOARD_PUBLISHED', 'SHARED_DASHBOARD', String(meta.SNAPSHOT_VERSION), {
      version: meta.SNAPSHOT_VERSION, hash: meta.CONTENT_HASH, slot: meta.ACTIVE_SLOT,
      projectCount: meta.PROJECT_COUNT, taskCount: meta.TASK_COUNT, asOf: meta.AS_OF
    });
  }

  /**
   * Publishes the sanitized snapshot.
   *
   * @param {{mode?: string, actorEmail?: string}} options
   * @returns {object} publication result (never includes the destination spreadsheet ID)
   */
  function publish(options) {
    options = options || {};
    var mode = options.mode === 'SCHEDULED' ? 'SCHEDULED' : 'MANUAL';
    return Database.withLock(function () {
      var values = AutomationSettings.get();
      if (mode === 'SCHEDULED' && values.SHARED_DASHBOARD_PUBLISH_ENABLED !== true) {
        return {published: false, mode: mode, reason: 'PUBLICATION_DISABLED'};
      }
      try {
        var identity = requirePublisher(mode, options.actorEmail);
        var opened = openDestination();
        var meta = readMeta(opened.book);
        if (!meta) throw new Error('Snapshot workbook is not initialized; run the approved snapshot initialization');

        var snapshot = SharedDashboardModel.build(collect());
        var active = activeSlotFrom(meta);
        var target = active === 'A' ? 'B' : 'A';
        var previousVersion = Number(meta.SNAPSHOT_VERSION || 0);

        writeSlot(opened.book, target, snapshot);
        var verified = verifySlot(opened.book, target, snapshot);
        if (!verified.ok) throw new Error('Snapshot content hash verification failed; the previous snapshot stays active');

        var nextMeta = {
          CONTRACT_VERSION: CONTRACT_VERSION,
          ACTIVE_SLOT: target,
          SNAPSHOT_VERSION: previousVersion + 1,
          PUBLISHED_AT: Domain.now(),
          PUBLISHER_VERSION: PUBLISHER_VERSION,
          CONTENT_HASH: verified.hash,
          AS_OF: snapshot.asOf,
          PREVIOUS_SLOT: active,
          RESPONSIBILITY_COUNT: verified.counts.RESPONSIBILITY_COUNT,
          PROJECT_COUNT: verified.counts.PROJECT_COUNT,
          SUBPROJECT_COUNT: verified.counts.SUBPROJECT_COUNT,
          TASK_COUNT: verified.counts.TASK_COUNT,
          MILESTONE_COUNT: verified.counts.MILESTONE_COUNT,
          RESULT: 'SUCCESS'
        };
        writeMeta(opened.book, nextMeta);
        recordSuccess(nextMeta);
        return {
          published: true,
          mode: mode,
          version: nextMeta.SNAPSHOT_VERSION,
          activeSlot: target,
          hash: nextMeta.CONTENT_HASH,
          asOf: snapshot.asOf,
          counts: {
            responsibilities: verified.counts.RESPONSIBILITY_COUNT,
            projects: verified.counts.PROJECT_COUNT,
            subprojects: verified.counts.SUBPROJECT_COUNT,
            tasks: verified.counts.TASK_COUNT,
            milestones: verified.counts.MILESTONE_COUNT
          },
          excluded: snapshot.excluded,
          warnings: snapshot.warnings.map(function (warning) { return warning.code; }),
          actor: identity.email
        };
      } catch (error) {
        recordFailure(error);
        throw error;
      }
    });
  }

  /**
   * Dry run: builds the sanitized payload and compares it with the committed snapshot.
   * Writes nothing to the snapshot workbook.
   */
  function preview() {
    var opened = openDestination();
    var meta = readMeta(opened.book);
    var snapshot = SharedDashboardModel.build(collect());
    var hash = hashSnapshot(snapshot);
    var active = activeSlotFrom(meta);
    var counts = {};
    var stored = {};
    TABLES.forEach(function (table) {
      counts[table.label] = (snapshot[table.modelKey] || []).length;
      if (active) {
        try {
          stored[table.label] = readTable(opened.book, active, table).length;
        } catch (error) {
          stored[table.label] = null;
        }
      }
    });
    return {
      initialized: !!meta,
      activeSlot: active,
      publishedVersion: meta ? Number(meta.SNAPSHOT_VERSION || 0) : 0,
      publishedAt: meta ? String(meta.PUBLISHED_AT || '') : '',
      contentHash: hash,
      unchanged: !!meta && String(meta.CONTENT_HASH || '') === hash,
      asOf: snapshot.asOf,
      counts: counts,
      storedCounts: stored,
      excluded: snapshot.excluded,
      warnings: snapshot.warnings,
      sample: snapshot.projects.slice(0, 5)
    };
  }

  function status() {
    var values = AutomationSettings.get();
    var configured = destinationConfigured();
    var result = {
      publisherVersion: PUBLISHER_VERSION,
      contractVersion: CONTRACT_VERSION,
      destinationConfigured: configured,
      enabled: values.SHARED_DASHBOARD_PUBLISH_ENABLED === true,
      intervalMinutes: values.SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES,
      approvedBy: values.SHARED_DASHBOARD_PUBLISH_APPROVED_BY || '',
      lastSuccessAt: values.LAST_SHARED_DASHBOARD_PUBLISH_AT || '',
      lastResult: values.LAST_SHARED_DASHBOARD_PUBLISH_RESULT || '',
      lastVersion: values.LAST_SHARED_DASHBOARD_PUBLISH_VERSION || '',
      lastError: values.LAST_SHARED_DASHBOARD_PUBLISH_ERROR || '',
      snapshot: null,
      readable: false,
      error: ''
    };
    if (!configured) return result;
    try {
      var opened = openDestination();
      var meta = readMeta(opened.book);
      if (!meta || !activeSlotFrom(meta)) {
        result.error = 'Snapshot workbook is not initialized';
        return result;
      }
      var publishedAt = String(meta.PUBLISHED_AT || '');
      var ageHours = publishedAt ? Math.floor((Date.now() - new Date(publishedAt).getTime()) / 3600000) : null;
      result.readable = true;
      result.snapshot = {
        version: Number(meta.SNAPSHOT_VERSION || 0),
        publishedAt: publishedAt,
        activeSlot: activeSlotFrom(meta),
        contractVersion: String(meta.CONTRACT_VERSION || ''),
        ageHours: ageHours,
        counts: {
          responsibilities: Number(meta.RESPONSIBILITY_COUNT || 0),
          projects: Number(meta.PROJECT_COUNT || 0),
          subprojects: Number(meta.SUBPROJECT_COUNT || 0),
          tasks: Number(meta.TASK_COUNT || 0),
          milestones: Number(meta.MILESTONE_COUNT || 0)
        }
      };
    } catch (error) {
      result.error = String((error && error.message) || error).slice(0, 200);
    }
    return result;
  }

  /**
   * Publication settings live in AUTOMATION_SETTINGS and are independent of email mode.
   * Enabling publication is an ADMIN decision and requires an initialized destination.
   */
  function saveSettings(changes, actorEmail, confirmation) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Publication settings payload required');
    Object.keys(changes).forEach(function (key) {
      if (key !== 'SHARED_DASHBOARD_PUBLISH_ENABLED' && key !== 'SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES') {
        throw new Error('Not a shared dashboard publication setting: ' + key);
      }
    });
    var before = AutomationSettings.get();
    var enabling = changes.SHARED_DASHBOARD_PUBLISH_ENABLED === true && before.SHARED_DASHBOARD_PUBLISH_ENABLED !== true;
    if (enabling) {
      var admin = Access.requireAdmin(actorEmail);
      if (confirmation !== 'ENABLE SHARED DASHBOARD PUBLICATION') {
        throw new Error('Explicit confirmation required: ENABLE SHARED DASHBOARD PUBLICATION');
      }
      if (!destinationConfigured()) throw new Error('Configure the snapshot destination in Script Properties first');
      var opened = openDestination();
      if (!readMeta(opened.book)) throw new Error('Snapshot workbook is not initialized; initialize it first');
      var result = AutomationSettings.save(changes, actorEmail);
      AutomationSettings.setStatus('SHARED_DASHBOARD_PUBLISH_APPROVED_BY', admin.email);
      AuditLog.write('SHARED_DASHBOARD_PUBLICATION_APPROVED', 'SHARED_DASHBOARD', 'SHARED_DASHBOARD_PUBLISH_ENABLED',
        {actor: admin.email, interval: AutomationSettings.get().SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES});
      return result;
    }
    var saved = AutomationSettings.save(changes, actorEmail);
    if (changes.SHARED_DASHBOARD_PUBLISH_ENABLED === false && before.SHARED_DASHBOARD_PUBLISH_ENABLED === true) {
      AuditLog.write('SHARED_DASHBOARD_PUBLICATION_DISABLED', 'SHARED_DASHBOARD', 'SHARED_DASHBOARD_PUBLISH_ENABLED',
        {actor: Roles.verifiedEmail()});
    }
    return saved;
  }

  /**
   * Prepares a brand-new, empty snapshot workbook. Administrator only, explicit
   * confirmation, no content may already exist, and never an operational workbook.
   */
  function initialize(confirmation, actorEmail) {
    var admin = Access.requireAdmin(actorEmail);
    return Database.withLock(function () {
      var config = Config.get();
      var id = destinationId();
      if (String(id) === String(config.spreadsheetId)) throw new Error('Snapshot destination must not be the master workbook');
      if (confirmation !== 'INITIALIZE SHARED DASHBOARD ' + id) {
        throw new Error('Explicit snapshot initialization confirmation required');
      }
      var book = SpreadsheetApp.openById(id);
      assertSnapshotDestination(book, config.spreadsheetId);
      book.getSheets().forEach(function (sheet) {
        var range = sheet.getDataRange();
        var occupied = range.getValues().some(function (row) { return row.some(function (value) { return value !== ''; }); }) ||
          range.getFormulas().some(function (row) { return row.some(Boolean); });
        if (occupied) throw new Error('Snapshot initialization refuses a spreadsheet that already contains content');
      });
      if (!book.getSheetByName(META_SHEET)) book.insertSheet(META_SHEET);
      TABLES.forEach(function (table) {
        SLOTS.forEach(function (slot) {
          var name = slotSheet(table.sheet, slot);
          if (book.getSheetByName(name)) return;
          var sheet = book.insertSheet(name);
          sheet.getRange(1, 1, 1, table.fields.length).setValues([table.fields]);
        });
      });
      writeMeta(book, {
        CONTRACT_VERSION: CONTRACT_VERSION, ACTIVE_SLOT: '', SNAPSHOT_VERSION: 0,
        PUBLISHED_AT: '', PUBLISHER_VERSION: PUBLISHER_VERSION, CONTENT_HASH: '', AS_OF: '',
        PREVIOUS_SLOT: '', RESPONSIBILITY_COUNT: 0, PROJECT_COUNT: 0, SUBPROJECT_COUNT: 0, TASK_COUNT: 0,
        MILESTONE_COUNT: 0, RESULT: 'INITIALIZED'
      });
      AuditLog.write('SHARED_DASHBOARD_INITIALIZED', 'SHARED_DASHBOARD_WORKBOOK', '', {
        actor: admin.email, contractVersion: CONTRACT_VERSION
      });
      return {initialized: true, contractVersion: CONTRACT_VERSION, sheets: 1 + TABLES.length * SLOTS.length};
    });
  }

  /** Installable-trigger entrypoint. Publication OFF suppresses it entirely. */
  function scheduled() {
    try {
      return publish({mode: 'SCHEDULED'});
    } catch (error) {
      console.error('Scheduled shared dashboard publication failed: ' + error.message);
      return {published: false, mode: 'SCHEDULED', reason: 'FAILED', error: String(error.message || error).slice(0, 200)};
    }
  }

  return {
    PUBLISHER_VERSION: PUBLISHER_VERSION,
    DESTINATION_PROPERTY: DESTINATION_PROPERTY,
    META_SHEET: META_SHEET,
    META_KEYS: META_KEYS,
    TABLES: TABLES,
    publish: publish,
    preview: preview,
    status: status,
    saveSettings: saveSettings,
    initialize: initialize,
    scheduled: scheduled,
    destinationConfigured: destinationConfigured,
    slotSheet: slotSheet
  };
}());

function publishSharedDashboard() {
  return SharedDashboardPublisher.publish({mode: 'MANUAL', actorEmail: Roles.verifiedEmail()});
}
function previewSharedDashboardPublication() {
  Access.requireManager(Roles.verifiedEmail());
  return SharedDashboardPublisher.preview();
}
function sharedDashboardPublicationStatus() {
  Access.requireManager(Roles.verifiedEmail());
  return SharedDashboardPublisher.status();
}
function saveSharedDashboardSettings(changes, confirmation) {
  return SharedDashboardPublisher.saveSettings(changes, Roles.verifiedEmail(), confirmation);
}
function initializeSharedDashboardSnapshot(confirmation) {
  return SharedDashboardPublisher.initialize(confirmation, Roles.verifiedEmail());
}
function scheduledSharedDashboardPublish() {
  return SharedDashboardPublisher.scheduled();
}
