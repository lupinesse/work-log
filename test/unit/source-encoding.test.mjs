/**
 * @file source-encoding.test.mjs
 * Guards against a UTF-8 byte-order mark (U+FEFF) at the start of source files
 * (issue #506). A BOM before the first rule or statement breaks Sass/Stylelint
 * parsing and gets concatenated into the middle of the bundle by build.js.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __dirname } from './_helpers.mjs';

const BYTE_ORDER_MARK = '\uFEFF';
const SOURCE_ROOT = join(__dirname, '../../src');

/**
 * Lists files in a directory (non-recursive) that have one of the extensions.
 * @param {string} directory - Absolute directory path.
 * @param {string[]} extensions - Extensions including the dot, e.g. ['.js'].
 * @returns {string[]} Absolute file paths.
 */
function listSourceFiles(directory, extensions) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => join(directory, entry.name));
}

/**
 * Returns the files whose content starts with a byte-order mark.
 * @param {string[]} filePaths - Absolute file paths to inspect (read-only).
 * @returns {string[]} Paths of the offending files.
 */
function findFilesWithBom(filePaths) {
  return filePaths.filter((filePath) => readFileSync(filePath, 'utf8').startsWith(BYTE_ORDER_MARK));
}

/**
 * Builds the assertion message that names every offending file.
 * @param {string[]} offenders - Paths of files starting with a BOM.
 * @returns {string} Human-readable failure message.
 */
function describeOffenders(offenders) {
  return `Files must not start with a U+FEFF byte-order mark; save them as UTF-8 without BOM:\n${offenders.join('\n')}`;
}

describe('source files have no byte-order mark (#506)', () => {
  const targets = [
    ['src/css/*.scss', listSourceFiles(join(SOURCE_ROOT, 'css'), ['.scss'])],
    ['src/js/*.js', listSourceFiles(join(SOURCE_ROOT, 'js'), ['.js'])],
  ];

  for (const [label, files] of targets) {
    it(`${label}: found files to check`, () => {
      assert.ok(files.length > 0, `No files matched ${label}; the guard would pass vacuously`);
    });

    it(`${label}: none starts with U+FEFF`, () => {
      const offenders = findFilesWithBom(files);
      assert.deepEqual(offenders, [], describeOffenders(offenders));
    });
  }

  it('the detector flags a temp file that starts with a BOM and not a clean one', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bom-guard-'));
    try {
      const withBom = join(directory, 'with-bom.scss');
      const clean = join(directory, 'clean.scss');
      writeFileSync(withBom, `${BYTE_ORDER_MARK}.a { color: red; }`);
      writeFileSync(clean, '.a { color: red; }');
      assert.deepEqual(findFilesWithBom([withBom, clean]), [withBom]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
