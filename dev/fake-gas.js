// Apps Script 서비스를 메모리 안에서 흉내 낸다. 서버 코드(apps-script/*.gs)를 Node에서 그대로 돌려 보기 위한 것.
// 실제 구글·iCloud에는 아무것도 보내지 않는다. 외부 호출은 calls 배열에 기록만 한다.
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');

function seoulParts(date) {
  const o = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).forEach(p => { o[p.type] = p.value; });
  return o;
}

function makeSheet(name) {
  let rows = [];
  const sh = {
    name,
    getLastRow: () => rows.length,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => rows.slice(r - 1, r - 1 + nr).map(row => Array.from({ length: nc }, (_, j) => row[c - 1 + j] ?? '')),
        getValue: () => (rows[r - 1] || [])[c - 1] ?? '',
        setValues(vals) { vals.forEach((v, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; v.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; }); }); return this; },
        setFontWeight() { return this; },
      };
    },
    appendRow(v) { rows.push(v.slice()); },
    deleteRow(r) { rows.splice(r - 1, 1); },
    setFrozenRows() {},
    _rows: () => rows,
  };
  return sh;
}

function createContext(opts = {}) {
  const calls = [];
  const props = Object.assign({}, opts.props || {});
  const sheets = new Map();
  const ss = {
    getId: () => 'fake-sheet', getUrl: () => 'https://docs.google.com/spreadsheets/d/fake-sheet',
    getSheetByName: n => sheets.get(n) || null,
    insertSheet: n => { const s = makeSheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()], deleteSheet: s => sheets.delete(s.name),
  };
  const calEvents = new Map();
  function makeCal(id, name) {
    function create(kind, args) {
      const evId = 'g-' + crypto.randomUUID();
      const item = { getId: () => evId, removeAllReminders() {}, addPopupReminder() {}, deleteEvent() { calEvents.delete(evId); calls.push(['google.delete', evId]); }, deleteEventSeries() { calEvents.delete(evId); calls.push(['google.deleteSeries', evId]); } };
      calEvents.set(evId, { kind, title: args[0] });
      calls.push(['google.' + kind, args[0]]);
      return item;
    }
    return {
      getId: () => id, getName: () => name,
      createEvent: (...a) => create('createEvent', a), createEventSeries: (...a) => create('createEventSeries', a),
      createAllDayEvent: (...a) => create('createAllDayEvent', a), createAllDayEventSeries: (...a) => create('createAllDayEventSeries', a),
      getEventById: id2 => calEvents.has(id2) ? { deleteEvent() { calEvents.delete(id2); calls.push(['google.delete', id2]); } } : null,
      getEventSeriesById: id2 => calEvents.has(id2) ? { deleteEventSeries() { calEvents.delete(id2); calls.push(['google.deleteSeries', id2]); } } : null,
    };
  }
  const defaultCal = makeCal('me@example.com', '내 캘린더');
  const rec = () => ({ addDailyRule() { return this; }, addWeeklyRule() { return this; }, addMonthlyRule() { return this; } });

  const ctx = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    SpreadsheetApp: { create: () => ss, openById: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => 'Asia/Seoul' },
    Logger: { log: (...a) => calls.push(['log', ...a]) },
    HtmlService: {},
    CalendarApp: {
      getDefaultCalendar: () => defaultCal,
      getCalendarById: id => (id === defaultCal.getId() ? defaultCal : null),
      newRecurrence: rec,
    },
    UrlFetchApp: {
      fetch(url, o) {
        calls.push(['icloud.' + o.method, url]);
        if (opts.icloudFail) return { getResponseCode: () => 401 };
        return { getResponseCode: () => (o.method === 'put' ? 201 : 204) };
      },
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64Encode: s => Buffer.from(s).toString('base64'),
      Charset: { UTF_8: 'UTF-8' },
      newBlob: s => ({ getBytes: () => Array.from(Buffer.from(s)) }),
      formatDate(date, tz, fmt) {
        const o = seoulParts(date);
        return fmt.replace('yyyy', o.year).replace('MM', o.month).replace('dd', o.day).replace('HH', o.hour).replace('mm', o.minute);
      },
      parseDate(str, tz, fmt) {
        const m = str.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/);
        if (!m) throw new Error('parseDate: ' + str);
        return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], (+m[4] || 0) - 9, +m[5] || 0));
      },
    },
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'apps-script');
  ['Store.gs', 'ICloud.gs', 'GoogleCal.gs', 'Code.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  // google.script.run 처럼 값을 직렬화해서 주고받는다 (Date 등이 섞여 있으면 여기서 드러난다).
  ctx.call = (action, payload) => JSON.parse(JSON.stringify(ctx.api(action, JSON.parse(JSON.stringify(payload || {})))));
  ctx.calls = calls;
  ctx.props = props;
  ctx.sheets = sheets;
  return ctx;
}

module.exports = { createContext };
