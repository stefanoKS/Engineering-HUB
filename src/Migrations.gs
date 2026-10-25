var Migrations = (function () {
  var registry = [
    { id: '002_task_assignment_safety', from: 1, to: 2 },
    { id: '003_management_reliability', from: 2, to: 3 },
    { id: '004_shared_dashboard', from: 3, to: 4 },
    { id: '005_task_planning_and_requests', from: 4, to: 5 }
  ];
  function currentVersion() {
    var sheet = Database.book().getSheetByName('SCHEMA_MIGRATIONS');
    if (!sheet) return 0;
    return Database.read('SCHEMA_MIGRATIONS').reduce(function (v, row) {
      return row.Result === 'SUCCESS' ? Math.max(v, Number(row.New_Version) || 0) : v;
    }, 0);
  }
  function addSchema() {
    var book = Database.book();
    Object.keys(Schema.tables).forEach(function (name) {
      var def = Schema.tables[name];
      var sheet = book.getSheetByName(name);
      if (!sheet) sheet = book.insertSheet(name);
      var headers = sheet.getLastRow() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
      if (headers.some(function (h, i) { return !h || headers.indexOf(h) !== i; })) throw new Error('Ambiguous headers in ' + name);
      var missing = def.fields.filter(function (f) { return headers.indexOf(f.name) < 0; });
      Database.ensureSize(sheet, Math.max(2, sheet.getLastRow()), headers.length + missing.length);
      if (missing.length) sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing.map(function (f) { return f.name; })]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length + missing.length).setFontWeight('bold').setBackground('#d9eaf7');
      def.fields.forEach(function (f) {
        var col = headers.concat(missing.map(function (item) { return item.name; })).indexOf(f.name) + 1;
        var range = sheet.getRange(2, col, Math.max(1, sheet.getMaxRows() - 1), 1);
        var rule = null;
        if (f.values) rule = SpreadsheetApp.newDataValidation().requireValueInList(f.values, true);
        if (f.type === 'boolean') rule = SpreadsheetApp.newDataValidation().requireCheckbox();
        if (f.min !== undefined && f.max !== undefined) rule = SpreadsheetApp.newDataValidation().requireNumberBetween(f.min, f.max);
        if (rule) range.setDataValidation(rule.setAllowInvalid(false).build());
      });
    });
    Schema.generated.forEach(function (name) { if (!book.getSheetByName(name)) book.insertSheet(name); });
  }
  function validateExisting() {
    Object.keys(Schema.tables).forEach(function (name) {
      var sheet = Database.book().getSheetByName(name);
      if (!sheet || !sheet.getLastRow()) return;
      var values = sheet.getDataRange().getValues(), headers = values[0], id = Schema.tables[name].id;
      if (headers.some(function (h, i) { return !h || headers.indexOf(h) !== i; })) throw new Error('Invalid headers: ' + name);
      var idCol = headers.indexOf(id);
      var rows = values.slice(1).filter(function (r) { return r.some(function (v) { return v !== ''; }); });
      if (rows.length && idCol < 0) throw new Error('Cannot infer permanent IDs in ' + name);
      var seen = {};
      rows.forEach(function (r) {
        var key = r[idCol];
        if (!key || seen[key]) throw new Error('Missing or duplicate stable ID in ' + name);
        seen[key] = true;
      });
    });
  }
  function verifyPreserved(before) {
    before.forEach(function (old) {
      var current = Database.book().getSheetByName(old.name);
      if (!current) throw new Error('Table disappeared: ' + old.name);
      var values = current.getDataRange().getValues(), formulas = current.getDataRange().getFormulas();
      old.values.forEach(function (row, r) {
        row.forEach(function (value, c) {
          if (JSON.stringify(value) !== JSON.stringify(values[r] && values[r][c]) ||
              old.formulas[r][c] !== (formulas[r] && formulas[r][c])) throw new Error('Preservation check failed: ' + old.name);
        });
      });
    });
  }
  function assertSchema() {
    Object.keys(Schema.tables).forEach(function (name) {
      var sheet = Database.book().getSheetByName(name);
      if (!sheet) throw new Error('Missing table: ' + name);
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      Schema.tables[name].fields.forEach(function (f) { if (headers.indexOf(f.name) < 0) throw new Error('Missing column: ' + name + '.' + f.name); });
    });
    validateExisting();
  }
  function upgrade() {
    return Database.withLock(function () {
      var version = currentVersion();
      if (!version) throw new Error('Unversioned workbook: administrator review/import migration required');
      if (version > Schema.version) throw new Error('Database is newer than this code');
      validateExisting();
      registry.forEach(function (m) {
        if (version !== m.from) return;
        var approved = Config.require('APPROVED_MIGRATIONS').split(',').map(function (s) { return s.trim(); });
        if (approved.indexOf(m.id) < 0) throw new Error('Migration not approved: ' + m.id);
        var reference = Backup.create();
        var before = Backup.snapshot(Database.book());
        try {
          addSchema();
          verifyPreserved(before);
          assertSchema();
          // Safe automation defaults are seeded once. Live mail is never enabled by a migration.
          if (m.id === '003_management_reliability') AutomationSettings.seedDefaults();
          Database.insert('SCHEMA_MIGRATIONS', { Migration_ID: m.id, Applied_At: new Date().toISOString(),
            Previous_Version: version, New_Version: m.to, Result: 'SUCCESS', Backup_Reference: reference });
          version = m.to;
        } catch (error) {
          console.error('Migration stopped; preserve workbook for inspection; backup=' + reference + '; ' + error.message);
          if (Database.book().getSheetByName('SCHEMA_MIGRATIONS')) {
            Database.insert('SCHEMA_MIGRATIONS', { Migration_ID: m.id + '_FAILED_' + Utilities.getUuid(),
              Applied_At: new Date().toISOString(), Previous_Version: version, New_Version: version,
              Result: 'FAILED', Backup_Reference: reference });
          }
          throw error;
        }
      });
      if (version !== Schema.version) throw new Error('No approved migration path');
      assertSchema();
      return version;
    });
  }
  return { registry: registry, currentVersion: currentVersion, addSchema: addSchema,
    assertSchema: assertSchema, upgrade: upgrade };
}());

function initializeNewDatabase(confirmation) {
  return Database.withLock(function () {
    var config = Config.get();
    if (Config.require('INITIALIZATION_SPREADSHEET_ID') !== config.spreadsheetId ||
        confirmation !== 'INITIALIZE ' + config.spreadsheetId) throw new Error('Explicit empty spreadsheet confirmation required');
    var book = Database.book();
    book.getSheets().forEach(function (sheet) {
      var range = sheet.getDataRange();
      if (range.getValues().some(function (row) { return row.some(function (v) { return v !== ''; }); }) ||
          range.getFormulas().some(function (row) { return row.some(Boolean); })) throw new Error('Initialization refuses any existing content');
    });
    book.setSpreadsheetTimeZone('Asia/Tokyo');
    Migrations.addSchema();
    Database.insert('SETTINGS', { Setting_ID: 'DATABASE_ENVIRONMENT', Name: config.environment,
      Description: 'Environment binding. Do not edit or copy between development and production.' });
    AutomationSettings.seedDefaults();
    Database.insert('SCHEMA_MIGRATIONS', { Migration_ID: 'INITIALIZE_V' + Schema.version, Applied_At: new Date().toISOString(),
      Previous_Version: 0, New_Version: Schema.version, Result: 'SUCCESS', Backup_Reference: 'NEW_EMPTY_DATABASE' });
    PropertiesService.getScriptProperties().deleteProperty('INITIALIZATION_SPREADSHEET_ID');
    return Schema.version;
  });
}

function upgradeExistingDatabase() { return Migrations.upgrade(); }
