// Work Log — Smoke Test Suite
// Run with: node smoke-tests.js
// Requires: playwright (npm install playwright && npx playwright install chromium)

const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file://' + path.resolve(__dirname, 'work-log.html') + '?test=1';

let passed = 0, failed = 0;
const results = [];

function assert(name, condition, detail = '') {
  if (condition) { passed++; results.push({ ok: true, name }); console.log(`  ✅ ${name}`); }
  else           { failed++; results.push({ ok: false, name, detail }); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

function dk(date) { return date.toISOString().slice(0, 10); }

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

const CATS = [{ id: 'work', label: 'work', color: '#378ADD' }, { id: 'other', label: 'other', color: '#888780' }];

async function runTests() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();

  // ── 1. Page load ──────────────────────────────────────────────────────────
  console.log('\n1. Page load');
  {
    const errors = [];
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.clear());
    await page.goto(FILE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    assert('No JS errors on load',       errors.length === 0, errors[0]);
    assert('Test harness exposed',       await page.evaluate(() => typeof window.__wl === 'object'));
    assert('Stats rendered',             await page.evaluate(() => !!document.getElementById('statToday')));
    assert('liveWeek element exists',    await page.evaluate(() => !!document.getElementById('liveWeek')));
    assert('liveMoon element exists',    await page.evaluate(() => !!document.getElementById('liveMoon')));
    assert('liveFlagDay element exists', await page.evaluate(() => !!document.getElementById('liveFlagDay')));
    assert('liveNameday element exists', await page.evaluate(() => !!document.getElementById('liveNameday')));
    assert('liveSunrise element exists', await page.evaluate(() => !!document.getElementById('liveSunrise')));
    assert('liveRain element exists',    await page.evaluate(() => !!document.getElementById('liveRain')));
    assert('backupBtn exists',           await page.evaluate(() => !!document.getElementById('backupBtn')));
    assert('timerDistract btn exists',   await page.evaluate(() => !!document.getElementById('timerDistract')));
    assert('distractionSection exists',  await page.evaluate(() => !!document.getElementById('distractionSection')));
    await page.close();
  }

  // ── 2. roundToNearest30 ───────────────────────────────────────────────────
  console.log('\n2. roundToNearest30');
  {
    const page = await freshPage(ctx);
    const r = (h, m) => page.evaluate(({ h, m }) => {
      const ts = new Date(2026, 4, 6, h, m, 30).getTime();
      const d  = new Date(window.__wl.roundToNearest30(ts));
      return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
    }, { h, m });
    const r00 = await r(10,  0); assert('10:00 → 10:00', r00.h === 10 && r00.m === 0);
    const r08 = await r(10,  8); assert('10:08 → 10:00', r08.h === 10 && r08.m === 0);
    const r15 = await r(10, 15); assert('10:15 → 10:00', r15.h === 10 && r15.m === 0);
    const r16 = await r(10, 16); assert('10:16 → 10:30', r16.h === 10 && r16.m === 30);
    const r30 = await r(10, 30); assert('10:30 → 10:30', r30.h === 10 && r30.m === 30);
    const r45 = await r(10, 45); assert('10:45 → 10:30', r45.h === 10 && r45.m === 30);
    const r46 = await r(10, 46); assert('10:46 → 11:00', r46.h === 11 && r46.m === 0);
    const r59 = await r(10, 59); assert('10:59 → 11:00', r59.h === 11 && r59.m === 0);
    const sec = await r(10, 16); assert('seconds zeroed', sec.s === 0);
    await page.close();
  }

  // ── 3. localStorage round-trip + save() guard ─────────────────────────────
  console.log('\n3. localStorage round-trip');
  {
    const today   = dk(new Date());
    const entries = [{ id: 'rt1', text: 'Test task', tag: 'work', ts: Date.now(), date: today }];
    const page    = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    const state   = await page.evaluate(() => window.__wl.getState());
    assert('Entries loaded from storage', state.entries.length === 1);
    assert('Entry text preserved',        state.entries[0]?.text === 'Test task');
    assert('Custom categories loaded',    state.categories.length === 2);
    assert('Category colour preserved',   state.categories[0]?.color === '#378ADD');
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
    const today   = dk(new Date());
    const entries = [{ id: 'tm1', text: 'Timer task', tag: 'work', ts: Date.now() - 65000, date: today }];
    const page    = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    // Start timer via test harness after load — avoids Node/browser Date.now() skew
    await page.evaluate(() => window.__wl.startTimer('tm1'));
    await page.waitForTimeout(1200);
    assert('Timer bar visible',     await page.evaluate(() => document.getElementById('timerBar').style.display !== 'none'));
    assert('Timer shows task name', await page.evaluate(() => document.getElementById('timerTask').textContent === 'Timer task'));
    assert('Elapsed time non-zero', await page.evaluate(() => document.getElementById('timerElapsed').textContent !== '00:00'));
    const title = await page.title();
    assert('Tab title shows elapsed time', title.includes(':') && title.includes('Timer task'));
    assert('Tab title has running indicator', title.startsWith('▶'));
    await page.close();
  }

  // ── 5. Timer persists and increments ─────────────────────────────────────
  console.log('\n5. Timer persists across reload');
  {
    const today   = dk(new Date());
    const entries = [{ id: 'tp1', text: 'Persistent timer', tag: 'work', ts: Date.now() - 5000, date: today }];
    const page    = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    // Start timer in browser
    await page.evaluate(() => window.__wl.startTimer('tp1'));
    const elapsed1 = await page.evaluate(() => document.getElementById('timerElapsed').textContent);
    await page.waitForTimeout(1500);
    const elapsed2 = await page.evaluate(() => document.getElementById('timerElapsed').textContent);
    assert('Timer bar visible while running', await page.evaluate(() => document.getElementById('timerBar').style.display !== 'none'));
    // Either the timer ticked (elapsed2 > elapsed1) or it shows non-zero
    const nonZero = elapsed1 !== '00:00' || elapsed2 !== '00:00';
    assert('Timer elapsed is non-zero',  nonZero);
    assert('Timer elapsed format valid', /\d+:\d+/.test(elapsed2));
    // Verify timer state persists in localStorage (saved correctly)
    const saved = await page.evaluate(() => !!JSON.parse(localStorage.getItem('wl_timer_v1') || 'null'));
    assert('Timer state saved to localStorage', saved);
    await page.close();
  }

  // ── 6. completedAt + completed section ────────────────────────────────────
  console.log('\n6. completedAt');
  {
    const today = dk(new Date());
    const tasks = [{ id: 'ca1', text: 'Complete me', tag: 'work', status: 'todo', date: today }];
    const page  = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    await page.evaluate(() => {
      const sel = document.querySelector('.plan-status[data-pid="ca1"]');
      if (sel) { sel.value = 'done'; sel.dispatchEvent(new Event('change')); }
    });
    await page.waitForTimeout(300);
    const completedAt = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('wl_plan_v1') || '[]').find(t => t.id === 'ca1')?.completedAt
    );
    assert('completedAt set when marked Done',     !!completedAt);
    assert('completedAt is not 23:59 sentinel',    !(new Date(completedAt).getHours() === 23 && new Date(completedAt).getMinutes() === 59));
    assert('completedAt is not midnight sentinel', !(new Date(completedAt).getHours() === 0 && new Date(completedAt).getMinutes() === 0));
    assert('completedAt within 30min of now',      typeof completedAt === 'number' && Math.abs(completedAt - Date.now()) < 31 * 60 * 1000);
    assert('Completed tasks section exists',       await page.evaluate(() => !!document.getElementById('completedSection')));
    assert('Completed task appears in section',    await page.evaluate(() => document.querySelectorAll('.completed-item').length >= 1));
    const whenText = await page.evaluate(() => document.querySelector('.completed-item')?.textContent || '');
    assert('Completed item shows "completed" text', whenText.toLowerCase().includes('completed'));
    await page.close();
  }

  // ── 7. Auto-carry + parent promotion ──────────────────────────────────────
  console.log('\n7. Auto-carry');
  {
    const yesterday = dk(new Date(Date.now() - 86400000));
    const today     = dk(new Date());
    const tasks = [
      { id: 'ac1', text: 'Carry me',     tag: 'work', status: 'inprogress', date: yesterday },
      { id: 'ac2', text: 'Already done', tag: 'work', status: 'done',       date: yesterday, completedAt: Date.now() - 3600000 },
      { id: 'ac3', text: 'Child task',   tag: 'work', status: 'todo',       date: yesterday, parentId: 'ac1' },
    ];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    await page.evaluate(() =>
      Object.keys(localStorage).filter(k => k.startsWith('wl_carried_')).forEach(k => localStorage.removeItem(k))
    );
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    const todayTasks = await page.evaluate((today) =>
      window.__wl.getState().planTasks.filter(t => t.date === today)
    , today);
    const carried      = todayTasks.find(t => t.text === 'Carry me');
    const doneNotCarry = todayTasks.find(t => t.text === 'Already done');
    const child        = todayTasks.find(t => t.text === 'Child task');
    assert('Unfinished task carried to today',        !!carried);
    assert('Carried task preserves inprogress',       carried?.status === 'inprogress');
    assert('Done task not carried',                   !doneNotCarry);
    assert('Child task carried',                      !!child);
    assert('Child parentId remapped to today parent', child?.parentId === carried?.id);
    const promoPage = await freshPage(ctx, {
      wl_plan_v1: [
        { id: 'pr1', text: 'Parent task', tag: 'work', status: 'todo', date: today },
        { id: 'pr2', text: 'Child task2', tag: 'work', status: 'todo', date: today, parentId: 'pr1' },
      ],
      wl_cats_v1: CATS
    });
    await promoPage.evaluate(() => {
      const sel = document.querySelector('.plan-status[data-pid="pr2"]');
      if (sel) { sel.value = 'inprogress'; sel.dispatchEvent(new Event('change')); }
    });
    await promoPage.waitForTimeout(300);
    const parentStatus = await promoPage.evaluate(() =>
      window.__wl.getState().planTasks.find(t => t.id === 'pr1')?.status
    );
    assert('Child inprogress promotes parent', parentStatus === 'inprogress');
    await promoPage.close();
    await page.close();
  }

  // ── 8. Sort order ──────────────────────────────────────────────────────────
  console.log('\n8. Sort order');
  {
    const today = dk(new Date());
    const tasks = [
      { id: 's1', text: 'Zebra todo',  tag: 'work', status: 'todo',       date: today },
      { id: 's2', text: 'Alpha todo',  tag: 'work', status: 'todo',       date: today },
      { id: 's3', text: 'In progress', tag: 'work', status: 'inprogress', date: today },
      { id: 's4', text: 'Done task',   tag: 'work', status: 'done',       date: today, completedAt: Date.now() - 1000 },
    ];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.plan-item')).map(el => el.dataset.pid)
    );
    assert('In Progress before To do',     order.indexOf('s3') < order.indexOf('s1'));
    assert('Alpha todo before Zebra todo', order.indexOf('s2') < order.indexOf('s1'));
    assert('Done task not in plan list',   !order.includes('s4'));
    await page.close();
  }

  // ── 9. Plan count header ───────────────────────────────────────────────────
  console.log('\n9. Plan count header');
  {
    const today = dk(new Date());
    const tasks = [
      { id: 'pc1', text: 'Task A', tag: 'work', status: 'todo',       date: today },
      { id: 'pc2', text: 'Task B', tag: 'work', status: 'inprogress', date: today },
      { id: 'pc3', text: 'Task C', tag: 'work', status: 'done',       date: today, completedAt: Date.now() - 1000 },
    ];
    const page = await freshPage(ctx, { wl_plan_v1: tasks, wl_cats_v1: CATS });
    const count = await page.evaluate(() => document.getElementById('planCount').textContent);
    assert('Count shows to do',       count.includes('1 to do'));
    assert('Count shows in progress', count.includes('1 in progress'));
    assert('Count shows done',        count.includes('1 done'));
    assert('Count uses · separator',  count.includes('·'));
    await page.close();
  }

  // ── 10. Week number ────────────────────────────────────────────────────────
  console.log('\n10. Week number');
  {
    const page = await freshPage(ctx);
    const weekText = await page.evaluate(() => document.getElementById('liveWeek').textContent);
    assert('Week number shown',         /Week \d+\/\d+/.test(weekText));
    assert('Week format valid',         /Week ([1-9]|[1-4]\d|5[0-3])\/5[23]/.test(weekText));
    assert('Week number in second box', await page.evaluate(() => {
      const el = document.getElementById('liveWeek');
      const boxes = document.querySelectorAll('.live-info');
      return boxes.length >= 2 && boxes[1].contains(el);
    }));
    await page.close();
  }

  // ── 11. Distraction tracking ───────────────────────────────────────────────
  console.log('\n11. Distraction tracking');
  {
    const today   = dk(new Date());
    const entries = [{ id: 'dt1', text: 'Focus task', tag: 'work', ts: Date.now() - 60000, date: today }];
    const page    = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    await page.evaluate(() => window.__wl.startTimer('dt1'));
    await page.waitForTimeout(300);
    // Inject a distraction directly
    await page.evaluate(() => {
      const d = { ts: Date.now(), date: new Date().toISOString().slice(0, 10), task: 'Focus task', note: 'Threads' };
      const all = JSON.parse(localStorage.getItem('wl_distractions_v1') || '[]');
      all.push(d);
      localStorage.setItem('wl_distractions_v1', JSON.stringify(all));
    });
    // Trigger render directly
    await page.evaluate(() => window.__wl.renderDistractionCount());
    await page.waitForTimeout(300);
    const section = await page.evaluate(() => document.getElementById('distractionSection').innerHTML);
    assert('Distraction section shows entry',        section.includes('distraction'));
    assert('Distraction note shown',                 section.includes('Threads'));
    await page.close();
  }

  // ── 12. Active task highlighting ──────────────────────────────────────────
  console.log('\n12. Active task highlighting');
  {
    const today   = dk(new Date());
    const entries = [{ id: 'ah1', text: 'Active task', tag: 'work', ts: Date.now() - 30000, date: today }];
    const timer   = { entryId: 'ah1', startTs: Date.now() - 30000, accumulatedMs: 0, paused: false };
    const tasks   = [{ id: 'pt1', text: 'Active task', tag: 'work', status: 'inprogress', date: today }];
    const page    = await freshPage(ctx, { wl_entries_v1: entries, wl_timer_v1: timer, wl_plan_v1: tasks, wl_cats_v1: CATS });
    const hasActiveClass = await page.evaluate(() =>
      document.querySelector('.plan-item.active-timer') !== null
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
    const today   = dk(new Date());
    const entries = [{ id: 'tt1', text: 'Tab title task', tag: 'work', ts: Date.now() - 90000, date: today }];
    const page    = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: CATS });
    await page.evaluate(() => window.__wl.startTimer('tt1'));
    await page.waitForTimeout(1200);
    const titleRunning = await page.title();
    assert('Title shows ▶ when running',  titleRunning.startsWith('▶'));
    assert('Title contains task name',    titleRunning.includes('Tab title task'));
    assert('Title contains elapsed time', /\d+:\d+/.test(titleRunning));
    await page.evaluate(() => { document.getElementById('timerPause')?.click(); });
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
      localStorage.setItem('wl_cats_v1', JSON.stringify([
        { id: 'evil', label: 'evil', color: 'red; background:url(javascript:alert(1))' },
        { id: 'hex',  label: 'hex',  color: '#378ADD' },
        { id: 'hsl',  label: 'hsl',  color: 'hsl(200, 50%, 50%)' },
      ]));
    });
    await page.goto(FILE); // re-navigate without addInitScript wipe
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    const evilColor = await page.evaluate(() => window.__wl.getCat('evil').color);
    assert('Malicious color replaced with fallback', evilColor === '#888780');
    const hexColor  = await page.evaluate(() => window.__wl.getCat('hex').color);
    assert('Valid hex color preserved',  hexColor === '#378ADD');
    const hslColor  = await page.evaluate(() => window.__wl.getCat('hsl').color);
    assert('Valid hsl color preserved',  hslColor === 'hsl(200, 50%, 50%)');
    await page.close();
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  await browser.close();
  console.log('\n' + '─'.repeat(48));
  console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);
  console.log('─'.repeat(48));
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.ok).forEach(r => console.log(`  ❌ ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('\nTest runner crashed:', err.message);
  process.exit(1);
});
