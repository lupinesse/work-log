/**
 * @file pure-fns.js
 * Barrel module for the pure-function helpers, which live in five themed leaf
 * sub-modules: pure-fns-format.js (CSS/HTML safety, date/time/duration
 * formatting, billing rounding), pure-fns-validate.js (schema, backup, and
 * external-API validators), pure-fns-tasks.js (rapid-capture grammar,
 * carry-forward status, work location), and pure-fns-export.js (billable
 * export grouping, rolling summary, backup retention), and pure-fns-epics.js
 * (epic staleness and archiving). Re-exports every public
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
  isLongRunningTimer,
  mondayOfWeek,
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
  findWeeklyPlanReviewTasks,
  findPromotableTask,
  WORK_LOCATIONS,
  locationFor,
  nextLocation,
} from './pure-fns-tasks.js';

export {
  parseJiraLabel,
  groupEntriesByCategory,
  buildTimesheetSummaryLine,
  computeDayBounds,
  isWorkdayLikelyOver,
  buildTaskNoteMap,
  buildEntryNoteMap,
  buildEntryLinkMap,
  mergeNoteMaps,
  formatGroupedLines,
  findExportWarnings,
  buildRollingSummary,
  applyBackupRetention,
  buildBackupPayload,
  findGapReportEntries,
  WEEKLY_REPORT_NO_TICKET_KEY,
  buildWeeklyTicketSummary,
  formatWeeklyTicketSummaryText,
} from './pure-fns-export.js';

export {
  EPIC_STALE_DAYS,
  PROTECTED_CAT_IDS,
  epicCutoffDate,
  collectRecentlyUsedCatIds,
  findStaleCategories,
  pickableCategories,
  applyEpicArchive,
  restoreArchivedCategory,
} from './pure-fns-epics.js';
