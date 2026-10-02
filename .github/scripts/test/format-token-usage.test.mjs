import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatTokenUsage } from '../lib/format-token-usage.mjs';

describe('formatTokenUsage', () => {
  const CASES = [
    [
      'a full usage object',
      { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
      '  tokens: 120 in / 45 out / 165 total',
    ],
    ['no total reported', { prompt_tokens: 10, completion_tokens: 5 }, '  tokens: 10 in / 5 out'],
    ['an empty object', {}, '  tokens: ? in / ? out'],
    ['undefined', undefined, '  tokens: ? in / ? out'],
    [
      'zero counts (not treated as missing)',
      { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      '  tokens: 0 in / 0 out / 0 total',
    ],
  ];

  for (const [label, usage, expected] of CASES) {
    it(`formats ${label}`, () => assert.equal(formatTokenUsage(usage), expected));
  }
});
