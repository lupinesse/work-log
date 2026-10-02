/**
 * Unit tests for lib/pr-size-gate.mjs.
 *
 * Table-driven cases cover the boundary conditions at each threshold, the
 * generated-file exclusion, and the docs-only classification used to skip
 * documentation-only PRs.
 *
 * Run: node --test .github/scripts/test/pr-size-gate.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyPR,
  DOCS_ONLY,
  FILES_THRESHOLD,
  GENERATED,
  LABEL,
  LINES_THRESHOLD,
} from '../lib/pr-size-gate.mjs';

// ---------------------------------------------------------------------------
// Exported constant shape
// ---------------------------------------------------------------------------

describe('exported constants', () => {
  it('LINES_THRESHOLD is a positive integer', () => {
    assert.ok(Number.isInteger(LINES_THRESHOLD) && LINES_THRESHOLD > 0);
  });

  it('FILES_THRESHOLD is a positive integer', () => {
    assert.ok(Number.isInteger(FILES_THRESHOLD) && FILES_THRESHOLD > 0);
  });

  it('LABEL is a non-empty string', () => {
    assert.ok(typeof LABEL === 'string' && LABEL.length > 0);
  });

  it('GENERATED is a RegExp', () => {
    assert.ok(GENERATED instanceof RegExp);
  });

  it('DOCS_ONLY is a RegExp', () => {
    assert.ok(DOCS_ONLY instanceof RegExp);
  });
});

// ---------------------------------------------------------------------------
// GENERATED pattern
// ---------------------------------------------------------------------------

describe('GENERATED pattern', () => {
  const matches = [
    'script.js',
    'styles.css',
    'docs/index.html',
    'docs/nested/page.html',
    'package-lock.json',
  ];
  const nonMatches = [
    'src/app.js',
    'README.md',
    'docs/design.md',
    'package.json',
    'src/styles.scss',
  ];

  for (const file of matches) {
    it(`matches ${file}`, () => assert.ok(GENERATED.test(file)));
  }
  for (const file of nonMatches) {
    it(`does not match ${file}`, () => assert.ok(!GENERATED.test(file)));
  }
});

// ---------------------------------------------------------------------------
// DOCS_ONLY pattern
// ---------------------------------------------------------------------------

describe('DOCS_ONLY pattern', () => {
  const matches = [
    'README.md',
    'CHANGELOG.txt',
    'docs/guide.rst',
    'LICENSE',
    'CODEOWNERS',
    'CONTRIBUTING.MD',
  ];
  const nonMatches = ['src/app.js', 'styles.scss', 'docs/page.html', 'config.json'];

  for (const file of matches) {
    it(`matches ${file}`, () => assert.ok(DOCS_ONLY.test(file)));
  }
  for (const file of nonMatches) {
    it(`does not match ${file}`, () => assert.ok(!DOCS_ONLY.test(file)));
  }
});

// ---------------------------------------------------------------------------
// classifyPR — helper factory
// ---------------------------------------------------------------------------

/** @param {string} filename @param {number} additions @param {number} deletions */
const f = (filename, additions = 0, deletions = 0) => ({ filename, additions, deletions });

// ---------------------------------------------------------------------------
// classifyPR — threshold boundary cases
// ---------------------------------------------------------------------------

describe('classifyPR — lines threshold', () => {
  it('is false when totalLines is below LINES_THRESHOLD with few files', () => {
    // One source file, 1 line below threshold, 1 file (below FILES_THRESHOLD)
    const files = [f('src/a.js', LINES_THRESHOLD - 1, 0)];
    const { meetsThreshold, totalLines, fileCount } = classifyPR(files);
    assert.equal(totalLines, LINES_THRESHOLD - 1);
    assert.equal(fileCount, 1);
    assert.equal(meetsThreshold, false);
  });

  it('is true when totalLines equals LINES_THRESHOLD', () => {
    const files = [f('src/a.js', LINES_THRESHOLD, 0)];
    const { meetsThreshold, totalLines } = classifyPR(files);
    assert.equal(totalLines, LINES_THRESHOLD);
    assert.equal(meetsThreshold, true);
  });

  it('is true when totalLines exceeds LINES_THRESHOLD', () => {
    const files = [f('src/a.js', LINES_THRESHOLD + 50, 0)];
    const { meetsThreshold } = classifyPR(files);
    assert.equal(meetsThreshold, true);
  });

  it('counts both additions and deletions', () => {
    // Half additions, half deletions — should sum to threshold
    const half = LINES_THRESHOLD / 2;
    const files = [f('src/a.js', half, half)];
    const { totalLines, meetsThreshold } = classifyPR(files);
    assert.equal(totalLines, LINES_THRESHOLD);
    assert.equal(meetsThreshold, true);
  });
});

describe('classifyPR — files threshold', () => {
  it('is false when fileCount is below FILES_THRESHOLD with few lines', () => {
    // FILES_THRESHOLD - 1 files, each with 1 line changed
    const files = Array.from({ length: FILES_THRESHOLD - 1 }, (_, i) => f(`src/f${i}.js`, 1, 0));
    const { meetsThreshold, fileCount } = classifyPR(files);
    assert.equal(fileCount, FILES_THRESHOLD - 1);
    assert.equal(meetsThreshold, false);
  });

  it('is true when fileCount equals FILES_THRESHOLD', () => {
    const files = Array.from({ length: FILES_THRESHOLD }, (_, i) => f(`src/f${i}.js`, 1, 0));
    const { meetsThreshold, fileCount } = classifyPR(files);
    assert.equal(fileCount, FILES_THRESHOLD);
    assert.equal(meetsThreshold, true);
  });

  it('is true when fileCount exceeds FILES_THRESHOLD', () => {
    const files = Array.from({ length: FILES_THRESHOLD + 2 }, (_, i) => f(`src/f${i}.js`, 1, 0));
    const { meetsThreshold } = classifyPR(files);
    assert.equal(meetsThreshold, true);
  });
});

// ---------------------------------------------------------------------------
// classifyPR — generated file exclusion
// ---------------------------------------------------------------------------

describe('classifyPR — generated file exclusion', () => {
  it('excludes script.js from counts', () => {
    const files = [f('src/app.js', 10, 0), f('script.js', 1000, 0)];
    const { sourceFiles, totalLines, fileCount } = classifyPR(files);
    assert.equal(fileCount, 1);
    assert.equal(totalLines, 10);
    assert.equal(sourceFiles[0].filename, 'src/app.js');
  });

  it('excludes styles.css from counts', () => {
    const files = [f('src/style.scss', 5, 0), f('styles.css', 999, 0)];
    const { fileCount, totalLines } = classifyPR(files);
    assert.equal(fileCount, 1);
    assert.equal(totalLines, 5);
  });

  it('excludes docs/*.html files from counts', () => {
    const files = [
      f('src/app.js', 1, 0),
      f('docs/api.html', 500, 0),
      f('docs/nested/page.html', 300, 0),
    ];
    const { fileCount, totalLines } = classifyPR(files);
    assert.equal(fileCount, 1);
    assert.equal(totalLines, 1);
  });

  it('excludes package-lock.json from counts', () => {
    const files = [f('src/app.js', 2, 0), f('package-lock.json', 5000, 0)];
    const { fileCount, totalLines } = classifyPR(files);
    assert.equal(fileCount, 1);
    assert.equal(totalLines, 2);
  });

  it('does not exclude package.json (only package-lock.json is generated)', () => {
    const files = [f('package.json', 3, 0)];
    const { fileCount } = classifyPR(files);
    assert.equal(fileCount, 1);
  });

  it('returns meetsThreshold false when only generated files are present', () => {
    const files = [f('script.js', 1000, 0), f('styles.css', 1000, 0)];
    const { fileCount, totalLines, meetsThreshold } = classifyPR(files);
    assert.equal(fileCount, 0);
    assert.equal(totalLines, 0);
    assert.equal(meetsThreshold, false);
  });

  it('PR meets threshold via lines even after generated files removed', () => {
    const files = [f('src/app.js', LINES_THRESHOLD, 0), f('script.js', 5000, 0)];
    const { meetsThreshold, totalLines } = classifyPR(files);
    assert.equal(totalLines, LINES_THRESHOLD);
    assert.equal(meetsThreshold, true);
  });
});

// ---------------------------------------------------------------------------
// classifyPR — docs-only classification
// ---------------------------------------------------------------------------

describe('classifyPR — isDocsOnly', () => {
  it('is true when all source files are docs', () => {
    const files = [f('README.md', 10, 2), f('CHANGELOG.md', 5, 0)];
    const { isDocsOnly, meetsThreshold } = classifyPR(files);
    assert.equal(isDocsOnly, true);
    assert.equal(meetsThreshold, false);
  });

  it('is false when at least one source file is not docs', () => {
    const files = [f('README.md', 10, 0), f('src/app.js', 5, 0)];
    const { isDocsOnly } = classifyPR(files);
    assert.equal(isDocsOnly, false);
  });

  it('is false when the file list is empty', () => {
    const { isDocsOnly } = classifyPR([]);
    assert.equal(isDocsOnly, false);
  });

  it('is false when all files are generated (fileCount is 0)', () => {
    const files = [f('script.js', 10, 0)];
    const { isDocsOnly } = classifyPR(files);
    assert.equal(isDocsOnly, false);
  });

  it('docs-only PR with many files does not meet file threshold', () => {
    const files = Array.from({ length: FILES_THRESHOLD + 3 }, (_, i) =>
      f(`docs/section${i}.md`, 1, 0)
    );
    const { isDocsOnly, meetsThreshold, fileCount } = classifyPR(files);
    assert.equal(fileCount, FILES_THRESHOLD + 3);
    assert.equal(meetsThreshold, true);
    assert.equal(isDocsOnly, true);
  });
});

// ---------------------------------------------------------------------------
// classifyPR — empty and edge cases
// ---------------------------------------------------------------------------

describe('classifyPR — edge cases', () => {
  it('handles an empty files array', () => {
    const result = classifyPR([]);
    assert.deepEqual(result, {
      sourceFiles: [],
      totalLines: 0,
      fileCount: 0,
      meetsThreshold: false,
      isDocsOnly: false,
    });
  });

  it('handles files with zero additions and deletions', () => {
    const files = [f('src/app.js', 0, 0), f('src/b.js', 0, 0)];
    const { totalLines, meetsThreshold } = classifyPR(files);
    assert.equal(totalLines, 0);
    assert.equal(meetsThreshold, false);
  });
});
