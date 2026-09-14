/**
 * @file pure-fns-rollingsummary.js
 * Rolling per-day summary aggregation, used by the Rolling Summary tab.
 * Split out of pure-fns-export.js (QA 2026-09-07, largest-module finding) —
 * re-exported there via the pure-fns.js barrel. Pure, with no side-effects
 * and no global state — a leaf ES module with no dependencies of its own.
 */

/* ── Rolling summary ── */

/**
 * Computes a rolling per-day summary for a set of date keys.
 *
 * All data dependencies are injected so the function is pure and unit-testable
 * without any browser globals or localStorage access.
 *
 * @param {string[]} dateKeys - Date keys (YYYY-MM-DD) to summarise, most recent first.
 * @param {object} opts
 * @param {object[]} opts.entries - All work-log entries.
 * @param {Function} opts.getDayStartTs - `(dateKey: string) => number|null` — SOD timestamp.
 * @param {Function} opts.getDayEodTs - `(dateKey: string) => number|null` — EOD timestamp.
 * @param {Function} opts.getLocationEmoji - `(dateKey: string) => string` — location emoji char.
 * @returns {Array<{
 *   dateKey: string,
 *   locationEmoji: string,
 *   sodTs: number|null,
 *   eodTs: number|null,
 *   totalMs: number,
 *   topTasks: Array<{text: string, totalMs: number}>
 * }>}
 * @example
 * buildRollingSummary(['2026-06-04'], {
 *   entries: [{ date: '2026-06-04', text: 'Write code', ts: 1000, tsEnd: 4600000, signifier: '' }],
 *   getDayStartTs: () => 1000,
 *   getDayEodTs: () => null,
 *   getLocationEmoji: () => '🏠',
 * })
 * // → [{ dateKey: '2026-06-04', locationEmoji: '🏠', sodTs: 1000, eodTs: null,
 * //      totalMs: 4599000, topTasks: [{ text: 'Write code', totalMs: 4599000 }] }]
 */
export function buildRollingSummary(dateKeys, opts) {
  const { entries, getDayStartTs, getDayEodTs, getLocationEmoji } = opts;
  return dateKeys.map((dateKey) => {
    const dayEntries = entries.filter(
      (e) => e.date === dateKey && e.tsEnd && e.signifier !== 'cancelled'
    );
    const totalMs = dayEntries.reduce((sum, e) => sum + (e.tsEnd - e.ts), 0);

    // Aggregate by task text; case-preserving, case-sensitive key so "Fix bug" and
    // "fix bug" remain separate entries (they were logged as distinct tasks).
    const byText = {};
    for (const e of dayEntries) {
      const key = e.text || '(untitled)';
      byText[key] = (byText[key] || 0) + (e.tsEnd - e.ts);
    }
    const topTasks = Object.entries(byText)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([text, ms]) => ({ text, totalMs: ms }));

    return {
      dateKey,
      locationEmoji: getLocationEmoji(dateKey),
      sodTs: getDayStartTs(dateKey),
      eodTs: getDayEodTs(dateKey),
      totalMs,
      topTasks,
    };
  });
}
