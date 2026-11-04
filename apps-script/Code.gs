/**
 * My Base — 개인 DB & 일정 관리 웹앱의 진입점.
 * 화면(Index.html)은 google.script.run.api(action, payload) 하나로 서버를 부른다.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('My Base')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function api(action, payload) {
  const handlers = {
    bootstrap: bootstrap,
    saveEvent: saveEvent,
    deleteEvent: deleteEvent,
    saveTask: saveTask,
    deleteTask: deleteTask,
    saveDatabase: saveDatabase,
    deleteDatabase: deleteDatabase,
    saveRecord: saveRecord,
    deleteRecord: deleteRecord,
    saveMemo: saveMemo,
    saveNote: saveNote,
    saveSettings: saveSettings,
  };
  const fn = handlers[action];
  if (!fn) throw new Error('알 수 없는 요청입니다: ' + action);
  return fn(payload || {});
}

// ---------- 처음 화면 ----------

function bootstrap() {
  return withLock(function () {
    seedDatabases_();
    const tz = Session.getScriptTimeZone();
    const now = new Date();
    const memos = readAll('memos');
    const memo = memos.filter(function (m) { return m.id === 'quick'; })[0];
    const notes = {};
    memos.forEach(function (m) { if (NOTE_ID.test(m.id)) notes[m.id] = m.text; });
    return {
      today: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
      now: Utilities.formatDate(now, tz, 'HH:mm'),
      settings: { theme: props_().getProperty('THEME') || 'workbook' },
      status: status_(),
      events: readAll('events'),
      tasks: readAll('tasks'),
      databases: readAll('databases'),
      records: readAll('records'),
      memo: memo ? memo.text : '',
      notes: notes,
      sheetUrl: spreadsheet().getUrl(),
    };
  });
}

function status_() {
  function calName(ws) {
    try { return googleCalendar(ws).getName(); } catch (e) { return null; }
  }
  return {
    google: { work: calName('work'), personal: calName('personal') },
    apple: { work: !!iCloudConfig('work'), personal: !!iCloudConfig('personal') },
  };
}

/** 데이터베이스가 하나도 없으면 기본 DB 6개를 만든다 (기록은 비어 있음). */
function seedDatabases_() {
  if (readAll('databases').length) return;
  const seeds = [
    ['work', '프로젝트', [['상태', 'select', ['대기', '진행 중', '완료']], ['거래처', 'text'], ['마감일', 'date'], ['태그', 'text']]],
    ['work', '거래처·연락처', [['회사', 'text'], ['담당자', 'text'], ['전화', 'text'], ['이메일', 'text']]],
    ['work', '회의록', [['날짜', 'date'], ['참석자', 'text']]],
    ['personal', '연락처', [['관계', 'text'], ['전화', 'text'], ['생일', 'date']]],
    ['personal', '가계부', [['날짜', 'date'], ['구분', 'select', ['지출', '수입']], ['금액', 'number'], ['분류', 'text']]],
    ['personal', '메모·기록', [['태그', 'text']]],
  ];
  seeds.forEach(function (s, i) {
    upsert('databases', {
      name: s[1],
      workspace: s[0],
      order: i,
      fields: s[2].map(function (f, j) { return { id: 'f' + (j + 1), name: f[0], type: f[1], options: f[2] || [] }; }),
    });
  });
}

// ---------- 입력값 검사 ----------

const WORKSPACES = ['work', 'personal'];
const REPEATS = ['none', 'daily', 'weekly', 'monthly'];
const REMINDERS = [0, 10, 30, 60, 1440];
const FIELD_TYPES = ['text', 'number', 'date', 'select', 'check'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}$/;
const NEW_TASK = '__new';

function text_(v, max, label) {
  const s = String(v == null ? '' : v).trim();
  if (s.length > max) throw new Error(label + '은(는) ' + max + '자 이하로 입력하세요.');
  return s;
}

function cleanEvent_(input) {
  const ev = {
    id: input.id ? String(input.id) : '',
    title: text_(input.title, 200, '제목'),
    workspace: WORKSPACES.indexOf(input.workspace) >= 0 ? input.workspace : 'work',
    allDay: !!input.allDay,
    date: String(input.date || ''),
    endDate: String(input.endDate || input.date || ''),
    start: String(input.start || ''),
    end: String(input.end || ''),
    repeat: REPEATS.indexOf(input.repeat) >= 0 ? input.repeat : 'none',
    reminder: input.reminder === '' || input.reminder == null ? null : Number(input.reminder),
    location: text_(input.location, 200, '장소'),
    memo: text_(input.memo, 5000, '메모'),
    recordId: input.recordId ? String(input.recordId) : '',
    taskId: input.taskId ? String(input.taskId) : '',
    toGoogle: !!input.toGoogle,
    toApple: !!input.toApple,
  };
  if (!ev.title) throw new Error('제목을 입력하세요.');
  if (!YMD.test(ev.date) || !YMD.test(ev.endDate)) throw new Error('날짜 형식이 올바르지 않습니다.');
  if (ev.reminder !== null && REMINDERS.indexOf(ev.reminder) < 0) throw new Error('알림 값이 올바르지 않습니다.');
  if (ev.allDay) {
    if (ev.endDate < ev.date) throw new Error('종료일이 시작일보다 빠릅니다.');
    if (ev.repeat !== 'none') ev.endDate = ev.date; // 반복하는 종일 일정은 하루짜리만 지원
    ev.start = '';
    ev.end = '';
  } else {
    if (!HM.test(ev.start) || !HM.test(ev.end)) throw new Error('시간 형식이 올바르지 않습니다.');
    if (ev.end <= ev.start) throw new Error('종료 시간이 시작 시간보다 늦어야 합니다.');
    ev.endDate = ev.date;
  }
  return ev;
}

// ---------- 일정 ----------

/**
 * 일정을 시트에 저장하고, 고른 외부 캘린더에도 기록한다.
 * 외부 캘린더가 실패해도 앱에는 저장하고, 실패 이유를 ev.sync 에 남긴다.
 */
function saveEvent(input) {
  const ev = cleanEvent_(input);
  return withLock(function () {
    const old = ev.id ? getById('events', ev.id) : null;
    if (!ev.id) ev.id = Utilities.getUuid();
    if (old) ev.createdAt = old.createdAt;
    else ev.createdAt = new Date().toISOString();
    ev.google = null;
    ev.apple = null;
    ev.sync = {};

    // 할 일 연결: '__new' 이면 일정 제목으로 새 할 일을 만들어 연결한다.
    let newTask = null;
    if (ev.taskId === NEW_TASK) {
      newTask = upsert('tasks', {
        id: '', title: ev.title, workspace: ev.workspace, status: 'todo', done: false, doneAt: '', due: ev.date, detail: '',
        createdAt: new Date().toISOString(),
      });
      ev.taskId = newTask.id;
    } else if (ev.taskId && !getById('tasks', ev.taskId)) {
      ev.taskId = '';
    }

    // Google: 바뀐 내용을 정확히 반영하려고 이전 사본을 지우고 새로 만든다.
    if (old && old.google) {
      try { googleDelete(old.google); } catch (e) { ev.sync.google = '이전 Google 일정을 지우지 못했습니다: ' + e.message; }
    }
    if (ev.toGoogle) {
      try { ev.google = googleCreate(ev); ev.sync.google = 'ok'; } catch (e) { ev.sync.google = e.message; }
    }

    // iCloud: 같은 캘린더면 같은 주소에 덮어쓰고, 아니면 이전 사본을 지운다.
    const keepUrl = old && old.apple && ev.toApple && old.workspace === ev.workspace ? old.apple.url : null;
    if (old && old.apple && !keepUrl) {
      try { iCloudDelete(old.workspace, old.apple.url); } catch (e) { ev.sync.apple = '이전 iCloud 일정을 지우지 못했습니다: ' + e.message; }
    }
    if (ev.toApple) {
      try { ev.apple = { url: iCloudPut(ev, keepUrl) }; ev.sync.apple = 'ok'; } catch (e) { ev.sync.apple = e.message; }
    }

    const saved = upsert('events', ev);
    if (newTask) saved.newTask = newTask; // 화면에 알려 주기만 하고 시트에는 저장하지 않는다
    return saved;
  });
}

function deleteEvent(input) {
  return withLock(function () {
    const old = getById('events', String(input.id));
    if (!old) return { ok: true, warnings: [] };
    const warnings = [];
    if (old.google) {
      try { googleDelete(old.google); } catch (e) { warnings.push('Google: ' + e.message); }
    }
    if (old.apple) {
      try { iCloudDelete(old.workspace, old.apple.url); } catch (e) { warnings.push('iCloud: ' + e.message); }
    }
    remove('events', old.id);
    return { ok: true, warnings: warnings };
  });
}

// ---------- 할 일 ----------

const TASK_STATUS = ['todo', 'doing', 'done'];

/** 상태: todo(할 일) → doing(진행 중) → done(완료). 예전 자료처럼 done만 있으면 그걸로 정한다. */
function taskStatus_(input) {
  let st = TASK_STATUS.indexOf(input.status) >= 0 ? input.status : (input.done ? 'done' : 'todo');
  if (input.done === true) st = 'done';
  if (input.done === false && st === 'done') st = 'todo';
  return st;
}

function saveTask(input) {
  const status = taskStatus_(input);
  const task = {
    id: input.id ? String(input.id) : '',
    title: text_(input.title, 200, '할 일'),
    workspace: WORKSPACES.indexOf(input.workspace) >= 0 ? input.workspace : 'work',
    status: status,
    done: status === 'done',
    doneAt: '',
    due: YMD.test(input.due || '') ? input.due : '',
    detail: String(input.detail == null ? '' : input.detail),
    createdAt: input.createdAt || new Date().toISOString(),
  };
  if (!task.title) throw new Error('할 일을 입력하세요.');
  // 시트 한 칸에는 5만 자까지만 들어가므로, 서식까지 포함한 상세 내용을 4만 자로 제한한다.
  if (JSON.stringify(task.detail).length > 40000) {
    throw new Error('상세 내용이 너무 깁니다. 일부를 줄이거나 나눠서 적어 주세요.');
  }
  return withLock(function () {
    const old = task.id ? getById('tasks', task.id) : null;
    // 완료한 시각: 이번에 완료로 바뀌면 지금, 계속 완료면 예전 시각을 유지한다.
    if (task.done) task.doneAt = old && old.done && old.doneAt ? old.doneAt : new Date().toISOString();
    return upsert('tasks', task);
  });
}

function deleteTask(input) {
  return withLock(function () {
    const id = String(input.id);
    readAll('events').forEach(function (ev) {
      if (ev.taskId === id) { ev.taskId = ''; upsert('events', ev); }
    });
    remove('tasks', id);
    return { ok: true };
  });
}

// ---------- 데이터베이스 ----------

function saveDatabase(input) {
  const db = {
    id: input.id ? String(input.id) : '',
    name: text_(input.name, 60, 'DB 이름'),
    workspace: WORKSPACES.indexOf(input.workspace) >= 0 ? input.workspace : 'work',
    order: Number(input.order) || 0,
    fields: (input.fields || []).slice(0, 20).map(function (f, i) {
      return {
        id: f.id ? String(f.id) : 'f' + Date.now().toString(36) + i,
        name: text_(f.name, 40, '항목 이름') || '항목 ' + (i + 1),
        type: FIELD_TYPES.indexOf(f.type) >= 0 ? f.type : 'text',
        options: f.type === 'select'
          ? (f.options || []).map(function (o) { return text_(o, 40, '선택지'); }).filter(Boolean).slice(0, 20)
          : [],
      };
    }),
  };
  if (!db.name) throw new Error('DB 이름을 입력하세요.');
  return withLock(function () {
    if (!db.id) db.order = readAll('databases').length;
    return upsert('databases', db);
  });
}

/** DB와 그 안의 기록을 모두 지운다. */
function deleteDatabase(input) {
  const id = String(input.id);
  return withLock(function () {
    readAll('records').forEach(function (r) { if (r.dbId === id) unlinkRecord_(r.id); });
    readAll('records').forEach(function (r) { if (r.dbId === id) remove('records', r.id); });
    remove('databases', id);
    return { ok: true };
  });
}

// ---------- 기록 ----------

function saveRecord(input) {
  return withLock(function () {
    const db = getById('databases', String(input.dbId || ''));
    if (!db) throw new Error('데이터베이스를 찾을 수 없습니다.');
    const values = {};
    db.fields.forEach(function (f) {
      const v = input.values ? input.values[f.id] : '';
      if (f.type === 'check') values[f.id] = !!v;
      else values[f.id] = text_(v, 2000, f.name);
    });
    const rec = {
      id: input.id ? String(input.id) : '',
      dbId: db.id,
      workspace: db.workspace,
      title: text_(input.title, 200, '제목'),
      values: values,
      memo: text_(input.memo, 20000, '메모'),
      createdAt: input.createdAt || new Date().toISOString(),
    };
    if (!rec.title) throw new Error('제목을 입력하세요.');
    return upsert('records', rec);
  });
}

function deleteRecord(input) {
  return withLock(function () {
    unlinkRecord_(String(input.id));
    remove('records', String(input.id));
    return { ok: true };
  });
}

/** 지워지는 기록에 연결돼 있던 일정의 연결만 끊는다. */
function unlinkRecord_(recordId) {
  readAll('events').forEach(function (ev) {
    if (ev.recordId === recordId) {
      ev.recordId = '';
      upsert('events', ev);
    }
  });
}

// ---------- 메모·설정 ----------

function saveMemo(input) {
  return withLock(function () {
    return upsert('memos', { id: 'quick', title: '빠른 메모', text: text_(input.text, 20000, '메모') });
  });
}

/** 메모장 페이지의 한 칸(예: 'schedule:core'). 서식 HTML은 화면에서 정리해 보낸다. */
const NOTE_ID = /^[a-z][a-z0-9-]{0,30}:[a-z][a-z0-9-]{0,30}$/;
function saveNote(input) {
  const id = String(input.id || '');
  if (!NOTE_ID.test(id)) throw new Error('메모 칸 이름이 올바르지 않습니다.');
  const html = String(input.html == null ? '' : input.html);
  if (JSON.stringify(html).length > 40000) throw new Error('내용이 너무 깁니다. 일부를 줄이거나 나눠서 적어 주세요.');
  return withLock(function () {
    const saved = upsert('memos', { id: id, title: id, text: html });
    return { id: saved.id, updatedAt: saved.updatedAt };
  });
}

function saveSettings(input) {
  if (input.theme) props_().setProperty('THEME', String(input.theme).slice(0, 40));
  return { ok: true };
}

/**
 * 편집기에서 한 번 실행: 권한 승인 + 연결 확인.
 * iCloud가 설정돼 있으면 테스트 일정을 만들었다가 바로 지운다.
 */
function testSetup() {
  Logger.log('데이터 시트: ' + spreadsheet().getUrl());
  Logger.log('Google 캘린더(업무): ' + googleCalendar('work').getName());
  Logger.log('Google 캘린더(개인): ' + googleCalendar('personal').getName());
  ['work', 'personal'].forEach(function (ws) {
    if (!iCloudConfig(ws)) {
      Logger.log('iCloud(' + ws + '): 설정 없음');
      return;
    }
    const tz = Session.getScriptTimeZone();
    const ev = {
      id: Utilities.getUuid(), title: '연결 테스트', workspace: ws, allDay: false,
      date: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), start: '23:00', end: '23:30',
      repeat: 'none', reminder: null,
    };
    const url = iCloudPut(ev, null);
    iCloudDelete(ws, url);
    Logger.log('iCloud(' + ws + '): 연결 성공');
  });
}
