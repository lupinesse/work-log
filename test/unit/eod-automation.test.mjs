/**
 * @file eod-automation.test.mjs
 * Tests for the end-of-day automation library, using a fake page so no
 * browser or network is needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLoginUrl,
  parseTimesheetPayload,
  resolveSelectors,
  submitDayEntry,
  SessionExpiredError,
  DEFAULT_SELECTORS,
} from '../../scripts/lib/eod-automation.mjs';

/**
 * Builds a fake Playwright page that records actions.
 * @param {string} landingUrl - URL the page reports after goto().
 * @returns {{page: Object, actions: string[]}} The page and its action log.
 */
function fakePage(landingUrl) {
  const actions = [];
  const page = {
    goto: async (url) => actions.push(`goto ${url}`),
    url: () => landingUrl,
    locator: (selector) => ({
      first: () => ({
        click: async () => actions.push(`click ${selector}`),
        fill: async (value) => actions.push(`fill ${selector}=${value}`),
        waitFor: async () => actions.push(`wait ${selector}`),
      }),
    }),
  };
  return { page, actions };
}

const validPayload = { date: '2026-09-30', hours: 7.5, description: 'work (X-1)' };

describe('isLoginUrl', () => {
  it('recognises Microsoft sign-in hosts only', () => {
    assert.equal(isLoginUrl('https://login.microsoftonline.com/tenant/oauth2'), true);
    assert.equal(isLoginUrl('https://eod-test.local/'), false);
    assert.equal(isLoginUrl('not a url'), false);
  });
});

describe('parseTimesheetPayload', () => {
  it('accepts a valid payload', () => {
    assert.deepEqual(parseTimesheetPayload(JSON.stringify(validPayload)), validPayload);
  });

  for (const [name, mutation, message] of [
    ['bad date', { date: '30/09/2026' }, /YYYY-MM-DD/],
    ['non-numeric hours', { hours: 'seven' }, /hours/],
    ['zero hours', { hours: 0 }, /hours/],
    ['over 24 hours', { hours: 25 }, /hours/],
    ['blank description', { description: '  ' }, /description/],
  ]) {
    it(`rejects ${name}`, () => {
      assert.throws(
        () => parseTimesheetPayload(JSON.stringify({ ...validPayload, ...mutation })),
        message
      );
    });
  }

  it('rejects malformed JSON with an informative error', () => {
    assert.throws(() => parseTimesheetPayload('{nope'), /not valid JSON/);
  });
});

describe('resolveSelectors', () => {
  it('lets overrides win while keeping the other defaults', () => {
    const merged = resolveSelectors({ saveButton: '#save' });
    assert.equal(merged.saveButton, '#save');
    assert.equal(merged.dateInput, DEFAULT_SELECTORS.dateInput);
  });
});

describe('submitDayEntry', () => {
  it('fills the form and waits for the save confirmation', async () => {
    const { page, actions } = fakePage('https://eod-test.local/');
    await submitDayEntry(page, 'https://eod-test.local', validPayload, DEFAULT_SELECTORS);
    assert.deepEqual(actions, [
      'goto https://eod-test.local',
      `click ${DEFAULT_SELECTORS.addEntryButton}`,
      `fill ${DEFAULT_SELECTORS.dateInput}=2026-09-30`,
      `fill ${DEFAULT_SELECTORS.hoursInput}=7.5`,
      `fill ${DEFAULT_SELECTORS.descriptionInput}=work (X-1)`,
      `click ${DEFAULT_SELECTORS.saveButton}`,
      `wait ${DEFAULT_SELECTORS.savedConfirmation}`,
    ]);
  });

  it('throws SessionExpiredError, touching nothing, when redirected to sign-in', async () => {
    const { page, actions } = fakePage('https://login.microsoftonline.com/x');
    await assert.rejects(
      submitDayEntry(page, 'https://eod-test.local', validPayload, DEFAULT_SELECTORS),
      SessionExpiredError
    );
    assert.equal(actions.length, 1);
  });
});
