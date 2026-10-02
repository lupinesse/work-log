/**
 * @file source-encoding.test.mjs
 * Guard for #506: source files must not start with a UTF-8 byte-order mark.
 * A BOM in a SCSS partial or a concatenated JS module ends up mid-bundle as an
 * invisible U+FEFF (PR #79 fixed one such mojibake case; nothing prevented a
 * repeat).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, openSync, readSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname } from './_helpers.mjs';

const SOURCE_DIRECTORIES = [
  { directory: join(__dirname, '../../src/css'), extension: '.scss' },
  { directory: join(__dirname, '../../src/js'), extension: '.js' },
];

const BYTE_ORDER_MARK = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * Lists the source files in one directory with the given extension.
 * @param {{directory: string, extension: string}} source - Where and what to scan.
 * @returns {string[]} Absolute file paths.
 */
function listSourceFiles({ directory, extension }) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .map((name) => join(directory, name));
}

/**
 * Tells whether a file begins with a UTF-8 byte-order mark.
 * @param {string} filePath - Absolute path of the file to inspect.
 * @returns {boolean} True when the first three bytes are EF BB BF.
 */
function startsWithByteOrderMark(filePath) {
  // Read only the three bytes that matter instead of the whole file.
  const header = Buffer.alloc(BYTE_ORDER_MARK.length);
  const descriptor = openSync(filePath, 'r');
  try {
    const bytesRead = readSync(descriptor, header, 0, header.length, 0);
    return bytesRead === header.length && header.equals(BYTE_ORDER_MARK);
  } finally {
    closeSync(descriptor);
  }
}

describe('source files contain no byte-order mark (#506)', () => {
  const sourceFiles = SOURCE_DIRECTORIES.flatMap(listSourceFiles);

  it('finds more than 40 SCSS and JS files, so a wrong directory cannot pass vacuously', () => {
    assert.ok(sourceFiles.length > 40, `only found ${sourceFiles.length} files`);
  });

  it('no src/css/*.scss or src/js/*.js file starts with U+FEFF', () => {
    const offenders = sourceFiles.filter(startsWithByteOrderMark);
    assert.deepEqual(offenders, [], `remove the BOM from: ${offenders.join(', ')}`);
  });
});
