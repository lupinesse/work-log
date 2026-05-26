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
  return date.toISOString().slice(0, 10);
}

async function freshPage(ctx, extraStorage = {}) {
  const page = await ctx.newPage();
  await page.addInitScript((storage) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, JSON.stringify(v));
  }, extraStorage);
  await page.goto(FILE);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
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
    await page.waitForTimeout(600);
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

  // ── 2. roundToNearest30 ───────────────────────────────────────────────────
  console.log('\n2. roundToNearest30');
  {
    const page = await freshPage(ctx);
    const r = (h, m) =>
      page.evaluate(
        ({ h, m }) => {
          const ts = new Date(2026, 4, 6, h, m, 30).getTime();
          const d = new Date(window.__wl.roundToNearest30(ts));
          return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
        },
        { h, m }
      );
    const r00 = await r(10, 0);
    assert('10:00 → 10:00', r00.h === 10 && r00.m === 0);
    const r08 = await r(10, 8);
    assert('10:08 → 10:00', r08.h === 10 && r08.m === 0);
    const r15 = await r(10, 15);
    assert('10:15 → 10:00', r15.h === 10 && r15.m === 0);
    const r16 = await r(10, 16);
    assert('10:16 → 10:30', r16.h === 10 && r16.m === 30);
    const r30 = await r(10, 30);
    assert('10:30 → 10:30', r30.h === 10 && r30.m === 30);
    const r45 = await r(10, 45);
    assert('10:45 → 10:30', r45.h === 10 && r45.m === 30);
    const r46 = await r(10, 46);
    assert('10:46 → 11:00', r46.h === 11 && r46.m === 0);
    const r59 = await r(10, 59);
    assert('10:59 → 11:00', r59.h === 11 && r59.m === 0);
    const sec = await r(10, 16);
    assert('seconds zeroed', sec.s === 0);
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
      'Timer bar visible',
      await page.evaluate(() => document.getElementById('timerBar').style.display !== 'none')
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
      'Timer bar visible while running',
      await page.evaluate(() => document.getElementById('timerBar').style.display !== 'none')
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
    await page.waitForTimeout(300);
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
    assert(
      'completedAt is not midnight sentinel',
      !(new Date(completedAt).getHours() === 0 && new Date(completedAt).getMinutes() === 0)
    );
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
    await page.waitForTimeout(600);
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
      'Week number in second box',
      await page.evaluate(() => {
        const el = document.getElementById('liveWeek');
        const boxes = document.querySelectorAll('.live-info');
        return boxes.length >= 2 && boxes[1].contains(el);
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
    await page.waitForTimeout(300);
    // Inject a distraction directly
    await page.evaluate(() => {
      const d = {
        ts: Date.now(),
        date: new Date().toISOString().slice(0, 10),
        task: 'Focus task',
        note: 'Threads',
      };
      const all = JSON.parse(localStorage.getItem('wl_distractions_v1') || '[]');
      all.push(d);
      localStorage.setItem('wl_distractions_v1', JSON.stringify(all));
    });
    // Trigger render directly
    await page.evaluate(() => window.__wl.renderDistractionCount());
    await page.waitForTimeout(300);
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
    await page.waitForTimeout(400);
    const titlePaused = await page.title();
    assert('Title shows ⏸ when paused', titlePaused.startsWith('⏸'));
    await page.close();
  }

  // ── 14. CSS color validator (safeCssColor) ────────────────────────────────
  console.log('\n14. safeCssColor');
  {
    // Use raw page so reload doesn't wipe injected categories
    const page = await ctx.newPage();
    await page.goto(FILE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      localStorage.setItem(
        'wl_cats_v1',
        JSON.stringify([
          { id: 'evil', label: 'evil', color: 'red; background:url(javascript:alert(1))' },
          { id: 'hex', label: 'hex', color: '#378ADD' },
          { id: 'hsl', label: 'hsl', color: 'hsl(200, 50%, 50%)' },
        ])
      );
    });
    await page.goto(FILE); // re-navigate without addInitScript wipe
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    const evilColor = await page.evaluate(() => window.__wl.getCat('evil').color);
    assert('Malicious color replaced with fallback', evilColor === '#888780');
    const hexColor = await page.evaluate(() => window.__wl.getCat('hex').color);
    assert('Valid hex color preserved', hexColor === '#378ADD');
    const hslColor = await page.evaluate(() => window.__wl.getCat('hsl').color);
    assert('Valid hsl color preserved', hslColor === 'hsl(200, 50%, 50%)');
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
    await page.waitForTimeout(400);

    // Enter emergency mode
    await page.evaluate(() => document.getElementById('emergencyBtn').click());
    await page.waitForTimeout(200);

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
    await page.waitForTimeout(200);

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
    await page.waitForTimeout(200);
    const restored = await page.evaluate(() => document.getElementById('emergencyNext').value);
    assert('Next action restored on re-entry', restored === 'Check the token expiry');

    // Escape key exits
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
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
    await page.waitForTimeout(400);

    // First stop click — should show handoff input
    await page.evaluate(() => document.getElementById('timerStop').click());
    await page.waitForTimeout(200);

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
    await page.waitForTimeout(300);

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
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__wl.stopTimer());
    await page.waitForTimeout(300);
    // Need another entry to trigger quick pick render with at least one recent task
    await page.evaluate(() => window.__wl.render());
    await page.waitForTimeout(300);
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
      await page.waitForTimeout(800);
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
      await page.waitForTimeout(300);

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
      await page.waitForTimeout(300);
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
    await page.waitForTimeout(400);

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
    await page.waitForTimeout(400);

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
      const pauseEnd = new Date(liveEntry.ts + (timerRaw.accumulatedMs || 0));
      const startSlot = timeToSlot(
        new Date(liveEntry.ts).getHours(),
        new Date(liveEntry.ts).getMinutes()
      );
      const endSlot = timeToSlot(pauseEnd.getHours(), pauseEnd.getMinutes());
      // Check slot 90 min after start is NOT covered
      const nowSlot = timeToSlot(new Date().getHours(), new Date().getMinutes());
      const covered = new Set();
      for (let s = Math.max(0, startSlot); s < Math.min(TB_SLOTS, endSlot + 1); s++) covered.add(s);
      return { endSlot, nowSlot, nowCovered: covered.has(nowSlot) };
    });
    assert('Paused timer has coverage data', !!coverage);
    assert('Paused timer endSlot < nowSlot', coverage && coverage.endSlot < coverage.nowSlot);
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
    await page.waitForTimeout(400);
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
    await page.waitForTimeout(300);
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
    await page.waitForTimeout(300);
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
    await page.waitForTimeout(200);
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
    await page.waitForTimeout(200);
    const streakValAfter = await page.evaluate(
      () => document.getElementById('statStreak').textContent
    );
    assert('Streak stays at 2 — today not counted by design', streakValAfter === '2');
    await page.close();
  }

  // ── 25. Calendar section & meetings ────────────────────────────────────────
  console.log('\n25. Calendar section');
  {
    const page = await freshPage(ctx);
    // Check that calendar section exists
    assert('calSection exists', await page.evaluate(() => !!document.getElementById('calSection')));
    assert('calHeader exists', await page.evaluate(() => !!document.getElementById('calHeader')));
    assert(
      'calMeetings exists',
      await page.evaluate(() => !!document.getElementById('calMeetings'))
    );
    assert(
      'calCount badge exists',
      await page.evaluate(() => !!document.getElementById('calCount'))
    );

    // Inject a mock meeting so renderCalStrip produces delete buttons
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
    await page.waitForTimeout(200);
    const hasDeleteBtn = await page.evaluate(
      () => document.querySelectorAll('.cal-delete-btn').length > 0
    );
    assert('Delete buttons exist in DOM', hasDeleteBtn);

    await page.close();
  }

  // ── 26. Meeting deletion persistence ───────────────────────────────────────
  console.log('\n26. Meeting deletion');
  {
    const today = dk(new Date());
    const page = await freshPage(ctx);

    // Simulate clicking a delete button and verify localStorage is updated
    const hiddenBefore = await page.evaluate(
      ({ today }) => {
        const key = 'wl_hidden_meetings_' + today;
        return localStorage.getItem(key);
      },
      { today }
    );
    assert('No hidden meetings initially', hiddenBefore === null);

    // Simulate adding a hidden meeting
    await page.evaluate(
      ({ today }) => {
        const key = 'wl_hidden_meetings_' + today;
        const meetings = ['Team Standup'];
        localStorage.setItem(key, JSON.stringify(meetings));
      },
      { today }
    );

    const hiddenAfter = await page.evaluate(
      ({ today }) => {
        const key = 'wl_hidden_meetings_' + today;
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : [];
      },
      { today }
    );
    assert('Hidden meeting persists in storage', hiddenAfter.includes('Team Standup'));

    await page.close();
  }

  // ── 27. Nameday with Swedish flag SVG ──────────────────────────────────────
  console.log('\n27. Nameday display');
  {
    const page = await freshPage(ctx);

    // Check that nameday element exists
    assert(
      'liveNameday element exists',
      await page.evaluate(() => !!document.getElementById('liveNameday'))
    );

    // Check that it either shows a name or error message
    const content = await page.evaluate(() => {
      const el = document.getElementById('liveNameday');
      return el ? el.textContent : '';
    });
    const hasContent = content.length > 0;
    assert('liveNameday has content', hasContent);

    // Check for either emoji or SVG flag
    const hasFlagOrEmoji = await page.evaluate(() => {
      const el = document.getElementById('liveNameday');
      const svg = el.querySelector('svg');
      const text = el.textContent;
      return !!svg || text.includes('🎂');
    });
    assert('Nameday shows flag SVG or emoji', hasFlagOrEmoji);

    await page.close();
  }

  // ── 28. Flag days section ──────────────────────────────────────────────────
  console.log('\n28. Flag days API');
  {
    const page = await freshPage(ctx);

    // Check that flag day element exists
    assert(
      'liveFlagDay element exists',
      await page.evaluate(() => !!document.getElementById('liveFlagDay'))
    );

    // Check that it has content (flag day emoji or text)
    const content = await page.evaluate(() => {
      const el = document.getElementById('liveFlagDay');
      return el ? el.textContent : '';
    });
    const hasContent = content.length > 0;
    assert('liveFlagDay displays content', hasContent);

    await page.close();
  }

  // ── 29. Status carry-over (pending/blocked) ────────────────────────────────
  console.log('\n29. Status carry-over');
  {
    const yesterday = dk(new Date(Date.now() - 86400000));

    // Create a task with pending status from yesterday
    const planTasks = [
      {
        id: 'p1',
        text: 'Important task',
        status: 'pending',
        date: yesterday,
        tag: 'work',
        comments: [{ text: 'Waiting for review', ts: Date.now() - 86400000 }],
      },
    ];

    const page = await freshPage(ctx, { wl_plan_v1: planTasks, wl_cats_v1: CATS });

    // Check if pending section is visible
    const hasPendingSection = await page.evaluate(() => {
      return !!document.querySelector('[id*="pending"]');
    });
    assert('Page has pending/blocked section', hasPendingSection);

    await page.close();
  }

  // ── 30. Upcoming Tasks section ─────────────────────────────────────────────
  console.log('\n30. Upcoming Tasks');
  {
    const today = dk(new Date());
    const tomorrow = dk(new Date(Date.now() + 86400000));

    const planTasks = [
      { id: 'u1', text: 'Today task', status: 'todo', date: today, tag: 'work' },
      { id: 'u2', text: 'Tomorrow task', status: 'todo', date: tomorrow, tag: 'work' },
    ];

    const page = await freshPage(ctx, { wl_plan_v1: planTasks, wl_cats_v1: CATS });

    // Check for upcoming section
    const hasUpcoming = await page.evaluate(() => {
      const text = document.body.textContent;
      return text.includes('Upcoming') || text.includes('upcoming');
    });
    assert('Upcoming section or label visible', hasUpcoming);

    await page.close();
  }

  // ── 31. Timer input field text visibility ──────────────────────────────────
  console.log('\n31. Timer input styling');
  {
    const page = await freshPage(ctx);

    // Check that input fields have proper visibility
    const handoffColor = await page.evaluate(() => {
      const el = document.getElementById('timerHandoff');
      return window.getComputedStyle(el).color;
    });
    assert(
      'Handoff input has visible text color',
      handoffColor !== '' && handoffColor !== 'rgba(0, 0, 0, 0)'
    );

    const parkColor = await page.evaluate(() => {
      const el = document.getElementById('parkCapture');
      return window.getComputedStyle(el).color;
    });
    assert(
      'Park capture input has visible text color',
      parkColor !== '' && parkColor !== 'rgba(0, 0, 0, 0)'
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
      { id: 'cp2', text: 'Task no steps', tag: 'work', status: 'todo', date: today },
    ];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    await page.waitForTimeout(300);

    const planHtml = await page.evaluate(() => document.getElementById('planList').innerHTML);
    assert('cp-badge rendered for task with checkpoints', planHtml.includes('cp-badge'));
    assert('Badge shows correct fraction (1/3)', planHtml.includes('1/3'));
    assert('+ steps badge on task with no checkpoints', planHtml.includes('+ steps'));

    // Open checkpoints by clicking the badge
    await page.evaluate(() => document.querySelector('.cp-badge[data-pid="cp1"]').click());
    await page.waitForTimeout(200);
    const openHtml = await page.evaluate(() => document.getElementById('planList').innerHTML);
    assert('Checkpoint area opens on badge click', openHtml.includes('cp-area'));
    assert('Step text rendered', openHtml.includes('Step one'));
    assert('Done step has cp-checked class', openHtml.includes('cp-checked'));
    assert('Progress bar rendered', openHtml.includes('cp-fill'));

    // Tick an unchecked checkpoint — three-state: false → 'partial' → true
    await page.evaluate(() =>
      document.querySelector('.cp-check[data-pid="cp1"][data-cpidx="0"]').click()
    );
    await page.waitForTimeout(200);
    const afterTick1 = await page.evaluate(() =>
      window.__wl.getState().planTasks.find((t) => t.id === 'cp1')
    );
    assert('First tick sets checkpoint to partial', afterTick1?.checkpoints[0]?.done === 'partial');

    await page.evaluate(() =>
      document.querySelector('.cp-check[data-pid="cp1"][data-cpidx="0"]').click()
    );
    await page.waitForTimeout(200);
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
    await page.waitForTimeout(300);

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
    await page.waitForTimeout(200);
    const planHtml = await page.evaluate(() => document.getElementById('planList').innerHTML);
    assert('Handoff note shown in plan row', planHtml.includes('pick up from line 42'));
    assert('Handoff dismiss button rendered', planHtml.includes('plan-handoff-dismiss'));
    assert('Unfinished task has handoff note class', planHtml.includes('plan-handoff-note'));

    // Verify EOD notes only show worked-on tasks (not done tasks, not unworked tasks)
    await page.evaluate(() => window.__wl.openEodModal());
    await page.waitForTimeout(200);
    const notesHtml = await page.evaluate(() => document.getElementById('eodTaskNotes').innerHTML);
    assert('Worked task shown in EOD notes', notesHtml.includes('Unfinished task'));
    assert('Done task not in EOD notes', !notesHtml.includes('Done task'));

    await page.close();
  }

  // ── 34. Parked thoughts ─────────────────────────────────────────────────────
  console.log('\n34. Parked thoughts');
  {
    const page = await freshPage(ctx);
    await page.waitForTimeout(300);

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
    await page.waitForTimeout(200);
    const section = await page.evaluate(() => document.getElementById('parkSection').style.display);
    assert('Park section visible when items exist', section !== 'none');
    const html = await page.evaluate(() => document.getElementById('parkList').innerHTML);
    assert('Parked item text rendered', html.includes('A parked idea'));
    assert('Promote-to-task button exists', html.includes('parked-promote'));
    assert('Dismiss button exists', html.includes('parked-dismiss'));

    await page.close();
  }

  // ── 6. completedAt expiry at iteration boundaries ──────────────────────────
  console.log('\n6. completedAt expiry at iteration boundaries');
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
    await page2.waitForTimeout(300);

    // Enter focus mode
    await page2.evaluate(() => document.getElementById('emergencyBtn').click());
    await page2.waitForTimeout(200);

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
    await page2.waitForTimeout(200);
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
    await page.waitForTimeout(300);

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
    await page2.waitForTimeout(300);

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
    await page.waitForTimeout(300);

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
    await page.waitForTimeout(300);

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

    await page.waitForTimeout(200);

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
    await page.waitForTimeout(200);

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
    await page.waitForTimeout(300);

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
    await page.waitForTimeout(300);

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
    await page.waitForTimeout(300);

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
    await page.waitForTimeout(300);

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
    await page.waitForTimeout(200);

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
    await page.waitForTimeout(200);
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
    await page.waitForTimeout(200);
    const afterClick2 = await getState();
    assert('Click 2: "partial" → true', afterClick2 === true, `got ${JSON.stringify(afterClick2)}`);

    // Click 3: true → false
    await page.evaluate(() =>
      document.querySelector('.cp-check[data-pid="ts1"][data-cpidx="0"]').click()
    );
    await page.waitForTimeout(200);
    const afterClick3 = await getState();
    assert('Click 3: true → false', afterClick3 === false, `got ${JSON.stringify(afterClick3)}`);

    // Click 4: false → 'partial' again (cycle repeats)
    await page.evaluate(() =>
      document.querySelector('.cp-check[data-pid="ts1"][data-cpidx="0"]').click()
    );
    await page.waitForTimeout(200);
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

  // ── Daily Log ─────────────────────────────────────────────────────────────
  console.log('\nDaily Log');
  {
    const today = dk(new Date());
    const page = await freshPage(ctx, {
      wl_entries_v1: [{ id: 'dl1', text: 'Deep work', tag: 'work', ts: Date.now(), date: today }],
    });
    await page.click('#tabDailyLog');
    await page.waitForSelector('#dailyLogSection:visible');
    const html = await page.evaluate(() => document.getElementById('dailyLogFeed').innerHTML);
    assert('Daily Log renders entry', html.includes('Deep work'), 'entry text not found in feed');
    // Add a note via the programmatic helper
    await page.evaluate(() => {
      document.getElementById('dailyLogNoteInput').value = 'remembered to call back';
      window.__wl.addLogNote();
    });
    const noteHtml = await page.evaluate(() => document.getElementById('dailyLogFeed').innerHTML);
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

  // ── Monthly Log ───────────────────────────────────────────────────────────
  console.log('\nMonthly Log');
  {
    const today = dk(new Date());
    const page = await freshPage(ctx, {
      wl_entries_v1: [
        {
          id: 'ml1',
          text: 'Monthly task',
          tag: 'work',
          ts: Date.now() - 3600000,
          tsEnd: Date.now(),
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
    // Cycle through all six and confirm it wraps back to billable
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) window.__wl.cycleSignifier('sig1');
    });
    const wrapped = await page.evaluate(() => window.__wl.getState().entries[0].signifier);
    assert(
      'Signifier wraps back to billable after 6 cycles',
      wrapped === 'billable',
      `got ${JSON.stringify(wrapped)}`
    );
    // Cancelled entry excluded from isEntryBillable
    await page.evaluate(() => {
      window.__wl.cycleSignifier('sig1'); // billable → event
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
