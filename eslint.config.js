import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,

  // Build tooling — ES modules running in Node
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
    },
  },

  // CommonJS Node files: Playwright smoke tests (root *.cjs) and unit tests (test/**/*.cjs).
  // Browser globals are included because smoke tests pass browser-side code to page.evaluate().
  {
    files: ['*.cjs', 'test/**/*.cjs', 'scripts/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    ignores: ['node_modules/', 'dist/', 'portable/', 'script.js'],
  },
];
