// Structured logger — prefix [WL:LEVEL] makes log lines easy to filter in DevTools.
// Loaded first (00-) so all other modules can call wlLog.* without guards.

/**
 * Namespace for all application logging.
 * Each method prepends a `[WL:LEVEL]` tag so log lines can be filtered in
 * the browser DevTools console with the text filter `[WL:`.
 * @namespace wlLog
 */
const wlLog = (() => {
  const fmt = (level, msg, data) =>
    data !== undefined ? [`[WL:${level}]`, msg, data] : [`[WL:${level}]`, msg];

  return {
    /**
     * Emits a debug-level message, visible only when DevTools verbose level is on.
     * @param {string} msg - Human-readable message.
     * @param {*} [data] - Optional value to attach to the log line.
     */
    debug: (msg, data) => console.debug(...fmt('DEBUG', msg, data)),

    /**
     * Emits an informational message.
     * @param {string} msg - Human-readable message.
     * @param {*} [data] - Optional value to attach to the log line.
     */
    info: (msg, data) => console.info(...fmt('INFO', msg, data)),

    /**
     * Emits a warning — something unexpected but non-fatal.
     * @param {string} msg - Human-readable message.
     * @param {*} [data] - Optional value to attach to the log line.
     */
    warn: (msg, data) => console.warn(...fmt('WARN', msg, data)),

    /**
     * Emits an error — something that broke or produced an incorrect result.
     * @param {string} msg - Human-readable message.
     * @param {*} [data] - Optional value to attach to the log line.
     */
    error: (msg, data) => console.error(...fmt('ERROR', msg, data)),

    /**
     * Logs a snapshot of runtime configuration at startup in a collapsed group.
     * Called once by 07-lifecycle.js after state is loaded.
     * @param {Object} cfg - Key/value pairs to display (e.g. version, entry count).
     */
    config: (cfg) => {
      console.groupCollapsed('[WL:CONFIG] Startup');
      Object.entries(cfg).forEach(([k, v]) => console.log(`  ${k}:`, v));
      console.groupEnd();
    },
  };
})();
