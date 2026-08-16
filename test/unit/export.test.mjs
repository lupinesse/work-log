/**
 * @file export.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname, loadPureFnsScriptSource } from './_helpers.mjs';

const exportSrc = readFileSync(join(__dirname, '../../src/js/05a-export.js'), 'utf8');

const pureFnsSrc = loadPureFnsScriptSource();

describe('regression #224: readOptionalLogForBackup passes err to wlLog.warn', () => {
  function makeExportSandbox(overrides = {}) {
    const warned = [];
    const sb = {
      wlLog: {
        warn: (...args) => warned.push(args),
        info: () => {},
        error: () => {},
        debug: () => {},
        config: () => {},
      },
      localStorage: { getItem: () => 'not-valid-json', setItem: () => {}, removeItem: () => {} },
      document: { getElementById: () => null, addEventListener: () => {} },
      window: { showSaveFilePicker: undefined },
      entries: [],
      planTasks: [],
      categories: [],
      blocks: [],
      activeTimer: null,
      viewDate: new Date(),
      getDayStart: () => null,
      viewEntries: () => [],
      getCat: () => ({ label: 'other', color: '#888780', billable: true }),
      fmtDurLong: () => '0h',
      dk: (d) => d.toISOString().slice(0, 10),
      ...overrides,
      _warned: warned,
    };
    vm.createContext(sb);
    vm.runInContext(pureFnsSrc + '\n' + exportSrc, sb);
    return sb;
  }

  it('calls wlLog.warn with the caught Error, not undefined', () => {
    const sb = makeExportSandbox();
    // readOptionalLogForBackup is private; trigger it via exportBackup which calls it
    // for pomoLog, devLog, and distractions. A corrupt getItem value causes a parse error.
    // The warning args should include an actual Error, not undefined.
    vm.runInContext(
      `
      try { readOptionalLogForBackup('test_key', 'testLabel'); } catch(_) {}
      `,
      sb
    );
    assert.ok(sb._warned.length > 0, 'wlLog.warn should have been called');
    const warnArgs = sb._warned[0];
    // Before the fix: warnArgs[1] was undefined (bare `e` in catch body)
    // After the fix:  warnArgs[1] is the SyntaxError from JSON.parse
    assert.ok(warnArgs[1] !== undefined, 'second wlLog.warn arg must not be undefined');
    // JSON.parse throws a SyntaxError in the VM context; use constructor.name for cross-context check
    assert.equal(warnArgs[1].constructor.name, 'SyntaxError');
  });

  it('returns [] when localStorage contains invalid JSON', () => {
    const sb = makeExportSandbox();
    vm.runInContext('results = readOptionalLogForBackup("k", "label");', sb);
    // Cross-context deepEqual on [] fails; check length instead
    assert.equal(sb.results.length, 0);
  });
});
