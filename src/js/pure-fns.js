/**
 * @file pure-fns.js
 * Barrel module for the pure-function helpers, which live in themed leaf
 * sub-modules: pure-fns-format.js (CSS/HTML safety, date/time/duration
 * formatting, billing rounding), pure-fns-validate.js (schema, backup, and
 * external-API validators), pure-fns-tasks.js (rapid-capture grammar,
 * carry-forward status, work location), pure-fns-export.js (billable export
 * grouping), pure-fns-gapreport.js (gap report and export warnings),
 * pure-fns-weeklyreport.js (weekly report draft), pure-fns-rollingsummary.js
 * (rolling summary), pure-fns-backup.js (backup retention), and
 * pure-fns-epics.js (epic staleness and archiving) — the last five split out
 * of one former pure-fns-export.js (QA 2026-09-07, largest-module finding).
 * Re-exports every public symbol so existing imports of './pure-fns.js'
 * keep working unchanged.
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
  normalizeCalendarMeeting,
  calendarMeetingKey,
  isMeetingHidden,
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
} from './pure-fns-export.js';

export {
  GAP_REPORT_UTILITY_TEXTS,
  findGapReportEntries,
  findExportWarnings,
  formatGroupedLines,
} from './pure-fns-gapreport.js';

export {
  WEEKLY_REPORT_NO_TICKET_KEY,
  buildWeeklyTicketSummary,
  formatWeeklyTicketSummaryText,
} from './pure-fns-weeklyreport.js';

export { buildRollingSummary } from './pure-fns-rollingsummary.js';

export { applyBackupRetention, buildBackupPayload } from './pure-fns-backup.js';

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
