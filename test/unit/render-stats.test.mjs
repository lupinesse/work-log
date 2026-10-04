/**
 * @file render-stats.test.mjs
 * Covers src/js/04b-render-stats.js — header stat tiles and sub-stat tiles.
 * Added for ES-module extraction #13 (#336).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeEl() {
  return {
    textContent: '',
    innerHTML: '',
    style: { display: '' },
  };
}

function makeDocMock(ids = []) {
  const els = {};
  // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
  for (const id of ids) els[id] = makeEl();
  return {
    getElementById: (id) => {
      // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
      if (!els[id]) els[id] = makeEl();
      // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
      return els[id];
    },
    _els: els,
  };
}

let renderStatsMod;
let stateMod;

async function loadMods() {
  if (!renderStatsMod) {
    globalThis.document = makeDocMock();
    renderStatsMod = await import('../../src/js/04b-render-stats.js');
    stateMod = await import('../../src/js/state.js');
  }
  return { ...renderStatsMod, ...stateMod };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function dk(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('renderHeaderStatTiles', () => {
  beforeEach(async () => {
    const { setEntries } = await loadMods();
    setEntries([]);
    globalThis.document = makeDocMock();
  });

  it('sets statToday to zero when entries is empty', async () => {
    const { renderHeaderStatTiles } = await loadMods();
    renderHeaderStatTiles();
    assert.equal(String(globalThis.document.getElementById('statToday').textContent), '0');
  });

  it('counts distinct task texts for statToday (case-insensitive)', async () => {
    const { renderHeaderStatTiles, setEntries } = await loadMods();
    const todayKey = dk(new Date());
    setEntries([
      { date: todayKey, ts: Date.now(), text: 'Task A' },
      { date: todayKey, ts: Date.now(), text: 'task a' },
      { date: todayKey, ts: Date.now(), text: 'Task B' },
    ]);
    renderHeaderStatTiles();
    assert.equal(String(globalThis.document.getElementById('statToday').textContent), '2');
  });

  it('counts distinct epic tags for statWeek', async () => {
    const { renderHeaderStatTiles, setEntries } = await loadMods();
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    setEntries([
      { date: dk(weekStart), ts: weekStart.getTime(), tag: 'epic-a' },
      { date: dk(weekStart), ts: weekStart.getTime(), tag: 'epic-a' },
      { date: dk(weekStart), ts: weekStart.getTime(), tag: 'epic-b' },
    ]);
    renderHeaderStatTiles();
    assert.equal(String(globalThis.document.getElementById('statWeek').textContent), '2');
  });

  it('sets analyticsSummary with dot-separated values', async () => {
    const { renderHeaderStatTiles, setEntries } = await loadMods();
    setEntries([]);
    renderHeaderStatTiles();
    const summary = globalThis.document.getElementById('analyticsSummary').textContent;
    assert.ok(summary.includes('·'), 'summary should contain separator dots');
    assert.ok(summary.includes('tasks today'), 'summary should label task count');
    assert.ok(summary.includes('epics this week'), 'summary should label epic count');
    assert.ok(summary.includes('-day streak'), 'summary should label streak');
  });

  it('sets statStreak based on consecutive past days', async () => {
    const { renderHeaderStatTiles, setEntries } = await loadMods();
    setEntries([
      { date: dk(daysAgo(1)), ts: daysAgo(1).getTime() },
      { date: dk(daysAgo(2)), ts: daysAgo(2).getTime() },
    ]);
    renderHeaderStatTiles();
    assert.equal(String(globalThis.document.getElementById('statStreak').textContent), '2');
  });
});

describe('renderSubStatTiles', () => {
  beforeEach(async () => {
    const { setEntries } = await loadMods();
    setEntries([]);
    globalThis.document = makeDocMock();
  });

  it('hides statTodaySub when no timed entries exist today', async () => {
    const { renderSubStatTiles } = await loadMods();
    renderSubStatTiles();
    assert.equal(globalThis.document.getElementById('statTodaySub').style.display, 'none');
  });

  it('shows statTodaySub with the top task when timed entries exist', async () => {
    const { renderSubStatTiles, setEntries } = await loadMods();
    const todayKey = dk(new Date());
    const now = Date.now();
    setEntries([
      { date: todayKey, ts: now - 3600000, tsEnd: now, text: 'Big Task' },
      { date: todayKey, ts: now - 1800000, tsEnd: now, text: 'Small Task' },
    ]);
    renderSubStatTiles();
    const el = globalThis.document.getElementById('statTodaySub');
    assert.equal(el.style.display, '', 'should be visible');
    assert.ok(el.innerHTML.includes('Big Task'), 'should show the most-tracked task');
  });

  it('hides statWeekSub when no timed entries exist this week', async () => {
    const { renderSubStatTiles } = await loadMods();
    renderSubStatTiles();
    assert.equal(globalThis.document.getElementById('statWeekSub').style.display, 'none');
  });

  it('hides statStreakSub when there is no streak', async () => {
    const { renderSubStatTiles } = await loadMods();
    renderSubStatTiles();
    assert.equal(globalThis.document.getElementById('statStreakSub').style.display, 'none');
  });

  it('shows statStreakSub when there is a streak with timed entries', async () => {
    const { renderSubStatTiles, setEntries } = await loadMods();
    const yesterday = daysAgo(1);
    setEntries([
      {
        date: dk(yesterday),
        ts: yesterday.getTime(),
        tsEnd: yesterday.getTime() + 3600000,
        text: 'Work',
      },
    ]);
    renderSubStatTiles();
    const el = globalThis.document.getElementById('statStreakSub');
    assert.equal(el.style.display, '', 'should be visible');
    assert.ok(
      el.innerHTML.includes('Longest date tracked'),
      'should show the longest-tracked day label'
    );
  });
});
