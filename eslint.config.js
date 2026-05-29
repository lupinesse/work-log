import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';

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

  // Source modules — concatenated into a single browser IIFE at build time.
  // no-undef is disabled: functions defined in one module are legitimately called
  // from another; ESLint cannot see the full shared scope of the concatenated output.
  // detect-object-injection is disabled: bracket-notation on internal state arrays
  // (entries, categories, planTasks) is intentional and the data is never from
  // untrusted external input at that point.
  {
    files: ['src/js/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: globals.browser,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'security/detect-object-injection': 'off',
    },
  },

  // CI dialogue scripts — ES modules running in Node (GitHub Actions).
  // These power the chatgpt/claude PR-review pipeline. They use Node globals
  // (process, console, fetch). detect-non-literal-fs-filename: any file paths
  // here are derived from internal config or trusted CI output, not external
  // input. detect-object-injection: bracket lookups key off internal source
  // labels and parsed CI data, never untrusted user input at that point.
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
      'security/detect-object-injection': 'off',
    },
  },

  // CommonJS Node files: Playwright smoke tests (root *.cjs) and unit tests (test/**/*.cjs).
  // Browser globals are included because smoke tests pass browser-side code to page.evaluate().
  // detect-non-literal-fs-filename: paths come from internal config, not external input.
  // detect-object-injection: MIME[ext] is a static lookup keyed by path.extname(), not user data.
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
      'security/detect-object-injection': 'off',
    },
  },

  {
    ignores: ['node_modules/', 'dist/', 'portable/', 'script.js'],
  },
];
