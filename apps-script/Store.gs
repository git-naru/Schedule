/**
 * 데이터 저장소: 구글 스프레드시트 한 개에 컬렉션마다 시트 하나.
 * 각 행은 [id, 제목, 구분, 수정 시각, data(JSON)] 이고, 객체 전체는 data 열에 JSON으로 들어간다.
 * 앞의 네 열은 시트를 직접 열었을 때 알아보기 쉽게 하려는 사본이다.
 */

const COLLECTIONS = ['events', 'tasks', 'databases', 'records', 'memos'];
const SHEET_TITLES = { events: '일정', tasks: '할 일', databases: '데이터베이스', records: '기록', memos: '메모' };
const HEADERS = ['id', '제목', '구분', '수정 시각', 'data'];

let spreadsheet_ = null;

function props_() {
  return PropertiesService.getScriptProperties();
}

/** 저장용 스프레드시트를 연다. 없으면 내 드라이브에 새로 만든다. */
function spreadsheet() {
  if (spreadsheet_) return spreadsheet_;
  const id = props_().getProperty('SHEET_ID');
  if (id) {
    spreadsheet_ = SpreadsheetApp.openById(id);
  } else {
    spreadsheet_ = SpreadsheetApp.create('My Base 데이터');
    props_().setProperty('SHEET_ID', spreadsheet_.getId());
  }
  return spreadsheet_;
}

function sheet_(name) {
  const ss = spreadsheet();
  const title = SHEET_TITLES[name];
  let sh = ss.getSheetByName(title);
  if (!sh) {
    sh = ss.insertSheet(title);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // 새 스프레드시트의 빈 기본 시트는 정리한다.
    const blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('시트1');
    if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  }
  return sh;
}

function readAll(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 5, last - 1, 1).getValues()
    .map(function (r) { return r[0] ? JSON.parse(r[0]) : null; })
    .filter(Boolean);
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

function rowOf_(obj) {
  return [obj.id, obj.title || obj.name || '', obj.workspace || '', obj.updatedAt || '', JSON.stringify(obj)];
}

/** id가 같으면 덮어쓰고, 없으면 새 행으로 추가한다. */
function upsert(name, obj) {
  if (!obj.id) obj.id = Utilities.getUuid();
  obj.updatedAt = new Date().toISOString();
  const sh = sheet_(name);
  const row = findRow_(sh, obj.id);
  if (row > 0) sh.getRange(row, 1, 1, HEADERS.length).setValues([rowOf_(obj)]);
  else sh.appendRow(rowOf_(obj));
  return obj;
}

function getById(name, id) {
  const sh = sheet_(name);
  const row = findRow_(sh, id);
  if (row < 0) return null;
  return JSON.parse(sh.getRange(row, 5).getValue());
}

function remove(name, id) {
  const sh = sheet_(name);
  const row = findRow_(sh, id);
  if (row > 0) sh.deleteRow(row);
}

/** 여러 요청이 동시에 시트를 고치지 않도록 잠근 채로 실행한다. */
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
