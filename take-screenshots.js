const { chromium } = require('playwright');

const TODAY = new Date().toISOString().slice(0, 10);
const d = (h, m) => { const t = new Date(); t.setHours(h, m, 0, 0); return t.getTime(); };

const SAMPLE_CATS = [
  { id: 'dev',     label: 'Development', color: '#378ADD' },
  { id: 'focus',   label: 'Deep focus',  color: '#1D9E75' },
  { id: 'meeting', label: 'Meetings',    color: '#BA7517' },
];

const SAMPLE_TASKS = [
  { id: 't1', text: 'Write integration tests',          tag: 'focus',   status: 'active', date: TODAY },
  { id: 't2', text: 'Fix session timeout bug',           tag: 'dev',     status: 'done',   date: TODAY, completedAt: d(10,0) },
  { id: 't3', text: 'Update API documentation',          tag: 'dev',     status: 'todo',   date: TODAY },
  { id: 't4', text: 'Review pull request #42',           tag: 'dev',     status: 'todo',   date: TODAY },
  { id: 't5', text: 'Sprint planning prep',              tag: 'meeting', status: 'todo',   date: TODAY },
  { id: 't6', text: 'Write integration tests — happy path',  tag: 'focus', status: 'done', date: TODAY, parentId: 't1', completedAt: d(13,30) },
  { id: 't7', text: 'Write integration tests — edge cases',  tag: 'focus', status: 'todo', date: TODAY, parentId: 't1' },
];

const SAMPLE_ENTRIES = [
  { id: 'e1', text: 'Fix session timeout bug',  tag: 'dev',     date: TODAY, ts: d(8,30), tsEnd: d(10,0)  },
  { id: 'e2', text: 'Sprint planning prep',     tag: 'meeting', date: TODAY, ts: d(10,0), tsEnd: d(10,45) },
  { id: 'e3', text: 'Write integration tests',  tag: 'focus',   date: TODAY, ts: d(11,0), tsEnd: d(13,30) },
  { id: 'e4', text: 'Write integration tests',  tag: 'focus',   date: TODAY, ts: d(14,0), tsEnd: null     },
];

const t = (h, m) => { const x = new Date(); x.setHours(h, m, 0, 0); return x.toISOString(); };
const FAKE_MEETINGS = [
  { subject: 'Team standup',              start: t(9,0),  end: t(9,15),  location: '', joinUrl: null, account: null },
  { subject: 'Sprint planning',           start: t(10,0), end: t(11,0),  location: '', joinUrl: null, account: null },
  { subject: 'Lunch break',              start: t(11,30),end: t(12,0),  location: '', joinUrl: null, account: null },
  { subject: 'API design review',         start: t(13,0), end: t(13,45), location: '', joinUrl: null, account: null },
  { subject: '1:1 with tech lead',        start: t(14,30),end: t(15,0),  location: '', joinUrl: null, account: null },
];

// Create a context with the calendar API mocked and localStorage seeded
async function freshPageWithData(browser, { seedData = true } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  // Intercept calendar API before first navigation
  await page.route('**/api/calendar', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_MEETINGS) })
  );
  await page.goto('http://localhost:8080/work-log.html');
  await page.waitForTimeout(1000);
  if (seedData) {
    await page.evaluate(({ cats, tasks, entries }) => {
      localStorage.setItem('wl_cats_v1', JSON.stringify(cats));
      localStorage.setItem('wl_plan_v1', JSON.stringify(tasks));
      localStorage.setItem('wl_entries_v1', JSON.stringify(entries));
    }, { cats: SAMPLE_CATS, tasks: SAMPLE_TASKS, entries: SAMPLE_ENTRIES });
    await page.reload();
    await page.waitForTimeout(2000);
  } else {
    await page.waitForTimeout(2000);
  }
  return page;
}

(async () => {
  const browser = await chromium.launch();

  // ss1: overview — mocked calendar, no task data
  const p1 = await freshPageWithData(browser, { seedData: false });
  await p1.screenshot({ path: 'screenshots/ss1-overview.png' });

  // ss2 + ss3 + ss5: mocked calendar + seeded task/entry data
  const p2 = await freshPageWithData(browser, { seedData: true });

  // ss2: today's tasks + time log
  await p2.evaluate(() => document.getElementById('planSection').scrollIntoView());
  await p2.waitForTimeout(300);
  await p2.screenshot({ path: 'screenshots/ss2-tasks.png' });

  // ss3: timeblock
  await p2.evaluate(() => document.getElementById('tbSection').scrollIntoView());
  await p2.waitForTimeout(300);
  await p2.screenshot({ path: 'screenshots/ss3-timeblock.png' });

  // ss4: pomodoro (scroll down on p1 — clean page, fake meetings already loaded)
  await p1.evaluate(() => document.querySelector('.pomo-section').scrollIntoView());
  await p1.waitForTimeout(300);
  await p1.screenshot({ path: 'screenshots/ss4-pomodoro.png' });

  // ss5: focus mode
  await p2.evaluate(() => window.scrollTo(0, 0));
  await p2.waitForTimeout(200);
  await p2.evaluate(() => {
    document.getElementById('emergencyTask').textContent = 'Write integration tests';
    document.body.classList.add('emergency');
    const pomo = document.querySelector('.pomo-section');
    if (pomo) document.getElementById('emergencyScreen').appendChild(pomo);
  });
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: 'screenshots/ss5-focus-mode.png' });

  await browser.close();
  console.log('done');
})();
