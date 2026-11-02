// 체험판 만들기: 실제 서버 코드(apps-script/*.gs)와 화면(Index.html)을 HTML 파일 하나로 묶는다.
//   node dev/build-demo.js  →  dist/demo.html
// 브라우저 안에서 가짜 Apps Script 위에 서버 코드를 그대로 돌린다.
// 데이터는 그 브라우저의 localStorage에만 저장되고, 구글·iCloud 캘린더에는 아무것도 보내지 않는다.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'apps-script');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

const server = ['Store.gs', 'ICloud.gs', 'GoogleCal.gs', 'Code.gs'].map(read).join('\n;\n');

const shim = `
<script>
(function () {
  var KEY = 'mybase-demo-v1';
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  var sheetRows = saved.sheets || {};   // 시트 이름 → 행 배열
  var props = saved.props || {};
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ sheets: sheetRows, props: props })); } catch (e) {}
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function seoulParts(date) {
    var o = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function makeSheet(name) {
    if (!sheetRows[name]) sheetRows[name] = [];
    var rows = sheetRows[name];
    return {
      getName: function () { return name; },
      getLastRow: function () { return rows.length; },
      getRange: function (r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        return {
          getValues: function () {
            return rows.slice(r - 1, r - 1 + nr).map(function (row) {
              var out = []; for (var j = 0; j < nc; j++) { var v = row[c - 1 + j]; out.push(v == null ? '' : v); } return out;
            });
          },
          getValue: function () { var v = (rows[r - 1] || [])[c - 1]; return v == null ? '' : v; },
          setValues: function (vals) {
            vals.forEach(function (v, i) { rows[r - 1 + i] = rows[r - 1 + i] || []; v.forEach(function (x, j) { rows[r - 1 + i][c - 1 + j] = x; }); });
            return this;
          },
          setFontWeight: function () { return this; },
        };
      },
      appendRow: function (v) { rows.push(v.slice()); },
      deleteRow: function (r) { rows.splice(r - 1, 1); },
      setFrozenRows: function () {},
    };
  }
  var ss = {
    getId: function () { return 'demo-sheet'; },
    getUrl: function () { return '#'; },
    getSheetByName: function (n) { return sheetRows[n] ? makeSheet(n) : null; },
    insertSheet: function (n) { sheetRows[n] = []; return makeSheet(n); },
    getSheets: function () { return Object.keys(sheetRows).map(makeSheet); },
    deleteSheet: function (s) { delete sheetRows[s.getName()]; },
  };
  function fakeEvent() {
    var id = 'demo-' + uuid();
    return { getId: function () { return id; }, removeAllReminders: function () {}, addPopupReminder: function () {},
      deleteEvent: function () {}, deleteEventSeries: function () {} };
  }
  var cal = {
    getId: function () { return 'demo@calendar'; }, getName: function () { return '체험판 캘린더 (실제로 기록되지 않음)'; },
    createEvent: fakeEvent, createEventSeries: fakeEvent, createAllDayEvent: fakeEvent, createAllDayEventSeries: fakeEvent,
    getEventById: function () { return fakeEvent(); }, getEventSeriesById: function () { return fakeEvent(); },
  };
  function rec() { return { addDailyRule: function () { return this; }, addWeeklyRule: function () { return this; }, addMonthlyRule: function () { return this; } }; }

  var GAS = {
    PropertiesService: { getScriptProperties: function () { return {
      getProperty: function (k) { return props[k] == null ? null : props[k]; },
      setProperty: function (k, v) { props[k] = v; } }; } },
    SpreadsheetApp: { create: function () { return ss; }, openById: function () { return ss; } },
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    Session: { getScriptTimeZone: function () { return 'Asia/Seoul'; } },
    Logger: { log: function () { console.log.apply(console, arguments); } },
    HtmlService: {},
    CalendarApp: { getDefaultCalendar: function () { return cal; }, getCalendarById: function () { return cal; }, newRecurrence: rec },
    UrlFetchApp: { fetch: function () { return { getResponseCode: function () { return 204; }, getContentText: function () { return ''; } }; } },
    Utilities: {
      getUuid: uuid,
      base64Encode: function (s) { return btoa(unescape(encodeURIComponent(s))); },
      Charset: { UTF_8: 'UTF-8' },
      newBlob: function (s) { return { getBytes: function () { return Array.from(new TextEncoder().encode(s)); } }; },
      formatDate: function (date, tz, fmt) {
        var o = seoulParts(date);
        return fmt.replace('yyyy', o.year).replace('MM', o.month).replace('dd', o.day).replace('HH', o.hour).replace('mm', o.minute);
      },
      parseDate: function (str) {
        var m = str.match(/^(\\d{4})-(\\d{2})-(\\d{2})(?: (\\d{2}):(\\d{2}))?$/);
        if (!m) throw new Error('parseDate: ' + str);
        return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], (+m[4] || 0) - 9, +m[5] || 0));
      },
    },
  };

  var serverApi = (function (PropertiesService, SpreadsheetApp, LockService, Session, Logger, HtmlService, CalendarApp, UrlFetchApp, Utilities) {
${server.replace(/<\/script/gi, '<\\/script')}
    return api;
  })(GAS.PropertiesService, GAS.SpreadsheetApp, GAS.LockService, GAS.Session, GAS.Logger, GAS.HtmlService, GAS.CalendarApp, GAS.UrlFetchApp, GAS.Utilities);

  // google.script.run 흉내: 값을 JSON으로 직렬화하고 비동기로 돌려준다.
  function make(ok, fail) {
    return {
      withSuccessHandler: function (fn) { return make(fn, fail); },
      withFailureHandler: function (fn) { return make(ok, fn); },
      api: function (action, payload) {
        setTimeout(function () {
          var res, err;
          try { res = JSON.parse(JSON.stringify(serverApi(action, JSON.parse(JSON.stringify(payload || {}))) || null)); persist(); }
          catch (e) { err = e; }
          if (err) { if (fail) fail(err); } else if (ok) ok(res);
        }, 60);
      },
    };
  }
  window.google = { script: { run: make() } };
  window.__demoReset = function () {
    var btn = document.getElementById('demoReset');
    if (btn && btn.dataset.armed !== '1') {
      btn.dataset.armed = '1'; btn.textContent = '한 번 더 누르면 삭제';
      setTimeout(function () { btn.dataset.armed = ''; btn.textContent = '초기화'; }, 3000);
      return;
    }
    try { localStorage.removeItem(KEY); } catch (e) {}
    location.reload();
  };
})();
</script>`;

const badge = `
<div style="position:fixed;right:12px;bottom:12px;z-index:9999;display:flex;gap:6px;align-items:center;font:12px/1.2 sans-serif;
  background:rgba(0,0,0,.72);color:#fff;padding:6px 8px 6px 10px;border-radius:999px">
  체험판 · 이 기기에만 저장
  <button id="demoReset" onclick="__demoReset()" style="font:inherit;border:0;border-radius:999px;padding:3px 8px;background:#fff;color:#000;cursor:pointer">초기화</button>
</div>`;

let html = read('Index.html');
if (!html.includes('<script>')) throw new Error('Index.html 구조가 예상과 다릅니다');
html = html.replace('<base target="_top">\n', '');
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
html = html.replace('<script>', shim.trim() + '\n<script>');
html = html.replace(/<\/body>/i, badge + '\n</body>');

const out = path.join(__dirname, '..', 'dist', 'demo.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('만들었습니다:', out, Math.round(html.length / 1024) + 'KB');
