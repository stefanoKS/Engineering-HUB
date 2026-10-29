/**
 * Experimental table-read backend (V1.7.3, PHASE 4).
 *
 * `SpreadsheetApp` is the only production read path. This module exists so a development
 * deployment can *measure* whether the Sheets API `spreadsheets.values.batchGet` reduces real
 * remote calls, without changing what the application stores or publishes.
 *
 * Safety properties:
 * - Default is `SPREADSHEETAPP`. The experimental path requires the explicit script property
 *   `DEV_SHEET_READ_BACKEND=BATCH_GET`, `ENVIRONMENT=DEVELOPMENT`, the advanced Sheets service
 *   being available and the spreadsheet timezone being Asia/Tokyo. Anything else silently keeps
 *   the production path.
 * - Any failure falls back to `SpreadsheetApp` for that table and records the reason; a read
 *   never becomes unavailable because of the experiment.
 * - Only date/datetime columns declared in `Schema` are converted from Sheets serial numbers, so
 *   a numeric column never turns into a date and a text identifier never turns into a number.
 * - Nothing here writes, and no additional OAuth scope is requested.
 */
var SheetReadBackend = (function () {
  var PROPERTY = 'DEV_SHEET_READ_BACKEND';
  var BATCH = 'BATCH_GET';
  var PRODUCTION = 'SPREADSHEETAPP';
  var REQUIRED_TIME_ZONE = 'Asia/Tokyo';
  // Execution-local only: one Apps Script execution reads the properties once.
  var selected = null, fallbackReason = '';

  function property(key) {
    try { return String(PropertiesService.getScriptProperties().getProperty(key) || '').trim(); }
    catch (error) { return ''; }
  }

  function name() {
    if (selected) return selected;
    if (property(PROPERTY).toUpperCase() !== BATCH) { selected = PRODUCTION; return selected; }
    if (property('ENVIRONMENT').toUpperCase() !== 'DEVELOPMENT') { selected = PRODUCTION; return selected; }
    if (typeof Sheets === 'undefined' || !Sheets.Spreadsheets || !Sheets.Spreadsheets.Values) {
      selected = PRODUCTION; fallbackReason = 'ADVANCED_SERVICE_UNAVAILABLE'; return selected;
    }
    selected = BATCH;
    return selected;
  }

  function reset() { selected = null; fallbackReason = ''; }
  function lastFallback() { return fallbackReason; }

  function columnLetter(column) {
    var letter = '', value = Number(column);
    while (value > 0) {
      var remainder = (value - 1) % 26;
      letter = String.fromCharCode(65 + remainder) + letter;
      value = Math.floor((value - 1) / 26);
    }
    return letter || 'A';
  }

  function sheetRange(sheet) {
    return "'" + String(sheet.getName()).replace(/'/g, "''") + "'!A:" + columnLetter(sheet.getMaxColumns());
  }

  /**
   * Converts a Sheets serial number to the `Date` object `SpreadsheetApp` would return.
   *
   * The serial counts days from 1899-12-30 with no timezone. The wall clock is interpreted in
   * Asia/Tokyo, which is the only timezone this application supports, so a date-only cell keeps
   * its calendar day and a datetime keeps its wall clock.
   */
  function serialDate(serial) {
    // The serial counts days from 1899-12-30 and encodes a wall clock without a timezone, so it
    // is first read as if it were UTC, then shifted by the Asia/Tokyo offset at that instant.
    var wallMs = Date.UTC(1899, 11, 30) + Math.round(serial * 86400000);
    var offset = Date.parse(Utilities.formatDate(new Date(wallMs), REQUIRED_TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ss") + 'Z') - wallMs;
    return new Date(wallMs - offset);
  }

  /** Date/datetime columns of one table, keyed by header name. */
  function dateColumns(table, headers) {
    var fields = (Schema.tables[table] || {fields: []}).fields, types = Object.create(null);
    headers.forEach(function (header) {
      var field = fields.filter(function (f) { return f.name === header; })[0];
      if (field && (field.type === 'date' || field.type === 'datetime')) types[header] = field.type;
    });
    return types;
  }

  function normalize(table, rows) {
    var headers = (rows[0] || []).map(function (value) { return String(value); });
    var dates = dateColumns(table, headers), width = headers.length;
    return rows.map(function (row) {
      var out = [];
      for (var index = 0; index < width; index++) {
        var value = row[index];
        var type = dates[headers[index]];
        if (type && typeof value === 'number') value = serialDate(value);
        out.push(value === undefined || value === null ? '' : value);
      }
      return out;
    });
  }

  function batchValues(table, sheet) {
    if (String(sheet.getParent().getSpreadsheetTimeZone()) !== REQUIRED_TIME_ZONE) {
      fallbackReason = 'SPREADSHEET_TIME_ZONE_UNSUPPORTED';
      return null;
    }
    var response = Sheets.Spreadsheets.Values.batchGet(sheet.getParent().getId(), {
      ranges: [sheetRange(sheet)],
      majorDimension: 'ROWS',
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER'
    });
    var valueRange = response && response.valueRanges && response.valueRanges[0];
    var rows = valueRange && valueRange.values ? valueRange.values : [];
    if (!rows.length) return [];
    return normalize(table, rows);
  }

  /**
   * Values of one table, exactly as `getDataRange().getValues()` would return them.
   *
   * @param {string} table operational table name (used for the declared date columns)
   * @param {Object} sheet the bound sheet
   * @returns {Array<Array<*>>} cell values, header row first
   */
  function values(table, sheet) {
    if (name() !== BATCH) return sheet.getDataRange().getValues();
    try {
      var result = batchValues(table, sheet);
      if (result) return result;
    } catch (error) {
      fallbackReason = String(error && error.message ? error.message : error).slice(0, 120);
    }
    // Fail safe: the experiment never makes a table unreadable.
    selected = PRODUCTION;
    return sheet.getDataRange().getValues();
  }

  return {name: name, values: values, reset: reset, lastFallback: lastFallback, serialDate: serialDate};
}());
