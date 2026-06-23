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
import {
  addReactionToComment,
  postInlineComment,
  resolveThread,
  fetchAllIssueComments,
  formatThreadsForPrompt,
  upsertIssueComment,
} from '../lib/github-threads.mjs';

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

// ─────────────────────────── addReactionToComment ───────────────────────────

describe('addReactionToComment', () => {
  const params = { token: 'tok-123', owner: 'acme', repo: 'app', commentId: 77, content: 'eyes' };

  test('POSTs to the correct reactions URL with the given content', async (t) => {
    const payload = { id: 1, content: 'eyes' };
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => makeResponse(payload, 201));

    const result = await addReactionToComment(params);

    assert.strictEqual(fetchMock.mock.calls.length, 1);
    const [url, opts] = fetchMock.mock.calls[0].arguments;
    assert.strictEqual(url, 'https://api.github.com/repos/acme/app/pulls/comments/77/reactions');
    assert.strictEqual(opts.method, 'POST');
    assert.deepStrictEqual(JSON.parse(opts.body), { content: 'eyes' });
    assert.deepStrictEqual(result, payload);
  });

  test('resolves successfully when the API returns 200 (reaction already exists)', async (t) => {
    // GitHub returns 200 (not 201) when the reaction already exists for this user.
    // The function must treat it as success — idempotent re-use across workflow re-runs.
    const payload = { id: 1, content: 'eyes' };
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => makeResponse(payload, 200));

    const result = await addReactionToComment(params);

    assert.strictEqual(fetchMock.mock.calls.length, 1);
    assert.deepStrictEqual(result, payload);
  });

  test('throws when the API returns a non-ok status', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => makeResponse('Not Found', 404));

    await assert.rejects(addReactionToComment(params), (err) => {
      assert.ok(err.message.includes('404'), `expected 404 in: ${err.message}`);
      return true;
    });
  });
});

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

// ─────────────────────────── postInlineComment ───────────────────────────

describe('postInlineComment', () => {
  const params = {
    token: 'tok-123',
    owner: 'acme',
    repo: 'app',
    prNumber: 42,
    headSha: 'abc1234',
    path: 'src/index.js',
    line: 10,
    body: 'A test comment.',
  };

  test('sends the correct URL, method, and body', async (t) => {
    const payload = { id: 1, html_url: 'https://github.com/acme/app/pull/42#discussion_r1' };
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => makeResponse(payload));

    const result = await postInlineComment(params);

    assert.strictEqual(fetchMock.mock.calls.length, 1);
    const [url, opts] = fetchMock.mock.calls[0].arguments;
    assert.strictEqual(url, 'https://api.github.com/repos/acme/app/pulls/42/comments');
    assert.strictEqual(opts.method, 'POST');

    const sent = JSON.parse(opts.body);
    assert.strictEqual(sent.commit_id, 'abc1234');
    assert.strictEqual(sent.path, 'src/index.js');
    assert.strictEqual(sent.line, 10);
    assert.strictEqual(sent.side, 'RIGHT');
    assert.strictEqual(sent.body, 'A test comment.');
    assert.deepStrictEqual(result, payload);
  });

  test('includes X-GitHub-Api-Version: 2022-11-28 in the request headers', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
      makeResponse({ id: 1, html_url: 'https://github.com/' })
    );

    await postInlineComment(params);

    const [, opts] = fetchMock.mock.calls[0].arguments;
    assert.strictEqual(
      opts.headers['X-GitHub-Api-Version'],
      '2022-11-28',
      'X-GitHub-Api-Version header must be present'
    );
  });

  test('throws when the API returns a non-ok status', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => makeResponse('Unprocessable Entity', 422));

    await assert.rejects(postInlineComment(params), (err) => {
      assert.ok(err.message.includes('422'), `expected 422 in: ${err.message}`);
      return true;
    });
  });
});

// ─────────────────────────── formatThreadsForPrompt ───────────────────────────

describe('formatThreadsForPrompt', () => {
  const openThread = {
    id: 'T_1',
    isResolved: false,
    firstCommentId: 1,
    author: 'chatgpt-reviewer',
    path: 'src/js/foo.js',
    line: 42,
    body: '🔴 Blocking finding here.',
    replies: [],
  };
  const resolvedThread = {
    id: 'T_2',
    isResolved: true,
    firstCommentId: 2,
    author: 'chatgpt-reviewer',
    path: 'src/js/bar.js',
    line: 10,
    body: 'Small issue.',
    replies: [{ author: 'claude-reviewer', body: '✅ Will fix by renaming.' }],
  };

  test('renders the correct header for an open thread', () => {
    const output = formatThreadsForPrompt([openThread]);
    assert.ok(output.includes('src/js/foo.js:42'), 'should include path:line');
    assert.ok(output.includes('open'), 'should show open state');
    assert.ok(output.includes('chatgpt-reviewer'), 'should show author');
  });

  test('renders the correct header for a resolved thread', () => {
    const output = formatThreadsForPrompt([resolvedThread]);
    assert.ok(output.includes('resolved'), 'should show resolved state');
  });

  test('truncates reply bodies at 400 characters', () => {
    const longBody = 'x'.repeat(500);
    const thread = {
      ...openThread,
      replies: [{ author: 'claude-reviewer', body: longBody }],
    };
    const output = formatThreadsForPrompt([thread]);
    assert.ok(!output.includes('x'.repeat(401)), 'reply body should be truncated to 400 chars');
    assert.ok(output.includes('x'.repeat(400)), 'first 400 chars of reply should appear');
  });

  test('returns a placeholder when the thread list is empty', () => {
    const output = formatThreadsForPrompt([]);
    assert.ok(output.includes('no existing'), 'should note empty thread list');
  });

  test('separates multiple threads with a horizontal rule', () => {
    const output = formatThreadsForPrompt([openThread, resolvedThread]);
    assert.ok(output.includes('---'), 'should separate threads with ---');
  });
});

// ─────────────────────────── upsertIssueComment ───────────────────────────

describe('upsertIssueComment', () => {
  const ctx = { token: 'tok', owner: 'acme', repo: 'app', prNumber: 7 };
  const MARKER = '<!-- my-marker -->';

  test('PATCHes an existing comment when the marker is found', async (t) => {
    const existing = [{ id: 42, body: `${MARKER}\nOld content` }];
    const patched = { id: 42, body: `${MARKER}\nNew content`, html_url: 'https://gh/' };

    t.mock.method(globalThis, 'fetch', async (url, opts) => {
      if (opts?.method === 'GET' || !opts?.method) {
        return makeResponse(existing);
      }
      return makeResponse(patched);
    });

    const result = await upsertIssueComment({
      ...ctx,
      marker: MARKER,
      body: `${MARKER}\nNew content`,
    });

    assert.strictEqual(result.updated, true);
    assert.deepStrictEqual(result.comment, patched);
  });

  test('POSTs a new comment when no marker match is found', async (t) => {
    const existing = [{ id: 1, body: 'unrelated comment' }];
    const created = { id: 99, body: `${MARKER}\nFirst post`, html_url: 'https://gh/' };

    t.mock.method(globalThis, 'fetch', async (url, opts) => {
      if (opts?.method === 'POST') return makeResponse(created, 201);
      return makeResponse(existing);
    });

    const result = await upsertIssueComment({
      ...ctx,
      marker: MARKER,
      body: `${MARKER}\nFirst post`,
    });

    assert.strictEqual(result.updated, false);
    assert.deepStrictEqual(result.comment, created);
  });
});
