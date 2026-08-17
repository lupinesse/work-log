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
 *
 * Helper functions are exported for unit testing.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Check if `content` references `basename` as an import/require path target.
 * Handles `.js` extension variants and leading path separators; escapes
 * regex metacharacters in `basename` so hyphens and dots are treated literally.
 *
 * @param {string} content - File content to search.
 * @param {string} basename - Module basename without extension (e.g. "pure-fns").
 * @returns {boolean}
 */
export function referencesModule(content, basename) {
  const esc = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Must be preceded by a quote or slash (path separator) and optionally
  // have a .js extension before the closing quote — prevents partial matches.
  // eslint-disable-next-line security/detect-non-literal-regexp -- esc is sanitised above with replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:['"/])${esc}(?:\\.js)?['"/]`).test(content);
}

/**
 * Find the 1-based line number of the first occurrence of `term` in `filePath`.
 * Returns null if the term is not found.
 *
 * @param {string} filePath
 * @param {string} term
 * @returns {number|null}
 */
export function firstLineContaining(filePath, term) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.includes(term));
  return idx === -1 ? null : idx + 1;
}

/**
 * Find the test files to search for coverage of a changed module: the smoke
 * test script plus every unit-test file under test/unit/. Discovered by
 * globbing the directory rather than a fixed filename list, so a future
 * rename/split of the unit-test suite (like #334/#355's split of the former
 * test/unit.mjs into test/unit/*.test.mjs) doesn't silently drop coverage.
 *
 * @returns {string[]} Existing test file paths, relative to the repo root.
 */
export function discoverTestFiles() {
  const unitTestDir = path.join('test', 'unit');
  const unitTestFiles = fs.existsSync(unitTestDir)
    ? fs
        .readdirSync(unitTestDir)
        .filter((f) => f.endsWith('.test.mjs'))
        .map((f) => path.join(unitTestDir, f))
    : [];

  return ['smoke-tests.cjs', ...unitTestFiles].filter((f) => fs.existsSync(f));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  // 1. Read the diff
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

  // 2. Extract changed src/ files (additions and modifications only)
  const changedFiles = [
    ...new Set(
      [...diffContent.matchAll(/^\+\+\+ b\/(src\/(?:js|css)\/[^\s]+)/gm)].map((m) => m[1])
    ),
  ];

  if (changedFiles.length === 0) {
    console.log('## Impact Analysis — no src/ changes detected in this diff.');
    process.exit(0);
  }

  // 3. Build dependency map
  const allJsFiles = fs.existsSync('src/js')
    ? fs
        .readdirSync('src/js')
        .filter((f) => f.endsWith('.js'))
        .map((f) => path.join('src', 'js', f))
    : [];

  const buildFiles = ['build.js', 'build-portable.js'].filter((f) => fs.existsSync(f));

  const testFiles = discoverTestFiles();

  const rows = changedFiles.map((changed) => {
    const basename = path.basename(changed, path.extname(changed));

    const dependants = allJsFiles
      .filter((src) => src !== changed)
      .filter((src) => referencesModule(fs.readFileSync(src, 'utf8'), basename))
      .map((src) => path.basename(src));

    const buildRefs = buildFiles
      .filter((f) => fs.readFileSync(f, 'utf8').includes(basename))
      .map((f) => path.basename(f));

    const risk =
      dependants.length >= 2 ? '🔴 High' : dependants.length === 1 ? '🟡 Medium' : '🟢 Low';

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

  // 4. Write report
  const out = ['## Impact Analysis', ''];

  out.push('### Changed modules');
  for (const r of rows) out.push(`- \`${r.file}\``);
  out.push('');

  out.push('### Downstream dependants');
  out.push('| Changed module | Modules that import it | Risk |');
  out.push('|---|---|---|');
  for (const r of rows) {
    const deps =
      r.dependants.length > 0 ? r.dependants.map((d) => `\`${d}\``).join(', ') : '(none)';
    out.push(`| \`${path.basename(r.file)}\` | ${deps} | ${r.risk} |`);
  }
  out.push('');

  out.push('### Test coverage for changed modules');
  out.push('| Module | Test coverage |');
  out.push('|---|---|');
  for (const r of rows) out.push(`| \`${path.basename(r.file)}\` | ${r.testCoverage} |`);

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
}
