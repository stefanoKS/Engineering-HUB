'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function chainBuilder() {
  return new Proxy({}, {
    get(target, key) {
      if (key === 'build' || key === 'copy') return () => chainBuilder();
      return (...args) => { target[key] = args; return chainBuilder(); };
    }
  });
}

class MockRange {
  constructor(sheet, row, column, rows = 1, columns = 1) {
    if (row < 1 || column < 1 || rows < 1 || columns < 1) throw new Error('Invalid range');
    Object.assign(this, { sheet, row, column, rows, columns });
  }
  getValues() {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.columns }, (_, c) =>
        this.sheet.rows[this.row + r - 1]?.[this.column + c - 1] ?? ''));
  }
  getDisplayValues() { return this.getValues().map(row => row.map(String)); }
  getValue() { return this.getValues()[0][0]; }
  setValue(value) { return this.setValues(Array.from({ length: this.rows }, () => Array(this.columns).fill(value))); }
  setValues(values) {
    if (values.length !== this.rows || values.some(row => row.length !== this.columns)) {
      throw new Error('Range dimensions do not match values');
    }
    values.forEach((row, r) => row.forEach((value, c) => {
      const index = this.row + r - 1;
      this.sheet.rows[index] ||= [];
      this.sheet.rows[index][this.column + c - 1] = value;
    }));
    return this;
  }
  clearContent() { return this.setValue(''); }
  clear() { return this.clearContent(); }
  getRow() { return this.row; }
  getColumn() { return this.column; }
  getNumRows() { return this.rows; }
  getNumColumns() { return this.columns; }
  getSheet() { return this.sheet; }
  getA1Notation() { return `R${this.row}C${this.column}`; }
  setFormula(formula) { return this.setValue(formula); }
  setFormulas(values) { return this.setValues(values); }
  getFormula() { return this.getFormulas()[0][0]; }
  // A prefilled formula may evaluate to '' (for example =IF($A2="","",$B2)); Sheets still counts
  // that cell as content. Tests may register such a formula with MockSheet.setFormulaCell.
  getFormulas() {
    const values = this.getValues();
    return values.map((row, r) => row.map((value, c) =>
      this.sheet.formulaCells.get(`${this.row + r}:${this.column + c}`) ??
      (typeof value === 'string' && value.startsWith('=') ? value : '')));
  }
  createFilter() { this.sheet.filter = { remove: () => { this.sheet.filter = null; } }; return this.sheet.filter; }
  getFilter() { return this.sheet.filter; }
  sort(spec) {
    const specifications = Array.isArray(spec) ? spec : [spec];
    const values = this.getValues().sort((a, b) => {
      for (const item of specifications) {
        const column = typeof item === 'number' ? item : item.column;
        const direction = typeof item === 'number' || item.ascending !== false ? 1 : -1;
        const x = a[column - this.column], y = b[column - this.column];
        if (x < y) return -direction;
        if (x > y) return direction;
      }
      return 0;
    });
    return this.setValues(values);
  }
}
for (const method of ['setFontWeight', 'setFontColor', 'setFontSize', 'setFontFamily',
  'setBackground', 'setBackgrounds', 'setNumberFormat', 'setNumberFormats', 'setWrap',
  'setHorizontalAlignment', 'setVerticalAlignment', 'setBorder', 'setDataValidation',
  'setDataValidations', 'clearDataValidations', 'setNote', 'setNotes', 'merge', 'breakApart']) {
  MockRange.prototype[method] = function (...args) {
    this.sheet.formatting.push({ method, row: this.row, column: this.column, args });
    return this;
  };
}

function parseA1(notation, sheet) {
  const match = /^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/i.exec(notation);
  if (!match) throw new Error(`Unsupported A1 range: ${notation}`);
  const col = text => [...text.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const row = Number(match[2] || 1);
  const column = col(match[1]);
  return [row, column, match[3] ? Number(match[4] || sheet.getMaxRows()) - row + 1 : 1,
    match[3] ? col(match[3]) - column + 1 : 1];
}

class MockSheet {
  constructor(name, rows = [], book = null) {
    this.name = name;
    this.rows = rows.map(row => [...row]);
    this.book = book;
    this.formatting = [];
    this.charts = [];
    this.rules = [];
    this.formulaCells = new Map();
    this.filter = null;
    this.maxRows = Math.max(1000, this.rows.length);
    this.maxColumns = Math.max(26, ...this.rows.map(row => row.length));
  }
  getName() { return this.name; }
  setName(name) {
    if (this.book?.getSheetByName(name) && this.name !== name) throw new Error(`Sheet exists: ${name}`);
    this.name = name; return this;
  }
  getSheetId() { return this.book ? this.book.sheets.indexOf(this) + 1 : 1; }
  getParent() { return this.book; }
  getLastRow() {
    let last = 0;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i]?.some(v => v !== '' && v !== null && v !== undefined)) { last = i + 1; break; }
    }
    for (const key of this.formulaCells.keys()) last = Math.max(last, Number(key.split(':')[0]));
    return last;
  }
  getLastColumn() {
    let used = this.rows.reduce((max, row) => {
      for (let i = row.length - 1; i >= 0; i--) {
        if (row[i] !== '' && row[i] !== null && row[i] !== undefined) return Math.max(max, i + 1);
      }
      return max;
    }, 0);
    for (const key of this.formulaCells.keys()) used = Math.max(used, Number(key.split(':')[1]));
    return used;
  }
  /** Registers a formula whose evaluated value stays blank, as Sheets reports for prefilled rows. */
  setFormulaCell(row, column, formula) {
    this.formulaCells.set(`${row}:${column}`, formula);
    return this;
  }
  getMaxRows() { return this.maxRows; }
  // Sheets guarantees the grid is at least as wide as its widest row; keep the mock faithful
  // so a migration appends columns instead of shifting user-added ones.
  getMaxColumns() { return Math.max(this.maxColumns, ...this.rows.map(row => row.length), 0); }
  insertRowsAfter(position, count) {
    if (!Number.isInteger(position) || position < 1 || position > this.maxRows ||
        !Number.isInteger(count) || count < 1) throw new Error('Invalid row insertion');
    if (position < this.rows.length) this.rows.splice(position, 0, ...Array.from({ length: count }, () => []));
    this.maxRows += count;
    return this;
  }
  insertColumnsAfter(position, count) {
    if (!Number.isInteger(position) || position < 1 || position > this.maxColumns ||
        !Number.isInteger(count) || count < 1) throw new Error('Invalid column insertion');
    for (const row of this.rows) {
      if (position < row.length) row.splice(position, 0, ...Array(count).fill(''));
    }
    this.maxColumns += count;
    return this;
  }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(row, column, rows = 1, columns = 1) {
    return new MockRange(this, ...(typeof row === 'string' ? parseA1(row, this) : [row, column, rows, columns]));
  }
  appendRow(row) { this.getRange(this.getLastRow() + 1, 1, 1, row.length).setValues([row]); return this; }
  /**
   * Sheets removes a whole row and shifts the rows below it up. The mock keeps that semantic so
   * a reviewed deletion path can be exercised locally; only Deletion.gs may call it.
   */
  deleteRow(position) {
    if (!Number.isInteger(position) || position < 1 || position > this.getMaxRows()) {
      throw new Error('Invalid row deletion');
    }
    if (position <= this.rows.length) this.rows.splice(position - 1, 1);
    this.maxRows = Math.max(1, this.maxRows - 1);
    const shifted = new Map();
    this.formulaCells.forEach((formula, key) => {
      const [row, column] = key.split(':').map(Number);
      if (row === position) return;
      shifted.set(`${row > position ? row - 1 : row}:${column}`, formula);
    });
    this.formulaCells = shifted;
    return this;
  }
  clearContents() { this.rows = []; this.formulaCells.clear(); return this; }
  clear() { return this.clearContents(); }
  getFilter() { return this.filter; }
  getCharts() { return [...this.charts]; }
  newChart() { return chainBuilder(); }
  insertChart(chart) { this.charts.push(chart); return this; }
  removeChart(chart) { this.charts = this.charts.filter(item => item !== chart); return this; }
  setConditionalFormatRules(rules) { this.rules = rules; return this; }
  getConditionalFormatRules() { return this.rules; }
  setFrozenRows(count) { this.frozenRows = count; return this; }
  getFrozenRows() { return this.frozenRows || 0; }
}
for (const method of ['autoResizeColumns', 'setColumnWidth', 'setColumnWidths', 'setRowHeight',
  'setRowHeights', 'setFrozenColumns', 'hideColumns', 'showColumns', 'setTabColor',
  'activate']) {
  MockSheet.prototype[method] = function () { return this; };
}

class MockSpreadsheet {
  constructor(id = 'test-db', sheets = {}) {
    this.id = id;
    this.name = 'Engineering HUB Test';
    this.sheets = Object.entries(sheets).map(([name, rows]) => new MockSheet(name, rows, this));
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}/edit`; }
  getSheets() { return [...this.sheets]; }
  getSheetByName(name) { return this.sheets.find(sheet => sheet.name === name) || null; }
  getActiveSheet() { return this.sheets[0] || null; }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error(`Sheet exists: ${name}`);
    const sheet = new MockSheet(name, [], this);
    this.sheets.push(sheet);
    return sheet;
  }
  getSpreadsheetTimeZone() { return this.timeZone || 'Asia/Tokyo'; }
  setSpreadsheetTimeZone(timeZone) { this.timeZone = timeZone; return this; }
  toast() {}
}

function createGoogleMocks(options = {}) {
  const values = {
    ENVIRONMENT: 'DEVELOPMENT',
    SPREADSHEET_ID: 'test-db',
    BOUND_ENVIRONMENT: 'DEVELOPMENT',
    INITIALIZATION_SPREADSHEET_ID: 'test-db',
    ...options.properties
  };
  const properties = {
    getProperty: key => Object.hasOwn(values, key) ? String(values[key]) : null,
    getProperties: () => ({ ...values }),
    setProperty(key, value) { values[key] = String(value); return this; },
    setProperties(items, deleteAllOthers = false) {
      if (deleteAllOthers) this.deleteAllProperties();
      Object.entries(items).forEach(([key, value]) => this.setProperty(key, value));
      return this;
    },
    deleteProperty(key) { delete values[key]; return this; },
    deleteAllProperties() { Object.keys(values).forEach(key => delete values[key]); return this; }
  };
  const spreadsheet = options.spreadsheet || options.book || new MockSpreadsheet(options.spreadsheetId || 'test-db', options.sheets);
  const spreadsheets = new Map([[spreadsheet.getId(), spreadsheet]]);
  const sentEmails = [], backups = [], triggers = [], calendarEvents = [], uiSidebars = [];
  const calendars = new Map();
  const folders = new Map();
  const files = new Map();
  const actor = options.actor === undefined ? 'admin@example.test' : options.actor;
  // Tests may switch the simulated signed-in account without rebuilding the workbook.
  const identity = { current: actor };
  const lock = {
    held: false,
    tryLock() { if (options.lockAvailable === false || this.held) return false; this.held = true; return true; },
    waitLock() { if (!this.tryLock()) throw new Error('Lock unavailable'); },
    releaseLock() { this.held = false; },
    hasLock() { return this.held; }
  };
  // Script cache is process-local and expires by key on demand; tests inspect `store`.
  const cacheStore = new Map();
  const cache = {
    store: cacheStore,
    get(key) { return cacheStore.has(key) ? cacheStore.get(key) : null; },
    getAll(keys) { return Object.fromEntries(keys.filter(key => cacheStore.has(key)).map(key => [key, cacheStore.get(key)])); },
    put(key, value) { cacheStore.set(key, String(value)); return this; },
    putAll(values) { Object.entries(values).forEach(([key, value]) => this.put(key, value)); return this; },
    remove(key) { cacheStore.delete(key); return this; },
    removeAll(keys) { keys.forEach(key => cacheStore.delete(key)); return this; }
  };
  const iterator = items => {
    let index = 0;
    return { hasNext: () => index < items.length, next: () => {
      if (index >= items.length) throw new Error('Iterator exhausted');
      return items[index++];
    } };
  };
  function makeFile(id, name, parent) {
    const file = {
      id, name, parent,
      getId: () => id, getName: () => name,
      getUrl: () => `https://drive.google.com/file/d/${id}/view`,
      getParents: () => iterator(parent ? [parent] : []),
      getSharingAccess: () => 'PRIVATE',
      getSharingPermission: () => 'NONE',
      isTrashed: () => false,
      getEditors: () => [],
      getViewers: () => [],
      setDescription(description) { this.description = description; return this; },
      setSharing(access, permission) { this.sharingAccess = access; this.sharingPermission = permission; return this; },
      makeCopy(copyName, folder) {
        const copy = makeFile(`backup-${backups.length + 1}`, copyName, folder);
        backups.push(copy);
        files.set(copy.id, copy);
        if (spreadsheets.has(id)) {
          const original = spreadsheets.get(id);
          const cloned = new MockSpreadsheet(copy.id, Object.fromEntries(
            original.getSheets().map(sheet => [sheet.getName(), sheet.getDataRange().getValues()])
          ));
          original.getSheets().forEach(source => {
            const target = cloned.getSheetByName(source.getName());
            source.formulaCells.forEach((formula, key) => target.formulaCells.set(key, formula));
          });
          cloned.name = copyName;
          spreadsheets.set(copy.id, cloned);
        }
        return copy;
      },
      moveTo(folder) { this.parent = folder; return this; }
    };
    return file;
  }
  files.set(spreadsheet.getId(), makeFile(spreadsheet.getId(), spreadsheet.getName(), null));
  function addFolder(id, settings = {}) {
    const folder = {
      getId: () => id,
      getName: () => settings.name || id,
      getSharingAccess: () => settings.sharingAccess || 'PRIVATE',
      getSharingPermission: () => settings.sharingPermission || 'NONE',
      getEditors: () => settings.editors || [],
      getViewers: () => settings.viewers || [],
      getFiles: () => iterator([...files.values()].filter(file => file.parent === folder)),
      getFilesByName: name => iterator([...files.values()].filter(file => file.parent === folder && file.name === name))
    };
    folders.set(id, folder); return folder;
  }
  for (const [id, settings] of Object.entries(options.folders || {})) addFolder(id, settings);
  if (values.BACKUP_FOLDER_ID && !folders.has(values.BACKUP_FOLDER_ID)) addFolder(values.BACKUP_FOLDER_ID);
  function addCalendar(id, settings = {}) {
    const calendar = {
      getId: () => id,
      getName: () => settings.name || id,
      getEvents: () => calendarEvents.filter(event => event.calendarId === id && !event.deleted),
      getEventById: eventId => calendarEvents.find(event => event.id === eventId && event.calendarId === id && !event.deleted) || null,
      createEvent(title, start, end, eventOptions = {}) {
        const event = {
          id: `event-${calendarEvents.length + 1}`, calendarId: id, title, start, end, options: eventOptions,
          getId() { return this.id; },
          getTitle() { return this.title; },
          getDescription() { return this.options.description || ''; },
          setTitle(value) { this.title = value; return this; },
          setTime(a, b) { this.start = a; this.end = b; return this; },
          setAllDayDate(date) { this.start = date; this.end = date; this.allDay = true; return this; },
          setDescription(value) { this.options.description = value; return this; },
          deleteEvent() { this.deleted = true; },
          addPopupReminder() { return this; },
          addEmailReminder() { return this; },
          removeAllReminders() { return this; },
          setTag(key, value) { this.tags ||= {}; this.tags[key] = value; return this; },
          getTag(key) { return this.tags?.[key] || ''; }
        };
        calendarEvents.push(event); return event;
      }
    };
    calendar.createAllDayEvent = (title, date, eventOptions) => calendar.createEvent(title, date, date, eventOptions);
    calendars.set(id, calendar); return calendar;
  }
  for (const [id, settings] of Object.entries(options.calendars || {})) addCalendar(id, settings);
  if (values.CALENDAR_ID && !calendars.has(values.CALENDAR_ID)) addCalendar(values.CALENDAR_ID);
  const globals = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => options.activeSpreadsheet === null ? null : spreadsheet,
      getActive: () => options.activeSpreadsheet === null ? null : spreadsheet,
      openById(id) {
        if (!spreadsheets.has(id)) throw new Error(`Unknown spreadsheet: ${id}`);
        return spreadsheets.get(id);
      },
      flush() {},
      newDataValidation: chainBuilder,
      newConditionalFormatRule: chainBuilder,
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
      BorderStyle: { SOLID: 'SOLID' },
      WrapStrategy: { WRAP: 'WRAP' },
      getUi: () => ({
        createMenu: () => chainBuilder(),
        showSidebar: output => { uiSidebars.push(output); return output; },
        showModalDialog: output => { uiSidebars.push(output); return output; },
        toast: () => {},
        alert: () => 'YES', Button: { YES: 'YES', NO: 'NO' },
        ButtonSet: { YES_NO: 'YES_NO', OK: 'OK' }
      })
    },
    PropertiesService: {
      getScriptProperties: () => properties,
      getDocumentProperties: () => properties,
      getUserProperties: () => properties
    },
    LockService: { getScriptLock: () => lock, getDocumentLock: () => lock },
    Session: {
      getActiveUser: () => ({ getEmail: () => identity.current }),
      getEffectiveUser: () => ({ getEmail: () => options.effectiveActor || identity.current }),
      getScriptTimeZone: () => 'Asia/Tokyo'
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      sleep() {},
      DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' },
      Charset: { UTF_8: 'UTF-8' },
      computeDigest: (algorithm, text) => [...crypto.createHash(String(algorithm).toLowerCase().replace('_', '')).update(String(text)).digest()].map(n => n > 127 ? n - 256 : n),
      base64Encode: data => Buffer.from(data).toString('base64'),
      formatDate(date, timeZone, pattern) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
          timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
        }).formatToParts(new Date(date)).map(part => [part.type, part.value]));
        const tokens = { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second };
        return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, token => tokens[token]).replace(/'([^']*)'/g, '$1');
      }
    },
    MailApp: {
      getRemainingDailyQuota: () => options.emailQuota ?? 100,
      sendEmail(...args) {
        if (options.mailError) throw new Error(options.mailError);
        sentEmails.push(typeof args[0] === 'object' ? { ...args[0] } : { to: args[0], subject: args[1], body: args[2], ...args[3] });
      }
    },
    CalendarApp: {
      getCalendarById: id => calendars.get(id) || null,
      getDefaultCalendar: () => calendars.get('default') || addCalendar('default')
    },
    DriveApp: {
      Access: { PRIVATE: 'PRIVATE', ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN: 'DOMAIN', DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK' },
      Permission: { NONE: 'NONE', VIEW: 'VIEW', EDIT: 'EDIT' },
      getFileById(id) { if (!files.has(id)) throw new Error(`Unknown file: ${id}`); return files.get(id); },
      getFolderById(id) { if (!folders.has(id)) throw new Error(`Unknown folder: ${id}`); return folders.get(id); }
    },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger(trigger) { const i = triggers.indexOf(trigger); if (i >= 0) triggers.splice(i, 1); },
      newTrigger(handler) {
        const details = { handler };
        const builder = {
          timeBased() { return this; },
          everyDays(value) { details.everyDays = value; return this; },
          everyWeeks(value) { details.everyWeeks = value; return this; },
          everyHours(value) { details.everyHours = value; return this; },
          everyMinutes(value) { details.everyMinutes = value; return this; },
          atHour(value) { details.hour = value; return this; },
          nearMinute(value) { details.minute = value; return this; },
          inTimezone(value) { details.timeZone = value; return this; },
          onWeekDay(value) { details.weekDay = value; return this; },
          create() {
            const trigger = { ...details, getHandlerFunction: () => handler, getUniqueId: () => String(triggers.indexOf(trigger) + 1) };
            triggers.push(trigger); return trigger;
          }
        };
        return builder;
      },
      WeekDay: { SUNDAY: 'SUNDAY', MONDAY: 'MONDAY', TUESDAY: 'TUESDAY', WEDNESDAY: 'WEDNESDAY',
        THURSDAY: 'THURSDAY', FRIDAY: 'FRIDAY', SATURDAY: 'SATURDAY' }
    },
    HtmlService: {
      createHtmlOutputFromFile(name) {
        const file = path.join(__dirname, '../../', options.htmlDir || 'src', `${name}.html`);
        if (!fs.existsSync(file)) throw new Error(`Unknown HTML template: ${name}`);
        const content = fs.readFileSync(file, 'utf8');
        const output = {
          getContent: () => content,
          getTitle: () => output.title || '',
          setTitle(value) { output.title = value; return output; },
          setWidth() { return output; },
          setHeight() { return output; },
          setSandboxMode() { return output; },
          setXFrameOptionsMode() { return output; },
          setFaviconUrl() { return output; },
          addMetaTag() { return output; },
          append() { return output; }
        };
        return output;
      },
      createHtmlOutput(content) {
        const output = { getContent: () => content, setTitle() { return output; }, setWidth() { return output; }, setHeight() { return output; } };
        return output;
      },
      createTemplateFromFile(name) {
        // Resolve <?!= include('Partial') ?> scriptlets so tests see the real assembled page.
        const read = templateName => {
          const file = path.join(__dirname, '../../', options.htmlDir || 'src', `${templateName}.html`);
          if (!fs.existsSync(file)) throw new Error(`Unknown HTML template: ${templateName}`);
          return fs.readFileSync(file, 'utf8').replace(/<\?!=\s*include\('([^']+)'\)\s*\?>/g, (match, partial) => read(partial));
        };
        const content = read(name);
        let output = null;
        output = {
          getContent: () => content,
          getTitle: () => output.title || '',
          setTitle(value) { output.title = value; return output; },
          setWidth() { return output; },
          setHeight() { return output; },
          setSandboxMode() { return output; },
          setXFrameOptionsMode() { return output; },
          setFaviconUrl() { return output; },
          addMetaTag() { return output; },
          append() { return output; }
        };
        return { evaluate: () => output };
      }
    },
    Charts: { ChartType: { COLUMN: 'COLUMN', BAR: 'BAR', PIE: 'PIE', LINE: 'LINE' } },
    CacheService: {
      getScriptCache: () => cache,
      getDocumentCache: () => cache,
      getUserCache: () => cache
    },
    Logger: { log() {} }
  };
  return { globals, spreadsheet, book: spreadsheet, properties, sentEmails, calendars,
    calendarEvents, backups, triggers, folders, files, spreadsheets, lock, addFolder, addCalendar, uiSidebars, cache,
    setActor(value) { identity.current = value; return identity.current; },
    getActor() { return identity.current; } };
}

module.exports = { createGoogleMocks, MockSpreadsheet, MockSheet, MockRange };
