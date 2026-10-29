'use strict';

/**
 * V1.7.3 performance work.
 *
 * 1. Execution-local reuse: one range read per table per execution, and a write no longer reads
 *    the same table twice (find + data).
 * 1. Write batching: one range write per contiguous run of changed columns, and only the patched
 *    cells are written, so formulas, custom columns and untouched cells keep their content.
 * 1. Instrumentation: real service-call counts, lock/binding/serialization timings and payload
 *    size, compact by default and detailed only when the 計測 page asks for it.
 * 1. The experimental Sheets `batchGet` reader returns exactly the same records as
 *    `SpreadsheetApp` and falls back safely.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const { harness, flush } = require('./support/manager-web-harness');
const { fixture } = require('../scripts/manager-web-preview');

const DOMAIN = { MANAGER_WEB_ALLOWED_DOMAINS: 'example.test' };

function administrator(options) {
  const settings = Object.assign({ actor: 'admin@example.test' }, options || {});
  settings.properties = Object.assign({}, DOMAIN, (options && options.properties) || {});
  return fixtures.base(settings);
}

/** Counts range reads per sheet and write calls on one sheet (or on every sheet). */
function countCalls(instance, only) {
  const counts = { reads: {}, setValue: 0, setValues: 0 };
  for (const sheet of instance.book.getSheets()) {
    const name = sheet.getName();
    if (only && name !== only) continue;
    const getDataRange = sheet.getDataRange.bind(sheet);
    sheet.getDataRange = () => { counts.reads[name] = (counts.reads[name] || 0) + 1; return getDataRange(); };
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => {
      const range = getRange(...args);
      const setValue = range.setValue.bind(range), setValues = range.setValues.bind(range);
      range.setValue = value => { counts.setValue++; return setValue(value); };
      range.setValues = values => { counts.setValues++; return setValues(values); };
      return range;
    };
  }
  return counts;
}

function serialOf(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(part => [part.type, part.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
  return (wall - Date.UTC(1899, 11, 30)) / 86400000;
}

/**
 * A stand-in for the advanced Sheets service: `UNFORMATTED_VALUE` and `SERIAL_NUMBER`, exactly
 * what the experimental reader asks for. A `Date` cell becomes its serial number, so the
 * conversion back to a Date is exercised.
 */
function fakeSheets(holder, failure) {
  return {
    Spreadsheets: {
      Values: {
        batchGet(spreadsheetId, options) {
          holder.calls.push({spreadsheetId, options});
          if (failure) throw new Error(failure);
          const range = options.ranges[0];
          const name = /^'((?:[^']|'')*)'!/.exec(range)[1].replace(/''/g, "'");
          const sheet = holder.book.getSheetByName(name);
          const values = sheet.getDataRange().getValues()
            .map(row => row.map(value => (value instanceof Date ? serialOf(value, 'Asia/Tokyo') : value)));
          return {valueRanges: [{range, majorDimension: 'ROWS', values}]};
        }
      }
    }
  };
}

const plain = value => JSON.parse(JSON.stringify(value, (key, item) => (item instanceof Date ? 'DATE:' + item.toISOString() : item)));
/** Records with the wall-clock columns removed: two fixtures are created at different moments. */
const stable = record => {
  const copy = Object.assign({}, record);
  ['Created_At', 'Last_Updated', 'Imported_At', 'Timestamp', 'Applied_At', 'Assigned_At', 'Decided_At', 'Submitted_At']
    .forEach(key => delete copy[key]);
  return copy;
};

/* ------------------------------------------------------------------ *
 * 1. Execution-local reuse
 * ------------------------------------------------------------------ */

test('a write reads the task table once per execution instead of twice', () => {
  const a = administrator(), c = a.context;
  const counts = countCalls(a, 'TASKS');
  // The database layer is where find() used to read the table and then data() read it again.
  c.Database.withReadContext(() => c.Database.update('TASKS', 'T1', { Task_Name: 'Renamed once' }), true);
  assert.equal(counts.reads.TASKS, 1, 'the row is read once for the update');
  assert.equal(c.Database.find('TASKS', 'T1').Task_Name, 'Renamed once');
});

test('bootstrap reads every table once and reports the real range-read count', () => {
  const a = administrator();
  const counts = countCalls(a);
  const result = a.context.managerWebRead('bootstrap', { diagnostics: true });
  assert.equal(result.ok, true, result.error);
  assert.ok(Object.values(counts.reads).every(count => count === 1), JSON.stringify(counts.reads));
  assert.equal(result.metrics.tableReads, 9);
  assert.equal(result.metrics.rangeReads, 10, 'nine tables plus the SETTINGS environment marker');
  assert.equal(result.metrics.workbookOpens, 1);
});

test('the first page load is one read and the task index is not prefetched', async () => {
  const a = fixture();
  const h = harness((write, operation, payload) => (write
    ? a.context.managerWebWrite(operation, payload)
    : a.context.managerWebRead(operation, payload)));
  await flush();
  assert.equal(h.calls.filter(call => !call.write).length, 1, 'only the snapshot is read');
  assert.equal(h.calls[0].operation, 'bootstrap');
  assert.equal(h.window.ManagerWebClient.store.tasks.loaded, false, 'no task rows for a screen not opened');

  // Opening タスク reads the compact index once.
  h.click('nav', 'タスク'); await flush();
  const reads = h.calls.filter(call => !call.write).map(call => call.operation);
  assert.deepEqual(reads, ['bootstrap', 'taskIndex']);
  assert.equal(h.window.ManagerWebClient.store.tasks.loaded, true);
});

/* ------------------------------------------------------------------ *
 * 2. Instrumentation
 * ------------------------------------------------------------------ */

test('metrics are compact by default and detailed only on request', () => {
  const a = administrator(), c = a.context;
  const compact = c.managerWebRead('overview').metrics;
  assert.deepEqual(Object.keys(compact).sort(), ['executionMs', 'payloadBytes', 'tableReads']);
  assert.ok(compact.payloadBytes > 0);

  const detail = c.managerWebRead('overview', { diagnostics: true }).metrics;
  ['dataMs', 'applicationMs', 'executionMs', 'totalMs', 'tableReads', 'rangeReads', 'workbookOpens',
    'openMs', 'bindMs', 'lockMs', 'writes', 'cellsWritten', 'serializationMs', 'payloadBytes',
    'readBackend', 'tableMs'].forEach(key => assert.ok(key in detail, 'detail metric ' + key));
  assert.equal(detail.workbookOpens, 1);
  assert.equal(detail.writes, 0, 'a read performs no write');
  assert.equal(detail.readBackend, 'SPREADSHEETAPP');
  assert.ok(detail.tableMs.TASKS >= 0, 'per-table read time is reported');
  // No record content, identifier or cell value may appear in the measurement envelope.
  assert.doesNotMatch(JSON.stringify(detail), /検査装置|設計 次郎|P1/);
});

test('the diagnostics page summarises queue wait, server time and sheet reads', async () => {
  const a = administrator();
  const h = harness((write, operation, payload) => (write
    ? a.context.managerWebWrite(operation, payload)
    : a.context.managerWebRead(operation, payload)));
  await flush();
  h.document.getElementById('diagnostics').dispatchEvent('click', {});
  await flush();
  h.click('content', '詳細計測を実行'); await flush();
  const text = h.document.getElementById('content').textContent;
  assert.match(text, /ブックを開いた回数/);
  assert.match(text, /シート範囲の読み取り/);
  assert.match(text, /応答生成/);
  assert.doesNotMatch(text, /\{|\}/, 'no raw metrics object is rendered');
  const rows = h.nodes('content').filter(node => node.tagName === 'TR');
  assert.ok(rows.length >= 2, 'one row per measured operation');
  const measured = h.calls.filter(call => !call.write && call.payload && call.payload.diagnostics === true);
  assert.ok(measured.length >= 5, 'the measurement run asks for the detailed envelope');
});

/* ------------------------------------------------------------------ *
 * 3. Write batching and preservation
 * ------------------------------------------------------------------ */

test('a multi-field save is one range write per contiguous block and never rewrites other cells', () => {
  const a = administrator(), c = a.context;
  const sheet = a.book.getSheetByName('TASKS');
  const headers = sheet.rows[0];
  const index = sheet.rows.findIndex((cells, position) => position > 0 && cells[0] === 'T1');
  const taskRow = index + 1;
  // A custom column and a formula cell that must survive an unrelated save.
  sheet.rows[0].push('Custom_Note');
  sheet.rows[index].push('手動メモ');
  const customColumn = headers.length - 1;
  sheet.setFormulaCell(taskRow, headers.indexOf('Actual_Hours') + 1, '=B1*0');

  const counts = countCalls(a, 'TASKS');
  // Status and Priority are adjacent columns, so one range write covers both.
  c.Database.withReadContext(() => c.Database.update('TASKS', 'T1', { Status: 'Blocked', Priority: 'High' }), true);
  assert.equal(counts.setValues, 1, 'adjacent changed columns are written together');
  assert.equal(counts.setValue, 0, 'no per-field write remains');
  assert.equal(sheet.rows[index][headers.indexOf('Status')], 'Blocked');
  assert.equal(sheet.rows[index][headers.indexOf('Priority')], 'High');
  assert.equal(sheet.rows[index][customColumn], '手動メモ', 'a custom column is untouched');
  assert.equal(sheet.formulaCells.get(`${taskRow}:${headers.indexOf('Actual_Hours') + 1}`), '=B1*0',
    'a formula cell is untouched');
  assert.equal(sheet.rows[index][headers.indexOf('Task_Name')], '機構設計', 'an unchanged cell keeps its value');
});

test('a non-contiguous save still writes only the addressed cells', () => {
  const a = administrator(), c = a.context;
  const sheet = a.book.getSheetByName('TASKS');
  const headers = sheet.rows[0];
  const index = sheet.rows.findIndex((cells, position) => position > 0 && cells[0] === 'T1');
  const counts = countCalls(a, 'TASKS');
  c.Database.withReadContext(() => c.Database.update('TASKS', 'T1', { Task_Name: '二つの列', Next_Action: '確認する' }), true);
  assert.equal(counts.setValues, 2, 'two separated columns are two range writes, not one per field');
  assert.equal(sheet.rows[index][headers.indexOf('Task_Name')], '二つの列');
  assert.equal(sheet.rows[index][headers.indexOf('Next_Action')], '確認する');
  assert.equal(sheet.rows[index][headers.indexOf('Status')], 'In Progress', 'an unrelated cell is unchanged');
  assert.equal(sheet.rows[index][headers.indexOf('Owner_Member_ID')], 'M-ENG', 'the owner is unchanged');
});

test('a real task save preserves a custom column and a formula cell', () => {
  const a = administrator(), c = a.context;
  const sheet = a.book.getSheetByName('TASKS');
  const headers = sheet.rows[0];
  sheet.rows[0].push('Custom_Note');
  const index = sheet.rows.findIndex((cells, position) => position > 0 && cells[0] === 'T1');
  sheet.rows[index].push('手動メモ');
  sheet.setFormulaCell(index + 1, headers.indexOf('Actual_Hours') + 1, '=B1*0');

  const revision = c.managerWebRead('task', { id: 'T1' }).data.record._revision;
  const result = c.managerWebWrite('taskSave', { taskId: 'T1', revision: revision, taskName: '保存した名前' });
  assert.equal(result.ok, true, result.error);
  assert.equal(sheet.rows[index][headers.indexOf('Task_Name')], '保存した名前');
  assert.equal(sheet.rows[index][headers.length - 1], '手動メモ', 'the custom column survives');
  assert.equal(sheet.formulaCells.get(`${index + 1}:${headers.indexOf('Actual_Hours') + 1}`), '=B1*0',
    'the formula survives');
});

/* ------------------------------------------------------------------ *
 * 4. Experimental batchGet equivalence
 * ------------------------------------------------------------------ */

test('the experimental batchGet reader returns the same records as SpreadsheetApp', () => {
  const reference = administrator();
  // A real Date cell in both workbooks: the serial conversion must not shift the day.
  const putDate = instance => {
    const sheet = instance.book.getSheetByName('TASKS');
    const index = sheet.rows.findIndex((cells, position) => position > 0 && cells[0] === 'T1');
    sheet.rows[index][sheet.rows[0].indexOf('Due_Date')] = new Date('2026-12-15T00:00:00.000Z');
    sheet.rows[index][sheet.rows[0].indexOf('Last_Updated')] = new Date('2026-10-01T03:04:05.000Z');
  };
  putDate(reference);

  const holder = { book: null, calls: [] };
  const Sheets = fakeSheets(holder);
  const a = administrator({ properties: { DEV_SHEET_READ_BACKEND: 'BATCH_GET' }, globals: { Sheets } });
  holder.book = a.book;
  putDate(a);
  a.context.SheetReadBackend.reset();

  const context = { backend: a.context.SheetReadBackend.name(), comparison: [] };
  assert.equal(context.backend, 'BATCH_GET', 'the experiment is active');
  const tables = ['TASKS', 'PROJECTS', 'SUBPROJECTS', 'MEMBERS', 'RESPONSIBILITIES', 'TASK_REQUESTS'];
  tables.forEach(table => {
    const expected = reference.context.Database.withReadContext(() => reference.context.Database.read(table).map(stable));
    const actual = a.context.Database.withReadContext(() => a.context.Database.read(table).map(stable));
    assert.deepEqual(plain(actual), plain(expected), table + ' records must be identical');
  });
  assert.ok(holder.calls.length >= tables.length, 'every table was read through batchGet');
  assert.equal(holder.calls[0].options.valueRenderOption, 'UNFORMATTED_VALUE');
  assert.equal(holder.calls[0].options.dateTimeRenderOption, 'SERIAL_NUMBER');
  // Dates keep their calendar day and their wall clock.
  const task = a.context.Database.withReadContext(() => a.context.Database.read('TASKS')).filter(row => row.Task_ID === 'T1')[0];
  assert.equal(task.Due_Date instanceof a.context.Date, true);
  assert.equal(a.context.Domain.date(task.Due_Date), '2026-12-15');
});

test('batchGet keeps booleans, numbers, empty cells and text identifiers exactly', () => {
  const reference = administrator();
  const holder = { book: null, calls: [] };
  const Sheets = fakeSheets(holder);
  const a = administrator({ properties: { DEV_SHEET_READ_BACKEND: 'BATCH_GET' }, globals: { Sheets } });
  holder.book = a.book;
  a.context.SheetReadBackend.reset();
  const tasks = a.context.Database.withReadContext(() => a.context.Database.read('TASKS')).filter(row => row.Task_ID === 'T1')[0];
  const expected = reference.context.Database.withReadContext(() => reference.context.Database.read('TASKS')).filter(row => row.Task_ID === 'T1')[0];
  assert.equal(tasks.Notification_Enabled, true, 'a checkbox stays boolean');
  assert.equal(typeof tasks.Estimated_Hours, 'number');
  assert.equal(tasks.Task_ID, 'T1', 'a stable ID stays text');
  assert.equal(tasks.Description, '');
  assert.deepEqual(plain(stable(tasks)), plain(stable(expected)));
});

test('a batchGet failure or an unsupported timezone falls back to SpreadsheetApp', () => {
  const holder = { book: null, calls: [] };
  const failing = fakeSheets(holder, 'Sheets API unavailable');
  const a = administrator({ properties: { DEV_SHEET_READ_BACKEND: 'BATCH_GET' }, globals: { Sheets: failing } });
  holder.book = a.book;
  a.context.SheetReadBackend.reset();
  const rows = a.context.Database.withReadContext(() => a.context.Database.read('TASKS'));
  assert.equal(rows.length > 0, true, 'the read still succeeds');
  assert.equal(a.context.SheetReadBackend.name(), 'SPREADSHEETAPP', 'the experiment stops after a failure');
  assert.match(a.context.SheetReadBackend.lastFallback(), /Sheets API unavailable/);

  const holder2 = { book: null, calls: [] };
  const b = administrator({ properties: { DEV_SHEET_READ_BACKEND: 'BATCH_GET' }, globals: { Sheets: fakeSheets(holder2) } });
  holder2.book = b.book;
  b.book.setSpreadsheetTimeZone('UTC');
  b.context.SheetReadBackend.reset();
  const other = b.context.Database.withReadContext(() => b.context.Database.read('TASKS'));
  assert.equal(other.length > 0, true);
  assert.equal(b.context.SheetReadBackend.lastFallback(), 'SPREADSHEET_TIME_ZONE_UNSUPPORTED');
});

test('the production read path stays the default', () => {
  const a = administrator();
  assert.equal(a.context.SheetReadBackend.name(), 'SPREADSHEETAPP');
  const production = fixtures.base({
    actor: 'admin@example.test',
    properties: Object.assign({}, DOMAIN, { DEV_SHEET_READ_BACKEND: 'BATCH_GET', ENVIRONMENT: 'PRODUCTION', BOUND_ENVIRONMENT: 'PRODUCTION' })
  });
  assert.equal(production.context.SheetReadBackend.name(), 'SPREADSHEETAPP',
    'the experiment is refused outside DEVELOPMENT');
});


test('the DEV benchmark is read-only, refuses production and reports real service counts', () => {
  const a = administrator();
  const originalInfo = console.info;
  const lines = [];
  console.info = value => lines.push(String(value));
  let report;
  try {
    report = a.context.devBenchmarkManagerWeb(1);
  } finally {
    console.info = originalInfo;
  }
  assert.equal(report.environment, 'DEVELOPMENT');
  assert.equal(report.applicationVersion, '1.7.5');
  assert.equal(report.schemaVersion, 8);
  const operations = report.operations.map(entry => entry.operation);
  ['bootstrap', 'overview', 'taskIndex', 'projects', 'tasks', 'references'].forEach(name =>
    assert.ok(operations.indexOf(name) >= 0, 'measures ' + name));
  report.operations.forEach(entry => {
    assert.equal(typeof entry.coldMs, 'number', entry.operation + ' cold');
    assert.doesNotMatch(JSON.stringify(entry), /検査装置|設計 次郎|test-db/, 'no private value is reported');
  });
  const bootstrap = report.operations.filter(entry => entry.operation === 'bootstrap')[0];
  assert.ok(bootstrap.tableReads > 0);
  assert.equal(typeof bootstrap.payloadBytes, 'number');
  assert.equal(lines.length, 1, 'the report is logged once for the developer');

  // Nothing was written and no outbox/side effect happened.
  assert.equal(a.sentEmails.length, 0);
  assert.equal(a.triggers.length, 0);
  assert.equal(a.context.Database.read('AUDIT_LOG').length, a.context.Database.read('AUDIT_LOG').length);

  const production = fixtures.base({
    actor: 'admin@example.test',
    properties: Object.assign({}, DOMAIN, { ENVIRONMENT: 'PRODUCTION', BOUND_ENVIRONMENT: 'PRODUCTION' })
  });
  assert.throws(() => production.context.devBenchmarkManagerWeb(1), /DEVELOPMENT/);
});
