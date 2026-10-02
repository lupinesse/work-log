import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';

// Flags a new single-letter arrow-function parameter, e.g. `(a) => a.x`.
// Doesn't touch the existing instances across src/js/ (counted by BASELINE_COUNT
// in .github/scripts/lib/arrow-param-ratchet.mjs, not restated here; severity 'warn',
// not 'error' — retroactively failing lint on unrelated pre-existing code
// isn't this rule's job) or arrow functions with more than one parameter,
// where a short name in a `.map`/`.reduce`/`.sort` comparator chain reads
// fine. Flagged as unaddressed across seven consecutive weekly QA reviews;
// this is the "stop the pile from growing" fix those reviews recommended,
// not a bulk rename. The actual enforcement is a separate CI check —
// `npm run test:arrow-param-count` (.github/scripts/check-arrow-param-count.mjs)
// — since 'warn' alone did not stop the count growing (294 → 297 over the
// two reviews after this rule first landed).
const NO_SINGLE_LETTER_ARROW_PARAM = {
  selector: 'ArrowFunctionExpression[params.length=1] > Identifier.params[name=/^[a-z]$/]',
  message:
    'Single-letter arrow-function parameter — use an informative name (CLAUDE.md: "Names are informative, concise, and explicit — no cryptic abbreviations").',
};

export default [
  js.configs.recommended,
  security.configs.recommended,

  // Build tooling — ES modules running in Node
  // detect-non-literal-fs-filename is suppressed: all file paths here are
  // internal configuration constants derived from package.json and __dirname,
  // never from external/user input, so the rule produces only false positives.
  {
    files: ['*.js'],
    ignores: ['take-screenshots.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'security/detect-non-literal-fs-filename': 'off',
    },
  },

  // Playwright automation script — ES module in Node that passes browser-side
  // code to page.evaluate(); browser globals are legitimately in scope there.
  {
    files: ['take-screenshots.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Extracted ES-module files — logger.js, app-constants.js, state.js,
  // 05b-filesystem.js, 01b-migrate.js, 24-location.js, date-labels.js,
  // 12b-changelog-data.js, signifiers.js, 00-config.js, and the pure-fns
  // barrel plus its pure-fns-*.js sub-modules use 'export' syntax and are
  // imported directly by unit tests. They run in the browser context.
  // detect-object-injection: warn (not off) so new bracket-notation sites with
  // untrusted keys are caught; existing sites carry per-line disable comments.
  {
    files: [
      'src/js/00-config.js',
      'src/js/logger.js',
      'src/js/app-constants.js',
      'src/js/state.js',
      'src/js/05b-filesystem.js',
      'src/js/01b-migrate.js',
      'src/js/24-location.js',
      'src/js/focus-utils.js',
      'src/js/12d-weeklyreport.js',
      'src/js/date-labels.js',
      'src/js/04b-render-stats.js',
      'src/js/12b-changelog-data.js',
      'src/js/signifiers.js',
      'src/js/25-rollingsummary.js',
      'src/js/26-gofore-timesheet.js',
      'src/js/22-trackers.js',
      'src/js/pomo-storage.js',
      'src/js/08a-pomo-dashboard.js',
      'src/js/01c-save.js',
      'src/js/10b-signifiers.js',
      'src/js/cat-utils.js',
      'src/js/entry-billable.js',
      'src/js/pure-fns*.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'security/detect-object-injection': 'warn',
      'no-restricted-syntax': ['warn', NO_SINGLE_LETTER_ARROW_PARAM],
    },
  },

  // Source modules — concatenated into a single browser IIFE at build time.
  // no-undef is disabled: functions defined in one module are legitimately called
  // from another; ESLint cannot see the full shared scope of the concatenated output.
  // no-unused-vars uses vars:'local' for the same reason — a top-level function or
  // state variable defined here is frequently consumed only by another module (or by
  // work-log.html), which per-file linting cannot see, so flagging those globals
  // produces false positives. Genuinely-dead *local* variables inside functions are
  // still reported. caughtErrors:'none' allows `catch (err)` fallbacks that do not
  // inspect the error (paired with the allowEmptyCatch policy below). Cross-file dead
  // top-level symbols are found with the dead-code skill, not this rule.
  // detect-object-injection: warn (not off) so new bracket-notation sites with
  // untrusted keys are caught; existing sites carry per-line disable comments.
  // The ignores below are the ES-module files configured in the block above
  // (sourceType 'module'); this block is for the concatenated classic-script files.
  // Keep the two lists in sync so a file is linted by exactly one block.
  {
    files: ['src/js/*.js'],
    ignores: [
      'src/js/00-config.js',
      'src/js/logger.js',
      'src/js/app-constants.js',
      'src/js/state.js',
      'src/js/05b-filesystem.js',
      'src/js/01b-migrate.js',
      'src/js/24-location.js',
      'src/js/focus-utils.js',
      'src/js/12d-weeklyreport.js',
      'src/js/date-labels.js',
      'src/js/04b-render-stats.js',
      'src/js/12b-changelog-data.js',
      'src/js/signifiers.js',
      'src/js/25-rollingsummary.js',
      'src/js/26-gofore-timesheet.js',
      'src/js/22-trackers.js',
      'src/js/pomo-storage.js',
      'src/js/08a-pomo-dashboard.js',
      'src/js/01c-save.js',
      'src/js/10b-signifiers.js',
      'src/js/cat-utils.js',
      'src/js/entry-billable.js',
      'src/js/pure-fns*.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: globals.browser,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': [
        'warn',
        { vars: 'local', args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'security/detect-object-injection': 'warn',
      'no-restricted-syntax': ['warn', NO_SINGLE_LETTER_ARROW_PARAM],
    },
  },

  // Workstation tooling — ES modules run by hand via `npm run`, not by CI.
  // scripts/session-guard.mjs and its lib guard against concurrent sessions
  // sharing this checkout (#268). They use Node globals (process, console).
  // detect-non-literal-fs-filename: lock paths are built from the git common
  // directory and a sanitised session id, never from untrusted input.
  // detect-object-injection is 'warn' here (#484): every existing bracket lookup
  // carries an inline disable naming why its key is safe, so a new one with an
  // untrusted key shows up instead of being silenced wholesale.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'warn',
    },
  },

  // CI dialogue scripts — ES modules running in Node (GitHub Actions).
  // These power the chatgpt/claude PR-review pipeline. They use Node globals
  // (process, console, fetch). detect-non-literal-fs-filename: any file paths
  // here are derived from internal config or trusted CI output, not external
  // input. detect-object-injection is 'warn' (#484): these scripts parse PR and
  // API data, so each existing bracket lookup carries an inline disable naming
  // why its key is safe, and a new one with an untrusted key will show up.
  {
    files: ['.github/scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'warn',
    },
  },

  // CommonJS Node files: Playwright smoke tests (root *.cjs) and unit tests (test/**/*.cjs).
  // Browser globals are included because smoke tests pass browser-side code to page.evaluate().
  // detect-non-literal-fs-filename: paths come from internal config, not external input.
  // detect-object-injection is 'warn' (#484); the one MIME[ext] lookup carries an inline
  // disable explaining that path.extname() always starts with a dot.
  {
    files: ['*.cjs', 'test/**/*.cjs', 'scripts/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'warn',
    },
  },

  // ESM unit tests — run with Node's built-in test runner.
  // Includes browser globals because tests use vm.runInContext with browser-side code.
  // detect-object-injection: warn (not off); test fixtures carry per-line
  // disable comments.
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'warn',
    },
  },

  {
    ignores: ['node_modules/', 'dist/', 'portable/', 'script.js'],
  },
];
