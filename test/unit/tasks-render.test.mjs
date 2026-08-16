/**
 * @file tasks-render.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dk } from '../../src/js/pure-fns.js';
import { __dirname, loadPureFnsScriptSource } from './_helpers.mjs';

/**
 * Loads pure-fns, 02-utils.js, and 10a-tasks-render.js into one VM sandbox
 * with a minimal fake `#planTrackRecent` container, exposing
 * renderTrackRecent() for direct testing.
 * @param {Object} [overrides] - Properties merged into the sandbox before eval.
 * @returns {{ sandbox: Object, container: Object }}
 */
function loadTrackRecentSandbox(overrides = {}) {
  const pureSrc = loadPureFnsScriptSource();
  const utilsSrc = readFileSync(join(__dirname, '../../src/js/02-utils.js'), 'utf8');
  const tasksRenderSrc = readFileSync(join(__dirname, '../../src/js/10a-tasks-render.js'), 'utf8');

  const container = {
    style: {},
    innerHTML: '',
    querySelectorAll: () => [],
  };

  const sandbox = {
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    document: { getElementById: (id) => (id === 'planTrackRecent' ? container : null) },
    categories: [{ id: 'work', label: 'Work', color: '#378ADD' }],
    entries: [],
    activeTimer: null,
    ...overrides,
  };

  vm.createContext(sandbox);
  vm.runInContext(pureSrc, sandbox);
  vm.runInContext(utilsSrc, sandbox);
  vm.runInContext(tasksRenderSrc, sandbox);
  return { sandbox, container };
}

describe('renderTrackRecent — colour sanitisation', () => {
  // dk() (imported at the top of this file, same as the sandboxed copy
  // renderTrackRecent() calls internally) keys by local date components, not
  // UTC — must match here or this flakes near midnight in any timezone
  // behind/ahead of UTC.
  const todayKey = () => dk(new Date());

  it('never lets a malicious category colour reach the chip dot', () => {
    const { sandbox, container } = loadTrackRecentSandbox({
      categories: [{ id: 'work', label: 'Work', color: '"><script>alert(1)</script>' }],
      entries: [{ id: 'e1', date: todayKey(), text: 'Standup', tag: 'work' }],
    });
    sandbox.renderTrackRecent();
    assert.ok(container.innerHTML.includes('background:#888780'));
    assert.ok(!container.innerHTML.includes('<script>'));
  });

  it('renders a legitimate hex colour through unchanged', () => {
    const { sandbox, container } = loadTrackRecentSandbox({
      categories: [{ id: 'work', label: 'Work', color: '#4a90e2' }],
      entries: [{ id: 'e1', date: todayKey(), text: 'Standup', tag: 'work' }],
    });
    sandbox.renderTrackRecent();
    assert.ok(container.innerHTML.includes('background:#4a90e2'));
  });
});
