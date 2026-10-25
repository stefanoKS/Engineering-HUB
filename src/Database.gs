var Database = (function () {
  function book() {
    var config = Config.get(), spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
    var settings = spreadsheet.getSheetByName('SETTINGS');
    if (settings && settings.getLastRow() > 1) {
      var values = settings.getDataRange().getValues(), headers = values[0];
      var marker = values.slice(1).filter(function (row) { return row[headers.indexOf('Setting_ID')] === 'DATABASE_ENVIRONMENT'; });
      if (marker.length > 1 || marker.length && marker[0][headers.indexOf('Name')] !== config.environment) throw new Error('Workbook environment mismatch');
    }
    return spreadsheet;
  }
  function withLock(fn) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try { return fn(); } finally { lock.releaseLock(); }
  }
  function ensureSize(sheet, rows, columns) {
    if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
    if (sheet.getMaxColumns() < columns) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
  }
  function definition(name) {
    if (!Schema.tables[name]) throw new Error('Unknown operational table: ' + name);
    return Schema.tables[name];
  }
  function data(name) {
    definition(name);
    var sheet = book().getSheetByName(name);
    if (!sheet) throw new Error('Missing table: ' + name + '; run approved migration');
    var values = sheet.getDataRange().getValues();
    var headers = values[0] || [];
    if (headers.some(function (h, i) { return !h || headers.indexOf(h) !== i; })) throw new Error('Invalid headers: ' + name);
    return { sheet: sheet, values: values, headers: headers };
  }
  function read(name) {
    var d = data(name);
    return d.values.slice(1).filter(function (row) { return row.some(function (v) { return v !== ''; }); }).map(function (row) {
      var obj = {};
      d.headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
  }
  function find(name, id) {
    var key = definition(name).id;
    var matches = read(name).filter(function (row) { return row[key] === id; });
    if (matches.length > 1) throw new Error('Duplicate stable ID: ' + id);
    return matches[0] || null;
  }
  function blank(v) { return v === '' || v === null || v === undefined; }
  function validate(name, obj, references) {
    var def = definition(name);
    Object.keys(obj).forEach(function (key) {
      if (!def.fields.some(function (f) { return f.name === key; })) throw new Error('Unknown field: ' + key);
    });
    def.fields.forEach(function (f) {
      var v = obj[f.name];
      if (blank(v)) { if (f.required) throw new Error('Required field: ' + f.name); return; }
      if (f.values && f.values.indexOf(v) < 0) throw new Error('Invalid enum: ' + f.name);
      if (f.type === 'string' && typeof v !== 'string') throw new Error('Invalid text: ' + f.name);
      if (f.type === 'number' && (typeof v !== 'number' || !isFinite(v))) throw new Error('Invalid number: ' + f.name);
      if (f.integer && !Number.isInteger(v)) throw new Error('Integer required: ' + f.name);
      if (f.min !== undefined && v < f.min || f.max !== undefined && v > f.max) throw new Error('Out of range: ' + f.name);
      if (f.type === 'boolean' && typeof v !== 'boolean') throw new Error('Invalid boolean: ' + f.name);
      if (f.type === 'date' || f.type === 'datetime') {
        var text = v instanceof Date ? Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd') : String(v);
        if (!/^\d{4}-\d{2}-\d{2}($|T)/.test(text) || !isFinite(Date.parse(text))) throw new Error('Invalid date: ' + f.name);
        if (f.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(text).toISOString().slice(0, 10) !== text) throw new Error('Invalid calendar date: ' + f.name);
      }
      if (f.ref) {
        if (references && !references[f.ref]) {
          references[f.ref] = new Set(read(f.ref).map(function (row) { return row[definition(f.ref).id]; }));
        }
        if (references ? !references[f.ref].has(v) : !find(f.ref, v)) throw new Error('Invalid reference: ' + f.name);
      }
    });
    return obj;
  }
  function cell(v) {
    // Operational text must remain text, never a user-supplied Sheets formula.
    return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
  }
  function insert(name, values) {
    var def = definition(name);
    var obj = {};
    def.fields.forEach(function (f) {
      obj[f.name] = f.defaultValue === 'NOW' ? new Date().toISOString() : f.defaultValue;
    });
    Object.assign(obj, values);
    obj[def.id] = obj[def.id] || name.replace(/S$/, '') + '_' + Utilities.getUuid();
    if (find(name, obj[def.id])) throw new Error('Duplicate ID');
    validate(name, obj);
    var d = data(name);
    def.fields.forEach(function (f) { if (d.headers.indexOf(f.name) < 0) throw new Error('Missing column: ' + f.name); });
    ensureSize(d.sheet, d.sheet.getLastRow() + 1, d.headers.length);
    d.sheet.getRange(d.sheet.getLastRow() + 1, 1, 1, d.headers.length).setValues([d.headers.map(function (h) { return cell(obj[h] === undefined ? '' : obj[h]); })]);
    return obj;
  }
  function update(name, id, patch) {
    var def = definition(name);
    if (Object.prototype.hasOwnProperty.call(patch, def.id) && patch[def.id] !== id) throw new Error('Stable ID is immutable');
    var previous = find(name, id);
    if (!previous) throw new Error('Record not found: ' + id);
    // Preserve unknown, user-maintained columns without treating them as application fields.
    var known = {};
    def.fields.forEach(function (f) { known[f.name] = previous[f.name]; });
    var obj = validate(name, Object.assign(known, patch));
    var d = data(name), index = d.values.findIndex(function (row, i) { return i > 0 && row[d.headers.indexOf(def.id)] === id; });
    Object.keys(patch).forEach(function (key) {
      var col = d.headers.indexOf(key);
      if (col < 0) throw new Error('Missing column: ' + key);
    });
    // Only explicit fields are written: formulas and manually maintained cells remain untouched.
    Object.keys(patch).forEach(function (key) { d.sheet.getRange(index + 1, d.headers.indexOf(key) + 1).setValue(cell(obj[key])); });
    return Object.assign(previous, obj);
  }
  function updateMany(name, changes) {
    var def = definition(name), d = data(name), idColumn = d.headers.indexOf(def.id);
    var positions = new Map(), references = {}, columns = {}, seen = new Set();
    d.values.slice(1).forEach(function (row, i) {
      if (row[idColumn]) {
        if (positions.has(row[idColumn])) throw new Error('Duplicate stable ID');
        positions.set(row[idColumn], i + 1);
      }
    });
    var results = changes.map(function (change) {
      if (seen.has(change.id)) throw new Error('Duplicate update request');
      seen.add(change.id);
      if (!positions.has(change.id)) throw new Error('Record not found: ' + change.id);
      if (Object.prototype.hasOwnProperty.call(change.patch, def.id) && change.patch[def.id] !== change.id) throw new Error('Stable ID is immutable');
      var rowIndex = positions.get(change.id), obj = {};
      def.fields.forEach(function (f) { obj[f.name] = d.values[rowIndex][d.headers.indexOf(f.name)]; });
      Object.assign(obj, change.patch);
      validate(name, obj, references);
      Object.keys(change.patch).forEach(function (key) {
        var column = d.headers.indexOf(key);
        if (column < 0) throw new Error('Missing column: ' + key);
        if (!columns[column]) columns[column] = [];
        columns[column].push({ row: rowIndex + 1, value: cell(obj[key]) });
      });
      return obj;
    });
    // Validate the complete batch before writing; never rewrite untouched cells.
    Object.keys(columns).forEach(function (key) {
      var entries = columns[key].sort(function (a, b) { return a.row - b.row; });
      var start = 0;
      while (start < entries.length) {
        var end = start + 1;
        while (end < entries.length && entries[end].row === entries[end - 1].row + 1) end++;
        d.sheet.getRange(entries[start].row, Number(key) + 1, end - start, 1).setValues(entries.slice(start, end).map(function (entry) { return [entry.value]; }));
        start = end;
      }
    });
    return results;
  }
  function writeGenerated(name, rows) {
    if (Schema.generated.indexOf(name) < 0) throw new Error('Not a generated sheet');
    var sheet = book().getSheetByName(name) || book().insertSheet(name);
    sheet.clearContents();
    if (rows.length && rows[0].length) {
      ensureSize(sheet, rows.length, rows[0].length);
      sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows.map(function (row) { return row.map(cell); }));
    }
    sheet.setFrozenRows(1);
    return sheet;
  }
  return { book: book, read: read, find: find, insert: insert, update: update, validate: validate,
    withLock: withLock, writeGenerated: writeGenerated, ensureSize: ensureSize, updateMany: updateMany };
}());
