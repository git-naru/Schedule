/**
 * iCloud 캘린더(CalDAV) 연동.
 * 일정 하나를 .ics 파일로 만들어 캘린더 주소 아래에 PUT 하면 iCloud에 저장되고, DELETE 하면 지워진다.
 *
 * 스크립트 속성:
 *   ICLOUD_USER, ICLOUD_APP_PASSWORD   Apple ID 와 앱 전용 암호
 *   ICLOUD_CALENDAR_URL                기본 캘린더 주소 (tools/find_icloud_calendar.py 로 찾음)
 *   ICLOUD_CALENDAR_URL_WORK / _PERSONAL  (선택) 업무·개인을 다른 iCloud 캘린더에 넣고 싶을 때
 */

function iCloudConfig(workspace) {
  const p = props_();
  const user = p.getProperty('ICLOUD_USER');
  const password = p.getProperty('ICLOUD_APP_PASSWORD');
  const key = workspace === 'work' ? 'ICLOUD_CALENDAR_URL_WORK' : 'ICLOUD_CALENDAR_URL_PERSONAL';
  let url = p.getProperty(key) || p.getProperty('ICLOUD_CALENDAR_URL');
  if (!user || !password || !url) return null;
  url = url.trim();
  if (!url.endsWith('/')) url += '/';
  return { user: user.trim(), password: password.trim(), calendarUrl: url };
}

function iCloudRequest_(config, url, options) {
  options.headers = Object.assign({}, options.headers, {
    Authorization: 'Basic ' + Utilities.base64Encode(config.user + ':' + config.password, Utilities.Charset.UTF_8),
  });
  options.muteHttpExceptions = true;
  return UrlFetchApp.fetch(url, options).getResponseCode();
}

/** 새로 만들거나(existingUrl 없음) 같은 주소에 덮어쓴다. 저장한 .ics 주소를 돌려준다. */
function iCloudPut(ev, existingUrl) {
  const config = iCloudConfig(ev.workspace);
  if (!config) throw new Error('iCloud 설정이 없습니다');
  const uid = ev.id;
  const url = existingUrl || config.calendarUrl + uid + '.ics';
  const headers = existingUrl ? {} : { 'If-None-Match': '*' };
  const code = iCloudRequest_(config, url, {
    method: 'put',
    contentType: 'text/calendar; charset=utf-8',
    payload: Utilities.newBlob(buildIcs_(ev, uid, new Date())).getBytes(),
    headers: headers,
  });
  if (code !== 201 && code !== 204) throw new Error(describeICloudError_(code));
  return url;
}

function iCloudDelete(workspace, url) {
  const config = iCloudConfig(workspace);
  if (!config) return;
  const code = iCloudRequest_(config, url, { method: 'delete' });
  // 이미 지워진 일정(404)은 성공으로 본다.
  if (code !== 200 && code !== 204 && code !== 404) throw new Error(describeICloudError_(code));
}

function describeICloudError_(code) {
  if (code === 401) return 'iCloud 인증 실패 (Apple ID 또는 앱 전용 암호 확인)';
  if (code === 403 || code === 404) return 'iCloud 캘린더 주소를 확인하세요 (HTTP ' + code + ')';
  if (code === 412) return '같은 일정이 iCloud에 이미 있습니다 (HTTP 412)';
  return 'iCloud 저장 실패 (HTTP ' + code + ')';
}

// ---- 아래는 순수 함수 (iCalendar 텍스트 생성) — tests/ 에서 Node 로 검사한다 ----

/**
 * ev: { title, location, memo, allDay, date, endDate, start, end, repeat, reminder }
 * 시간은 서울 시간(UTC+9, 서머타임 없음) 기준 문자열이다.
 */
function buildIcs_(ev, uid, now) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//My Base//Schedule//KO',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + toIcsUtc_(now),
  ];
  if (ev.allDay) {
    lines.push('DTSTART;VALUE=DATE:' + ev.date.replace(/-/g, ''));
    lines.push('DTEND;VALUE=DATE:' + nextDay_(ev.endDate || ev.date).replace(/-/g, ''));
  } else {
    lines.push('DTSTART:' + toIcsUtc_(seoulToDate_(ev.date, ev.start)));
    lines.push('DTEND:' + toIcsUtc_(seoulToDate_(ev.date, ev.end)));
  }
  const rrule = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }[ev.repeat];
  if (rrule) lines.push('RRULE:FREQ=' + rrule);
  lines.push('SUMMARY:' + escapeIcsText_(ev.title));
  if (ev.location) lines.push('LOCATION:' + escapeIcsText_(ev.location));
  if (ev.memo) lines.push('DESCRIPTION:' + escapeIcsText_(ev.memo));
  if (ev.reminder !== null && ev.reminder !== undefined && ev.reminder !== '') {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + escapeIcsText_(ev.title),
      'TRIGGER:' + toIcsTrigger_(Number(ev.reminder)),
      'END:VALARM'
    );
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldIcsLine_).join('\r\n') + '\r\n';
}

/** '2026-10-30', '14:00' (서울) → Date */
function seoulToDate_(ymd, hm) {
  const d = ymd.split('-').map(Number);
  const t = hm.split(':').map(Number);
  return new Date(Date.UTC(d[0], d[1] - 1, d[2], t[0] - 9, t[1]));
}

/** Date → 20261030T050000Z */
function toIcsUtc_(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** '2026-10-31' → '2026-11-01' */
function nextDay_(ymd) {
  const p = ymd.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1)).toISOString().slice(0, 10);
}

function toIcsTrigger_(minutes) {
  if (minutes === 0) return 'PT0S';
  if (minutes % 1440 === 0) return '-P' + minutes / 1440 + 'D';
  return '-PT' + minutes + 'M';
}

function escapeIcsText_(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** RFC 5545: 한 줄은 75바이트(UTF-8)를 넘지 않게 접는다. 한글이 중간에 잘리지 않도록 글자 단위로 센다. */
function foldIcsLine_(line) {
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    const limit = parts.length === 0 ? 75 : 74; // 이어지는 줄은 앞의 공백 1바이트 포함
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}
