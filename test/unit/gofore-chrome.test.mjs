/**
 * @file gofore-chrome.test.mjs
 * Tests for the Claude-in-Chrome-first, Playwright-fallback submission logic.
 * No real CLI or browser is launched; the child process is faked.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  buildChromePrompt,
  parseChromeResult,
  runClaudeInChrome,
  submitWithFallback,
  RESULT_PREFIX,
} from '../../scripts/lib/gofore-chrome.mjs';

const payload = { date: '2026-09-30', hours: 7.5, description: 'work (X-1)' };

/**
 * Fake child process that emits the given events after stdin is closed.
 * @param {{stdout?: string, stderr?: string, code?: number, signal?: string, error?: Error}} script
 * @returns {{spawnImpl: Function, calls: Array, stdinText: function(): string}} Fake spawn.
 */
function fakeSpawn(script) {
  const calls = [];
  let written = '';
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      end: (text) => {
        written = text;
        setImmediate(() => {
          if (script.error) return child.emit('error', script.error);
          if (script.stdout) child.stdout.emit('data', script.stdout);
          if (script.stderr) child.stderr.emit('data', script.stderr);
          child.emit('close', script.code ?? 0, script.signal ?? null);
        });
      },
    };
    return child;
  };
  return { spawnImpl, calls, stdinText: () => written };
}

describe('buildChromePrompt', () => {
  it('embeds the entry as JSON and marks page content as untrusted', () => {
    const prompt = buildChromePrompt(payload, 'https://timesheet.gofore.com');
    assert.ok(prompt.includes(JSON.stringify(payload)));
    assert.match(prompt, /untrusted/);
    assert.ok(prompt.includes(`${RESULT_PREFIX} SAVED`));
  });
});

describe('parseChromeResult', () => {
  for (const [name, output, status] of [
    ['saved', `done\n${RESULT_PREFIX} SAVED\n`, 'saved'],
    ['login required', `${RESULT_PREFIX} LOGIN_REQUIRED`, 'login_required'],
    ['failed with reason', `${RESULT_PREFIX} FAILED form not found`, 'failed'],
    ['no sentinel at all', 'I think it worked!', 'failed'],
  ]) {
    it(`reads ${name}`, () => assert.equal(parseChromeResult(output).status, status));
  }

  it('uses the last result line and keeps the failure reason', () => {
    const result = parseChromeResult(`${RESULT_PREFIX} SAVED\n${RESULT_PREFIX} FAILED boom`);
    assert.deepEqual(result, { status: 'failed', detail: 'boom' });
  });
});

describe('runClaudeInChrome', () => {
  it('passes the prompt over stdin, never in argv, and returns stdout', async () => {
    const fake = fakeSpawn({ stdout: 'ok' });
    const out = await runClaudeInChrome('SECRET PROMPT', { spawnImpl: fake.spawnImpl });
    assert.equal(out, 'ok');
    assert.equal(fake.stdinText(), 'SECRET PROMPT');
    assert.deepEqual(fake.calls[0].args, [
      '--chrome',
      '-p',
      '--allowedTools',
      'mcp__claude-in-chrome__*',
    ]);
  });

  for (const [name, script, message] of [
    ['a missing CLI', { error: new Error('ENOENT') }, /could not start claude CLI: ENOENT/],
    ['a non-zero exit', { code: 1, stderr: 'no chrome' }, /exited 1: no chrome/],
    ['a timeout kill', { signal: 'SIGTERM' }, /SIGTERM/],
  ]) {
    it(`rejects on ${name}`, async () => {
      await assert.rejects(
        runClaudeInChrome('p', { spawnImpl: fakeSpawn(script).spawnImpl }),
        message
      );
    });
  }
});

describe('submitWithFallback', () => {
  /**
   * Runs the orchestrator with stubbed steps.
   * @param {function(): Promise<Object>} viaChrome - Chrome step.
   * @returns {Promise<{route: string, logs: string[], playwrightRuns: number}>} Outcome.
   */
  async function run(viaChrome) {
    const logs = [];
    let playwrightRuns = 0;
    const route = await submitWithFallback({
      viaChrome,
      viaPlaywright: async () => playwrightRuns++,
      log: (message) => logs.push(message),
    });
    return { route, logs, playwrightRuns };
  }

  it('uses Chrome and skips Playwright when Chrome saves', async () => {
    const result = await run(async () => ({ status: 'saved', detail: '' }));
    assert.deepEqual([result.route, result.playwrightRuns], ['chrome', 0]);
  });

  it('falls back and logs why when Chrome reports a failure', async () => {
    const result = await run(async () => ({ status: 'login_required', detail: 'x' }));
    assert.deepEqual([result.route, result.playwrightRuns], ['playwright', 1]);
    assert.match(result.logs[0], /login_required/);
  });

  it('falls back and logs why when Chrome throws', async () => {
    const result = await run(async () => {
      throw new Error('extension not connected');
    });
    assert.equal(result.route, 'playwright');
    assert.match(result.logs[0], /extension not connected/);
  });

  it('propagates a Playwright failure after the fallback', async () => {
    await assert.rejects(
      submitWithFallback({
        viaChrome: async () => ({ status: 'failed', detail: '' }),
        viaPlaywright: async () => {
          throw new Error('session expired');
        },
        log: () => {},
      }),
      /session expired/
    );
  });
});
