// 화면 미리보기: 가짜 Apps Script 위에서 실제 서버 코드 + Index.html 을 띄우고 화면을 캡처한다.
//   node dev/preview.js [출력 폴더]
// 예시 데이터는 미리보기에만 쓰이며 실제 시트에는 들어가지 않는다.
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const { createContext } = require('./fake-gas');

const out = path.resolve(process.argv[2] || path.join(__dirname, 'shots'));
fs.mkdirSync(out, { recursive: true });

function seed(g, today) {
  const add = (d, n) => { const t = new Date(today + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const boot = g.call('bootstrap');
  const proj = boot.databases.find(d => d.name === '프로젝트');
  const budget = boot.databases.find(d => d.name === '가계부');
  const a = g.call('saveRecord', { dbId: proj.id, title: '[예시] 프로젝트 A', values: { f1: '진행 중', f2: '[예시] 거래처 1', f3: add(today, 15), f4: '제안서' }, memo: '진행 상황 메모 (예시)' });
  g.call('saveRecord', { dbId: proj.id, title: '[예시] 프로젝트 B', values: { f1: '대기', f2: '[예시] 거래처 2', f3: add(today, 30) } });
  g.call('saveRecord', { dbId: budget.id, title: '[예시] 장보기', values: { f1: today, f2: '지출', f3: '42000', f4: '식비' } });
  const ev = (o) => g.call('saveEvent', Object.assign({ workspace: 'work', repeat: 'none', reminder: '10', toGoogle: true, toApple: false }, o));
  ev({ title: '[예시] 주간 팀 회의', date: add(today, -((new Date(today).getUTCDay() + 6) % 7)), start: '09:30', end: '10:30', repeat: 'weekly', location: '3층 회의실' });
  ev({ title: '[예시] 거래처 미팅', date: today, start: '14:00', end: '15:30', recordId: a.id });
  ev({ title: '[예시] 자료 검토', date: today, start: '14:30', end: '15:00' });
  ev({ title: '[예시] 운동', workspace: 'personal', date: add(today, -3), start: '19:00', end: '20:00', repeat: 'weekly' });
  ev({ title: '[예시] 가족 여행', workspace: 'personal', allDay: true, date: add(today, 2), endDate: add(today, 4) });
  g.call('saveTask', { title: '[예시] 보고서 초안 제출', workspace: 'work', due: add(today, 1) });
  g.call('saveTask', { title: '[예시] 관리비 납부', workspace: 'personal' });
  g.call('saveMemo', { text: '[예시] 미팅 전에 견적서 다시 확인하기' });
}

(async () => {
  const g = createContext({ props: { ICLOUD_USER: 'x', ICLOUD_APP_PASSWORD: 'y', ICLOUD_CALENDAR_URL: 'https://example.invalid/cal/' } });
  const today = g.call('bootstrap').today;
  seed(g, today);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  async function open(viewport) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test((m.location() || {}).url || '')) errors.push(m.text()); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.exposeFunction('__api', (a, p) => { try { return g.call(a, p); } catch (e) { return { __error: e.message }; } });
    await page.addInitScript(() => {
      function make(ok, fail) {
        return {
          withSuccessHandler: fn => make(fn, fail),
          withFailureHandler: fn => make(ok, fn),
          api: (a, p) => window.__api(a, p).then(r => (r && r.__error ? fail && fail(new Error(r.__error)) : ok && ok(r))),
        };
      }
      window.google = { script: { run: make() } };
    });
    await page.goto('file://' + path.join(__dirname, '..', 'apps-script', 'Index.html'));
    await page.waitForSelector('#loading[hidden]', { state: 'attached' });
    return page;
  }
  const shot = (page, name) => page.screenshot({ path: path.join(out, name + '.png') });

  const p = await open({ width: 1280, height: 800 });
  await shot(p, '1-dashboard');
  await p.click('.acc-h[data-acc="work"]'); await p.waitForTimeout(450); await shot(p, '2-menu-open');
  await p.click('.hd .segv [data-go="week"]'); await p.waitForTimeout(100); await shot(p, '3-week');
  await p.click('.segv [data-go="month"]'); await p.waitForTimeout(100); await shot(p, '4-month');
  await p.click('.acc-h[data-acc="work"]'); await p.waitForTimeout(450); await p.click('.acc.open [data-go="db"]'); await p.click('tr[data-rec]'); await shot(p, '5-database');
  await p.click('[data-act="edit-db"]'); await shot(p, '6-db-edit'); await p.click('#dbForm [data-act="close-dlg"]');
  await p.click('.btn[data-act="new-rec"]');
  await p.click('.acc-h[data-acc="home"]'); await p.waitForTimeout(400);
  await p.click('.side [data-go="dash"][data-day]');
  await p.click('.blk'); await shot(p, '7-event-edit');
  await p.fill('#eTitle', '[예시] 거래처 미팅 (변경)'); await p.click('#evForm [type=submit]');
  await p.waitForSelector('#ov[hidden]', { state: 'attached' }); await shot(p, '8-saved-toast');
  await p.click('.btn[data-act="new-event"]'); await p.click('[data-act="dlg-task"]'); await p.fill('#tTitle', '[예시] 새 할 일'); await p.click('#taskDlg [type=submit]');
  await p.waitForSelector('#ov[hidden]', { state: 'attached' });
  await p.fill('#q', '예시'); await p.waitForTimeout(400); await shot(p, '9-search');
  await p.click('[data-act="clear-search"]');
  await p.click('.acc-h[data-acc="set"]'); await p.waitForTimeout(400); await p.click('[data-go="settings"]');
  await p.click('[data-theme="posco-navy"]'); await shot(p, '10-settings-theme');
  await p.click('[data-theme="code-dark"]');

  const tab = await open({ width: 800, height: 1280 });
  await shot(tab, '11-tablet-portrait');
  await tab.click('.hd .menu-btn'); await tab.waitForTimeout(350); await shot(tab, '12-portrait-menu');
  const phone = await open({ width: 390, height: 844 });
  await shot(phone, '13-phone');
  await phone.click('.hd .segv [data-go="month"]'); await shot(phone, '14-phone-month');

  // 가로 스크롤(페이지가 화면보다 넓어지는지) 확인
  for (const [name, pg] of [['tablet', tab], ['phone', phone]]) {
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 0) errors.push(name + ': 페이지가 ' + over + 'px 넘칩니다');
  }
  await browser.close();
  const ext = g.calls.filter(c => /^(google|icloud)/.test(c[0])).length;
  console.log('캡처 완료:', out);
  console.log('외부 캘린더 호출(가짜) 수:', ext);
  console.log(errors.length ? '오류:\n' + errors.join('\n') : '콘솔 오류 없음');
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
