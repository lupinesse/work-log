/**
 * @file pure-fns-backup.test.mjs
 * Split out of pure-fns-export.test.mjs (QA 2026-09-07, largest-module
 * finding), mirroring the corresponding src/js/pure-fns-*.js split.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dk, applyBackupRetention, buildBackupPayload } from '../../src/js/pure-fns.js';

describe('applyBackupRetention', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date('2026-06-09T12:00:00Z').getTime();

  function makeEntry(daysAgo) {
    const d = new Date(now - daysAgo * DAY_MS);
    return { date: dk(d), ts: d.getTime() };
  }

  it('keeps entries within the retention window', () => {
    const e = makeEntry(30);
    const { kept, dropped } = applyBackupRetention([e], 90, now);
    assert.equal(kept.length, 1);
    assert.equal(dropped, 0);
  });

  it('drops entries older than the retention window', () => {
    const old = makeEntry(91);
    const { kept, dropped } = applyBackupRetention([old], 90, now);
    assert.equal(kept.length, 0);
    assert.equal(dropped, 1);
  });

  it('keeps an entry exactly on the cutoff boundary', () => {
    const boundary = makeEntry(90);
    const { kept, dropped } = applyBackupRetention([boundary], 90, now);
    assert.equal(kept.length, 1);
    assert.equal(dropped, 0);
  });

  it('drops entries with a missing date field', () => {
    const noDate = { ts: now - DAY_MS };
    const { kept, dropped } = applyBackupRetention([noDate], 90, now);
    assert.equal(kept.length, 0);
    assert.equal(dropped, 1);
  });

  it('drops entries with an unparseable date field', () => {
    const bad = { date: 'not-a-date', ts: now };
    const { kept, dropped } = applyBackupRetention([bad], 90, now);
    assert.equal(kept.length, 0);
    assert.equal(dropped, 1);
  });

  it('handles a mixed array correctly', () => {
    const entries = [makeEntry(10), makeEntry(95), makeEntry(50), { ts: now }];
    const { kept, dropped } = applyBackupRetention(entries, 90, now);
    assert.equal(kept.length, 2);
    assert.equal(dropped, 2);
  });

  it('returns empty arrays when given an empty array', () => {
    const { kept, dropped } = applyBackupRetention([], 90, now);
    assert.deepEqual(kept, []);
    assert.equal(dropped, 0);
  });

  it('does not mutate the input array', () => {
    const entries = [makeEntry(10), makeEntry(95)];
    const copy = [...entries];
    applyBackupRetention(entries, 90, now);
    assert.deepEqual(entries, copy);
  });
});

describe('buildBackupPayload', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date('2026-06-09T12:00:00Z').getTime();

  /** A dated record `daysAgo` before `now`, tagged with `id` for identity checks. */
  function rec(id, daysAgo) {
    return { id, date: dk(new Date(now - daysAgo * DAY_MS)) };
  }

  it('trims every time-series array to the retention window', () => {
    const state = {
      entries: [rec('e-new', 5), rec('e-old', 40)],
      planTasks: [rec('t-new', 5), rec('t-old', 40)],
      blocks: [rec('b-new', 5), rec('b-old', 40)],
      devLog: [rec('d-new', 5), rec('d-old', 40)],
      distractions: [rec('x-new', 5), rec('x-old', 40)],
    };
    const { payload } = buildBackupPayload(state, 21, now);
    assert.deepEqual(
      payload.entries.map((r) => r.id),
      ['e-new']
    );
    assert.deepEqual(
      payload.planTasks.map((r) => r.id),
      ['t-new']
    );
    assert.deepEqual(
      payload.blocks.map((r) => r.id),
      ['b-new']
    );
    assert.deepEqual(
      payload.devLog.map((r) => r.id),
      ['d-new']
    );
    assert.deepEqual(
      payload.distractions.map((r) => r.id),
      ['x-new']
    );
  });

  it('keeps categories, qpHidden, and pomoLog whole (not date-filtered)', () => {
    const state = {
      categories: [{ id: 'c1' }, { id: 'c2' }],
      qpHidden: ['a', 'b', 'c'],
      // pomoLog is capped at source, so old-dated records must survive here
      pomoLog: [rec('p-old', 400)],
    };
    const { payload } = buildBackupPayload(state, 21, now);
    assert.equal(payload.categories.length, 2);
    assert.deepEqual(payload.qpHidden, ['a', 'b', 'c']);
    assert.equal(payload.pomoLog.length, 1);
  });

  it('reports per-array dropped counts, omitting arrays that dropped nothing', () => {
    const state = {
      entries: [rec('e-new', 5)],
      planTasks: [rec('t-old', 40), rec('t-old2', 50)],
      blocks: [rec('b-old', 40)],
    };
    const { dropped } = buildBackupPayload(state, 21, now);
    assert.equal(dropped.entries, undefined);
    assert.equal(dropped.planTasks, 2);
    assert.equal(dropped.blocks, 1);
  });

  it('keeps future-dated records (e.g. upcoming tasks) inside the window', () => {
    const state = { planTasks: [rec('t-future', -7)] };
    const { payload, dropped } = buildBackupPayload(state, 21, now);
    assert.deepEqual(
      payload.planTasks.map((r) => r.id),
      ['t-future']
    );
    assert.equal(dropped.planTasks, undefined);
  });

  it('tolerates missing arrays without throwing', () => {
    const { payload, dropped } = buildBackupPayload({}, 21, now);
    assert.deepEqual(payload.entries, []);
    assert.deepEqual(payload.planTasks, []);
    assert.deepEqual(payload.categories, []);
    assert.deepEqual(payload.qpHidden, []);
    assert.equal(payload.version, '1');
    assert.equal(payload.retentionDays, 21);
    assert.deepEqual(dropped, {});
  });

  it('tolerates explicit null values for individual state properties', () => {
    const state = {
      entries: null,
      categories: null,
      planTasks: null,
      blocks: null,
      pomoLog: null,
      devLog: null,
      distractions: null,
      qpHidden: null,
    };
    let payload;
    let dropped;
    assert.doesNotThrow(() => {
      ({ payload, dropped } = buildBackupPayload(state, 21, now));
    });
    // Every array coerces to an empty array; nothing is dropped.
    assert.deepEqual(payload.entries, []);
    assert.deepEqual(payload.categories, []);
    assert.deepEqual(payload.planTasks, []);
    assert.deepEqual(payload.blocks, []);
    assert.deepEqual(payload.pomoLog, []);
    assert.deepEqual(payload.devLog, []);
    assert.deepEqual(payload.distractions, []);
    assert.deepEqual(payload.qpHidden, []);
    assert.deepEqual(dropped, {});
  });

  it('stamps the export timestamp from the supplied clock', () => {
    const { payload } = buildBackupPayload({}, 21, now);
    assert.equal(payload.exported, new Date(now).toISOString());
  });

  it('does not mutate the supplied qpHidden array', () => {
    const qpHidden = ['a', 'b'];
    const { payload } = buildBackupPayload({ qpHidden }, 21, now);
    payload.qpHidden.push('c');
    assert.deepEqual(qpHidden, ['a', 'b']);
  });
});
