/**
 * @file pure-fns-weeklyreport.js
 * Weekly report draft helpers: grouping a week's entries by Jira ticket and
 * rendering that grouping into text. Split out of pure-fns-export.js (QA
 * 2026-09-07, largest-module finding) — re-exported there via the
 * pure-fns.js barrel. Pure functions with no side-effects and no global
 * state — a leaf ES module.
 */

import { parseJiraLabel } from './pure-fns-export.js';
import { GAP_REPORT_UTILITY_TEXTS } from './pure-fns-gapreport.js';

/* ── Weekly report draft ── */

/** Sentinel ticket key for entries whose text carries no parseable Jira prefix. */
export const WEEKLY_REPORT_NO_TICKET_KEY = '__no_ticket__';

/**
 * Groups a week's finished, non-cancelled, non-utility entries by Jira ticket
 * key (via {@link parseJiraLabel}), then by task name within each ticket —
 * the data layer behind the weekly report draft. Entries with no parseable
 * ticket prefix fall into the {@link WEEKLY_REPORT_NO_TICKET_KEY} bucket,
 * sub-grouped by their own task text so untracked work stays legible rather
 * than collapsing into one opaque blob.
 *
 * Uses the same "finished, not cancelled, in-window" filter as
 * `findGapReportEntries` (whose `GAP_REPORT_UTILITY_TEXTS` exclusion
 * it also reuses — break/lunch/meeting entries never belong in a status
 * report any more than they belong in the gap report).
 *
 * @param {Array<Object>} entries - All log entries.
 * @param {number} weekStart - Inclusive week-start timestamp in ms (e.g. Monday 00:00).
 * @param {number} weekEnd - Exclusive week-end timestamp in ms (e.g. the following Monday 00:00).
 * @returns {{
 *   ticketOrder: string[],
 *   grouped: Object<string, {
 *     totalMs: number,
 *     nameOrder: string[],
 *     names: Object<string, {label: string, totalMs: number}>,
 *     notes: string[],
 *     links: string[]
 *   }>
 * }} `ticketOrder` lists real ticket keys sorted by total time descending,
 *   with the no-ticket bucket (if present) always last regardless of its
 *   total — it is a catch-all, not a reportable line item.
 * @example
 * buildWeeklyTicketSummary(
 *   [{ id: '1', text: 'PROJ-1: Fix login', ts: 100, tsEnd: 3700, date: '2026-06-01' }],
 *   0, 604800000
 * )
 * // → { ticketOrder: ['PROJ-1'], grouped: { 'PROJ-1': { totalMs: 3600, ... } } }
 */
export function buildWeeklyTicketSummary(entries, weekStart, weekEnd) {
  const grouped = {};
  (entries || [])
    .filter(
      (entry) =>
        entry.tsEnd &&
        entry.signifier !== 'cancelled' &&
        entry.ts >= weekStart &&
        entry.ts < weekEnd &&
        !GAP_REPORT_UTILITY_TEXTS.has(entry.text)
    )
    .forEach((entry) => {
      const { ticket, name } = parseJiraLabel(entry.text);
      const ticketKey = ticket || WEEKLY_REPORT_NO_TICKET_KEY;
      const nameKey = name.toLowerCase();
      const ms = entry.tsEnd - entry.ts;

      if (!grouped[ticketKey]) {
        grouped[ticketKey] = { totalMs: 0, nameOrder: [], names: {}, notes: [], links: [] };
      }
      const bucket = grouped[ticketKey];

      if (!bucket.names[nameKey]) {
        bucket.nameOrder.push(nameKey);
        bucket.names[nameKey] = { label: name, totalMs: 0 };
      }
      bucket.totalMs += ms;
      bucket.names[nameKey].totalMs += ms;

      const note = entry.note && entry.note.trim();
      if (note && !bucket.notes.includes(note)) bucket.notes.push(note);
      const link = entry.link && entry.link.trim();
      if (link && !bucket.links.includes(link)) bucket.links.push(link);
    });

  const ticketOrder = Object.keys(grouped)
    .filter((key) => key !== WEEKLY_REPORT_NO_TICKET_KEY)
    .sort((a, b) => grouped[b].totalMs - grouped[a].totalMs);
  // The no-ticket bucket is a catch-all grouping, not a reportable ticket —
  // it always sorts last regardless of its total time, even if that time
  // exceeds a real ticket's.
  if (grouped[WEEKLY_REPORT_NO_TICKET_KEY]) ticketOrder.push(WEEKLY_REPORT_NO_TICKET_KEY);

  return { ticketOrder, grouped };
}

/**
 * Renders the structure produced by {@link buildWeeklyTicketSummary} into
 * text lines: one header line per ticket (with its total), each followed by
 * an indented bullet per distinct task name (with its own subtotal) and any
 * collected `note:`/`link:` lines — same indentation convention as
 * `formatGroupedLines` in `pure-fns-gapreport.js`. Ticket blocks are
 * separated by a blank line.
 *
 * Pure: the duration formatter is injected so this has no dependency on
 * global state and can be unit-tested directly.
 *
 * @param {string[]} ticketOrder - Ticket keys in display order.
 * @param {Object} grouped - Grouping produced by {@link buildWeeklyTicketSummary}.
 * @param {function(number): string} fmtDuration - Formats a duration in ms (e.g. `fmtDurLong`).
 * @returns {string[]} The report body lines; empty when `ticketOrder` is empty.
 */
export function formatWeeklyTicketSummaryText(ticketOrder, grouped, fmtDuration) {
  const lines = [];
  ticketOrder.forEach((ticketKey, index) => {
    if (index > 0) lines.push('');
    const { totalMs, nameOrder, names, notes, links } = grouped[ticketKey];
    const ticketLabel = ticketKey === WEEKLY_REPORT_NO_TICKET_KEY ? 'No ticket' : ticketKey;
    lines.push(`${ticketLabel} — ${fmtDuration(totalMs)}`);
    nameOrder.forEach((nameKey) => {
      const { label, totalMs: nameMs } = names[nameKey];
      lines.push(label ? `    ${fmtDuration(nameMs)} - ${label}` : `    ${fmtDuration(nameMs)}`);
    });
    notes.forEach((note) => lines.push(`    note: ${note}`));
    links.forEach((link) => lines.push(`    link: ${link}`));
  });
  return lines;
}
