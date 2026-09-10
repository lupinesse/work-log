#!/usr/bin/env node
/**
 * CI guard: fail if the single-letter-arrow-param count in `src/js/` grows.
 *
 * Entry point only — the counting/decision logic lives in
 * lib/arrow-param-ratchet.mjs. Run via `npm run test:arrow-param-count`;
 * wired into the `lint` job in ci.yml.
 *
 * eslint.config.js's own rule for this is `'warn'`, so `npm run lint` stays
 * green regardless of the count — it exists to give local, inline feedback,
 * not to gate a merge. Six-plus consecutive weekly QA reviews found the
 * count unchanged or growing anyway, because nothing actually blocked a PR
 * from adding to it. This script is that block: it re-lints `src/js/` itself
 * (independent of whatever else `npm run lint` covers) and fails when the
 * count exceeds the recorded baseline.
 *
 * Exits 0 when the count is at or below the baseline, 1 when it has grown.
 */

import { ESLint } from 'eslint';

import {
  BASELINE_COUNT,
  countArrowParamWarnings,
  evaluateRatchet,
} from './lib/arrow-param-ratchet.mjs';

/**
 * Lints `src/js/**\/*.js` and evaluates the count against the baseline.
 *
 * @returns {Promise<number>} 0 when the ratchet holds, 1 when it does not.
 */
async function main() {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(['src/js/**/*.js']);
  const messages = results.flatMap((result) => result.messages);
  const count = countArrowParamWarnings(messages);
  const { ok, baseline } = evaluateRatchet(count, BASELINE_COUNT);

  console.log(`single-letter arrow params in src/js/: ${count} (baseline ${baseline})`);

  if (ok) {
    if (count < baseline) {
      console.log(
        `✔ below baseline — consider lowering BASELINE_COUNT in ` +
          `.github/scripts/lib/arrow-param-ratchet.mjs to ${count} so the ratchet holds the new floor`
      );
    } else {
      console.log('✔ at baseline, no new single-letter arrow params added');
    }
    return 0;
  }

  console.error(
    `✖ ${count} single-letter arrow params found, up from a baseline of ${baseline}.\n` +
      `New code should use an informative parameter name instead (CLAUDE.md: "Names are ` +
      `informative, concise, and explicit — no cryptic abbreviations"). Run ` +
      `\`npx eslint src/js/\` to see exactly which lines eslint.config.js's own ` +
      `NO_SINGLE_LETTER_ARROW_PARAM warning flagged.`
  );
  return 1;
}

main().then((code) => process.exit(code));
