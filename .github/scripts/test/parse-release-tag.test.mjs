import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseReleaseTag } from '../lib/parse-release-tag.mjs';

describe('parseReleaseTag', () => {
  const VALID = [
    ['v1.9.2', '1.9.2'],
    ['v10.0.0', '10.0.0'],
    ['v1.9.2-rc.1', '1.9.2-rc.1'],
    ['v1.9.2+build.5', '1.9.2+build.5'],
  ];
  for (const [tag, version] of VALID) {
    it(`accepts ${tag} and returns ${version}`, () => assert.equal(parseReleaseTag(tag), version));
  }

  const INVALID = [
    ['no leading v (regression, #530)', '1.9.2'],
    ['a branch name', 'main'],
    ['two-part version', 'v1.9'],
    ['empty string', ''],
    ['uppercase V', 'V1.9.2'],
    ['trailing text', 'v1.9.2 final'],
    ['a path-like value', 'refs/tags/v1.9.2'],
  ];
  for (const [label, tag] of INVALID) {
    it(`rejects ${label}`, () => {
      assert.throws(
        () => parseReleaseTag(tag),
        (error) => error.message.includes('v1.2.3') && error.message.includes(JSON.stringify(tag))
      );
    });
  }
});
