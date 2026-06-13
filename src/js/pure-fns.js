/**
 * @file pure-fns.js
 * Barrel module for the pure-function helpers, which live in four themed leaf
 * sub-modules: pure-fns-format.js (CSS/HTML safety, date/time/duration
 * formatting, billing rounding), pure-fns-validate.js (schema, backup, and
 * external-API validators), pure-fns-tasks.js (rapid-capture grammar,
 * carry-forward status, work location), and pure-fns-export.js (billable
 * export grouping, rolling summary, backup retention). Re-exports every public
 * symbol so existing imports of './pure-fns.js' keep working unchanged.
 */

export {
  safeCssColor,
  escHtml,
  dk,
  fmtTime,
  fmtElapsed,
  fmtDur,
  fmtAgo,
  fmtDurLong,
  roundToNearest30,
} from './pure-fns-format.js';

export {
  validEntry,
  validCategory,
  validPlanTask,
  validBlock,
  validTimer,
  validPomoEntry,
  validateBackupFile,
  filterNewBackupEntries,
  validWeatherResponse,
  validCalendarMeeting,
  validJiraCsvRow,
} from './pure-fns-validate.js';

export {
  parseRapidTokens,
  resolveCarryStatus,
  WORK_LOCATIONS,
  locationFor,
  nextLocation,
} from './pure-fns-tasks.js';

export {
  stripJiraPrefix,
  groupEntriesByCategory,
  mergeAdjacentEntries,
  buildBillableSummaryParts,
  computeDayBounds,
  formatGroupedLines,
  buildRollingSummary,
  applyBackupRetention,
} from './pure-fns-export.js';
