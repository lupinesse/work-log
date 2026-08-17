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
 * Rewrite a path with forward slashes for display.
 *
 * Paths are built with `path.join`, so on Windows they come back with
 * backslashes — which read as escape characters once the report is rendered as
 * markdown in a PR comment. The report is a document, not a filesystem call, so
 * it always shows POSIX separators regardless of the host OS.
 *
 * @param {string} filePath - Path in host-OS form.
 * @returns {string} The same path with `/` separators.
 */
export function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

/**
 * Collect the test files to search for coverage of a changed module.
 *
 * Discovers the suites by reading `testDir` rather than naming files, because
 * the previous hard-coded list silently stopped matching anything the moment
 * `test/unit.mjs` was split into `test/unit/*.test.mjs` (#334): the dead path
 * was filtered out by an `existsSync` check without a word, and every changed
 * module started reporting "not found".
 *
 * The scan covers `testDir` itself and one level of subdirectory — enough for
 * both the pre-#334 layout (`test/unit.mjs`) and the current one
 * (`test/unit/*.test.mjs`), and no deeper. A suite nested further than that
 * would be missed just as silently, so the caller logs the discovered count:
 * that number dropping is the signal, since this function cannot tell
 * "no suites here" apart from "did not look here".
 *
 * Every `.mjs`/`.cjs` file is returned, which means shared fixtures such as
 * `test/unit/_helpers.mjs` come back alongside the suites proper — harmless,
 * since the caller only greps these paths for a module reference. Other
 * extensions are skipped, so `test/calendar.Tests.ps1` (Pester) never appears.
 *
 * Everything found under `testDir` is sorted together for a stable report — a
 * file directly in `testDir` gets no precedence over one in a subdirectory.
 * Only the `rootTestFiles` entries are pinned ahead of the scan, which is what
 * keeps `smoke-tests.cjs` searched first as it was before.
 *
 * @param {string} [testDir] - Directory holding the test suites.
 * @param {string[]} [rootTestFiles] - Suites outside `testDir`, searched first.
 * @returns {string[]} Paths of existing `.mjs`/`.cjs` files, in search order.
 */
export function collectTestFiles(testDir = 'test', rootTestFiles = ['smoke-tests.cjs']) {
  // Directory entries, not bare names: a *directory* named `foo.mjs` would
  // otherwise be collected as a file, and the caller's readFileSync on it
  // throws EISDIR.
  const isTestScript = (entry) =>
    !entry.isDirectory() && (entry.name.endsWith('.mjs') || entry.name.endsWith('.cjs'));

  const discovered = [];
  if (fs.existsSync(testDir)) {
    for (const entry of fs.readdirSync(testDir, { withFileTypes: true })) {
      const entryPath = path.join(testDir, entry.name);
      if (entry.isDirectory()) {
        discovered.push(
          ...fs
            .readdirSync(entryPath, { withFileTypes: true })
            .filter(isTestScript)
            .map((child) => path.join(entryPath, child.name))
        );
      } else if (isTestScript(entry)) {
        discovered.push(entryPath);
      }
    }
  }

  return [...rootTestFiles.filter((f) => fs.existsSync(f)), ...discovered.sort()];
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

  // Report the discovered suites on stderr — the workflow redirects only
  // stdout into the PR comment, so this lands in the Actions log instead of
  // the posted markdown. A count of 1 (smoke tests alone) is the signature of
  // the discovery breaking again.
  const testFiles = collectTestFiles();
  console.error(`impact-check: searching ${testFiles.length} test file(s) for coverage`);

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
        testCoverage = `✅ ${toPosixPath(tf)} line ${lineNum}`;
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
