/**
 * @file notion.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname } from './_helpers.mjs';

const notionSrc = readFileSync(join(__dirname, '../../src/js/15-notion.js'), 'utf8');

/**
 * Minimal Fetch Response shim — enough for 15-notion.js to read `ok`, `status`,
 * `json()`, and `text()`. Named `MockResponse` deliberately so it doesn't shadow
 * Node's global `Response`.
 */
class MockResponse {
  /**
   * @param {string|Object} body - Response body. Objects are JSON-stringified.
   * @param {{ status?: number }} [init] - Status defaults to 200.
   */
  constructor(body, init = {}) {
    this._body = typeof body === 'string' ? body : JSON.stringify(body);
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
  }
  async json() {
    return JSON.parse(this._body);
  }
  async text() {
    return this._body;
  }
}

/**
 * Creates a VM sandbox pre-loaded with the browser globals that 15-notion.js
 * expects, evaluates the source, and exposes the registered document-level
 * click handler via `sandbox.__clickHandler` so tests can drive it directly.
 * @param {Object} overrides - Properties merged onto the sandbox before eval.
 * @returns {Object} The populated sandbox, with a `__clickHandler(event)`
 *   method that invokes the click listener 15-notion.js registered on
 *   `document` (null-safe when no listener was captured).
 */
function loadNotionSandbox(overrides = {}) {
  const store = {};
  let capturedClickHandler = null;
  const sandbox = {
    fetch: async () => new MockResponse({}),
    getCat: () => ({ id: 'other', label: 'other', color: '#888780' }),
    planTasks: [],
    savePlan: () => {},
    renderPlan: () => {},
    localStorage: {
      getItem: (key) => store[key] ?? null,
      setItem: (key, value) => {
        store[key] = String(value);
      },
      removeItem: (key) => {
        delete store[key];
      },
    },
    document: {
      addEventListener: (event, handler) => {
        // 15-notion.js registers exactly one document-level click listener
        // (the delegated handler for `.notion-task-btn`). Last-write-wins
        // by design: if a second handler is ever added, this stub silently
        // drops the earlier one, which would surface as missing assertions
        // — bump this capture to an array of handlers in that case.
        if (event === 'click') capturedClickHandler = handler;
      },
    },
    window: {},
    alert: () => {},
    console,
    ...overrides,
  };
  vm.createContext(sandbox);
  vm.runInContext(notionSrc, sandbox);
  sandbox.__clickHandler = (event) => capturedClickHandler && capturedClickHandler(event);
  return sandbox;
}

it('regression #33: removes wl_anthropic_key from localStorage on load', () => {
  const removed = [];
  loadNotionSandbox({
    localStorage: { removeItem: (k) => removed.push(k), getItem: () => null, setItem: () => {} },
  });
  assert.ok(removed.includes('wl_anthropic_key'));
});

describe('addTaskToNotion', () => {
  it('returns the Notion page URL on success', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse({ url: 'https://notion.so/page-1' }),
    });
    const url = await sandbox.addTaskToNotion({ text: 'Write tests', tag: 'dev' });
    assert.equal(url, 'https://notion.so/page-1');
  });

  it('sends the task title and epic label in the request body', async () => {
    let captured;
    const sandbox = loadNotionSandbox({
      getCat: () => ({ id: 'dev', label: 'Development', color: '#000' }),
      fetch: async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return new MockResponse({ url: 'https://notion.so/p' });
      },
    });
    await sandbox.addTaskToNotion({ text: 'My task', tag: 'dev' });
    assert.equal(captured.title, 'My task');
    assert.equal(captured.epic, 'development');
  });

  it('falls back to "other" when task has no tag', async () => {
    let captured;
    const sandbox = loadNotionSandbox({
      getCat: (id) => ({ id, label: id, color: '#000' }),
      fetch: async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return new MockResponse({ url: 'https://notion.so/p' });
      },
    });
    await sandbox.addTaskToNotion({ text: 'Untagged task' });
    assert.equal(captured.epic, 'other');
  });

  it('throws when the API returns a non-OK status', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse({ detail: 'Forbidden' }, { status: 403 }),
    });
    await assert.rejects(
      () => sandbox.addTaskToNotion({ text: 'x', tag: 'a' }),
      (err) => err.message === 'Forbidden'
    );
  });

  it('falls back to data.error when data.detail is absent', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse({ error: 'database not found' }, { status: 404 }),
    });
    await assert.rejects(
      () => sandbox.addTaskToNotion({ text: 'x', tag: 'a' }),
      (err) => err.message === 'database not found'
    );
  });

  it('throws with generic message when error response has no detail', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse('not json', { status: 500 }),
    });
    await assert.rejects(
      () => sandbox.addTaskToNotion({ text: 'x', tag: 'a' }),
      (err) => err.message === 'API 500'
    );
  });

  it('truncates the error detail to 300 characters', async () => {
    const longDetail = 'y'.repeat(500);
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse({ detail: longDetail }, { status: 500 }),
    });
    await assert.rejects(
      () => sandbox.addTaskToNotion({ text: 'x', tag: 'a' }),
      (err) => err.message === 'y'.repeat(300)
    );
  });

  it('throws when the response is OK but contains no URL', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse({ id: '123' }),
    });
    await assert.rejects(
      () => sandbox.addTaskToNotion({ text: 'x', tag: 'a' }),
      (err) => err.message === 'No URL returned from Notion'
    );
  });
});

describe('saveTaskNotionUrl', () => {
  it('persists the URL on the matching plan task', () => {
    const task = { id: 'abc', text: 'Do thing' };
    let planSaved = false;
    let planRendered = false;
    const sandbox = loadNotionSandbox({
      planTasks: [task],
      savePlan: () => {
        planSaved = true;
      },
      renderPlan: () => {
        planRendered = true;
      },
    });
    sandbox.saveTaskNotionUrl('abc', 'https://notion.so/page');
    assert.equal(task.notionUrl, 'https://notion.so/page');
    assert.equal(planSaved, true);
    assert.equal(planRendered, true);
  });

  it('does nothing when the task ID is not found', () => {
    let planSaved = false;
    const sandbox = loadNotionSandbox({
      planTasks: [{ id: 'xyz', text: 'Other' }],
      savePlan: () => {
        planSaved = true;
      },
    });
    sandbox.saveTaskNotionUrl('missing-id', 'https://notion.so/page');
    assert.equal(planSaved, false);
  });

  it('updates only the matching task when multiple tasks exist', () => {
    const tasks = [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ];
    const sandbox = loadNotionSandbox({ planTasks: tasks });
    sandbox.saveTaskNotionUrl('b', 'https://notion.so/b');
    assert.equal(tasks[0].notionUrl, undefined, 'task a should be untouched');
    assert.equal(tasks[1].notionUrl, 'https://notion.so/b');
    assert.equal(tasks[2].notionUrl, undefined, 'task c should be untouched');
  });
});

describe('callClaudeWithNotion', () => {
  it('concatenates text blocks, skips non-text, and trims surrounding whitespace', async () => {
    // Leading + trailing whitespace makes the source's `.trim()` load-bearing:
    // without it the result would be '  Hello World  '.
    const body = {
      content: [
        { type: 'text', text: '  Hello ' },
        { type: 'tool_use', id: 'x' },
        { type: 'text', text: 'World  ' },
      ],
    };
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse(body),
    });
    const result = await sandbox.callClaudeWithNotion('test prompt');
    assert.equal(result, 'Hello World');
  });

  it('sends model and maxTokens overrides in the request body', async () => {
    let captured;
    const sandbox = loadNotionSandbox({
      fetch: async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return new MockResponse({ content: [] });
      },
    });
    await sandbox.callClaudeWithNotion('p', { model: 'claude-opus-4-7', maxTokens: 500 });
    assert.equal(captured.model, 'claude-opus-4-7');
    assert.equal(captured.max_tokens, 500);
  });

  it('uses default model and maxTokens when no overrides given', async () => {
    let captured;
    const sandbox = loadNotionSandbox({
      fetch: async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return new MockResponse({ content: [] });
      },
    });
    await sandbox.callClaudeWithNotion('p');
    // These literals mirror the defaults in src/js/15-notion.js — bump them
    // together when the source default model or token cap changes.
    assert.equal(captured.model, 'claude-sonnet-4-6');
    assert.equal(captured.max_tokens, 1000);
  });

  it('throws when the API returns a non-OK status', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse('Unauthorized', { status: 401 }),
    });
    await assert.rejects(
      () => sandbox.callClaudeWithNotion('p'),
      (err) => err.message.includes('API 401')
    );
  });

  it('includes the error body in the message (short body, no truncation)', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse('Some error detail', { status: 400 }),
    });
    await assert.rejects(
      () => sandbox.callClaudeWithNotion('p'),
      (err) => err.message === 'API 400: Some error detail'
    );
  });

  it('truncates the error body to 200 characters', async () => {
    const longBody = 'x'.repeat(500);
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse(longBody, { status: 500 }),
    });
    await assert.rejects(
      () => sandbox.callClaudeWithNotion('p'),
      (err) => err.message === `API 500: ${'x'.repeat(200)}`
    );
  });

  it('returns empty string when response has no text blocks', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse({ content: [] }),
    });
    const result = await sandbox.callClaudeWithNotion('p');
    assert.equal(result, '');
  });
});

/**
 * Build a synthetic click event whose `target.closest()` returns the given
 * button, mimicking the shape the delegated handler expects.
 * Note: the stub ignores its selector argument because the handler only
 * calls `closest('.notion-task-btn')` once. Add a switch on the selector
 * if a future handler grows a second `closest()` call.
 * @param {Object} btn - Stand-in for the `.notion-task-btn` element.
 * @returns {{ target: { closest: Function }, stopPropagation: Function }}
 */
function eventTargetingButton(btn) {
  return { target: { closest: () => btn }, stopPropagation: () => {} };
}

/**
 * Drain queued microtasks so fire-and-forget promise chains can settle.
 * Pumps several `setImmediate` ticks rather than coupling to a specific
 * depth — the click handler in src/js/15-notion.js currently has a
 * 1–2-await chain, so five ticks gives generous headroom for slower
 * CI runners or a future internal `await`.
 *
 * If a future contributor restructures the click handler to return its
 * promise, switch the tests to `await sandbox.__clickHandler(...)`
 * directly and delete this helper.
 * @returns {Promise<void>}
 */
async function flushPromises() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('Notion button click handler', () => {
  it('opens the existing notionUrl in a new tab without fetching', () => {
    const openCalls = [];
    let fetchCalled = false;
    const sandbox = loadNotionSandbox({
      planTasks: [{ id: 'p1', text: 'Task', notionUrl: 'https://notion.so/page-1' }],
      window: {
        open: (url, target, features) => openCalls.push({ url, target, features }),
      },
      fetch: async () => {
        fetchCalled = true;
        return new MockResponse({});
      },
    });

    const btn = { dataset: { pid: 'p1' }, disabled: false, textContent: '📋' };
    sandbox.__clickHandler(eventTargetingButton(btn));

    assert.equal(openCalls.length, 1);
    assert.equal(openCalls[0].url, 'https://notion.so/page-1');
    assert.equal(openCalls[0].target, '_blank');
    // Pin 'noopener': prevents the opened page from controlling window.opener
    // (tab-jacking / reverse-tabnabbing). Removing it would silently weaken
    // a security boundary, so this assertion guards against drift.
    assert.equal(openCalls[0].features, 'noopener');
    assert.equal(fetchCalled, false);
  });

  it('is a no-op when the click target has no .notion-task-btn ancestor', () => {
    let fetchCalled = false;
    const sandbox = loadNotionSandbox({
      fetch: async () => {
        fetchCalled = true;
        return new MockResponse({});
      },
    });
    sandbox.__clickHandler({ target: { closest: () => null }, stopPropagation: () => {} });
    assert.equal(fetchCalled, false);
  });

  it('is a no-op when the button has no pid in its dataset', () => {
    let fetchCalled = false;
    const sandbox = loadNotionSandbox({
      fetch: async () => {
        fetchCalled = true;
        return new MockResponse({});
      },
    });
    sandbox.__clickHandler(eventTargetingButton({ dataset: {} }));
    assert.equal(fetchCalled, false);
  });

  it('is a no-op when the pid does not match any plan task', () => {
    let fetchCalled = false;
    const sandbox = loadNotionSandbox({
      planTasks: [{ id: 'other-id', text: 'Some other task' }],
      fetch: async () => {
        fetchCalled = true;
        return new MockResponse({});
      },
    });
    const btn = { dataset: { pid: 'unknown-pid' }, disabled: false, textContent: '📋' };
    sandbox.__clickHandler(eventTargetingButton(btn));
    assert.equal(fetchCalled, false);
    assert.equal(btn.disabled, false, 'button must not be disabled when task is missing');
  });

  it('disables the button and persists the URL on a successful add', async () => {
    let savedTaskId, savedUrl;
    const sandbox = loadNotionSandbox({
      planTasks: [{ id: 'p2', text: 'New task' }],
    });
    // Override VM-context globals: properties assigned on the sandbox after
    // vm.runInContext are visible to closures created inside the script
    // (including the captured click handler), so this replaces the real
    // function with a stub for this test.
    sandbox.addTaskToNotion = async () => 'https://notion.so/new-page';
    sandbox.saveTaskNotionUrl = (taskId, url) => {
      savedTaskId = taskId;
      savedUrl = url;
    };

    const btn = { dataset: { pid: 'p2' }, disabled: false, textContent: '📋' };
    sandbox.__clickHandler(eventTargetingButton(btn));
    assert.equal(btn.disabled, true, 'button disabled synchronously before fetch resolves');
    await flushPromises();

    assert.equal(savedTaskId, 'p2');
    assert.equal(savedUrl, 'https://notion.so/new-page');
    // Source leaves the button in its loading state on success — renderPlan
    // is expected to redraw it via saveTaskNotionUrl. Guard against a future
    // refactor that prematurely re-enables the button here.
    assert.equal(btn.disabled, true);
    assert.equal(btn.textContent, '…');
  });

  it('restores the button and alerts when addTaskToNotion resolves to a non-HTTP URL', async () => {
    const alerts = [];
    const sandbox = loadNotionSandbox({
      planTasks: [{ id: 'p4', text: 'Weird URL task' }],
      alert: (message) => alerts.push(message),
    });
    sandbox.addTaskToNotion = async () => '/relative-path';

    const btn = { dataset: { pid: 'p4' }, disabled: false, textContent: '📋' };
    sandbox.__clickHandler(eventTargetingButton(btn));
    await flushPromises();

    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, '📋');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /Notion responded but no URL: \/relative-path/);
  });

  it('restores the button and alerts when addTaskToNotion rejects', async () => {
    const alerts = [];
    const sandbox = loadNotionSandbox({
      planTasks: [{ id: 'p3', text: 'Failing task' }],
      alert: (message) => alerts.push(message),
    });
    sandbox.addTaskToNotion = async () => {
      throw new Error('API down');
    };

    const btn = { dataset: { pid: 'p3' }, disabled: false, textContent: '📋' };
    sandbox.__clickHandler(eventTargetingButton(btn));
    await flushPromises();

    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, '📋');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /Failed to add to Notion: API down/);
  });
});
