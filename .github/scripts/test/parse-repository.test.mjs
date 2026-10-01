import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepository } from '../lib/parse-repository.mjs';

describe('parseRepository', () => {
  it('splits a valid owner/repo value', () => {
    assert.deepEqual(parseRepository('lupinesse/work-log'), {
      owner: 'lupinesse',
      repo: 'work-log',
    });
  });

  const INVALID_VALUES = [
    ['no slash', 'work-log'],
    ['empty string', ''],
    ['empty owner', '/work-log'],
    ['empty repo', 'lupinesse/'],
    ['extra segment', 'a/b/c'],
    ['lone slash', '/'],
  ];

  for (const [label, value] of INVALID_VALUES) {
    it(`rejects ${label} with a message naming the value`, () => {
      assert.throws(
        () => parseRepository(value),
        (error) =>
          error.message.includes('owner/repo') && error.message.includes(JSON.stringify(value))
      );
    });
  }
});
