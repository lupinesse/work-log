// Work Log — Smoke Test Suite
// Run with: node smoke-tests.js
// Requires: playwright (npm install playwright && npx playwright install chromium)

const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file://' + path.resolve(__dirname, 'work-log.html') + '?test=1';

let passed = 0, failed = 0;
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
    for (const [k, v] of Object.entries(storage)) {
      localStorage.setItem(k, JSON.stringify(v));
    }
  }, extraStorage);
  await page.goto(FILE);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  return page;
}

async function runTests() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();

  // 1. Page loads without JS errors
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
    await page.close();
  }

  // 2. roundToNearest30
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

  // 3. localStorage round-trip + save() guard
  console.log('\n3. localStorage round-trip');
  {
    const today   = dk(new Date());
    const entries = [{ id: 'rt1', text: 'Test task', tag: 'work', ts: Date.now(), date: today }];
    const cats    = [{ id: 'work', label: 'work', color: '#378ADD' }, { id: 'other', label: 'other', color: '#888780' }];
    const page    = await freshPage(ctx, { wl_entries_v1: entries, wl_cats_v1: cats });

    const state = await page.evaluate(() => window.__wl.getState());
    assert('Entries loaded from storage', state.entries.length === 1);
    assert('Entry text preserved',        state.entries[0]?.text === 'Test task');
    assert('Custom categories loaded',    state.categories.length === 2);
    assert('Category colour preserved',   state.categories[0]?.color === '#378ADD');
    const statText = await page.evaluate(() => document.getElementById('statToday').textContent);
    assert('Stat today shows 1', statText === '1');

    // save() guard — emptying the in-memory array must not wipe localStorage
    await page.evaluate(() => {
      const state = window.__wl.getState();
      state.entries.length = 0;   // empty in memory
      window.__wl.save();          // guard should block this write
      window.__wl.load();          // reload from storage
    });
    const afterGuard = await page.evaluate(() => window.__wl.getState().entries.length);
    assert('save() guard preserves data when entries emptied', afterGuard >= 1);
    await page.close();
  }

  // 4. Timer start & display
  console.log('\n4. Timer start & display');
  {
    const today   = dk(new Date());
    const entries = [{ id: 'tm1', text: 'Timer task', tag: 'work', ts: Date.now() - 65000, date: today }];
    const timer   = { entryId: 'tm1', startTs: Date.now() - 65000, accumulatedMs: 0, paused: false };
    const page    = await freshPage(ctx, {
      wl_entries_v1: entries, wl_timer_v1: timer,
      wl_cats_v1: [{ id: 'work', label: 'work', color: '#378ADD' }, { id: 'other', label: 'other', color: '#888780' }]
    });

    assert('Timer bar visible',     await page.evaluate(() => document.getElementById('timerBar').style.display !== 'none'));
    assert('Timer shows task name', await page.evaluate(() => document.getElementById('timerTask').textContent === 'Timer task'));
    assert('Elapsed time non-zero', await page.evaluate(() => document.getElementById('timerElapsed').textContent !== '00:00'));
    await page.close();
  }

  // 5. Timer persists across reload
  console.log('\n5. Timer persists across reload');
  {
    const today   = dk(new Date());
    const ts      = Date.now() - 120000;
    const entries = [{ id: 'tp1', text: 'Persistent timer', tag: 'work', ts, date: today }];
    const timer   = { entryId: 'tp1', startTs: ts, accumulatedMs: 0, paused: false };
    const page    = await freshPage(ctx, {
      wl_entries_v1: entries, wl_timer_v1: timer,
      wl_cats_v1: [{ id: 'work', label: 'work', color: '#378ADD' }, { id: 'other', label: 'other', color: '#888780' }]
    });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => document.getElementById('timerElapsed').textContent);

    assert('Timer bar still visible after reload', await page.evaluate(() => document.getElementById('timerBar').style.display !== 'none'));
    assert('Timer elapsed after reload is non-zero', after !== '00:00');
    assert('Timer elapsed after reload is valid',    /\d+:\d+/.test(after));
    await page.close();
  }

  // 6. completedAt + completed section
  console.log('\n6. completedAt');
  {
    const today = dk(new Date());
    const tasks = [{ id: 'ca1', text: 'Complete me', tag: 'work', status: 'todo', date: today }];
    const page  = await freshPage(ctx, {
      wl_plan_v1: tasks,
      wl_cats_v1: [{ id: 'work', label: 'work', color: '#378ADD' }, { id: 'other', label: 'other', color: '#888780' }]
    });

    await page.evaluate(() => {
      const sel = document.querySelector('.plan-status[data-pid="ca1"]');
      if (sel) { sel.value = 'done'; sel.dispatchEvent(new Event('change')); }
    });
    await page.waitForTimeout(300);

    const completedAt = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('wl_plan_v1') || '[]').find(t => t.id === 'ca1')?.completedAt
    );
    assert('completedAt set when marked Done',          !!completedAt);
    assert('completedAt is not 23:59 sentinel',         !(new Date(completedAt).getHours() === 23 && new Date(completedAt).getMinutes() === 59));
    assert('completedAt is not midnight sentinel',      !(new Date(completedAt).getHours() === 0 && new Date(completedAt).getMinutes() === 0));
    assert('completedAt within 30min of now',           typeof completedAt === 'number' && Math.abs(completedAt - Date.now()) < 31 * 60 * 1000);
    assert('Completed tasks section exists',            await page.evaluate(() => !!document.getElementById('completedSection')));
    assert('Completed task appears in section',         await page.evaluate(() => document.querySelectorAll('.completed-item').length >= 1));
    const whenText = await page.evaluate(() => document.querySelector('.completed-item')?.textContent || '');
    assert('Completed item shows "completed" text',     whenText.toLowerCase().includes('completed'));
    await page.close();
  }

  // 7. Auto-carry + parent promotion
  console.log('\n7. Auto-carry');
  {
    const yesterday = dk(new Date(Date.now() - 86400000));
    const today     = dk(new Date());
    const tasks = [
      { id: 'ac1', text: 'Carry me',     tag: 'work', status: 'inprogress', date: yesterday },
      { id: 'ac2', text: 'Already done', tag: 'work', status: 'done',       date: yesterday, completedAt: Date.now() - 3600000 },
      { id: 'ac3', text: 'Child task',   tag: 'work', status: 'todo',       date: yesterday, parentId: 'ac1' },
    ];
    const page = await freshPage(ctx, {
      wl_plan_v1: tasks,
      wl_cats_v1: [{ id: 'work', label: 'work', color: '#378ADD' }, { id: 'other', label: 'other', color: '#888780' }]
    });
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

    // Child → parent promotion
    const promoPage = await freshPage(ctx, {
      wl_plan_v1: [
        { id: 'pr1', text: 'Parent task', tag: 'work', status: 'todo', date: today },
        { id: 'pr2', text: 'Child task2', tag: 'work', status: 'todo', date: today, parentId: 'pr1' },
      ],
      wl_cats_v1: [{ id: 'work', label: 'work', color: '#378ADD' }, { id: 'other', label: 'other', color: '#888780' }]
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

  // 8. Sort order
  console.log('\n8. Sort order');
  {
    const today = dk(new Date());
    const tasks = [
      { id: 's1', text: 'Zebra todo',  tag: 'work', status: 'todo',       date: today },
      { id: 's2', text: 'Alpha todo',  tag: 'work', status: 'todo',       date: today },
      { id: 's3', text: 'In progress', tag: 'work', status: 'inprogress', date: today },
      { id: 's4', text: 'Done task',   tag: 'work', status: 'done',       date: today, completedAt: Date.now() - 1000 },
    ];
    const page = await freshPage(ctx, {
      wl_plan_v1: tasks,
      wl_cats_v1: [{ id: 'work', label: 'work', color: '#378ADD' }, { id: 'other', label: 'other', color: '#888780' }]
    });

    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.plan-item')).map(el => el.dataset.pid)
    );
    assert('In Progress before To do',     order.indexOf('s3') < order.indexOf('s1'));
    assert('Alpha todo before Zebra todo', order.indexOf('s2') < order.indexOf('s1'));
    assert('Done task not in plan list',   !order.includes('s4'));
    await page.close();
  }

  // 9. Plan count header
  console.log('\n9. Plan count header');
  {
    const today = dk(new Date());
    const tasks = [
      { id: 'pc1', text: 'Task A', tag: 'work', status: 'todo',       date: today },
      { id: 'pc2', text: 'Task B', tag: 'work', status: 'inprogress', date: today },
      { id: 'pc3', text: 'Task C', tag: 'work', status: 'done',       date: today, completedAt: Date.now() - 1000 },
    ];
    const page = await freshPage(ctx, {
      wl_plan_v1: tasks,
      wl_cats_v1: [{ id: 'work', label: 'work', color: '#378ADD' }, { id: 'other', label: 'other', color: '#888780' }]
    });

    const count = await page.evaluate(() => document.getElementById('planCount').textContent);
    assert('Count shows to do',       count.includes('1 to do'));
    assert('Count shows in progress', count.includes('1 in progress'));
    assert('Count shows done',        count.includes('1 done'));
    assert('Count uses · separator',  count.includes('·'));
    await page.close();
  }

  // 10. Week number
  console.log('\n10. Week number');
  {
    const page = await freshPage(ctx);
    const weekText = await page.evaluate(() => document.getElementById('liveWeek').textContent);
    assert('Week number shown',        /Week \d+\/\d+/.test(weekText));
    assert('Week format valid',        /Week ([1-9]|[1-4]\d|5[0-3])\/5[23]/.test(weekText));
    assert('Week number in second box', await page.evaluate(() => {
      const el    = document.getElementById('liveWeek');
      const boxes = document.querySelectorAll('.live-info');
      return boxes.length >= 2 && boxes[1].contains(el);
    }));
    await page.close();
  }

  // Summary
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
