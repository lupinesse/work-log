/**
 * @file gofore-timesheet.mjs
 * Browser-automation helpers for submitting one day's entry to the Gofore
 * timesheet. Kept free of Playwright imports (the page is injected) so the
 * logic is unit-testable with a fake page; scripts/gofore-timesheet.mjs owns
 * the real browser.
 */

import { findTimesheetEntryProblem } from '../../src/js/pure-fns-timesheet.js';

/** Hosts the Microsoft SSO redirect lands on when the saved session has expired. */
const LOGIN_HOSTS = ['login.microsoftonline.com', 'login.live.com'];

/**
 * Raised when the persisted browser profile is no longer signed in, so the
 * caller can tell the user to run `npm run timesheet:login` instead of showing
 * a generic failure.
 */
export class SessionExpiredError extends Error {
  /** @param {string} url - The login URL the timesheet redirected to. */
  constructor(url) {
    super(`Timesheet session expired (redirected to ${url}). Run: npm run timesheet:login`);
    this.name = 'SessionExpiredError';
  }
}

/**
 * Default page selectors. These are UNVERIFIED guesses — the site could not be
 * inspected when this was written. Override any of them in
 * scripts/gofore-timesheet.selectors.json without touching code.
 */
export const DEFAULT_SELECTORS = {
  addEntryButton: 'button:has-text("Add")',
  dateInput: 'input[name="date"]',
  hoursInput: 'input[name="hours"]',
  descriptionInput: 'textarea[name="description"], input[name="description"]',
  saveButton: 'button:has-text("Save")',
  savedConfirmation: '[role="status"], .toast-success',
};

/**
 * Reports whether a URL is a Microsoft sign-in page.
 * @param {string} url - Page URL.
 * @returns {boolean} True when the host is a Microsoft login host.
 */
export function isLoginUrl(url) {
  try {
    return LOGIN_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Parses and validates the JSON payload sent by the work log.
 * @param {string} text - Raw JSON from stdin.
 * @returns {{date: string, hours: number, description: string}} Validated entry.
 * @throws {Error} With a specific message when the JSON or any field is invalid.
 */
export function parseTimesheetPayload(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error(`Timesheet payload is not valid JSON: ${err.message}`, { cause: err });
  }
  const problem = findTimesheetEntryProblem(payload);
  if (problem) throw new Error(problem);
  return { date: payload.date, hours: payload.hours, description: payload.description };
}

/**
 * Merges user overrides over {@link DEFAULT_SELECTORS}.
 * @param {Object} [overrides] - Partial selector map from the selectors JSON file.
 * @returns {Object} Complete selector map.
 */
export function resolveSelectors(overrides = {}) {
  return { ...DEFAULT_SELECTORS, ...overrides };
}

/**
 * Fills and saves the day's timesheet entry on an already-open page.
 * @param {Object} page - Playwright-compatible page (goto, url, locator).
 * @param {string} baseUrl - Timesheet start URL.
 * @param {{date: string, hours: number, description: string}} payload - Entry to add.
 * @param {Object} selectors - Selector map from {@link resolveSelectors}.
 * @returns {Promise<void>} Resolves once the save confirmation is visible.
 * @throws {SessionExpiredError} When the site redirects to Microsoft sign-in.
 */
export async function submitDayEntry(page, baseUrl, payload, selectors) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  if (isLoginUrl(page.url())) throw new SessionExpiredError(page.url());

  await page.locator(selectors.addEntryButton).first().click();
  await page.locator(selectors.dateInput).first().fill(payload.date);
  await page.locator(selectors.hoursInput).first().fill(String(payload.hours));
  await page.locator(selectors.descriptionInput).first().fill(payload.description);
  await page.locator(selectors.saveButton).first().click();
  await page.locator(selectors.savedConfirmation).first().waitFor({ state: 'visible' });
}
