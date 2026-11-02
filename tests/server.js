// 서버 코드(apps-script/*.gs)를 가짜 Apps Script 환경에서 돌려 본다: node tests/server.js
const assert = require('assert');
const { createContext } = require('../dev/fake-gas');

const ICLOUD = { ICLOUD_USER: 'me@icloud.com', ICLOUD_APP_PASSWORD: 'abcd-efgh-ijkl-mnop', ICLOUD_CALENDAR_URL: 'https://p1-caldav.icloud.com/1/calendars/home' };

// 처음 실행: 기본 DB 6개가 생기고, 다시 불러도 늘어나지 않는다.
let g = createContext({ props: ICLOUD });
let boot = g.call('bootstrap');
assert.strictEqual(boot.databases.length, 6);
assert.strictEqual(g.call('bootstrap').databases.length, 6);
assert.deepStrictEqual(boot.status, { google: { work: '내 캘린더', personal: '내 캘린더' }, apple: { work: true, personal: true } });
assert.strictEqual(boot.settings.theme, 'workbook');
assert.match(boot.today, /^\d{4}-\d{2}-\d{2}$/);

// 일정 저장: 앱 + Google + iCloud
const base = { title: '[거래처] 미팅', workspace: 'work', date: '2026-10-30', start: '14:00', end: '15:30', repeat: 'none', reminder: '10', toGoogle: true, toApple: true };
let ev = g.call('saveEvent', base);
assert(ev.id && ev.google && ev.apple && ev.sync.google === 'ok' && ev.sync.apple === 'ok', JSON.stringify(ev));
assert.strictEqual(ev.apple.url, 'https://p1-caldav.icloud.com/1/calendars/home/' + ev.id + '.ics');
assert.strictEqual(ev.reminder, 10);
assert.deepStrictEqual(g.calls.filter(c => c[0] !== 'log').map(c => c[0]), ['google.createEvent', 'icloud.put']);

// 수정: Google은 지우고 새로 만들고, iCloud는 같은 주소에 덮어쓴다.
g.calls.length = 0;
const firstGoogle = ev.google.id;
ev = g.call('saveEvent', Object.assign({}, ev, { title: '[거래처] 미팅 (변경)' }));
assert.deepStrictEqual(g.calls.map(c => c[0]), ['google.delete', 'google.createEvent', 'icloud.put']);
assert.notStrictEqual(ev.google.id, firstGoogle);
assert.strictEqual(g.calls[2][1], ev.apple.url);
assert.strictEqual(g.call('bootstrap').events.length, 1);

// 반복 일정은 Google에 시리즈로, 종일 반복은 하루짜리로 저장
g.calls.length = 0;
const series = g.call('saveEvent', { title: '운동', workspace: 'personal', date: '2026-10-27', start: '19:00', end: '20:00', repeat: 'weekly', reminder: '', toGoogle: true, toApple: false });
assert.strictEqual(series.google.series, true);
assert.strictEqual(series.reminder, null);
assert.deepStrictEqual(g.calls.map(c => c[0]), ['google.createEventSeries']);
const allDay = g.call('saveEvent', { title: '휴가', workspace: 'personal', allDay: true, date: '2026-11-02', endDate: '2026-11-04', repeat: 'none', toGoogle: true });
assert.strictEqual(allDay.endDate, '2026-11-04');
assert.strictEqual(allDay.start, '');

// iCloud 해제 → iCloud 사본 삭제
g.calls.length = 0;
ev = g.call('saveEvent', Object.assign({}, ev, { toApple: false }));
assert(g.calls.some(c => c[0] === 'icloud.delete'));
assert.strictEqual(ev.apple, null);

// 삭제: 외부 캘린더에서도 지운다
g.calls.length = 0;
const del = g.call('deleteEvent', { id: series.id });
assert.deepStrictEqual(del, { ok: true, warnings: [] });
assert.deepStrictEqual(g.calls.map(c => c[0]), ['google.deleteSeries']);

// 입력 검사
assert.throws(() => g.call('saveEvent', Object.assign({}, base, { title: ' ' })), /제목/);
assert.throws(() => g.call('saveEvent', Object.assign({}, base, { end: '13:00' })), /종료 시간/);
assert.throws(() => g.call('saveEvent', Object.assign({}, base, { date: '2026/10/30' })), /날짜/);
assert.throws(() => g.call('saveEvent', Object.assign({}, base, { reminder: '7' })), /알림/);

// 할 일
const task = g.call('saveTask', { title: '보고서 초안 제출', workspace: 'work' });
const done = g.call('saveTask', Object.assign({}, task, { done: true }));
assert.strictEqual(done.id, task.id);
assert.strictEqual(g.call('bootstrap').tasks[0].done, true);
const detailed = g.call('saveTask', Object.assign({}, done, { detail: '<h2>목차</h2><ul><li>배경</li></ul>' }));
assert.strictEqual(g.call('bootstrap').tasks[0].detail, detailed.detail);
assert.throws(() => g.call('saveTask', Object.assign({}, done, { detail: 'x'.repeat(40001) })), /상세 내용/);
g.call('deleteTask', { id: task.id });
assert.strictEqual(g.call('bootstrap').tasks.length, 0);

// 일정 ↔ 할 일 연결
const evBase = { title: '견적 회의', workspace: 'work', date: '2026-11-05', start: '10:00', end: '11:00', repeat: 'none', reminder: '10' };
const withNew = g.call('saveEvent', Object.assign({}, evBase, { taskId: '__new' }));
assert(withNew.newTask && withNew.taskId === withNew.newTask.id);
assert.strictEqual(withNew.newTask.title, '견적 회의');
assert.strictEqual(withNew.newTask.due, '2026-11-05');
assert.strictEqual(g.call('bootstrap').events.find(e => e.id === withNew.id).newTask, undefined); // 시트에는 저장 안 함
const noLink = g.call('saveEvent', Object.assign({}, evBase, { taskId: '' }));
assert.strictEqual(noLink.taskId, '');
const ghost = g.call('saveEvent', Object.assign({}, evBase, { taskId: 'no-such-task' }));
assert.strictEqual(ghost.taskId, '');
const existing = g.call('saveEvent', Object.assign({}, evBase, { taskId: withNew.taskId }));
assert.strictEqual(existing.taskId, withNew.taskId);
assert.strictEqual(g.call('bootstrap').tasks.length, 1);                    // 새로 만든 건 하나뿐
g.call('deleteTask', { id: withNew.taskId });
assert(g.call('bootstrap').events.every(e => !e.taskId));                     // 할 일을 지우면 연결만 끊김
[withNew, noLink, ghost, existing].forEach(e => g.call('deleteEvent', { id: e.id }));

// 기록과 연결
const proj = boot.databases.find(d => d.name === '프로젝트');
const rec = g.call('saveRecord', { dbId: proj.id, title: '[프로젝트 A]', values: { f1: '진행 중', f3: '2026-11-14', bogus: 'x' }, memo: '' });
assert.deepStrictEqual(Object.keys(rec.values).sort(), ['f1', 'f2', 'f3', 'f4']);
assert.strictEqual(rec.workspace, 'work');
ev = g.call('saveEvent', Object.assign({}, ev, { recordId: rec.id }));
g.call('deleteRecord', { id: rec.id });
let b2 = g.call('bootstrap');
assert.strictEqual(b2.records.length, 0);
assert.strictEqual(b2.events.find(e => e.id === ev.id).recordId, '');

// DB 만들기·지우기 (기록도 함께)
const db = g.call('saveDatabase', { name: '독서', workspace: 'personal', fields: [{ name: '저자', type: 'text' }, { name: '평점', type: 'select', options: ['1', '2', '3', ''] }, { name: '', type: 'weird' }] });
assert.strictEqual(db.fields.length, 3);
assert.deepStrictEqual(db.fields[1].options, ['1', '2', '3']);
assert.strictEqual(db.fields[2].type, 'text');
g.call('saveRecord', { dbId: db.id, title: '책 한 권', values: {} });
g.call('deleteDatabase', { id: db.id });
b2 = g.call('bootstrap');
assert(!b2.databases.some(d => d.id === db.id));
assert.strictEqual(b2.records.length, 0);

// 메모·설정
g.call('saveMemo', { text: '견적서 확인' });
g.call('saveSettings', { theme: 'nord' });
b2 = g.call('bootstrap');
assert.strictEqual(b2.memo, '견적서 확인');
assert.strictEqual(b2.settings.theme, 'nord');

// iCloud 실패해도 앱에는 저장되고, 이유가 남는다
const bad = createContext({ props: ICLOUD, icloudFail: true });
const e2 = bad.call('saveEvent', base);
assert.strictEqual(e2.sync.google, 'ok');
assert.match(e2.sync.apple, /인증 실패/);
assert.strictEqual(bad.call('bootstrap').events.length, 1);

// iCloud 설정이 없으면 연결 안 됨으로 표시
const none = createContext();
assert.deepStrictEqual(none.call('bootstrap').status.apple, { work: false, personal: false });

console.log('서버 검사 통과');
