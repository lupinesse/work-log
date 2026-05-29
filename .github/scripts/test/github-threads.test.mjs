/**
 * Unit tests for the GitHub API helpers in lib/github-threads.mjs.
 *
 * Covers: resolveThread and fetchAllIssueComments.
 * Each test stubs globalThis.fetch with a t.mock.method() scope — the
 * stub is automatically restored after the test completes.
 *
 * Run: node --test .github/scripts/test/github-threads.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveThread, fetchAllIssueComments } from '../lib/github-threads.mjs';

// ─────────────────────────── helpers ───────────────────────────

/**
 * Build a minimal fetch-Response substitute with ok, status, text(), json().
 *
 * @param {*}      body    Value returned by json(); stringified for text().
 * @param {number} status  HTTP status code (default 200).
 * @returns {object}
 */
function makeResponse(body, status = 200) {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => bodyText,
    json: async () => body,
  };
}

// ─────────────────────────── resolveThread ───────────────────────────

describe('resolveThread', () => {
  test('posts the resolveReviewThread GraphQL mutation on success', async (t) => {
    const payload = {
      data: { resolveReviewThread: { thread: { id: 'T_ABC', isResolved: true } } },
    };
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => makeResponse(payload));

    await assert.doesNotReject(resolveThread({ token: 'tok-123', threadId: 'T_ABC' }));

    assert.strictEqual(fetchMock.mock.calls.length, 1);
    const [url, opts] = fetchMock.mock.calls[0].arguments;
    assert.strictEqual(url, 'https://api.github.com/graphql');
    assert.strictEqual(opts.method, 'POST');

    const sent = JSON.parse(opts.body);
    assert.ok(sent.query.includes('resolveReviewThread'), 'mutation name should be in query');
    assert.deepStrictEqual(sent.variables, { id: 'T_ABC' });
  });

  test('throws when the HTTP response is not ok', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => makeResponse('Internal Server Error', 500));

    await assert.rejects(resolveThread({ token: 'tok', threadId: 'T_ERR' }), (err) => {
      assert.ok(err.message.includes('500'), `expected 500 in: ${err.message}`);
      return true;
    });
  });

  test('throws when the GraphQL response body contains an errors array', async (t) => {
    const payload = { errors: [{ message: 'Thread not found' }] };
    t.mock.method(globalThis, 'fetch', async () => makeResponse(payload));

    await assert.rejects(resolveThread({ token: 'tok', threadId: 'T_404' }), /GraphQL/);
  });
});

// ─────────────────────────── fetchAllIssueComments ───────────────────────────

describe('fetchAllIssueComments', () => {
  const ctx = { token: 'tok', owner: 'acme', repo: 'app', prNumber: 42 };

  test('returns all items when the first page has fewer than 100 entries', async (t) => {
    const comments = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, body: `comment ${i + 1}` }));
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => makeResponse(comments));

    const result = await fetchAllIssueComments(ctx);

    assert.strictEqual(fetchMock.mock.calls.length, 1);
    assert.strictEqual(result.length, 7);
    assert.deepStrictEqual(result, comments);
  });

  test('requests a second page when the first page returns exactly 100 entries', async (t) => {
    let callCount = 0;
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const page2 = [{ id: 101, body: 'last comment' }];

    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      callCount++;
      return makeResponse(callCount === 1 ? page1 : page2);
    });

    const result = await fetchAllIssueComments(ctx);

    assert.strictEqual(fetchMock.mock.calls.length, 2, 'should fetch exactly 2 pages');
    assert.strictEqual(result.length, 101);
    assert.deepStrictEqual(result[100], page2[0]);

    // Confirm page numbers in the URLs
    const url1 = new URL(fetchMock.mock.calls[0].arguments[0]);
    const url2 = new URL(fetchMock.mock.calls[1].arguments[0]);
    assert.strictEqual(url1.searchParams.get('page'), '1');
    assert.strictEqual(url2.searchParams.get('page'), '2');
  });

  test('throws after MAX_PAGES (200) consecutive full pages to prevent runaway pagination', async (t) => {
    // Return 100 items on every page indefinitely — the safety limit should
    // trigger after 200 pages with a descriptive error.
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => makeResponse(fullPage));

    await assert.rejects(fetchAllIssueComments(ctx), (err) => {
      assert.ok(err.message.includes('page limit'), `expected "page limit" in: ${err.message}`);
      assert.ok(err.message.includes('200'), `expected page count in: ${err.message}`);
      return true;
    });

    assert.strictEqual(fetchMock.mock.calls.length, 200, 'should stop exactly at the page limit');
  });

  test('throws when the API returns a non-ok status', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => makeResponse('Unauthorized', 401));

    await assert.rejects(fetchAllIssueComments(ctx), (err) => {
      assert.ok(err.message.includes('401'), `expected 401 in: ${err.message}`);
      return true;
    });
  });
});
