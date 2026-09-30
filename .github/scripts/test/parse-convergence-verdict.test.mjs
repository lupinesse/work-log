import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractVerdictLine, isBlockingVerdict } from '../lib/parse-convergence-verdict.mjs';

// ---------------------------------------------------------------------------
// extractVerdictLine
// ---------------------------------------------------------------------------

describe('extractVerdictLine', () => {
  it('extracts a blocking verdict sentence', () => {
    const body = '## Verdict\nBlocked on 2 agreed fixes.\n\n---\n*by Claude*';
    assert.equal(extractVerdictLine(body), 'Blocked on 2 agreed fixes.');
  });

  it('extracts a clean (non-blocking) verdict', () => {
    const body = '## Verdict\nClean — no blocking issues.\n\n---';
    assert.equal(extractVerdictLine(body), 'Clean — no blocking issues.');
  });

  it('extracts a mixed verdict (fixes + counter-positions)', () => {
    const body = '## Verdict\nBlocked on 1 agreed fix; 1 counter-position on record for Phase 4.';
    assert.equal(
      extractVerdictLine(body),
      'Blocked on 1 agreed fix; 1 counter-position on record for Phase 4.'
    );
  });

  it('handles extra blank lines between heading and sentence', () => {
    const body = '## Verdict\n\n\nClean — no blocking issues.';
    assert.equal(extractVerdictLine(body), 'Clean — no blocking issues.');
  });

  it('handles the heading with trailing spaces', () => {
    const body = '## Verdict   \nBlocked on 3 agreed fixes.';
    assert.equal(extractVerdictLine(body), 'Blocked on 3 agreed fixes.');
  });

  it('trims leading/trailing whitespace from the sentence', () => {
    const body = '## Verdict\n  Clean — no blocking issues.  \n';
    assert.equal(extractVerdictLine(body), 'Clean — no blocking issues.');
  });

  it('returns null when there is no ## Verdict section', () => {
    const body =
      '## Agreed — will fix in this PR\n- file:1 — something\n\n## Independent gaps\nNone.';
    assert.equal(extractVerdictLine(body), null);
  });

  it('returns null when ## Verdict heading has no following sentence', () => {
    const body = '## Verdict\n';
    assert.equal(extractVerdictLine(body), null);
  });

  it('returns null for an empty string', () => {
    assert.equal(extractVerdictLine(''), null);
  });

  it('returns null for a non-string input', () => {
    assert.equal(extractVerdictLine(null), null);
    assert.equal(extractVerdictLine(undefined), null);
  });

  it('finds the heading inside a full realistic comment body', () => {
    const body = [
      '<!-- claude-pr-review-comment -->',
      '',
      '## Agreed — will fix in this PR',
      '- src/js/04-render.js:42 — missing null check; will add guard.',
      '',
      "## Claude's counter-positions",
      '- src/js/01-state.js:55 — intentional mutable ref; not a bug.',
      '',
      '## Independent gaps',
      'No independent gaps found.',
      '',
      '## Verdict',
      'Blocked on 1 agreed fix.',
      '',
      '---',
      '*Convergence summary by Claude `claude-haiku-4-5` · commit `abc1234`*',
    ].join('\n');
    assert.equal(extractVerdictLine(body), 'Blocked on 1 agreed fix.');
  });
});

// ---------------------------------------------------------------------------
// isBlockingVerdict
// ---------------------------------------------------------------------------

describe('isBlockingVerdict', () => {
  it('returns true for a verdict starting with "Blocked"', () => {
    assert.equal(isBlockingVerdict('Blocked on 2 agreed fixes.'), true);
  });

  it('returns true for the mixed blocking form', () => {
    assert.equal(
      isBlockingVerdict('Blocked on 1 agreed fix; 1 counter-position on record for Phase 4.'),
      true
    );
  });

  it('returns false for a clean verdict', () => {
    assert.equal(isBlockingVerdict('Clean — no blocking issues.'), false);
  });

  it('returns false for null (no verdict found)', () => {
    assert.equal(isBlockingVerdict(null), false);
  });

  it('returns false for undefined', () => {
    assert.equal(isBlockingVerdict(undefined), false);
  });

  it('returns false for an empty string', () => {
    assert.equal(isBlockingVerdict(''), false);
  });

  it('is case-sensitive — lowercase "blocked" is not treated as blocking', () => {
    // The system prompt produces "Blocked" with a capital B; a lower-case
    // variant is not a recognised verdict and must not trip the gate.
    assert.equal(isBlockingVerdict('blocked on 1 fix.'), false);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: extract then classify
// ---------------------------------------------------------------------------

describe('extract + classify round-trip', () => {
  it('returns blocking=true for a full comment with a blocking verdict', () => {
    const body =
      '<!-- claude-pr-review-comment -->\n\n## Verdict\nBlocked on 1 agreed fix.\n\n---\n';
    assert.equal(isBlockingVerdict(extractVerdictLine(body)), true);
  });

  it('returns blocking=false for a full comment with a clean verdict', () => {
    const body =
      '<!-- claude-pr-review-comment -->\n\n## Verdict\nClean — no blocking issues.\n\n---\n';
    assert.equal(isBlockingVerdict(extractVerdictLine(body)), false);
  });

  it('returns blocking=false when there is no verdict section', () => {
    const body = '<!-- claude-pr-review-comment -->\n\nSome other content.\n';
    assert.equal(isBlockingVerdict(extractVerdictLine(body)), false);
  });
});
