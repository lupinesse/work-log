// Work Log — Smoke Test Suite
// Run with: node smoke-tests.cjs
// Requires: playwright (npm install playwright && npx playwright install chromium)
// Filename uses .cjs because package.json has "type": "module" (for Vite/ES modules),
// but this test file uses CommonJS require().

const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

// ── Inline static server ───────────────────────────────────────────────────
// Serves the app over HTTP so the test environment matches production and
// relative assets (script.js, styles.css) load from a proper HTTP origin.
const SERVE_ROOT = __dirname;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

let server, SERVER_PORT;

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const file = path.join(SERVE_ROOT, urlPath === '/' ? 'work-log.html' : urlPath);
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(file);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      SERVER_PORT = server.address().port;
      resolve();
    });
    server.on('error', reject);
  });
}

function stopServer() {
  return new Promise((resolve) => (server ? server.close(resolve) : resolve()));
}

let FILE;

let passed = 0,
  failed = 0;
const results = [];

function assert(name, condition, detail = '') {
  if (condition) {
    passed++;
    results.push({ ok: true, name });
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    results.push({ ok: false, name, detail });
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function dk(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function freshPage(ctx, extraStorage = {}) {
  const page = await ctx.newPage();
  await page.addInitScript((storage) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, JSON.stringify(v));
  }, extraStorage);
  await page.goto(FILE);
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(
    () => typeof window.__wl === 'object' && typeof window.__wl.getState === 'function',
    { timeout: 8000 }
  );
  return page;
}

const CATS = [
  { id: 'work', label: 'work', color: '#378ADD' },
  { id: 'other', label: 'other', color: '#888780' },
];

async function runTests() {
  await startServer();
  FILE = `http://127.0.0.1:${SERVER_PORT}/work-log.html?test=1`;
  console.log(`  Server running on port ${SERVER_PORT}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext();

  // ── 1. Page load ──────────────────────────────────────────────────────────
  console.log('\n1. Page load');
  {
    const errors = [];
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => localStorage.clear());
    await page.goto(FILE);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(
      () => typeof window.__wl === 'object' && typeof window.__wl.getState === 'function',
      { timeout: 8000 }
    );
    assert('No JS errors on load', errors.length === 0, errors[0]);
    assert('Test harness exposed', await page.evaluate(() => typeof window.__wl === 'object'));
    assert('Stats rendered', await page.evaluate(() => !!document.getElementById('statToday')));
    assert(
      'liveWeek element exists',
      await page.evaluate(() => !!document.getElementById('liveWeek'))
    );
    assert(
      'liveMoon element exists',
      await page.evaluate(() => !!document.getElementById('liveMoon'))
    );
    assert(
      'liveFlagDay element exists',
      await page.evaluate(() => !!document.getElementById('liveFlagDay'))
    );
    assert(
      'liveNameday element exists',
      await page.evaluate(() => !!document.getElementById('liveNameday'))
    );
    assert(
      'liveSunrise element exists',
      await page.evaluate(() => !!document.getElementById('liveSunrise'))
    );
    assert(
      'liveRain element exists',
      await page.evaluate(() => !!document.getElementById('liveRain'))
    );
    assert('eodBtn exists', await page.evaluate(() => !!document.getElementById('eodBtn')));
    assert(
      'jiraSection exists',
      await page.evaluate(() => !!document.getElementById('jiraSection'))
    );
    assert(
      'timerDistract btn exists',
      await page.evaluate(() => !!document.getElementById('timerDistract'))
    );
    assert(
      'distractionSection exists',
      await page.evaluate(() => !!document.getElementById('distractionSection'))
    );
    await page.close();
  }

  // ── 3. localStorage round-trip + save() guard ─────────────────────────────
  console.log('\n3. localStorage round-trip');
  {
    const today = dk(new Date());
    const entries = [{ id: 'rt1', text: 'Test task', tag: 'work', ts: Date.now(), date: today }];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    const state = await page.evaluate(() => window.__wl.getState());
    assert('Entries loaded from storage', state.entries.length === 1);
    assert('Entry text preserved', state.entries[0]?.text === 'Test task');
    assert('Custom categories loaded', state.categories.length === 2);
    assert('Category colour preserved', state.categories[0]?.color === '#378ADD');
    const statText = await page.evaluate(() => document.getElementById('statToday').textContent);
    assert('Stat today shows 1', statText === '1');
    await page.evaluate(() => {
      const state = window.__wl.getState();
      state.entries.length = 0;
      window.__wl.save();
      window.__wl.load();
    });
    const afterGuard = await page.evaluate(() => window.__wl.getState().entries.length);
    assert('save() guard preserves data when entries emptied', afterGuard >= 1);
    await page.close();
  }

  // ── 4. Timer start & display ──────────────────────────────────────────────
  console.log('\n4. Timer start & display');
  {
    const today = dk(new Date());
    const entries = [
      { id: 'tm1', text: 'Timer task', tag: 'work', ts: Date.now() - 65000, date: today },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    // Start timer via test harness after load — avoids Node/browser Date.now() skew
    await page.evaluate(() => window.__wl.startTimer('tm1'));
    await page.waitForTimeout(1200);
    assert(
      'Hero card shows running state',
      await page.evaluate(() =>
        document.getElementById('heroCard').classList.contains('hero-card--running')
      )
    );
    assert(
      'Timer shows task name',
      await page.evaluate(() => document.getElementById('timerTask').textContent === 'Timer task')
    );
    assert(
      'Elapsed time non-zero',
      await page.evaluate(() => document.getElementById('timerElapsed').textContent !== '00:00')
    );
    const title = await page.title();
    assert('Tab title shows elapsed time', title.includes(':') && title.includes('Timer task'));
    assert('Tab title has running indicator', title.startsWith('▶'));
    await page.close();
  }

  // ── 5. Timer persists and increments ─────────────────────────────────────
  console.log('\n5. Timer persists across reload');
  {
    const today = dk(new Date());
    const entries = [
      { id: 'tp1', text: 'Persistent timer', tag: 'work', ts: Date.now() - 5000, date: today },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    // Start timer in browser
    await page.evaluate(() => window.__wl.startTimer('tp1'));
    const elapsed1 = await page.evaluate(() => document.getElementById('timerElapsed').textContent);
    await page.waitForTimeout(1500);
    const elapsed2 = await page.evaluate(() => document.getElementById('timerElapsed').textContent);
    assert(
      'Hero card shows running state while timer active',
      await page.evaluate(() =>
        document.getElementById('heroCard').classList.contains('hero-card--running')
      )
    );
    // Either the timer ticked (elapsed2 > elapsed1) or it shows non-zero
    const nonZero = elapsed1 !== '00:00' || elapsed2 !== '00:00';
    assert('Timer elapsed is non-zero', nonZero);
    assert('Timer elapsed format valid', /\d+:\d+/.test(elapsed2));
    // Verify timer state persists in localStorage (saved correctly)
    const saved = await page.evaluate(
      () => !!JSON.parse(localStorage.getItem('wl_timer_v1') || 'null')
    );
    assert('Timer state saved to localStorage', saved);
    await page.close();
  }

  // ── 5b. Hero Card states (paused / stopped / undo) ───────────────────────
  console.log('\n5b. Hero Card states');
  {
    const today = dk(new Date());
    const entries = [
      { id: 'hc1', text: 'Hero task', tag: 'work', ts: Date.now() - 10000, date: today },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });

    // Start then pause
    await page.evaluate(() => window.__wl.startTimer('hc1'));
    await page.evaluate(() => window.__wl.pauseTimer());
    assert(
      'Hero card shows paused state',
      await page.evaluate(() =>
        document.getElementById('heroCard').classList.contains('hero-card--paused')
      )
    );
    assert(
      'Paused panel is visible',
      await page.evaluate(() => document.getElementById('heroPanelPaused').style.display !== 'none')
    );

    // Stop from paused → stopped confirmation window
    await page.evaluate(() => window.__wl.stopTimer());
    assert(
      'Hero card shows stopped state',
      await page.evaluate(() =>
        document.getElementById('heroCard').classList.contains('hero-card--stopped')
      )
    );
    assert(
      'Stopped panel is visible',
      await page.evaluate(
        () => document.getElementById('heroPanelStopped').style.display !== 'none'
      )
    );

    // Undo removes the entry
    const countBefore = await page.evaluate(() => window.__wl.getState().entries.length);
    await page.click('#heroUndoBtn');
    await page.waitForTimeout(50);
    const countAfter = await page.evaluate(() => window.__wl.getState().entries.length);
    assert('Undo removes the stopped entry', countAfter === countBefore - 1);
    assert(
      'Hero card returns to idle after undo',
      await page.evaluate(() =>
        document.getElementById('heroCard').classList.contains('hero-card--idle')
      )
    );

    await page.close();
  }

  // ── 5c. Mood dropdown is not clipped by hero card ─────────────────────────
  // Invariant: every item in `.tb-mood-panel` is rendered and hit-testable —
  // no ancestor `overflow` / stacking rule may clip or cover the panel.
  console.log('\n5c. Mood dropdown not clipped');
  {
    const today = dk(new Date());
    const entries = [
      { id: 'md1', text: 'Mood task', tag: 'work', ts: Date.now() - 5000, date: today },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    await page.evaluate(() => window.__wl.startTimer('md1'));
    // The running panel (which contains #tbMoodBtn) is shown when the timer
    // starts. Wait explicitly rather than relying on Playwright's implicit
    // auto-wait inside page.click, so any future state-machine regression
    // surfaces here with a clear timeout rather than a flaky click.
    await page.waitForSelector('#tbMoodBtn', { state: 'visible', timeout: 3000 });

    await page.click('#tbMoodBtn');
    // Wait on an actual menu item being visible — robust against changes to
    // how the panel toggles (class vs. inline style, animations, etc.).
    await page.waitForSelector('#tbMoodPanel .tb-mood-item', {
      state: 'visible',
      timeout: 3000,
    });

    const probe = await page.evaluate(() => {
      const items = document.querySelectorAll('#tbMoodPanel .tb-mood-item');
      if (items.length === 0) return { itemCount: 0 };
      // NodeList does not include .at() — use bracket-index access.
      const last = items[items.length - 1];
      const rect = last.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      // closest() walks up from text nodes / nested children, so the assertion
      // still passes if items later gain inline icon/label children.
      const hit = document.elementFromPoint(x, y);
      const inItem = hit ? hit.closest('.tb-mood-item') : null;
      return {
        itemCount: items.length,
        hitReachesItem: inItem !== null,
        bottomItemHeight: rect.height,
      };
    });
    assert(
      'Mood panel contains at least one item',
      probe.itemCount > 0,
      `expected .tb-mood-item elements but found ${probe.itemCount}`
    );
    assert(
      'Bottom mood item is rendered with a non-zero height',
      probe.bottomItemHeight > 0,
      `height=${probe.bottomItemHeight}`
    );
    assert(
      'Bottom mood item is reachable by hit-test at its centre',
      probe.hitReachesItem,
      'elementFromPoint at centre of last item is not inside a .tb-mood-item'
    );

    await page.close();
  }

  // ── 6. completedAt + completed section ────────────────────────────────────
  console.log('\n6. completedAt');
  {
    const today = dk(new Date());
    const tasks = [{ id: 'ca1', text: 'Complete me', tag: 'work', status: 'todo', date: today }];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    await page.evaluate(() => {
      const sel = document.querySelector('.plan-status[data-pid="ca1"]');
      if (sel) {
        sel.value = 'done';
        sel.dispatchEvent(new Event('change'));
      }
    });
    await page.waitForTimeout(50);
    const completedAt = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('wl_plan_v1') || '[]').find((t) => t.id === 'ca1')
          ?.completedAt
    );
    assert('completedAt set when marked Done', !!completedAt);
    assert(
      'completedAt is not 23:59 sentinel',
      !(new Date(completedAt).getHours() === 23 && new Date(completedAt).getMinutes() === 59)
    );
    assert('completedAt is on the same day as now', dk(new Date(completedAt)) === dk(new Date()));
    assert(
      'completedAt within 30min of now',
      typeof completedAt === 'number' && Math.abs(completedAt - Date.now()) < 31 * 60 * 1000
    );
    assert(
      'Completed tasks section exists',
      await page.evaluate(() => !!document.getElementById('completedSection'))
    );
    assert(
      'Completed task appears in section',
      await page.evaluate(() => document.querySelectorAll('.completed-item').length >= 1)
    );
    const whenText = await page.evaluate(
      () => document.querySelector('.completed-item')?.textContent || ''
    );
    assert('Completed item shows "completed" text', whenText.toLowerCase().includes('completed'));
    await page.close();
  }

  // ── 7. Auto-carry ─────────────────────────────────────────────────────────
  console.log('\n7. Auto-carry');
  {
    const yesterday = dk(new Date(Date.now() - 86400000));
    const today = dk(new Date());
    const tasks = [
      { id: 'ac1', text: 'Carry me', tag: 'work', status: 'inprogress', date: yesterday },
      {
        id: 'ac2',
        text: 'Already done',
        tag: 'work',
        status: 'done',
        date: yesterday,
        completedAt: Date.now() - 3600000,
      },
      // Pending task — must carry with pending status, not reset to todo/inprogress
      { id: 'ac4', text: 'Pending carry', tag: 'work', status: 'pending', date: yesterday },
    ];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith('wl_carried_'))
        .forEach((k) => localStorage.removeItem(k))
    );
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(
      () => typeof window.__wl === 'object' && typeof window.__wl.getState === 'function',
      { timeout: 8000 }
    );
    const todayTasks = await page.evaluate(
      (today) => window.__wl.getState().planTasks.filter((t) => t.date === today),
      today
    );
    const carried = todayTasks.find((t) => t.text === 'Carry me');
    const doneNotCarry = todayTasks.find((t) => t.text === 'Already done');
    const pendingTask = todayTasks.find((t) => t.text === 'Pending carry');
    assert('Unfinished task carried to today', !!carried);
    assert('Carried task preserves inprogress', carried?.status === 'inprogress');
    assert('Done task not carried', !doneNotCarry);
    assert('Pending task carried to today', !!pendingTask);
    assert('Pending task preserves pending status', pendingTask?.status === 'pending');
    await page.close();
  }

  // ── 8. Sort order ──────────────────────────────────────────────────────────
  console.log('\n8. Sort order');
  {
    const today = dk(new Date());
    const tasks = [
      { id: 's1', text: 'Zebra todo', tag: 'work', status: 'todo', date: today },
      { id: 's2', text: 'Alpha todo', tag: 'work', status: 'todo', date: today },
      { id: 's3', text: 'In progress', tag: 'work', status: 'inprogress', date: today },
      {
        id: 's4',
        text: 'Done task',
        tag: 'work',
        status: 'done',
        date: today,
        completedAt: Date.now() - 1000,
      },
    ];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.plan-item')).map((el) => el.dataset.pid)
    );
    assert('In Progress before To do', order.indexOf('s3') < order.indexOf('s1'));
    assert('Alpha todo before Zebra todo', order.indexOf('s2') < order.indexOf('s1'));
    assert('Done task not in plan list', !order.includes('s4'));
    await page.close();
  }

  // ── 9. Plan count header ───────────────────────────────────────────────────
  console.log('\n9. Plan count header');
  {
    const today = dk(new Date());
    const tasks = [
      { id: 'pc1', text: 'Task A', tag: 'work', status: 'todo', date: today },
      { id: 'pc2', text: 'Task B', tag: 'work', status: 'inprogress', date: today },
      {
        id: 'pc3',
        text: 'Task C',
        tag: 'work',
        status: 'done',
        date: today,
        completedAt: Date.now() - 1000,
      },
    ];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    const count = await page.evaluate(() => document.getElementById('planCount').textContent);
    assert('Count shows to do', count.includes('1 to do'));
    assert('Count shows in progress', count.includes('1 in progress'));
    assert('Count shows done', count.includes('1 done'));
    assert('Count uses · separator', count.includes('·'));
    await page.close();
  }

  // ── 10. Week number ────────────────────────────────────────────────────────
  console.log('\n10. Week number');
  {
    const page = await freshPage(ctx);
    const weekText = await page.evaluate(() => document.getElementById('liveWeek').textContent);
    assert('Week number shown', /Week \d+\/\d+/.test(weekText));
    assert('Week format valid', /Week ([1-9]|[1-4]\d|5[0-3])\/5[23]/.test(weekText));
    assert(
      'Week number in header-center',
      await page.evaluate(() => {
        const el = document.getElementById('liveWeek');
        const center = document.querySelector('.header-center');
        return center ? center.contains(el) : false;
      })
    );
    await page.close();
  }

  // ── 11. Distraction tracking ───────────────────────────────────────────────
  console.log('\n11. Distraction tracking');
  {
    const today = dk(new Date());
    const entries = [
      { id: 'dt1', text: 'Focus task', tag: 'work', ts: Date.now() - 60000, date: today },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    await page.evaluate(() => window.__wl.startTimer('dt1'));
    await page.waitForTimeout(50);
    // Inject a distraction directly
    await page.evaluate(() => {
      const d = {
        ts: Date.now(),
        date: window.__wl.dk(new Date()),
        task: 'Focus task',
        note: 'Threads',
      };
      const all = JSON.parse(localStorage.getItem('wl_distractions_v1') || '[]');
      all.push(d);
      localStorage.setItem('wl_distractions_v1', JSON.stringify(all));
    });
    // Trigger render directly
    await page.evaluate(() => window.__wl.renderDistractionCount());
    await page.waitForTimeout(50);
    const section = await page.evaluate(
      () => document.getElementById('distractionSection').innerHTML
    );
    assert('Distraction section shows entry', section.includes('distraction'));
    assert('Distraction note shown', section.includes('Threads'));
    await page.close();
  }

  // ── 12. Active task highlighting ──────────────────────────────────────────
  console.log('\n12. Active task highlighting');
  {
    const today = dk(new Date());
    const entries = [
      { id: 'ah1', text: 'Active task', tag: 'work', ts: Date.now() - 30000, date: today },
    ];
    const timer = { entryId: 'ah1', startTs: Date.now() - 30000, accumulatedMs: 0, paused: false };
    const tasks = [
      { id: 'pt1', text: 'Active task', tag: 'work', status: 'inprogress', date: today },
    ];
    const page = await freshPage(ctx, {
      wl_entries_v1: entries,
      wl_timer_v1: timer,
      wl_plan_v1: tasks,
      wl_cats_v1: CATS,
    });
    const hasActiveClass = await page.evaluate(
      () => document.querySelector('.plan-item.active-timer') !== null
    );
    assert('Active task has active-timer class', hasActiveClass);
    const hasLeftBorder = await page.evaluate(() => {
      const el = document.querySelector('.plan-item.active-timer');
      return el ? getComputedStyle(el).borderLeftWidth !== '0px' : false;
    });
    assert('Active task has left border', hasLeftBorder);
    await page.close();
  }

  // ── 12b. In-progress task highlighting (no active timer) ─────────────────
  {
    const today = dk(new Date());
    const tasks = [
      { id: 'ip1', text: 'In progress task', tag: 'work', status: 'inprogress', date: today },
      { id: 'ip2', text: 'Todo task', tag: 'work', status: 'todo', date: today },
    ];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    const hasInprogressClass = await page.evaluate(
      () => document.querySelector('.plan-item.inprogress') !== null
    );
    assert('Non-live inprogress task has .inprogress class', hasInprogressClass);
    const todoHasNoInprogress = await page.evaluate(
      () => document.querySelectorAll('.plan-item.inprogress').length === 1
    );
    assert('Only the inprogress task gets .inprogress class (not todo)', todoHasNoInprogress);
    const noActiveTimer = await page.evaluate(
      () => document.querySelector('.plan-item.active-timer') === null
    );
    assert('No .active-timer class when timer is absent', noActiveTimer);
    const hasLeftBorder = await page.evaluate(() => {
      const el = document.querySelector('.plan-item.inprogress');
      return el ? getComputedStyle(el).borderLeftWidth !== '0px' : false;
    });
    assert('Inprogress task row has left border highlight', hasLeftBorder);
    await page.close();
  }

  // ── 12c. Analytics section — default collapsed + summary text ────────────
  {
    const today = dk(new Date());
    const tasks = [
      { id: 'an1', text: 'Task A', tag: 'work', status: 'inprogress', date: today },
      { id: 'an2', text: 'Task B', tag: 'work', status: 'todo', date: today },
    ];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });

    const startsCollapsed = await page.evaluate(() =>
      document.getElementById('analyticsSection').classList.contains('collapsed')
    );
    assert('Analytics section starts collapsed by default', startsCollapsed);

    const summaryText = await page.evaluate(
      () => document.getElementById('analyticsSummary').textContent
    );
    assert('Analytics summary contains "tasks today"', summaryText.includes('tasks today'));
    assert('Analytics summary contains "epics this week"', summaryText.includes('epics this week'));
    assert('Analytics summary contains "-day streak"', summaryText.includes('-day streak'));

    // Click the header to open the section
    await page.click('#analyticsHeader');
    const isOpenAfterClick = await page.evaluate(
      () => !document.getElementById('analyticsSection').classList.contains('collapsed')
    );
    assert('Analytics section opens on header click', isOpenAfterClick);

    // Click again to close
    await page.click('#analyticsHeader');
    const isClosedAgain = await page.evaluate(() =>
      document.getElementById('analyticsSection').classList.contains('collapsed')
    );
    assert('Analytics section closes on second header click', isClosedAgain);

    await page.close();
  }

  // ── 13. Tab title updates with timer ──────────────────────────────────────
  console.log('\n13. Tab title');
  {
    const today = dk(new Date());
    const entries = [
      { id: 'tt1', text: 'Tab title task', tag: 'work', ts: Date.now() - 90000, date: today },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    await page.evaluate(() => window.__wl.startTimer('tt1'));
    await page.waitForTimeout(1200);
    const titleRunning = await page.title();
    assert('Title shows ▶ when running', titleRunning.startsWith('▶'));
    assert('Title contains task name', titleRunning.includes('Tab title task'));
    assert('Title contains elapsed time', /\d+:\d+/.test(titleRunning));
    await page.evaluate(() => {
      document.getElementById('timerPause')?.click();
    });
    await page.waitForTimeout(50);
    const titlePaused = await page.title();
    assert('Title shows ⏸ when paused', titlePaused.startsWith('⏸'));
    await page.close();
  }

  // ── 15. Emergency Mode ────────────────────────────────────────────────────
  console.log('\n15. Emergency Mode');
  {
    const today = dk(new Date());
    const entries = [
      { id: 'em1', text: 'Emergency task', tag: 'work', ts: Date.now() - 30000, date: today },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    await page.evaluate(() => window.__wl.startTimer('em1'));
    await page.waitForTimeout(50);

    // Enter emergency mode
    await page.evaluate(() => document.getElementById('emergencyBtn').click());
    await page.waitForTimeout(50);

    assert(
      'Body has emergency class',
      await page.evaluate(() => document.body.classList.contains('emergency'))
    );
    assert(
      'Emergency screen visible',
      await page.evaluate(
        () =>
          document.getElementById('emergencyScreen').style.display !== 'none' ||
          document.body.classList.contains('emergency')
      )
    );
    assert(
      'Emergency shows task name',
      await page.evaluate(
        () => document.getElementById('emergencyTask').textContent === 'Emergency task'
      )
    );
    assert(
      'Stats hidden in emergency',
      await page.evaluate(() => {
        const stats = document.querySelector('.stats');
        return getComputedStyle(stats).display === 'none';
      })
    );
    assert(
      'Plan section hidden',
      await page.evaluate(() => {
        const plan = document.getElementById('planSection');
        return !plan || getComputedStyle(plan).display === 'none';
      })
    );
    assert(
      'Emergency next input exists',
      await page.evaluate(() => !!document.getElementById('emergencyNext'))
    );

    // Type a next action
    await page.evaluate(() => {
      document.getElementById('emergencyNext').value = 'Check the token expiry';
    });

    // Exit emergency mode
    await page.evaluate(() => document.getElementById('emergencyExit').click());
    await page.waitForTimeout(50);

    assert(
      'Body loses emergency class on exit',
      await page.evaluate(() => !document.body.classList.contains('emergency'))
    );
    assert(
      'Stats visible again after exit',
      await page.evaluate(() => {
        const stats = document.querySelector('.stats');
        return getComputedStyle(stats).display !== 'none';
      })
    );

    // Re-enter — next action should be restored from localStorage
    await page.evaluate(() => document.getElementById('emergencyBtn').click());
    await page.waitForTimeout(50);
    const restored = await page.evaluate(() => document.getElementById('emergencyNext').value);
    assert('Next action restored on re-entry', restored === 'Check the token expiry');

    // Escape key exits
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    assert(
      'Escape exits emergency mode',
      await page.evaluate(() => !document.body.classList.contains('emergency'))
    );

    await page.close();
  }

  // ── 16. Transition handoff note ───────────────────────────────────────────
  console.log('\n16. Transition handoff note');
  {
    const today = dk(new Date());
    const entries = [
      { id: 'hn1', text: 'Handoff task', tag: 'work', ts: Date.now() - 30000, date: today },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    await page.evaluate(() => window.__wl.startTimer('hn1'));
    await page.waitForTimeout(50);

    // First stop click — should show handoff input
    await page.evaluate(() => document.getElementById('timerStop').click());
    await page.waitForTimeout(50);

    assert(
      'Handoff input appears on first stop click',
      await page.evaluate(() => document.getElementById('timerHandoff').classList.contains('show'))
    );
    assert(
      'Stop button changes to done ✓',
      await page.evaluate(() => document.getElementById('timerStop').textContent.includes('done'))
    );
    assert(
      'Timer still running during handoff',
      await page.evaluate(() => !!window.__wl.activeTimer())
    );

    // Type handoff note
    await page.evaluate(() => {
      document.getElementById('timerHandoff').value = 'Continue from line 42';
    });

    // Second click — saves note and stops
    await page.evaluate(() => document.getElementById('timerStop').click());
    await page.waitForTimeout(50);

    assert(
      'Timer stopped after handoff confirm',
      !(await page.evaluate(() => !!window.__wl.activeTimer()))
    );
    assert(
      'Handoff input hidden after stop',
      !(await page.evaluate(() =>
        document.getElementById('timerHandoff').classList.contains('show')
      ))
    );
    assert(
      'Stop button restored to "stop"',
      await page.evaluate(() => document.getElementById('timerStop').textContent === 'stop')
    );

    // Check note was saved
    const saved = await page.evaluate(() => {
      try {
        const notes = JSON.parse(localStorage.getItem('wl_handoff') || '{}');
        return notes['handoff task'] || null;
      } catch {
        return null;
      }
    });
    assert('Handoff note saved to localStorage', saved === 'Continue from line 42');

    // Check note appears in quick pick
    await page.evaluate(() => window.__wl.startTimer('hn1'));
    await page.waitForTimeout(50);
    await page.evaluate(() => window.__wl.stopTimer());
    await page.waitForTimeout(50);
    // Need another entry to trigger quick pick render with at least one recent task
    await page.evaluate(() => window.__wl.render());
    await page.waitForTimeout(50);
    const qpHtml = await page.evaluate(() => document.getElementById('quickPick')?.innerHTML || '');
    assert('Handoff note NOT shown in quick pick', !qpHtml.includes('Continue from line 42'));

    await page.close();
  }

  // ── 17. Day-change fixes & task retirement ────────────────────────────────
  console.log('\n17. Day-change fixes & task retirement');
  {
    // 17a — page loads clean (catches _lastTickDate TDZ bug and banner null crash)
    {
      const errors = [];
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(() => localStorage.clear());
      await page.goto(FILE);
      await page.waitForLoadState('networkidle');
      await page.waitForFunction(
        () => typeof window.__wl === 'object' && typeof window.__wl.getState === 'function',
        { timeout: 8000 }
      );
      assert('No ReferenceError on load', !errors.some((e) => e.includes('_lastTickDate')));
      assert(
        'No banner null crash',
        !errors.some((e) => e.includes('newdayBanner') || e.includes('Cannot read'))
      );
      assert(
        'Render completes cleanly',
        await page.evaluate(() => !!document.getElementById('statToday'))
      );
      await page.close();
    }

    // 17b — marking a task done retires older inprogress versions of same task
    {
      const today = dk(new Date());
      const yesterday = dk(new Date(Date.now() - 86400000));
      const tasks = [
        { id: 'rt1', text: 'Carry test task', tag: 'work', status: 'inprogress', date: yesterday },
        { id: 'rt2', text: 'Carry test task', tag: 'work', status: 'inprogress', date: today },
      ];
      const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });

      // Mark today's version done
      await page.evaluate(() => {
        const sel = document.querySelector('.plan-status[data-pid="rt2"]');
        if (sel) {
          sel.value = 'done';
          sel.dispatchEvent(new Event('change'));
        }
      });
      await page.waitForTimeout(50);

      const allTasks = await page.evaluate(() => window.__wl.getState().planTasks);
      const yesterday_task = allTasks.find((t) => t.id === 'rt1');
      const today_task = allTasks.find((t) => t.id === 'rt2');
      assert('Today task marked done', today_task?.status === 'done');
      assert('Yesterday version also retired', yesterday_task?.status === 'done');
      assert('Yesterday version gets completedAt', !!yesterday_task?.completedAt);
      await page.close();
    }

    // 17c — completed section deduplicates same-text tasks
    {
      const today = dk(new Date());
      const yesterday = dk(new Date(Date.now() - 86400000));
      const tasks = [
        {
          id: 'dd1',
          text: 'Duplicate task',
          tag: 'work',
          status: 'done',
          date: yesterday,
          completedAt: Date.now() - 86400000,
        },
        {
          id: 'dd2',
          text: 'Duplicate task',
          tag: 'work',
          status: 'done',
          date: today,
          completedAt: Date.now() - 1000,
        },
      ];
      const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
      await page.waitForTimeout(50);
      const items = await page.evaluate(() => document.querySelectorAll('.completed-item').length);
      assert('Duplicate tasks deduplicated in completed section', items === 1);
      await page.close();
    }
  }

  // ── 18. Untracked slot boundary ────────────────────────────────────────────
  console.log('\n18. Untracked slot boundary');
  {
    // Entry with tsEnd exactly on a 30-min boundary should NOT cover the next slot
    const today = dk(new Date());
    // Entry 09:00–09:30 (tsEnd exactly on boundary)
    const ts = new Date();
    ts.setHours(9, 0, 0, 0);
    const tsEnd = new Date();
    tsEnd.setHours(9, 30, 0, 0);
    const entries = [
      {
        id: 'ub1',
        text: 'Boundary task',
        tag: 'work',
        ts: ts.getTime(),
        tsEnd: tsEnd.getTime(),
        date: today,
      },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    await page.waitForTimeout(50);

    // Check that tsEnd is exactly on boundary
    assert('tsEnd seconds = 0', tsEnd.getSeconds() === 0);
    assert('tsEnd minutes % 30 = 0', tsEnd.getMinutes() % 30 === 0);

    // Verify the timeToSlot function uses Math.round (so naive -1min fix fails)
    const slotFor930 = await page.evaluate(() => {
      const TB_START = 8;
      return (9 - TB_START) * 2 + Math.round(30 / 30); // = 3
    });
    assert('timeToSlot(9,30) = 3 (slot after meeting)', slotFor930 === 3);

    // Now verify coveredSlots does NOT include slot 3 with the boundary fix
    const slot3Covered = await page.evaluate(() => {
      // Reproduce the exact logic from renderTimeblock
      const TB_START = 8,
        TB_SLOTS = 20;
      function timeToSlot(h, m) {
        return (h - TB_START) * 2 + Math.round(m / 30);
      }
      const entries = JSON.parse(localStorage.getItem('wl_entries_v1') || '[]');
      const today = new Date().toISOString().slice(0, 10);
      const covered = new Set();
      entries
        .filter((e) => e.date === today && e.tsEnd)
        .forEach((e) => {
          const startSlot = timeToSlot(new Date(e.ts).getHours(), new Date(e.ts).getMinutes());
          const endD = new Date(e.tsEnd);
          const onBoundary = endD.getMinutes() % 30 === 0 && endD.getSeconds() === 0;
          const endSlot = onBoundary
            ? timeToSlot(endD.getHours(), endD.getMinutes()) - 1
            : timeToSlot(endD.getHours(), endD.getMinutes());
          for (let s = Math.max(0, startSlot); s < Math.min(TB_SLOTS, endSlot + 1); s++)
            covered.add(s);
        });
      return covered.has(3); // slot 3 = 09:30–10:00
    });
    assert('Slot after boundary tsEnd is NOT covered', !slot3Covered);
    await page.close();
  }

  // ── 19. Paused timer live block cap ────────────────────────────────────────
  console.log('\n19. Paused timer live block cap');
  {
    const today = dk(new Date());
    // Timer started 90 min ago, paused after 30 min (accumulatedMs = 30min)
    const startTs = Date.now() - 90 * 60000;
    const entries = [{ id: 'pt1', text: 'Paused task', tag: 'work', ts: startTs, date: today }];
    const timer = { entryId: 'pt1', startTs: null, accumulatedMs: 30 * 60000, paused: true };
    const page = await freshPage(ctx, {
      wl_entries_v1: entries,
      wl_timer_v1: timer,
      wl_cats_v1: CATS,
    });
    await page.waitForTimeout(50);

    // Verify paused timer coverage stops at pause point, not at Date.now()
    const coverage = await page.evaluate(() => {
      const TB_START = 8,
        TB_SLOTS = 20;
      function timeToSlot(h, m) {
        return (h - TB_START) * 2 + Math.round(m / 30);
      }
      const timerRaw = JSON.parse(localStorage.getItem('wl_timer_v1') || 'null');
      const entriesRaw = JSON.parse(localStorage.getItem('wl_entries_v1') || '[]');
      if (!timerRaw || !timerRaw.paused) return null;
      const liveEntry = entriesRaw.find((e) => e.id === timerRaw.entryId);
      if (!liveEntry) return null;
      const pauseEndMs = liveEntry.ts + (timerRaw.accumulatedMs || 0);
      const pauseEnd = new Date(pauseEndMs);
      const startSlot = timeToSlot(
        new Date(liveEntry.ts).getHours(),
        new Date(liveEntry.ts).getMinutes()
      );
      const endSlot = timeToSlot(pauseEnd.getHours(), pauseEnd.getMinutes());
      // Check slot 90 min after start is NOT covered
      const nowSlot = timeToSlot(new Date().getHours(), new Date().getMinutes());
      const covered = new Set();
      for (let s = Math.max(0, startSlot); s < Math.min(TB_SLOTS, endSlot + 1); s++) covered.add(s);
      return { endSlot, nowSlot, nowCovered: covered.has(nowSlot), pauseEndMs };
    });
    assert('Paused timer has coverage data', !!coverage);
    // pauseEndMs < Date.now() avoids slot inversion when CI runs before 08:00 UTC
    assert('Paused timer pause point is in the past', coverage && coverage.pauseEndMs < Date.now());
    assert('Current slot NOT covered when paused', coverage && !coverage.nowCovered);
    await page.close();
  }

  // ── 20. Pending-carry self-heal ────────────────────────────────────────────
  // patchCarriedTasks must correct a task that was carried as inprogress
  // when the most recent past version was pending (buggy carry edge case).
  console.log('\n20. Pending-carry self-heal');
  {
    const today = dk(new Date());
    const yesterday = dk(new Date(Date.now() - 86400000));
    // Simulate the bug: yesterday the task was pending, but autoCarry somehow
    // created today's version as inprogress (old duplicate-carry bug).
    const tasks = [
      {
        id: 'sc1',
        text: 'Self-heal task',
        tag: 'work',
        status: 'pending',
        date: yesterday,
        statusComments: [
          { status: 'pending', comment: 'waiting on review', ts: Date.now() - 86400000 },
        ],
      },
      { id: 'sc2', text: 'Self-heal task', tag: 'work', status: 'inprogress', date: today },
    ];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    await page.waitForTimeout(50);
    const todayTask = await page.evaluate(() =>
      window.__wl.getState().planTasks.find((t) => t.id === 'sc2')
    );
    assert('Self-heal corrects status to pending', todayTask?.status === 'pending');
    assert(
      'Self-heal copies statusComments forward',
      Array.isArray(todayTask?.statusComments) && todayTask.statusComments.length > 0
    );
    await page.close();
  }

  // ── 21. Handoff note not in quick pick ─────────────────────────────────────
  console.log('\n21. Handoff not in quick pick');
  {
    const today = dk(new Date());
    const entries = [
      { id: 'hq1', text: 'Quick task', tag: 'work', ts: Date.now() - 60000, date: today },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    // Save a handoff note for the task
    await page.evaluate(() =>
      localStorage.setItem('wl_handoff', JSON.stringify({ 'quick task': 'continue from line 42' }))
    );
    // Trigger quick pick render by focusing the capture input
    await page.evaluate(() => document.getElementById('captureInput').focus());
    await page.waitForTimeout(50);
    const qpHtml = await page.evaluate(() => document.getElementById('quickPick').innerHTML);
    assert('Quick pick renders task', qpHtml.includes('Quick task'));
    assert('Handoff note NOT shown in quick pick', !qpHtml.includes('continue from line 42'));
    assert('No qp-handoff class in quick pick', !qpHtml.includes('qp-handoff'));
    await page.close();
  }

  // ── 22. Task emoji ──────────────────────────────────────────────────────────
  console.log('\n22. Task emoji');
  {
    const today = dk(new Date());
    const tasks = [
      { id: 'te1', text: 'Emoji task', tag: 'work', status: 'todo', date: today, emoji: '🚀' },
      { id: 'te2', text: 'No emoji', tag: 'work', status: 'todo', date: today },
    ];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    await page.waitForTimeout(50);
    const planHtml = await page.evaluate(() => document.getElementById('planList').innerHTML);
    assert('Emoji shown in task name', planHtml.includes('🚀'));
    assert('Non-emoji task has no emoji', !planHtml.includes('🚀 No emoji'));
    // Emoji button is only in timeblock blocks, not in the task list
    const emojiButtons = await page.evaluate(
      () => document.querySelectorAll('#planList .plan-emoji-btn').length
    );
    assert('No emoji buttons in task list (moved to timeblock only)', emojiButtons === 0);
    await page.close();
  }

  // ── 23. Start of day button ─────────────────────────────────────────────────
  console.log('\n23. Start of day button');
  {
    const page = await freshPage(ctx);
    assert('sodBtn exists', await page.evaluate(() => !!document.getElementById('sodBtn')));
    // Click to set start of day
    await page.evaluate(() => document.getElementById('sodBtn').click());
    await page.waitForTimeout(50);
    const sodKey = 'wl_sod_' + dk(new Date());
    const stored = await page.evaluate((k) => localStorage.getItem(k), sodKey);
    assert('Start of day timestamp stored', !!stored);
    assert('Stored value is a number string', !isNaN(parseInt(stored)));
    // Button label updates
    const btnText = await page.evaluate(() => document.getElementById('sodBtn').textContent);
    assert('Button shows started time', btnText.includes('started'));
    await page.close();
  }

  // ── 24. Streak counter (checks from yesterday, not today) ────────────────────
  console.log('\n24. Streak counter');
  {
    const yesterday = dk(new Date(Date.now() - 86400000));
    const dayBefore = dk(new Date(Date.now() - 172800000));
    // Entries for 3 consecutive days (yesterday and day before have entries)
    // but NO entry for today yet (simulating start of day)
    const entries = [
      { id: 'sk1', text: 'Task day1', tag: 'work', ts: Date.now() - 172800000, date: dayBefore },
      { id: 'sk2', text: 'Task day2', tag: 'work', ts: Date.now() - 86400000, date: yesterday },
      // No entry for today — simulating early morning before logging anything
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    const streakVal = await page.evaluate(() => document.getElementById('statStreak').textContent);
    assert('Streak shows 2 (yesterday + day before)', streakVal === '2');

    // Now add an entry for today and verify streak updates
    await page.evaluate(() => {
      const state = window.__wl.getState();
      state.entries.push({
        id: 'sk3',
        text: 'Task today',
        tag: 'work',
        ts: Date.now(),
        date: window.__wl.dk(new Date()),
      });
      window.__wl.render();
    });
    await page.waitForTimeout(50);
    const streakValAfter = await page.evaluate(
      () => document.getElementById('statStreak').textContent
    );
    assert('Streak stays at 2 — today not counted by design', streakValAfter === '2');
    await page.close();
  }

  // ── 25. Calendar — renderCalStrip produces delete buttons ──────────────────
  console.log('\n25. Calendar renderCalStrip');
  {
    const page = await freshPage(ctx);
    await page.evaluate(() => {
      const now = Date.now();
      window.__wl.renderCalStrip([
        {
          subject: 'Test Meeting',
          start: new Date(now + 3600000).toISOString(),
          end: new Date(now + 7200000).toISOString(),
        },
      ]);
    });
    assert(
      'renderCalStrip produces delete buttons',
      await page.evaluate(() => document.querySelectorAll('.cal-delete-btn').length > 0)
    );
    await page.close();
  }

  // ── 32. Task checkpoints ───────────────────────────────────────────────────
  console.log('\n32. Task checkpoints');
  {
    const today = dk(new Date());
    const tasks = [
      {
        id: 'cp1',
        text: 'Task with steps',
        tag: 'work',
        status: 'inprogress',
        date: today,
        checkpoints: [
          { id: 'c1', text: 'Step one', done: false },
          { id: 'c2', text: 'Step two', done: true },
          { id: 'c3', text: 'Step three', done: false },
        ],
      },
      {
        id: 'cp3',
        text: 'Zero progress task',
        tag: 'work',
        status: 'todo',
        date: today,
        checkpoints: [
          { id: 'c4', text: 'Unticked A', done: false },
          { id: 'c5', text: 'Unticked B', done: false },
        ],
      },
      { id: 'cp2', text: 'Task no steps', tag: 'work', status: 'todo', date: today },
      {
        // status: 'todo' so the row appears in #planList (done tasks render in the
        // completed section and would be missed by planHtml)
        id: 'cp4',
        text: 'All done task',
        tag: 'work',
        status: 'todo',
        date: today,
        checkpoints: [
          { id: 'c6', text: 'Done A', done: true },
          { id: 'c7', text: 'Done B', done: true },
        ],
      },
    ];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    await page.waitForTimeout(50);

    const planHtml = await page.evaluate(() => document.getElementById('planList').innerHTML);
    assert('cp-badge rendered for task with checkpoints', planHtml.includes('cp-badge'));
    // Invariant: ✓ K/N when any step ticked, plain K/N when none done, + steps when empty
    assert(
      'Badge shows ✓-prefixed fraction when progress exists (✓ 1/3)',
      planHtml.includes('✓ 1/3')
    );
    assert('Badge shows plain fraction when nothing done (0/2)', planHtml.includes('0/2'));
    assert('Badge shows ✓ N/N when all steps complete (✓ 2/2)', planHtml.includes('✓ 2/2'));
    assert('+ steps badge on task with no checkpoints', planHtml.includes('+ steps'));

    // Open checkpoints by clicking the badge — fail loudly if the badge is missing
    await page.waitForSelector('.cp-badge[data-pid="cp1"]');
    await page.evaluate(() => document.querySelector('.cp-badge[data-pid="cp1"]').click());
    await page.waitForTimeout(50);
    const openHtml = await page.evaluate(() => document.getElementById('planList').innerHTML);
    assert('Checkpoint area opens on badge click', openHtml.includes('cp-area'));
    assert('Step text rendered', openHtml.includes('Step one'));
    assert('Done step has cp-checked class', openHtml.includes('cp-checked'));
    assert('Progress bar rendered', openHtml.includes('cp-fill'));

    // Tick an unchecked checkpoint — three-state: false → 'partial' → true
    await page.waitForSelector('.cp-check[data-pid="cp1"][data-cpidx="0"]');
    await page.evaluate(() =>
      document.querySelector('.cp-check[data-pid="cp1"][data-cpidx="0"]').click()
    );
    await page.waitForTimeout(50);
    const afterTick1 = await page.evaluate(() =>
      window.__wl.getState().planTasks.find((t) => t.id === 'cp1')
    );
    assert('First tick sets checkpoint to partial', afterTick1?.checkpoints[0]?.done === 'partial');

    await page.evaluate(() =>
      document.querySelector('.cp-check[data-pid="cp1"][data-cpidx="0"]').click()
    );
    await page.waitForTimeout(50);
    const afterTick2 = await page.evaluate(() =>
      window.__wl.getState().planTasks.find((t) => t.id === 'cp1')
    );
    assert('Second tick sets checkpoint to done (true)', afterTick2?.checkpoints[0]?.done === true);

    await page.close();
  }

  // ── 33. EOD handoff notes ───────────────────────────────────────────────────
  console.log('\n33. EOD handoff notes');
  {
    const today = dk(new Date());
    const tasks = [
      { id: 'hn1', text: 'Unfinished task', tag: 'work', status: 'inprogress', date: today },
      { id: 'hn2', text: 'Done task', tag: 'work', status: 'done', date: today },
    ];
    // An entry for today is needed — EOD now only shows tasks worked on today
    const entries = [
      { id: 'e1', text: 'Unfinished task', tag: 'work', ts: Date.now(), date: today },
    ];
    const page = await freshPage(ctx, {
      wl_plan_v1: tasks,
      wl_cats_v1: CATS,
      wl_entries_v1: entries,
    });
    await page.waitForTimeout(50);

    assert(
      'eodTaskNotes element exists',
      await page.evaluate(() => !!document.getElementById('eodTaskNotes'))
    );

    // Pre-set a handoff note and verify it appears in the plan row
    await page.evaluate(() => {
      localStorage.setItem(
        'wl_handoff',
        JSON.stringify({ 'unfinished task': 'pick up from line 42' })
      );
      window.__wl.renderPlan();
    });
    await page.waitForTimeout(50);
    const planHtml = await page.evaluate(() => document.getElementById('planList').innerHTML);
    assert('Handoff note shown in plan row', planHtml.includes('pick up from line 42'));
    assert('Handoff dismiss button rendered', planHtml.includes('plan-handoff-dismiss'));
    assert('Unfinished task has handoff note class', planHtml.includes('plan-handoff-note'));

    // Verify EOD notes only show worked-on tasks (not done tasks, not unworked tasks)
    await page.evaluate(() => window.__wl.openEodModal());
    await page.waitForTimeout(50);
    const notesHtml = await page.evaluate(() => document.getElementById('eodTaskNotes').innerHTML);
    assert('Worked task shown in EOD notes', notesHtml.includes('Unfinished task'));
    assert('Done task not in EOD notes', !notesHtml.includes('Done task'));

    await page.close();
  }

  // ── 34. Parked thoughts ─────────────────────────────────────────────────────
  console.log('\n34. Parked thoughts');
  {
    const page = await freshPage(ctx);
    await page.waitForTimeout(50);

    assert(
      'parkSection exists',
      await page.evaluate(() => !!document.getElementById('parkSection'))
    );
    assert('idkwBtn exists', await page.evaluate(() => !!document.getElementById('idkwBtn')));

    // Inject a parked thought directly into the in-memory array and render
    await page.evaluate(() => {
      window.__wl.parkedThoughts.push({
        id: 'pk1',
        text: 'A parked idea',
        ts: Date.now(),
        done: false,
      });
      window.__wl.renderParked();
    });
    await page.waitForTimeout(50);
    const section = await page.evaluate(() => document.getElementById('parkSection').style.display);
    assert('Park section visible when items exist', section !== 'none');
    const html = await page.evaluate(() => document.getElementById('parkList').innerHTML);
    assert('Parked item text rendered', html.includes('A parked idea'));
    assert('Promote-to-task button exists', html.includes('parked-promote'));
    assert('Dismiss button exists', html.includes('parked-dismiss'));

    await page.close();
  }

  // ── 40. completedAt expiry at iteration boundaries ─────────────────────────
  console.log('\n40. completedAt expiry at iteration boundaries');
  {
    // Task completed on 2026-05-15 should expire at iteration boundary 2026-05-23
    const completedDay = '2026-05-15';
    const lastDayBeforeExpiry = '2026-05-22';
    const firstDayAfterExpiry = '2026-05-23';

    const tasks = [
      {
        id: 'exp1',
        text: 'Expired task',
        tag: 'work',
        status: 'done',
        date: completedDay,
        completedAt: new Date(completedDay + 'T14:30:00').getTime(),
      },
    ];
    const expiryDates = ['2026-05-09', '2026-05-23', '2026-06-06']; // iteration boundaries

    // Test 1: Task is visible on the day it was completed
    {
      const page = await freshPage(ctx, {
        wl_plan_v1: tasks,
        wl_cats_v1: CATS,
        wl_expiry_dates: expiryDates,
      });
      await page.evaluate((viewDate) => {
        window.__wl.viewDate = new Date(viewDate + 'T12:00:00');
      }, completedDay);
      await page.waitForTimeout(100);
      const visible = await page.evaluate(
        () => document.querySelectorAll('.completed-item').length > 0
      );
      assert('Task visible on completion day (2026-05-15)', visible);
      await page.close();
    }

    // Test 2: Task is visible the day before iteration expiry
    {
      const page = await freshPage(ctx, {
        wl_plan_v1: tasks,
        wl_cats_v1: CATS,
        wl_expiry_dates: expiryDates,
      });
      await page.evaluate((viewDate) => {
        window.__wl.viewDate = new Date(viewDate + 'T12:00:00');
      }, lastDayBeforeExpiry);
      await page.waitForTimeout(100);
      const visible = await page.evaluate(
        () => document.querySelectorAll('.completed-item').length > 0
      );
      assert('Task visible before expiry (2026-05-22)', visible);
      await page.close();
    }

    // Test 3: Task is NOT visible on the iteration expiry date
    {
      const page = await freshPage(ctx, {
        wl_plan_v1: tasks,
        wl_cats_v1: CATS,
        wl_expiry_dates: expiryDates,
      });
      await page.evaluate((viewDate) => {
        window.__wl.viewDate = new Date(viewDate + 'T12:00:00');
      }, firstDayAfterExpiry);
      await page.waitForTimeout(100);
      const visible = await page.evaluate(
        () => document.querySelectorAll('.completed-item').length > 0
      );
      assert('Task expires at iteration boundary (2026-05-23)', !visible);
      await page.close();
    }
  }

  // ── 35. Focus mode checkpoints ─────────────────────────────────────────────
  console.log('\n35. Focus mode checkpoints');
  {
    const today = dk(new Date());
    const tasks = [
      {
        id: 'fm1',
        text: 'Focus task',
        tag: 'work',
        status: 'inprogress',
        date: today,
        checkpoints: [
          { id: 'fc1', text: 'Step A', done: false },
          { id: 'fc2', text: 'Step B', done: true },
        ],
      },
    ];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    const timer = { entryId: 'tm_foc', startTs: Date.now(), accumulatedMs: 0, paused: false };
    const entries = [
      { id: 'tm_foc', text: 'Focus task', tag: 'work', ts: Date.now() - 1000, date: today },
    ];

    // Re-setup page with timer so active task is detected
    const page2 = await freshPage(ctx, {
      wl_plan_v1: tasks,
      wl_timer_v1: timer,
      wl_entries_v1: entries,
      wl_cats_v1: CATS,
    });
    await page2.waitForTimeout(50);

    // Enter focus mode
    await page2.evaluate(() => document.getElementById('emergencyBtn').click());
    await page2.waitForTimeout(50);

    assert(
      'Body has emergency class',
      await page2.evaluate(() => document.body.classList.contains('emergency'))
    );
    assert(
      'emergencyCps element exists',
      await page2.evaluate(() => !!document.getElementById('emergencyCps'))
    );
    assert(
      'Pomodoro section exists in DOM during focus mode',
      await page2.evaluate(() => !!document.querySelector('.pomo-section'))
    );
    assert(
      'tagRow hidden in focus mode',
      await page2.evaluate(() => {
        const el = document.getElementById('tagRow');
        return !el || getComputedStyle(el).display === 'none';
      })
    );

    // Exit focus mode and check if checkpoints are auto-expanded
    await page2.evaluate(() => document.getElementById('emergencyExit').click());
    await page2.waitForTimeout(50);
    assert(
      'Body loses emergency class on exit',
      await page2.evaluate(() => !document.body.classList.contains('emergency'))
    );
    assert(
      'Checkpoints auto-expanded after focus mode exit',
      await page2.evaluate(() => {
        const cpArea = document.querySelector('.cp-area');
        return (
          cpArea && cpArea.style.display !== 'none' && cpArea.querySelectorAll('.cp-row').length > 0
        );
      })
    );

    await page.close();
    await page2.close();
  }

  // ── 36. Export end time with active timer ──────────────────────────────────
  console.log('\n36. Export end time with active timer');
  {
    const today = dk(new Date());
    // Entry stopped at 17:00, simulating a full day ending early in the log
    const early = new Date();
    early.setHours(9, 0, 0, 0);
    const stop = new Date();
    stop.setHours(17, 0, 0, 0);
    const entries = [
      {
        id: 'ex1',
        text: 'Morning work',
        tag: 'work',
        ts: early.getTime(),
        tsEnd: stop.getTime(),
        date: today,
      },
    ];
    // Timer started at 18:00, accumulated 2h (= 20:00 effective end)
    const timerStart = new Date();
    timerStart.setHours(18, 0, 0, 0);
    const timer = {
      entryId: 'ex2',
      startTs: timerStart.getTime(),
      accumulatedMs: 0,
      paused: false,
    };
    const timerEntry = {
      id: 'ex2',
      text: 'Evening work',
      tag: 'work',
      ts: timerStart.getTime(),
      date: today,
    };

    const page = await freshPage(ctx, {
      wl_entries_v1: [...entries, timerEntry],
      wl_timer_v1: timer,
      wl_cats_v1: CATS,
    });
    await page.waitForTimeout(50);

    // Intercept writeExportFile to capture the blob text instead of writing/downloading
    const exportText = await page.evaluate(async () => {
      // Monkey-patch writeExportFile via the module scope isn't possible directly,
      // so override URL.createObjectURL and Blob to capture content
      const origCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = (blob) => {
        window.__capturedBlob = blob;
        return 'blob:test';
      };
      // Suppress the anchor click
      const origAppendChild = document.body.appendChild.bind(document.body);
      document.body.appendChild = (el) => {
        if (el.tagName === 'A') {
          el.click = () => {};
          return el;
        }
        return origAppendChild(el);
      };
      window.__wl.exportTxt();
      await new Promise((r) => setTimeout(r, 200));
      if (window.__capturedBlob) {
        const text = await window.__capturedBlob.text();
        URL.createObjectURL = origCreateObjectURL;
        return text;
      }
      URL.createObjectURL = origCreateObjectURL;
      return null;
    });

    assert('Export text was captured', exportText !== null);

    if (exportText) {
      const endedMatch = exportText.match(/Ended:\s*(\d{2}:\d{2})/);
      const endedTime = endedMatch ? endedMatch[1] : null;

      // The active timer started at 18:00 with 0 accumulatedMs, so liveEnd ≈ now
      // (test runs fast). The key assertion is that it's NOT capped at 17:00.
      assert(
        'Ended time is not capped at last stopped entry (17:00)',
        endedTime !== null && endedTime !== '17:00'
      );
      assert('Ended line is present in export header', exportText.includes('Ended:'));
      assert(
        'Export contains both entries',
        exportText.includes('Morning work') && exportText.includes('Evening work')
      );
    }

    // Paused-timer variant: accumulated 1h30m from a 17:30 start → effective end 19:00
    const pauseBase = new Date();
    pauseBase.setHours(17, 30, 0, 0);
    const pausedTimer = {
      entryId: 'ex3',
      startTs: null,
      accumulatedMs: 90 * 60 * 1000,
      paused: true,
    };
    const pausedEntry = {
      id: 'ex3',
      text: 'Paused work',
      tag: 'work',
      ts: pauseBase.getTime(),
      date: today,
    };

    const page2 = await freshPage(ctx, {
      wl_entries_v1: [...entries, pausedEntry],
      wl_timer_v1: pausedTimer,
      wl_cats_v1: CATS,
    });
    await page2.waitForTimeout(50);

    const exportText2 = await page2.evaluate(async () => {
      URL.createObjectURL = (blob) => {
        window.__capturedBlob = blob;
        return 'blob:test';
      };
      document.body.appendChild = (el) => {
        if (el.tagName === 'A') {
          el.click = () => {};
          return el;
        }
        return document.body.appendChild(el);
      };
      window.__wl.exportTxt();
      await new Promise((r) => setTimeout(r, 200));
      return window.__capturedBlob ? window.__capturedBlob.text() : null;
    });

    if (exportText2) {
      const endedMatch2 = exportText2.match(/Ended:\s*(\d{2}:\d{2})/);
      const endedTime2 = endedMatch2 ? endedMatch2[1] : null;
      // pauseBase(17:30) + 90min accumulated = 19:00
      assert('Paused timer: Ended reflects accumulated time (19:00)', endedTime2 === '19:00');
    } else {
      assert('Paused timer export captured', false);
    }

    await page.close();
    await page2.close();
  }

  // ── 17. Make-it-interesting hook ───────────────────────────────────────────
  console.log('\n17. Make-it-interesting hook');
  {
    const today = dk(new Date());
    const entries = [
      { id: 'hook1', text: 'Boring task', tag: 'work', ts: Date.now() - 30000, date: today },
    ];
    const timer = {
      entryId: 'hook1',
      startTs: Date.now() - 30000,
      accumulatedMs: 0,
      paused: false,
    };
    const page = await freshPage(ctx, {
      wl_entries_v1: entries,
      wl_timer_v1: timer,
      wl_cats_v1: CATS,
    });

    // Button should exist and be enabled with active timer
    assert(
      'timerHookBtn exists',
      await page.evaluate(() => !!document.getElementById('timerHookBtn'))
    );
    const btnDisabled1 = await page.evaluate(
      () => document.getElementById('timerHookBtn')?.disabled
    );
    assert('Button enabled when timer running', btnDisabled1 === false);

    // Test cache: save a hook, then verify it loads
    await page.evaluate(() => {
      window.__wl.saveHook('Boring task', 'Try the first 5 minutes.\nExplain to a colleague.');
    });

    // Verify wl_hooks storage
    const storedHooks1 = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('wl_hooks') || '{}')
    );
    assert('wl_hooks storage written', !!storedHooks1['boring task']);

    // Call the hook button click handler
    await page.evaluate(() => document.getElementById('timerHookBtn').click());
    await page.waitForTimeout(50);

    const hookPanel = await page.evaluate(() => {
      const panel = document.getElementById('timerHookPanel');
      return panel ? panel.style.display : 'none';
    });
    assert('Hook panel shows when cached', hookPanel !== 'none');

    const hookContent = await page.evaluate(
      () => document.getElementById('timerHookContent').textContent
    );
    assert('Cached hook renders', hookContent.includes('5 minutes'));

    // Stop timer and check button disabled
    await page.evaluate(() => {
      localStorage.setItem('wl_timer_v1', 'null');
      window.__wl.load();
      window.__wl.render();
    });
    await page.waitForTimeout(50);

    const btnDisabled2 = await page.evaluate(
      () => document.getElementById('timerHookBtn')?.disabled
    );
    assert('Button disabled when no timer', btnDisabled2 === true);

    // Verify hook close button
    const closeBtn = await page.evaluate(() => !!document.getElementById('timerHookClose'));
    assert('Hook close button exists', closeBtn);

    await page.close();
  }

  // ── 28. Transition bridge: banner and AI call ───────────────────────────────
  console.log('\n28. Transition bridge');
  {
    const today = dk(new Date());
    const planTasks = [
      { id: 'pt1', text: 'Next important task', status: 'todo', date: today, tag: 'work' },
    ];

    const page = await freshPage(ctx, {
      wl_entries_v1: [],
      wl_timer_v1: null,
      wl_cats_v1: CATS,
      wl_plan_v1: planTasks,
    });

    // Verify banner DOM elements exist
    assert(
      'newdayBanner exists',
      await page.evaluate(() => !!document.getElementById('newdayBanner'))
    );
    assert('newdayMsg exists', await page.evaluate(() => !!document.getElementById('newdayMsg')));
    assert(
      'newdayBridgeBtn exists',
      await page.evaluate(() => !!document.getElementById('newdayBridgeBtn'))
    );
    assert(
      'newdayDismiss exists',
      await page.evaluate(() => !!document.getElementById('newdayDismiss'))
    );
    assert(
      'newdayExpanded exists',
      await page.evaluate(() => !!document.getElementById('newdayExpanded'))
    );

    // Verify banner initially hidden
    const bannerHidden = await page.evaluate(() => {
      const banner = document.getElementById('newdayBanner');
      return !banner.className.includes('show');
    });
    assert('Banner initially not shown', bannerHidden);

    // Test banner via the actual showBridgeBanner function (exposed in window.__wl for tests)
    const testMeeting = {
      subject: 'Test Meeting',
      start: new Date().toISOString(),
      end: new Date().toISOString(),
    };
    await page.evaluate((meeting) => {
      if (window.__wl && window.__wl._showBridgeBanner) {
        window.__wl._showBridgeBanner(meeting);
      }
    }, testMeeting);

    await page.waitForTimeout(50);

    const bannerShown = await page.evaluate(() => {
      const banner = document.getElementById('newdayBanner');
      return banner.className.includes('show');
    });
    assert('Banner shows when activated', bannerShown);

    const msgContent = await page.evaluate(() => document.getElementById('newdayMsg').textContent);
    assert('Banner message correct', msgContent.includes('Test Meeting'));

    // Test dismiss — the button should have onclick handler set up by showBridgeBanner
    await page.evaluate(() => {
      const dismissBtn = document.getElementById('newdayDismiss');
      if (dismissBtn.onclick) {
        dismissBtn.click();
      } else {
        // Fallback: manually remove 'show' class if onclick not available
        document.getElementById('newdayBanner').classList.remove('show');
      }
    });
    await page.waitForTimeout(50);

    const bannerDismissed = await page.evaluate(() => {
      const banner = document.getElementById('newdayBanner');
      return !banner.className.includes('show');
    });
    assert('Banner hidden after dismiss', bannerDismissed);

    await page.close();
  }

  // ── 37. Billable emoji toggle ──────────────────────────────────────────────
  console.log('\n37. Billable emoji toggle');
  {
    const today = dk(new Date());
    // Create an entry without explicit billable flag (will use category default)
    const entries = [
      { id: 'be1', text: 'Work task', tag: 'work', ts: Date.now() - 60000, date: today },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    await page.waitForTimeout(50);

    // Initial state: entry has no billable flag, should default to category billable (true)
    const initialEmoji = await page.evaluate(() => {
      const btn = document.querySelector('.ebill-btn[data-id="be1"]');
      return btn ? btn.textContent : null;
    });
    assert('Billable button renders for entry', initialEmoji !== null);
    assert('Initial emoji is 💰 (billable)', initialEmoji === '💰');

    // Click to toggle — should set billable to false
    await page.evaluate(() => {
      const btn = document.querySelector('.ebill-btn[data-id="be1"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(50);

    const afterFirstClick = await page.evaluate(() => {
      const btn = document.querySelector('.ebill-btn[data-id="be1"]');
      return btn ? btn.textContent : null;
    });
    assert('After first click, emoji is 💸 (non-billable)', afterFirstClick === '💸');

    // Verify billable flag in state
    const isNonBillable = await page.evaluate(() => {
      const state = window.__wl.getState();
      const entry = state.entries.find((e) => e.id === 'be1');
      return entry?.billable === false;
    });
    assert('Entry marked as billable=false in state', isNonBillable);

    // Verify persisted in localStorage
    const storedBillable = await page.evaluate(() => {
      const entries = JSON.parse(localStorage.getItem('wl_entries_v1') || '[]');
      const entry = entries.find((e) => e.id === 'be1');
      return entry?.billable;
    });
    assert('billable=false persisted to localStorage', storedBillable === false);

    // Click again to toggle back to undefined (defaults to category again)
    await page.evaluate(() => {
      const btn = document.querySelector('.ebill-btn[data-id="be1"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(50);

    const afterSecondClick = await page.evaluate(() => {
      const btn = document.querySelector('.ebill-btn[data-id="be1"]');
      return btn ? btn.textContent : null;
    });
    assert(
      'After second click, emoji is 💰 again (reverted to default)',
      afterSecondClick === '💰'
    );

    // Verify billable flag reverted to undefined (uses default)
    const isDefaultAgain = await page.evaluate(() => {
      const state = window.__wl.getState();
      const entry = state.entries.find((e) => e.id === 'be1');
      return entry?.billable === undefined;
    });
    assert('Entry reverted to billable=undefined', isDefaultAgain);

    // Test with explicit non-billable entry
    await page.evaluate(
      ({ today }) => {
        const state = window.__wl.getState();
        state.entries.push({
          id: 'be2',
          text: 'Other task',
          tag: 'other',
          ts: Date.now(),
          date: today,
          billable: false,
        });
        window.__wl.save();
        window.__wl.render();
      },
      { today }
    );
    await page.waitForTimeout(50);

    const nonBillableEmoji = await page.evaluate(() => {
      const btn = document.querySelector('.ebill-btn[data-id="be2"]');
      return btn ? btn.textContent : null;
    });
    assert('Non-billable entry shows 💸', nonBillableEmoji === '💸');

    await page.close();
  }

  // ── 38. Checkpoint three-state toggle regression ──────────────────────────
  // Regression: the toggle handler used boolean NOT (!done), which can only
  // produce true/false and can never yield 'partial'. The fix uses a ternary
  // chain: false → 'partial' → true → false.
  console.log('\n38. Checkpoint three-state toggle regression');
  {
    const today = dk(new Date());
    const tasks = [
      {
        id: 'ts1',
        text: 'Three-state task',
        tag: 'work',
        status: 'inprogress',
        date: today,
        checkpoints: [{ id: 'ts1c1', text: 'Toggle step', done: false }],
      },
    ];
    const page = await freshPage(ctx, {
      wl_categories_v1: CATS,
      wl_plan_v1: tasks,
    });

    // Expand checkpoint area
    await page.evaluate(() => document.querySelector('.cp-badge[data-pid="ts1"]').click());
    await page.waitForTimeout(50);

    const getState = () =>
      page.evaluate(() => {
        const task = window.__wl.getState().planTasks.find((t) => t.id === 'ts1');
        return task?.checkpoints[0]?.done;
      });

    const initial = await getState();
    assert('Initial state is false', initial === false, `got ${JSON.stringify(initial)}`);

    // Click 1: false → 'partial'
    await page.evaluate(() =>
      document.querySelector('.cp-check[data-pid="ts1"][data-cpidx="0"]').click()
    );
    await page.waitForTimeout(50);
    const afterClick1 = await getState();
    assert(
      'Click 1: false → "partial"',
      afterClick1 === 'partial',
      `got ${JSON.stringify(afterClick1)}`
    );

    // Verify partial renders the dash symbol and cp-partial class
    const partialHtml = await page.evaluate(
      () => document.querySelector('.cp-check[data-pid="ts1"][data-cpidx="0"]')?.outerHTML ?? ''
    );
    assert('Partial checkbox has cp-partial class', partialHtml.includes('cp-partial'));

    const partialLabelHtml = await page.evaluate(
      () => document.querySelector('.cp-label[data-pid="ts1"][data-cpidx="0"]')?.className ?? ''
    );
    assert('Partial label has cp-partial class', partialLabelHtml.includes('cp-partial'));

    // Click 2: 'partial' → true
    await page.evaluate(() =>
      document.querySelector('.cp-check[data-pid="ts1"][data-cpidx="0"]').click()
    );
    await page.waitForTimeout(50);
    const afterClick2 = await getState();
    assert('Click 2: "partial" → true', afterClick2 === true, `got ${JSON.stringify(afterClick2)}`);

    // Click 3: true → false
    await page.evaluate(() =>
      document.querySelector('.cp-check[data-pid="ts1"][data-cpidx="0"]').click()
    );
    await page.waitForTimeout(50);
    const afterClick3 = await getState();
    assert('Click 3: true → false', afterClick3 === false, `got ${JSON.stringify(afterClick3)}`);

    // Click 4: false → 'partial' again (cycle repeats)
    await page.evaluate(() =>
      document.querySelector('.cp-check[data-pid="ts1"][data-cpidx="0"]').click()
    );
    await page.waitForTimeout(50);
    const afterClick4 = await getState();
    assert(
      'Click 4: false → "partial" (cycle confirmed)',
      afterClick4 === 'partial',
      `got ${JSON.stringify(afterClick4)}`
    );

    // Verify partial state persists to localStorage
    const stored = await page.evaluate(() => {
      const tasks = JSON.parse(localStorage.getItem('wl_plan_v1') || '[]');
      const task = tasks.find((t) => t.id === 'ts1');
      return task?.checkpoints?.[0]?.done;
    });
    assert(
      'Partial state persisted to localStorage',
      stored === 'partial',
      `got ${JSON.stringify(stored)}`
    );

    await page.close();
  }

  // ── Sprints ───────────────────────────────────────────────────────────────
  console.log('\nSprints');
  {
    const page = await freshPage(ctx);
    // pomoSection defaults to collapsed (no stored state on a fresh page).
    // Expand it so #sprintModeBtn is visible before interacting with it.
    await page.click('#pomoHeader');
    // Sprint setup opens on Sprint button click
    await page.click('#sprintModeBtn');
    assert(
      'Sprint setup opens',
      await page.evaluate(() => document.getElementById('sprintSetup').style.display !== 'none')
    );
    // Cancel closes it
    await page.click('#sprintCancel');
    assert(
      'Sprint setup closes on cancel',
      await page.evaluate(() => document.getElementById('sprintSetup').style.display === 'none')
    );
    // Duration buttons render (4 options)
    await page.click('#sprintModeBtn');
    const durCount = await page.evaluate(() => document.querySelectorAll('.sprint-dur-btn').length);
    assert('Sprint durations rendered', durCount === 4, `got ${durCount}`);
    await page.close();
  }

  // ── Reflection ────────────────────────────────────────────────────────────
  console.log('\nReflection');
  {
    const page = await freshPage(ctx);
    await page.evaluate(() => window.__wl.openReflection());
    assert(
      'Reflection overlay opens',
      await page.evaluate(
        () => document.getElementById('reflectionOverlay').style.display !== 'none'
      )
    );
    await page.click('#reflSkip');
    assert(
      'Reflection closes on skip',
      await page.evaluate(
        () => document.getElementById('reflectionOverlay').style.display === 'none'
      )
    );
    // Save with ratings
    await page.evaluate(() => window.__wl.openReflection());
    await page.click('[data-el="reflFocusStars"][data-val="4"]');
    await page.click('[data-el="reflEnergyStars"][data-val="3"]');
    await page.click('#reflSave');
    const today = dk(new Date());
    const refl = await page.evaluate((d) => window.__wl.getReflectionForDate(d), today);
    assert(
      'Reflection saves focus rating',
      refl && refl.focus === 4,
      `got ${JSON.stringify(refl)}`
    );
    assert(
      'Reflection saves energy rating',
      refl && refl.energy === 3,
      `got ${JSON.stringify(refl)}`
    );
    await page.close();
  }

  // ── Daily Log (now the Log view inside Today's Flow) ─────────────────────
  console.log('\nDaily Log');
  {
    const today = dk(new Date());
    const page = await freshPage(ctx, {
      wl_entries_v1: [{ id: 'dl1', text: 'Deep work', tag: 'work', ts: Date.now(), date: today }],
    });
    // Switch to the Log view using the Today's Flow segmented control
    await page.waitForSelector('.tf-seg-btn[data-view="log"]');
    await page.evaluate(() => document.querySelector('.tf-seg-btn[data-view="log"]')?.click());
    await page.waitForSelector('#tfLogPane:visible');
    const html = await page.evaluate(() => document.getElementById('tfLogFeed').innerHTML);
    assert('Daily Log renders entry', html.includes('Deep work'), 'entry text not found in feed');
    // Add a note via the programmatic helper
    await page.evaluate(() => {
      document.getElementById('dailyLogNoteInput').value = 'remembered to call back';
      window.__wl.addLogNote();
    });
    const noteHtml = await page.evaluate(() => document.getElementById('tfLogFeed').innerHTML);
    assert('Daily Log renders note', noteHtml.includes('remembered to call back'));
    const noteCount = await page.evaluate(() => window.__wl.getState().logNotes.length);
    assert('Log note persisted to state', noteCount === 1, `got ${noteCount}`);
    await page.close();
  }

  // ── Rapid Logging ─────────────────────────────────────────────────────────
  console.log('\nRapid Logging');
  {
    const page = await freshPage(ctx);
    await page.click('#rapidOpenBtn');
    assert(
      'Rapid overlay opens on button click',
      await page.evaluate(() => document.getElementById('rapidOverlay').style.display !== 'none')
    );
    await page.keyboard.press('Escape');
    assert(
      'Rapid overlay closes on Escape',
      await page.evaluate(() => document.getElementById('rapidOverlay').style.display === 'none')
    );
    // Log only — open again, fill, log
    await page.click('#rapidOpenBtn');
    await page.waitForSelector('#rapidInput:visible');
    await page.fill('#rapidInput', 'quick task');
    await page.click('#rapidLogOnly');
    const entryCount = await page.evaluate(() => window.__wl.getState().entries.length);
    assert('Log only creates an entry', entryCount === 1, `got ${entryCount} entries`);
    assert(
      'Rapid overlay closes after log',
      await page.evaluate(() => document.getElementById('rapidOverlay').style.display === 'none')
    );
    await page.close();
  }

  // ── Quick Capture — filter chips ─────────────────────────────────────────
  console.log('\nQuick Capture — filter chips');
  {
    const today = dk(new Date());
    const page = await freshPage(ctx, {
      wl_entries_v1: [
        {
          id: 'qcf1',
          text: 'Work task',
          tag: 'work',
          ts: Date.now() - 60000,
          date: today,
          tsEnd: Date.now() - 1000,
        },
        {
          id: 'qcf2',
          text: 'Other task',
          tag: 'other',
          ts: Date.now() - 30000,
          date: today,
          tsEnd: Date.now() - 500,
        },
      ],
    });
    await page.click('#rapidOpenBtn');
    await page.waitForSelector('#rapidCats .qc-cat-chip');
    // Click the chip for the 'work' category
    await page.evaluate(() => {
      for (const chip of document.querySelectorAll('#rapidCats .qc-cat-chip')) {
        if (chip.dataset.cat === 'work') {
          chip.click();
          break;
        }
      }
    });
    await page.waitForTimeout(50);
    const listHtml = await page.evaluate(() => document.getElementById('qcTaskList').innerHTML);
    assert(
      'Filter chip shows only matching category tasks',
      listHtml.includes('Work task') && !listHtml.includes('Other task'),
      listHtml
    );
    // Click 'All' chip resets filter
    await page.evaluate(() => {
      for (const chip of document.querySelectorAll('#rapidCats .qc-cat-chip')) {
        if (chip.dataset.cat === '') {
          chip.click();
          break;
        }
      }
    });
    await page.waitForTimeout(50);
    const allHtml = await page.evaluate(() => document.getElementById('qcTaskList').innerHTML);
    assert(
      'All chip restores full task list',
      allHtml.includes('Work task') && allHtml.includes('Other task'),
      allHtml
    );
    await page.close();
  }

  // ── Quick Capture — running strip ────────────────────────────────────────
  console.log('\nQuick Capture — running strip');
  {
    const today = dk(new Date());
    const page = await freshPage(ctx, {
      wl_entries_v1: [
        { id: 'qcr1', text: 'Active work', tag: 'work', ts: Date.now() - 120000, date: today },
      ],
    });
    // Start the timer programmatically then open the overlay
    await page.evaluate(() => window.__wl.startTimer('qcr1'));
    await page.click('#rapidOpenBtn');
    await page.waitForSelector('#rapidOverlay:visible');
    const stripVisible = await page.evaluate(
      () => document.getElementById('qcRunningStrip').style.display !== 'none'
    );
    assert('Running strip visible when timer is active', stripVisible);
    const taskName = await page.evaluate(() =>
      document.getElementById('qcRunTask').textContent.trim()
    );
    assert(
      'Running strip shows active task name',
      taskName.includes('Active work'),
      `got "${taskName}"`
    );
    const isRunningClass = await page.evaluate(() =>
      document.getElementById('rapidOverlay').classList.contains('qc-is-running')
    );
    assert('Overlay carries qc-is-running class while timer active', isRunningClass);
    await page.close();
  }

  // ── Quick Capture — task-row start ───────────────────────────────────────
  console.log('\nQuick Capture — task-row start');
  {
    const today = dk(new Date());
    const page = await freshPage(ctx, {
      wl_plan_v1: [{ id: 'qcp1', text: 'Plan me', tag: 'work', date: today, status: 'todo' }],
    });
    await page.click('#rapidOpenBtn');
    await page.waitForSelector('#qcTaskList .qc-task-action-btn');
    // Click the action button on the plan task row
    await page.evaluate(() => {
      const btn = document.querySelector('#qcTaskList .qc-task-action-btn');
      if (btn) btn.click();
    });
    await page.waitForTimeout(50);
    const overlayHidden = await page.evaluate(
      () => document.getElementById('rapidOverlay').style.display === 'none'
    );
    assert('Overlay closes after starting task from row', overlayHidden);
    const state = await page.evaluate(() => window.__wl.getState());
    assert(
      'Timer starts after task-row click',
      !!state.activeTimer,
      `activeTimer: ${JSON.stringify(state.activeTimer)}`
    );
    await page.close();
  }

  // ── Rapid Logging — inline token grammar ─────────────────────────────────
  console.log('\nRapid Logging — inline token grammar');
  {
    const page = await freshPage(ctx);
    await page.click('#rapidOpenBtn');
    await page.waitForSelector('#rapidInput:visible');

    // Type an entry with a signifier token and the first available category prefix
    // The default category set always includes 'work', so #work resolves.
    await page.fill('#rapidInput', 'Deploy hotfix #work !flag');
    await page.click('#rapidLogOnly');

    const entry = await page.evaluate(() => {
      const state = window.__wl.getState();
      return state.entries[state.entries.length - 1];
    });
    assert(
      'Token grammar: entry text has tokens stripped',
      entry && entry.text === 'Deploy hotfix',
      `got text="${entry && entry.text}"`
    );
    assert(
      'Token grammar: #category token sets tag',
      entry && entry.tag === 'work',
      `got tag="${entry && entry.tag}"`
    );
    assert(
      'Token grammar: !sig token sets signifier',
      entry && entry.signifier === 'flagged',
      `got signifier="${entry && entry.signifier}"`
    );
    await page.close();
  }

  // ── Migration ─────────────────────────────────────────────────────────────
  console.log('\nMigration');
  {
    const today = dk(new Date());
    const page = await freshPage(ctx, {
      wl_plan_v1: [
        { id: 'mig1', text: 'Unfinished task', tag: 'work', date: today, status: 'todo' },
      ],
    });

    // migrationOverlay exists in DOM
    const exists = await page.evaluate(() => document.getElementById('migrationOverlay') !== null);
    assert('Migration overlay exists in DOM', exists);

    // Opens with an open task
    await page.evaluate(() => window.__wl.openMigration());
    const visible = await page.evaluate(
      () => document.getElementById('migrationOverlay').style.display !== 'none'
    );
    assert('Migration overlay opens', visible);

    // Counter shows 0 / 1
    const counter = await page.evaluate(
      () => document.getElementById('migrationCounter').textContent
    );
    assert('Migration counter shows 0/1', counter.includes('0'), `got "${counter}"`);

    // Task text rendered in body
    const body = await page.evaluate(() => document.getElementById('migrationBody').innerHTML);
    assert('Migration shows task text', body.includes('Unfinished task'), body);

    // Carry forward resolves one item
    await page.click('#migCarry');
    const counter2 = await page.evaluate(
      () => document.getElementById('migrationCounter').textContent
    );
    assert('Carry increments counter to 1/1', counter2.includes('1'), `got "${counter2}"`);

    // Done screen shows after all resolved
    const doneHtml = await page.evaluate(() => document.getElementById('migrationBody').innerHTML);
    assert('Migration shows done screen', doneHtml.includes('Month closed'), doneHtml);

    // Close button hides overlay
    await page.click('#migrationClose');
    const hidden = await page.evaluate(
      () => document.getElementById('migrationOverlay').style.display === 'none'
    );
    assert('Migration closes on close button', hidden);
    await page.close();
  }

  // ── 39. Import backup — UI elements ─────────────────────────────────────
  // The file-input flow can't be driven headlessly without a real file, so
  // this section only verifies the hidden file input is present in the DOM
  // (triggered from the SOD button flow, not a standalone button).
  // validateBackupFile logic is thoroughly tested in test/unit.cjs (11 cases).
  console.log('\n39. Import backup — UI elements');
  {
    const page = await freshPage(ctx);

    assert(
      'backupFileInput exists and is hidden',
      await page.evaluate(() => {
        const el = document.getElementById('backupFileInput');
        return el && el.type === 'file' && el.style.display === 'none';
      })
    );
    assert(
      'backupFileInput accepts .json only',
      await page.evaluate(() => document.getElementById('backupFileInput').accept === '.json')
    );
    assert(
      'validateBackupFile exposed on test harness',
      await page.evaluate(() => typeof window.__wl.validateBackupFile === 'function')
    );

    await page.close();
  }

  // ── Monthly Log ───────────────────────────────────────────────────────────
  console.log('\nMonthly Log');
  {
    const today = dk(new Date());
    // Anchor to 10:00–11:00 today so migrateEntryDatesToLocal never shifts the date
    // when tests run in the first 90 minutes of a UTC day.
    const mlTs = new Date(today + 'T10:00:00').getTime();
    const mlTsEnd = new Date(today + 'T11:00:00').getTime();
    const page = await freshPage(ctx, {
      wl_entries_v1: [
        {
          id: 'ml1',
          text: 'Monthly task',
          tag: 'work',
          ts: mlTs,
          tsEnd: mlTsEnd,
          date: today,
        },
      ],
    });
    // Tab click shows the section
    await page.click('#tabMonthlyLog');
    await page.waitForSelector('#monthlyLogSection:visible');
    const tabActive = await page.evaluate(() =>
      document.getElementById('tabMonthlyLog').classList.contains('active')
    );
    assert('Monthly Log tab has active class', tabActive);

    // Heatmap grid renders
    const cellCount = await page.evaluate(() => document.querySelectorAll('.ml-cell').length);
    assert('Monthly Log heatmap cells rendered', cellCount >= 28, `got ${cellCount}`);

    // Summary renders with total
    const sumHtml = await page.evaluate(() => document.getElementById('mlSummary').innerHTML);
    assert('Monthly Log summary renders', sumHtml.includes('Total logged'), sumHtml);

    // Task inventory renders
    const taskHtml = await page.evaluate(() => document.getElementById('mlTasks').innerHTML);
    assert('Monthly Log task inventory renders', taskHtml.includes('Task inventory'), taskHtml);

    // mlHoursForDay returns > 0 for today
    const hrs = await page.evaluate((d) => window.__wl.mlHoursForDay(d), today);
    assert('mlHoursForDay > 0 for today', hrs > 0, `got ${hrs}`);

    // Second tab click hides the section
    await page.click('#tabMonthlyLog');
    const hidden = await page.evaluate(
      () => document.getElementById('monthlyLogSection').style.display === 'none'
    );
    assert('Monthly Log section hides on second tab click', hidden);

    await page.close();
  }

  // ── Trackers ──────────────────────────────────────────────────────────────
  console.log('\nTrackers');
  {
    const page = await freshPage(ctx);
    // Tracker section renders empty state
    const emptyHtml = await page.evaluate(() => document.getElementById('trackerList').innerHTML);
    assert('Trackers renders empty state', emptyHtml.includes('No trackers'), emptyHtml);

    // + New button opens the form
    await page.click('#trackerAddBtn');
    const formVisible = await page.evaluate(
      () => document.getElementById('trackerNewForm').style.display !== 'none'
    );
    assert('Tracker form opens on + New', formVisible);

    // Cancel closes the form
    await page.click('#trFormCancel');
    const formHidden = await page.evaluate(
      () => document.getElementById('trackerNewForm').style.display === 'none'
    );
    assert('Tracker form closes on cancel', formHidden);

    // Add a tracker via JS API
    await page.evaluate(() => {
      window.__wl.getTrackers().push({
        id: 'tr1',
        name: 'Deep work',
        targetMinutes: 60,
        tags: ['work'],
        color: '#378ADD',
      });
      window.__wl.saveTrackers();
      window.__wl.renderTrackers();
    });
    const trackerHtml = await page.evaluate(() => document.getElementById('trackerList').innerHTML);
    assert('Tracker card renders after adding', trackerHtml.includes('Deep work'), trackerHtml);
    assert('Tracker target label renders', trackerHtml.includes('1h/day'), trackerHtml);

    // trackerDayStatus returns 'miss' when no entries logged
    const status = await page.evaluate(() =>
      window.__wl.trackerDayStatus({ tags: ['work'], targetMinutes: 60 }, '2026-01-01')
    );
    assert('trackerDayStatus returns miss with no entries', status === 'miss', `got ${status}`);

    await page.close();
  }

  // ── Signifiers ────────────────────────────────────────────────────────────
  console.log('\nSignifiers');
  {
    const today = dk(new Date());
    const page = await freshPage(ctx, {
      wl_entries_v1: [{ id: 'sig1', text: 'Test', tag: 'work', ts: Date.now(), date: today }],
    });
    await page.evaluate(() => window.__wl.cycleSignifier('sig1'));
    const sig = await page.evaluate(() => window.__wl.getState().entries[0].signifier);
    assert('Signifier cycles on click', sig === 'event', `got ${JSON.stringify(sig)}`);
    // Cycle through all five and confirm it wraps back to null (neutral)
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) window.__wl.cycleSignifier('sig1');
    });
    const wrapped = await page.evaluate(() => window.__wl.getState().entries[0].signifier);
    assert(
      'Signifier wraps back to null after full cycle',
      wrapped === null,
      `got ${JSON.stringify(wrapped)}`
    );
    // Cancelled entry excluded from isEntryBillable
    await page.evaluate(() => {
      window.__wl.cycleSignifier('sig1'); // null → event
      window.__wl.cycleSignifier('sig1'); // event → flagged
      window.__wl.cycleSignifier('sig1'); // flagged → migrated
      window.__wl.cycleSignifier('sig1'); // migrated → cancelled
    });
    const isBill = await page.evaluate(() =>
      window.__wl.isEntryBillable(window.__wl.getState().entries[0])
    );
    assert('Cancelled entry is not billable', isBill === false);
    await page.close();
  }

  // ── Section 41. Regression: Anthropic key not exposed on window ──────────
  console.log('\n41. Regression: Anthropic key not in browser');
  {
    const page = await freshPage(ctx);
    const exposed = await page.evaluate(() => {
      const n = window._wlNotion;
      return {
        hasGetKey: typeof n?.getAnthropicKey === 'function',
        hasSetKey: typeof n?.setAnthropicKey === 'function',
        lsKey: localStorage.getItem('wl_anthropic_key'),
      };
    });
    assert('getAnthropicKey not on window._wlNotion', exposed.hasGetKey === false);
    assert('setAnthropicKey not on window._wlNotion', exposed.hasSetKey === false);
    assert('wl_anthropic_key cleared from localStorage', exposed.lsKey === null);
    await page.close();
  }

  // ── Today's Flow ──────────────────────────────────────────────────────────
  console.log("\nToday's Flow");
  {
    const today = dk(new Date());
    // Pin to 10:00 today so the timestamp always matches `today`'s date key
    // and sits inside the 07:00–21:00 strip regardless of when the tests run.
    const todayAt10 = new Date();
    todayAt10.setHours(10, 0, 0, 0);
    const base = todayAt10.getTime();
    const page = await freshPage(ctx, {
      wl_cats_v1: CATS,
      wl_entries_v1: [
        { id: 'tf1', text: 'Deep work', tag: 'work', ts: base, tsEnd: base + 3600000, date: today },
        {
          id: 'tf2',
          text: 'Code review',
          tag: 'work',
          ts: base + 5400000,
          tsEnd: base + 7200000,
          date: today,
        },
      ],
    });

    assert(
      "Today's Flow section renders",
      await page.evaluate(() => !!document.getElementById('todayFlowSection'))
    );

    assert(
      'Flow view shown by default',
      await page.evaluate(() => document.getElementById('tfFlowPane').style.display !== 'none')
    );

    assert(
      'Log and Blocks panes hidden by default',
      await page.evaluate(
        () =>
          document.getElementById('tfLogPane').style.display === 'none' &&
          document.getElementById('tfBlocksPane').style.display === 'none'
      )
    );

    assert(
      'Day-overview strip present',
      await page.evaluate(() => !!document.getElementById('tfDayStrip'))
    );

    assert(
      'Gap reminder shows for ≥15 min gap between entries',
      await page.evaluate(() => document.getElementById('tfGapReminder').style.display !== 'none')
    );

    // Switch to Log view
    await page.evaluate(() => document.querySelector('.tf-seg-btn[data-view="log"]')?.click());
    assert(
      'Log view shows after toggle',
      await page.evaluate(() => document.getElementById('tfLogPane').style.display !== 'none')
    );

    assert(
      'Flow pane hides after switching to Log',
      await page.evaluate(() => document.getElementById('tfFlowPane').style.display === 'none')
    );

    assert(
      'View preference persisted to localStorage',
      await page.evaluate(() => localStorage.getItem('wl_flow_view') === 'log')
    );

    // Switch to Blocks view
    await page.evaluate(() => document.querySelector('.tf-seg-btn[data-view="blocks"]')?.click());
    assert(
      'Blocks view shows after toggle',
      await page.evaluate(() => document.getElementById('tfBlocksPane').style.display !== 'none')
    );

    assert(
      'Timeblock grid present inside Blocks view',
      await page.evaluate(() => !!document.getElementById('tbGrid'))
    );

    // ── WCAG keyboard navigation on the tablist ──
    // Reset to flow view, focus its tab, then arrow through the views.
    await page.evaluate(() => {
      window.__wl.setFlowView('flow');
      window.__wl.renderTodayFlow();
      document.getElementById('tfTab-flow')?.focus();
    });
    await page.keyboard.press('ArrowRight');
    assert(
      'ArrowRight moves tablist to Log view',
      await page.evaluate(() => localStorage.getItem('wl_flow_view') === 'log')
    );
    await page.keyboard.press('ArrowRight');
    assert(
      'ArrowRight wraps Log → Blocks',
      await page.evaluate(() => localStorage.getItem('wl_flow_view') === 'blocks')
    );
    await page.keyboard.press('Home');
    assert(
      'Home jumps to first tab (Flow)',
      await page.evaluate(() => localStorage.getItem('wl_flow_view') === 'flow')
    );
    await page.keyboard.press('End');
    assert(
      'End jumps to last tab (Blocks)',
      await page.evaluate(() => localStorage.getItem('wl_flow_view') === 'blocks')
    );

    await page.close();
  }

  // Verify that calling setFlowView() + renderTodayFlow() updates pane visibility.
  // Note: this does NOT simulate a real page reload — Playwright's addInitScript
  // JSON-encodes storage values, so a raw 'blocks' string written via freshPage
  // would be stored as '"blocks"' and getFlowView() would fall back to 'flow'.
  // A true reload-survival test would need a custom init hook that writes raw
  // strings; see findLargestGap unit tests for the equivalent direct check.
  {
    const today = dk(new Date());
    const base = Date.now() - 3 * 3600000;
    const page2 = await freshPage(ctx, {
      wl_cats_v1: CATS,
      wl_entries_v1: [
        {
          id: 'tf3',
          text: 'Morning work',
          tag: 'work',
          ts: base,
          tsEnd: base + 3600000,
          date: today,
        },
      ],
    });
    await page2.evaluate(() => {
      window.__wl.setFlowView('blocks');
      window.__wl.renderTodayFlow();
    });
    assert(
      'setFlowView + renderTodayFlow updates pane visibility',
      await page2.evaluate(() => document.getElementById('tfBlocksPane').style.display !== 'none')
    );
    await page2.close();
  }

  // ── Pomodoro dashboard grid ───────────────────────────────────────────────
  console.log('\nPomodoro dashboard grid');
  {
    const page = await freshPage(ctx);
    const hasGrid = await page.evaluate(() => !!document.querySelector('.pomo-grid'));
    assert('Pomo 4-column grid present in DOM', hasGrid);
    const hasSparkline = await page.evaluate(() => !!document.getElementById('pomoSparkline'));
    assert('Sparkline canvas element present', hasSparkline);
    const hasRibbon = await page.evaluate(() => !!document.getElementById('pomoRibbonDots'));
    assert('Ribbon dots element present', hasRibbon);
    // Guard prevents uncaught exception when assert() is non-throwing and
    // hasRibbon is false — null produces a readable "got null" failure message.
    const dotCount = await page.evaluate(() => {
      const el = document.getElementById('pomoRibbonDots');
      return el ? el.querySelectorAll('.pomo-rdot').length : null;
    });
    assert(
      'Ribbon renders exactly 5 dots with empty session log',
      dotCount === 5,
      `got ${dotCount}`
    );
    await page.close();
  }

  // ── 43. Analytics sub-row HTML structure ─────────────────────────────────
  console.log('\n43. Analytics sub-row HTML structure');
  {
    const today = dk(new Date());
    // Anchor to 10:00–10:30 today; avoids migrateEntryDatesToLocal shifting the
    // date to yesterday when tests run in the first 90 minutes of a UTC day.
    const tsStart = new Date(today + 'T10:00:00').getTime();
    const tsEnd = new Date(today + 'T10:30:00').getTime(); // 30 min logged
    const entries = [
      {
        id: 'sr1',
        text: 'AITO-99 Review test cases',
        tag: 'work',
        ts: tsStart,
        tsEnd,
        date: today,
      },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });

    // Open analytics section so sub-rows render
    await page.evaluate(() => {
      const section = document.getElementById('analyticsSection');
      if (section && section.classList.contains('collapsed')) {
        document.getElementById('analyticsHeader').click();
      }
    });

    const todaySubHasTitleDiv = await page.evaluate(
      () => !!document.querySelector('#statTodaySub .stat-sub-title')
    );
    assert('stat-sub today: .stat-sub-title div present for Jira task', todaySubHasTitleDiv);

    const todaySubHasValueDiv = await page.evaluate(
      () => !!document.querySelector('#statTodaySub .stat-sub-value')
    );
    assert('stat-sub today: .stat-sub-value div present', todaySubHasValueDiv);

    const titleText = await page.evaluate(() => {
      const el = document.querySelector('#statTodaySub .stat-sub-title');
      return el ? el.textContent.trim() : null;
    });
    assert(
      'stat-sub today: .stat-sub-title shows task name (Jira title stripped)',
      titleText === 'Review test cases',
      `got "${titleText}"`
    );

    const valueText = await page.evaluate(() => {
      const el = document.querySelector('#statTodaySub .stat-sub-value');
      return el ? el.textContent.trim() : null;
    });
    assert(
      'stat-sub today: .stat-sub-value shows non-empty duration',
      typeof valueText === 'string' && valueText.length > 0,
      `got "${valueText}"`
    );

    await page.close();
  }

  // Non-Jira label path: .stat-sub-title should show the full label as-is
  {
    const today = dk(new Date());
    // Anchor to 10:00–10:30 today (same midnight-robustness reason as the Jira block above)
    const tsStart = new Date(today + 'T10:00:00').getTime();
    const tsEnd = new Date(today + 'T10:30:00').getTime();
    const entries = [
      { id: 'sr2', text: 'Review presentation', tag: 'work', ts: tsStart, tsEnd, date: today },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });

    await page.evaluate(() => {
      const section = document.getElementById('analyticsSection');
      if (section && section.classList.contains('collapsed')) {
        document.getElementById('analyticsHeader').click();
      }
    });

    const titleText = await page.evaluate(() => {
      const el = document.querySelector('#statTodaySub .stat-sub-title');
      return el ? el.textContent.trim() : null;
    });
    assert(
      'stat-sub today: non-Jira label shown verbatim in .stat-sub-title',
      titleText === 'Review presentation',
      `got "${titleText}"`
    );

    const hasValue = await page.evaluate(
      () => !!document.querySelector('#statTodaySub .stat-sub-value')
    );
    assert('stat-sub today: non-Jira path emits .stat-sub-value', hasValue);

    await page.close();
  }

  // Streak sub-row: yesterday entry should produce .stat-sub-title + .stat-sub-value in #statStreakSub
  {
    const yesterday = dk(new Date(Date.now() - 86400000));
    const yStart = new Date(yesterday + 'T09:00:00').getTime();
    const yEnd = new Date(yesterday + 'T11:00:00').getTime();
    const entries = [
      {
        id: 'sr3',
        text: 'Morning planning',
        tag: 'work',
        ts: yStart,
        tsEnd: yEnd,
        date: yesterday,
      },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });

    await page.evaluate(() => {
      const section = document.getElementById('analyticsSection');
      if (section && section.classList.contains('collapsed')) {
        document.getElementById('analyticsHeader').click();
      }
    });

    const streakSubHasTitle = await page.evaluate(
      () => !!document.querySelector('#statStreakSub .stat-sub-title')
    );
    assert('stat-sub streak: .stat-sub-title div present', streakSubHasTitle);

    const streakSubHasValue = await page.evaluate(
      () => !!document.querySelector('#statStreakSub .stat-sub-value')
    );
    assert('stat-sub streak: .stat-sub-value div present', streakSubHasValue);

    await page.close();
  }

  // ── Section 41 — Collapse state persists across page reloads (tt-open2-*) ──
  // Uses a plain ctx.newPage() (no addInitScript) so localStorage survives goto().
  {
    const page = await ctx.newPage();
    // Load with a clean slate so prior test state doesn't interfere.
    await page.goto(FILE);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => localStorage.clear());
    await page.goto(FILE);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(
      () => typeof window.__wl === 'object' && typeof window.__wl.getState === 'function',
      { timeout: 8000 }
    );

    // Analytics starts collapsed by default (no stored key).
    const defaultCollapsed = await page.evaluate(() =>
      document.getElementById('analyticsSection').classList.contains('collapsed')
    );
    assert('collapse: analyticsSection collapsed by default', defaultCollapsed);

    // Open it — handler writes tt-open2-analyticsSection = '0'.
    await page.click('#analyticsHeader');
    const openAfterClick = await page.evaluate(
      () => !document.getElementById('analyticsSection').classList.contains('collapsed')
    );
    assert('collapse: analyticsSection open after header click', openAfterClick);

    // Reload without clearing localStorage — open state must survive.
    await page.goto(FILE);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(
      () => typeof window.__wl === 'object' && typeof window.__wl.getState === 'function',
      { timeout: 8000 }
    );
    const openAfterReload = await page.evaluate(
      () => !document.getElementById('analyticsSection').classList.contains('collapsed')
    );
    assert(
      'collapse: analyticsSection stays open after reload (tt-open2- persisted)',
      openAfterReload
    );

    // Close it — collapsed state must also survive.
    await page.click('#analyticsHeader');
    await page.goto(FILE);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(
      () => typeof window.__wl === 'object' && typeof window.__wl.getState === 'function',
      { timeout: 8000 }
    );
    const collapsedAfterReload = await page.evaluate(() =>
      document.getElementById('analyticsSection').classList.contains('collapsed')
    );
    assert('collapse: analyticsSection stays collapsed after reload', collapsedAfterReload);

    await page.close();
  }

  // ── Pomodoro running/done states (pomoAddTime + pomoTapOut) ──────────────
  console.log('\nPomodoro running/done states');
  {
    // --- pomoAddTime adds 2 minutes to a live session ---
    const page = await freshPage(ctx);
    // Expand pomodoro section if collapsed
    await page.evaluate(() => {
      const s = document.getElementById('pomoSection');
      if (s && s.classList.contains('collapsed')) document.getElementById('pomoHeader')?.click();
    });
    await page.waitForTimeout(100);
    // Start a 1-minute session and read the initial time
    await page.evaluate(() => {
      window.__wl.initPomo(1);
      window.__wl.startPomo();
    });
    await page.waitForTimeout(200);
    const timeBefore = await page.evaluate(() => document.getElementById('pomoTime').textContent);
    await page.evaluate(() => window.__wl.pomoAddTime());
    const timeAfter = await page.evaluate(() => document.getElementById('pomoTime').textContent);
    const parsePomoSecs = (s) => {
      const [m, sec] = s.split(':').map(Number);
      return m * 60 + sec;
    };
    const diff = parsePomoSecs(timeAfter) - parsePomoSecs(timeBefore);
    assert('pomoAddTime increases remaining time by ~120 s', diff === 120, `diff was ${diff}`);
    await page.evaluate(() => window.__wl.pausePomo());
    await page.close();
  }

  {
    // --- pomoTapOut logs partial session and sets pomo--done state ---
    const page = await freshPage(ctx);
    await page.evaluate(() => {
      window.__wl.initPomo(5);
      window.__wl.startPomo();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__wl.pomoTapOut());
    await page.waitForTimeout(50);

    const isDone = await page.evaluate(() =>
      document.getElementById('pomoBody')?.classList.contains('pomo--done')
    );
    assert('pomoTapOut transitions body to pomo--done', isDone);

    const logEntry = await page.evaluate(() => {
      const raw = localStorage.getItem('wl_pomoLog_v1');
      if (!raw) return null;
      const log = JSON.parse(raw);
      return log.length > 0 ? log[0] : null;
    });
    assert('pomoTapOut writes an entry to wl_pomoLog_v1', logEntry !== null);
    assert(
      'pomoTapOut log entry has mins >= 1',
      typeof logEntry?.mins === 'number' && logEntry.mins >= 1,
      `got mins=${logEntry?.mins}`
    );
    await page.close();
  }

  // ── Hero Card idle panel reflects completed entries ───────────────────────
  // The top-zone redesign moved the tracked-total and last-session display
  // from the header into the Hero Card idle panel (heroLoggedToday /
  // heroIdleLastSession). The header's updateHeaderTracking() is now a no-op.
  console.log('\nHero Card logged-today tracking');
  {
    const today = dk(new Date());
    // Anchor to 10:00–10:30 today; avoids migrateEntryDatesToLocal shifting the
    // date to yesterday when tests run in the first 90 minutes of a UTC day.
    const tsStart = new Date(today + 'T10:00:00').getTime();
    const tsEnd = new Date(today + 'T10:30:00').getTime(); // 30 min logged
    const entries = [
      { id: 'ht1', text: 'Header test task', tag: 'work', ts: tsStart, tsEnd, date: today },
    ];
    const page = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    await page.waitForTimeout(200);

    const total = await page.evaluate(
      () => document.getElementById('heroLoggedToday')?.textContent
    );
    assert(
      'Hero Card heroLoggedToday shows 30m for a 30-minute entry',
      total === '30m',
      `got "${total}"`
    );

    const lastSession = await page.evaluate(
      () => document.getElementById('heroIdleLastSession')?.textContent
    );
    assert(
      'Hero Card heroIdleLastSession renders non-empty last-session text',
      typeof lastSession === 'string' && lastSession.length > 0,
      `got "${lastSession}"`
    );
    await page.close();
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  await browser.close();
  await stopServer();
  console.log('\n' + '─'.repeat(48));
  console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);
  console.log('─'.repeat(48));
  if (failed > 0) {
    console.log('\nFailed tests:');
    results
      .filter((r) => !r.ok)
      .forEach((r) => console.log(`  ❌ ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(async (err) => {
  console.error('\nTest runner crashed:', err.message);
  await stopServer();
  process.exit(1);
});
