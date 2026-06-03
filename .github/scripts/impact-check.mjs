#!/usr/bin/env node
/**
 * Static cross-module impact analysis — no Claude API required.
 *
 * Reads pr.diff (written by CI) or generates one locally, finds changed
 * src/js/ and src/css/ files, then builds a downstream-dependant map by
 * grepping every other source module for references to the changed basenames.
 * Also checks test-file coverage.
 *
 * Exits 0 always; human-readable markdown is written to stdout.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// 1. Read the diff
// ---------------------------------------------------------------------------

let diffContent = '';

if (fs.existsSync('pr.diff')) {
  diffContent = fs.readFileSync('pr.diff', 'utf8');
} else {
  try {
    diffContent = execSync('git diff main...HEAD', { encoding: 'utf8' });
  } catch {
    console.log('## Impact Analysis — could not generate diff.');
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// 2. Extract changed src/ files (additions and modifications only)
// ---------------------------------------------------------------------------

/** @type {string[]} */
const changedFiles = [
  ...new Set([...diffContent.matchAll(/^\+\+\+ b\/(src\/(?:js|css)\/[^\s]+)/gm)].map((m) => m[1])),
];

if (changedFiles.length === 0) {
  console.log('## Impact Analysis — no src/ changes detected in this diff.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 3. Build dependency map
// ---------------------------------------------------------------------------

/** All src/js source files. */
const allJsFiles = fs.existsSync('src/js')
  ? fs
      .readdirSync('src/js')
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join('src', 'js', f))
  : [];

/** Support files to check for build references. */
const buildFiles = ['build.js', 'build-portable.js'].filter((f) => fs.existsSync(f));

/** Test files to check for coverage. */
const testFiles = [
  'smoke-tests.cjs',
  path.join('test', 'unit.mjs'),
  path.join('test', 'unit.cjs'),
].filter((f) => fs.existsSync(f));

/**
 * Find the line number (1-based) of the first occurrence of `term` in `filePath`.
 *
 * @param {string} filePath
 * @param {string} term
 * @returns {number|null}
 */
function firstLineContaining(filePath, term) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.includes(term));
  return idx === -1 ? null : idx + 1;
}

/**
 * Check if `content` references `basename` as an import/require target.
 *
 * @param {string} content - File content.
 * @param {string} basename - Module basename without extension.
 * @returns {boolean}
 */
function referencesModule(content, basename) {
  // Match import/require with basename somewhere in the path string
  return (
    new RegExp(`['"/]${basename}(?:\\.js)?['"/]`).test(content) ||
    new RegExp(`/${basename}(?:\\.js)?['"/]`).test(content)
  );
}

/** @typedef {{ file: string, basename: string, dependants: string[], buildRefs: string[], testCoverage: string, risk: string }} Row */

/** @type {Row[]} */
const rows = changedFiles.map((changed) => {
  const basename = path.basename(changed, path.extname(changed));

  // Source dependants
  const dependants = allJsFiles
    .filter((src) => src !== changed && src !== changed.replace(/\\/g, '/'))
    .filter((src) => {
      const content = fs.readFileSync(src, 'utf8');
      return referencesModule(content, basename);
    })
    .map((src) => path.basename(src));

  // Build file references
  const buildRefs = buildFiles
    .filter((f) => fs.readFileSync(f, 'utf8').includes(basename))
    .map((f) => path.basename(f));

  // Risk level
  const risk =
    dependants.length >= 2 ? '🔴 High' : dependants.length === 1 ? '🟡 Medium' : '🟢 Low';

  // Test coverage
  let testCoverage = '❌ not found';
  for (const tf of testFiles) {
    const lineNum = firstLineContaining(tf, basename);
    if (lineNum !== null) {
      testCoverage = `✅ ${tf} line ${lineNum}`;
      break;
    }
  }

  return { file: changed, basename, dependants, buildRefs, testCoverage, risk };
});

// ---------------------------------------------------------------------------
// 4. Write report
// ---------------------------------------------------------------------------

const out = ['## Impact Analysis', ''];

out.push('### Changed modules');
for (const r of rows) {
  out.push(`- \`${r.file}\``);
}
out.push('');

out.push('### Downstream dependants');
out.push('| Changed module | Modules that import it | Risk |');
out.push('|---|---|---|');
for (const r of rows) {
  const deps = r.dependants.length > 0 ? r.dependants.map((d) => `\`${d}\``).join(', ') : '(none)';
  out.push(`| \`${path.basename(r.file)}\` | ${deps} | ${r.risk} |`);
}
out.push('');

out.push('### Test coverage for changed modules');
out.push('| Module | Test coverage |');
out.push('|---|---|');
for (const r of rows) {
  out.push(`| \`${path.basename(r.file)}\` | ${r.testCoverage} |`);
}

if (buildFiles.length > 0) {
  const anyBuildRef = rows.some((r) => r.buildRefs.length > 0);
  if (anyBuildRef) {
    out.push('');
    out.push('### Build references');
    out.push('| Module | Referenced in |');
    out.push('|---|---|');
    for (const r of rows) {
      if (r.buildRefs.length > 0) {
        out.push(
          `| \`${path.basename(r.file)}\` | ${r.buildRefs.map((f) => `\`${f}\``).join(', ')} |`
        );
      }
    }
  }
}

console.log(out.join('\n'));
