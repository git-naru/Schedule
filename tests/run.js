// 순수 함수 검사: node tests/run.js
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const root = path.join(__dirname, '..');

// 1) 화면(Index.html)의 날짜·반복·배치 함수
const html = fs.readFileSync(path.join(root, 'apps-script/Index.html'), 'utf8');
const pure = html.slice(html.indexOf('/* PURE-START */'), html.indexOf('/* PURE-END */'));
const ui = {}; vm.createContext(ui); vm.runInContext(pure, ui);

assert.strictEqual(ui.addDays('2026-10-31', 1), '2026-11-01');
assert.strictEqual(ui.addDays('2026-03-01', -1), '2026-02-28');
assert.strictEqual(ui.weekStart('2026-10-30'), '2026-10-26');      // 금 → 월
assert.strictEqual(ui.weekStart('2026-11-01'), '2026-10-26');      // 일 → 그 주 월
assert.strictEqual(ui.addMonths('2026-12', 1), '2027-01');
assert.strictEqual(ui.addMonths('2026-01', -1), '2025-12');
const g = ui.monthGrid('2026-10');
assert.strictEqual(g.length, 5);
assert.deepStrictEqual([g[0][0], g[4][6]], ['2026-09-28', '2026-11-01']);
assert.strictEqual(ui.monthGrid('2026-03').length, 6);               // 3/1이 일요일 → 6주
assert.strictEqual(ui.kDate('2026-10-30'), '10월 30일 금요일');

const weekly = { date: '2026-10-27', repeat: 'weekly' };
assert(ui.occursOn(weekly, '2026-11-03') && !ui.occursOn(weekly, '2026-11-04') && !ui.occursOn(weekly, '2026-10-20'));
const monthly = { date: '2026-01-31', repeat: 'monthly' };
assert(ui.occursOn(monthly, '2026-03-31') && !ui.occursOn(monthly, '2026-02-28'));
const multi = { date: '2026-10-30', endDate: '2026-11-02', repeat: 'none' };
assert.strictEqual(ui.occurrences([multi], '2026-10-26', '2026-11-08').length, 4);
assert.strictEqual(ui.occurrences([{ date: '2026-10-01', repeat: 'daily' }], '2026-10-26', '2026-11-01').length, 7);

// 겹치는 일정 배치: A(9-11)와 B(10-12)는 나란히, C(13-14)는 혼자
const L = ui.layoutDay([
  { ev: { start: '09:00', end: '11:00', id: 'A' } },
  { ev: { start: '10:00', end: '12:00', id: 'B' } },
  { ev: { start: '13:00', end: '14:00', id: 'C' } },
  { ev: { start: '11:00', end: '11:30', id: 'D' } },
]);
const by = Object.fromEntries(L.map(x => [x.ev.id, x]));
assert.deepStrictEqual([by.A.lane, by.B.lane, by.D.lane, by.A.lanes, by.B.lanes, by.D.lanes], [0, 1, 0, 2, 2, 2]);
assert.deepStrictEqual([by.C.lane, by.C.lanes], [0, 1]);
assert.strictEqual(ui.holidayOf('2026-10-09'), '한글날');

// 할 일 탭 분류 (오늘 = 2026-11-03, 서울)
assert.strictEqual(ui.daysBetween('2026-11-03', '2026-11-06'), 3);
assert.strictEqual(ui.daysBetween('2026-12-31', '2027-01-01'), 1);
assert.strictEqual(ui.seoulYmdOf('2026-11-02T16:30:00Z'), '2026-11-03'); // UTC 16:30 = 서울 다음날 01:30
const T = [
  { id: 'a', status: 'todo', due: '2026-11-10' },
  { id: 'b', status: 'doing', due: '2026-11-05' },
  { id: 'c', status: 'todo', due: '2026-11-01' },            // 지남 → 임박에 포함
  { id: 'd', status: 'todo', due: '2026-11-06' },            // D-3 → 포함
  { id: 'e', status: 'todo', due: '2026-11-07' },            // D-4 → 제외
  { id: 'f', status: 'done', doneAt: '2026-11-03T01:00:00Z' }, // 오늘 완료
  { id: 'g', status: 'done', doneAt: '2026-11-01T01:00:00Z' }, // 예전 완료
  { id: 'h', done: true, doneAt: '2026-11-02T20:00:00Z' },     // 옛 자료(status 없음), 서울 11/3 완료
  { id: 'i', done: false },                                    // 옛 자료, 마감 없음
];
const Bk = ui.taskBuckets(T, '2026-11-03');
const ids = l => l.map(x => x.id).join('');
assert.strictEqual(ids(Bk.todo), 'cbdeai' + 'fh');             // 마감 빠른 순, 마감 없는 건 뒤, 오늘 완료는 맨 뒤
assert.strictEqual(ids(Bk.doing), 'b');
assert.strictEqual(ids(Bk.soon), 'cbd');
assert.strictEqual(ids(Bk.done), 'fhg');
assert.strictEqual(ui.holidayOf('2026-09-25'), '추석');

// 2) iCloud 일정 파일(.ics) 생성
const gs = fs.readFileSync(path.join(root, 'apps-script/ICloud.gs'), 'utf8');
const ic = {}; vm.createContext(ic); vm.runInContext(gs, ic);
const now = new Date(Date.UTC(2026, 9, 30, 0, 0, 0));
const t = ic.buildIcs_({ title: '치과, 예약; 확인', location: '강남', memo: '1줄\n2줄', allDay: false,
  date: '2026-10-30', start: '14:00', end: '15:30', repeat: 'weekly', reminder: 10 }, 'uid-1', now);
assert(t.includes('DTSTART:20261030T050000Z') && t.includes('DTEND:20261030T063000Z'), t);
assert(t.includes('RRULE:FREQ=WEEKLY'));
assert(t.includes('SUMMARY:치과\\, 예약\\; 확인'));
assert(t.includes('DESCRIPTION:1줄\\n2줄'));
assert(t.includes('TRIGGER:-PT10M'));
assert(t.endsWith('END:VCALENDAR\r\n'));
const a = ic.buildIcs_({ title: 'x', allDay: true, date: '2026-10-30', endDate: '2026-10-31', repeat: 'none', reminder: null }, 'u', now);
assert(a.includes('DTSTART;VALUE=DATE:20261030') && a.includes('DTEND;VALUE=DATE:20261101') && !a.includes('RRULE') && !a.includes('VALARM'));
assert.strictEqual(ic.seoulToDate_('2026-10-30', '00:30').toISOString(), '2026-10-29T15:30:00.000Z');
const long = ic.foldIcsLine_('SUMMARY:' + '가나다라마바사'.repeat(10));
long.split('\r\n').forEach(l => assert(Buffer.byteLength(l) <= 75));
assert.strictEqual(long.split('\r\n ').join(''), 'SUMMARY:' + '가나다라마바사'.repeat(10));

console.log('모든 검사 통과');
