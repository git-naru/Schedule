/**
 * Google 캘린더 연동.
 * 스크립트 속성 (모두 선택):
 *   GOOGLE_CALENDAR_ID_WORK / GOOGLE_CALENDAR_ID_PERSONAL  업무·개인을 다른 캘린더에 넣고 싶을 때
 *   GOOGLE_CALENDAR_ID                                     공통 캘린더 (비우면 기본 캘린더)
 */

function googleCalendar(workspace) {
  const p = props_();
  const key = workspace === 'work' ? 'GOOGLE_CALENDAR_ID_WORK' : 'GOOGLE_CALENDAR_ID_PERSONAL';
  const id = p.getProperty(key) || p.getProperty('GOOGLE_CALENDAR_ID');
  const cal = id ? CalendarApp.getCalendarById(id) : CalendarApp.getDefaultCalendar();
  if (!cal) throw new Error('구글 캘린더를 찾을 수 없습니다: ' + id);
  return cal;
}

function recurrence_(repeat) {
  if (repeat === 'daily') return CalendarApp.newRecurrence().addDailyRule();
  // 주간·월간 규칙은 시작일의 요일·날짜를 따라 반복된다.
  if (repeat === 'weekly') return CalendarApp.newRecurrence().addWeeklyRule();
  if (repeat === 'monthly') return CalendarApp.newRecurrence().addMonthlyRule();
  return null;
}

/** 일정을 만들고, 나중에 지울 때 필요한 정보를 돌려준다. */
function googleCreate(ev) {
  const cal = googleCalendar(ev.workspace);
  const tz = Session.getScriptTimeZone();
  const opts = { location: ev.location || '', description: ev.memo || '' };
  const rec = recurrence_(ev.repeat);
  let item;
  if (ev.allDay) {
    const start = Utilities.parseDate(ev.date, tz, 'yyyy-MM-dd');
    if (rec) {
      item = cal.createAllDayEventSeries(ev.title, start, rec, opts);
    } else {
      // 종일 일정의 종료일은 '다음 날'(배타적)이다.
      const end = Utilities.parseDate(nextDay_(ev.endDate || ev.date), tz, 'yyyy-MM-dd');
      item = cal.createAllDayEvent(ev.title, start, end, opts);
    }
  } else {
    const s = Utilities.parseDate(ev.date + ' ' + ev.start, tz, 'yyyy-MM-dd HH:mm');
    const e = Utilities.parseDate(ev.date + ' ' + ev.end, tz, 'yyyy-MM-dd HH:mm');
    item = rec ? cal.createEventSeries(ev.title, s, e, rec, opts) : cal.createEvent(ev.title, s, e, opts);
  }
  // 앱과 iCloud 쪽 알림과 같게 맞추려고 캘린더 기본 알림은 지운다.
  item.removeAllReminders();
  if (ev.reminder !== null) item.addPopupReminder(ev.reminder);
  return { id: item.getId(), calId: cal.getId(), series: !!rec };
}

function googleDelete(g) {
  const cal = CalendarApp.getCalendarById(g.calId);
  if (!cal) return;
  if (g.series) {
    const series = cal.getEventSeriesById(g.id);
    if (series) series.deleteEventSeries();
  } else {
    const event = cal.getEventById(g.id);
    if (event) event.deleteEvent();
  }
}
