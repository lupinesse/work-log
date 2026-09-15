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
  describeRatchetFailure,
  evaluateRatchet,
  isSuspiciouslyZero,
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

  if (isSuspiciouslyZero(count)) {
    console.error(
      `✖ measured 0 single-letter arrow params, but the baseline is ${baseline} and this ` +
        `pile was never bulk-renamed — that means the count stopped matching real ESLint ` +
        `output instead of the codebase getting clean. Check that eslint.config.js's ` +
        `NO_SINGLE_LETTER_ARROW_PARAM rule still uses 'no-restricted-syntax' and that ` +
        `arrow-param-ratchet.mjs's RATCHETED_RULE_ID still matches it.`
    );
    return 1;
  }

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

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    // This check reaches ESLint through its Node API rather than the CLI, so an
    // ESLint upgrade that moves or renames that API surfaces here as a thrown
    // error, not as a count. Without this catch that arrives as a bare
    // unhandled-rejection trace: still a non-zero exit, but with nothing saying
    // which check broke or that the count was never actually measured.
    const { reason, frames } = describeRatchetFailure(error);
    console.error(
      `✖ the single-letter arrow-param ratchet could not run, so the count was never ` +
        `measured: ${reason}\n` +
        `This check lints src/js/ via the ESLint Node API. It fails this way when ESLint ` +
        `itself cannot load or run — a broken eslint.config.js, a missing plugin, or an ` +
        `ESLint major upgrade that changed the API. Run \`npx eslint src/js/\` to see the ` +
        `underlying error directly.`
    );
    if (frames) {
      console.error(frames);
    }
    process.exit(1);
  });
