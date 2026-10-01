/**
 * @file gofore-timesheet.mjs
 * Entry point: adds one day's entry to timesheet.gofore.com using a persistent
 * Playwright browser profile, so the Microsoft SSO sign-in (with MFA) is done
 * once by hand and reused.
 *
 *   npm run timesheet:login                 # headed; sign in once, then close
 *   echo '{"date":"…","hours":7.5,"description":"…"}' | node scripts/gofore-timesheet.mjs
 *
 * Submit order: Claude in Chrome (`claude --chrome -p`, your real signed-in
 * browser) first, Playwright as fallback. Env: GOFORE_TIMESHEET_URL (default
 * https://timesheet.gofore.com); GOFORE_TIMESHEET_CHROME=0 skips the Chrome try.
 * Exit codes: 0 saved, 2 session expired, 1 any other failure.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  parseTimesheetPayload,
  resolveSelectors,
  submitDayEntry,
  SessionExpiredError,
} from './lib/gofore-timesheet.mjs';
import {
  buildChromePrompt,
  parseChromeResult,
  runClaudeInChrome,
  submitWithFallback,
} from './lib/gofore-chrome.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const profileDir = join(scriptDir, '..', '.timesheet-profile');
const selectorsPath = join(scriptDir, 'gofore-timesheet.selectors.json');
const baseUrl = process.env.GOFORE_TIMESHEET_URL || 'https://timesheet.gofore.com';

/**
 * Reads the selector overrides file.
 * @returns {Object} Parsed overrides, or `{}` when the file is absent.
 */
function readSelectorOverrides() {
  return existsSync(selectorsPath) ? JSON.parse(readFileSync(selectorsPath, 'utf8')) : {};
}

/**
 * Opens a visible browser so the user can complete Microsoft SSO once; the
 * session is kept in the profile directory until the window is closed.
 * @returns {Promise<void>} Resolves when the user closes the window.
 */
async function runLogin() {
  console.log(`[timesheet] login mode — profile: ${profileDir}, url: ${baseUrl}`);
  const context = await chromium.launchPersistentContext(profileDir, { headless: false });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(baseUrl);
  await new Promise((resolve) => context.on('close', resolve));
}

/**
 * Adds the entry through the Playwright persistent profile (headless).
 * @param {{date: string, hours: number, description: string}} payload - Entry to add.
 * @returns {Promise<void>} Resolves when the entry is saved.
 */
async function submitViaPlaywright(payload) {
  console.log(`[timesheet] Playwright: ${payload.date} ${payload.hours}h (profile: ${profileDir})`);
  const context = await chromium.launchPersistentContext(profileDir, { headless: true });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await submitDayEntry(page, baseUrl, payload, resolveSelectors(readSelectorOverrides()));
  } finally {
    await context.close();
  }
}

/**
 * Adds the entry through Claude in Chrome via the headless Claude Code CLI.
 * @param {{date: string, hours: number, description: string}} payload - Entry to add.
 * @returns {Promise<{status: string, detail: string}>} Parsed session outcome.
 */
async function submitViaChrome(payload) {
  if (process.env.GOFORE_TIMESHEET_CHROME === '0') {
    return { status: 'failed', detail: 'disabled by GOFORE_TIMESHEET_CHROME=0' };
  }
  console.log('[timesheet] trying Claude in Chrome first');
  return parseChromeResult(await runClaudeInChrome(buildChromePrompt(payload, baseUrl)));
}

/**
 * Reads the payload from stdin and submits it, Chrome first then Playwright.
 * Prints `method=<chrome|playwright>` so the server can report the route used.
 * @returns {Promise<void>} Resolves when the entry is saved.
 */
async function runSubmit() {
  const payload = parseTimesheetPayload(readFileSync(0, 'utf8'));
  console.log(`[timesheet] submitting ${payload.date} ${payload.hours}h to ${baseUrl}`);
  const method = await submitWithFallback({
    viaChrome: () => submitViaChrome(payload),
    viaPlaywright: () => submitViaPlaywright(payload),
    log: (message) => console.log(`[timesheet] ${message}`),
  });
  console.log(`[timesheet] entry saved method=${method}`);
}

/**
 * Orchestrates login or submit and maps failures to exit codes.
 * @returns {Promise<void>}
 */
async function main() {
  try {
    await (process.argv.includes('--login') ? runLogin() : runSubmit());
  } catch (err) {
    console.error(`[timesheet] ${err.message}`);
    process.exitCode = err instanceof SessionExpiredError ? 2 : 1;
  }
}

await main();
