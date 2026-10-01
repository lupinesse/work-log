/**
 * Regression tests for #514: chatgpt-pr-review.yml must recognise the review
 * bot by exact login, not by a "chatgpt" substring.
 *
 * The checks live in inline actions/github-script blocks, so the tests pull the
 * real script text out of the workflow and run it against fake API data —
 * a source-only assertion would pass even if the logic were wrong.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const workflowPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'workflows',
  'chatgpt-pr-review.yml'
);
const source = readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');

const BOT_REST_LOGIN = 'chatgpt-reviewer-work-log[bot]';
const BOT_GRAPHQL_LOGIN = 'chatgpt-reviewer-work-log';
const SCRIPT_INDENT = 12;

/**
 * Returns the body of the github-script block that follows the given step name.
 * @param {string} stepName - The `- name:` of the step to extract from.
 * @returns {string} The script text with YAML indentation removed.
 */
function scriptAfter(stepName) {
  const stepStart = source.indexOf(`- name: ${stepName}`);
  assert.notEqual(stepStart, -1, `step "${stepName}" not found`);
  const marker = 'script: |\n';
  const bodyStart = source.indexOf(marker, stepStart) + marker.length;
  const lines = [];
  for (const line of source.slice(bodyStart).split('\n')) {
    if (line !== '' && !line.startsWith(' '.repeat(SCRIPT_INDENT))) break;
    lines.push(line.slice(SCRIPT_INDENT));
  }
  return lines.join('\n');
}

/**
 * Runs a github-script body with fake `github`, `context`, and `core`.
 * @param {string} body - Script text from {@link scriptAfter}.
 * @param {{github: object, context: object, env: string|undefined}} fakes
 * @returns {Promise<{outputs: object, failures: string[]}>} What the script set.
 */
async function runScript(body, { github, context, env }) {
  const outputs = {};
  const failures = [];
  const core = {
    info: () => {},
    setOutput: (name, value) => {
      outputs[name] = value;
    },
    setFailed: (message) => failures.push(message),
  };
  const originalEnv = process.env.CHATGPT_REVIEW_BOT_LOGIN;
  if (env === undefined) delete process.env.CHATGPT_REVIEW_BOT_LOGIN;
  else process.env.CHATGPT_REVIEW_BOT_LOGIN = env;
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  try {
    await new AsyncFunction('github', 'context', 'core', body)(github, context, core);
  } finally {
    if (originalEnv === undefined) delete process.env.CHATGPT_REVIEW_BOT_LOGIN;
    else process.env.CHATGPT_REVIEW_BOT_LOGIN = originalEnv;
  }
  return { outputs, failures };
}

/**
 * Fake octokit for the synchronize path. `sizeCheckReached` flips to true when
 * the script gets past the "already reviewed" guard and lists the PR's files.
 * @param {{commentLogins: string[], reviewLogins: string[]}} logins
 * @returns {{github: object, state: {sizeCheckReached: boolean}}}
 */
function fakeSynchronizeGithub({ commentLogins, reviewLogins }) {
  const listComments = () => {};
  const listReviews = () => {};
  const listFiles = () => {};
  const state = { sizeCheckReached: false };
  const asUsers = (logins) => logins.map((login) => ({ user: { login } }));
  const github = {
    rest: { issues: { listComments }, pulls: { listReviews, listFiles } },
    paginate: async (endpoint) => {
      if (endpoint === listComments) return asUsers(commentLogins);
      if (endpoint === listReviews) return asUsers(reviewLogins);
      state.sizeCheckReached = true;
      return [];
    },
  };
  return { github, state };
}

const synchronizeContext = {
  repo: { owner: 'o', repo: 'r' },
  payload: { action: 'synchronize', pull_request: { number: 1 } },
};

describe('chatgpt-pr-review.yml — bot identity (#514)', () => {
  test('no substring match on "chatgpt" remains', () => {
    assert.doesNotMatch(source, /\.includes\(\s*['"]chatgpt['"]\s*\)/);
  });

  test('the bot login is defined exactly once, at workflow level', () => {
    const definitions = source.match(/^\s*CHATGPT_REVIEW_BOT_LOGIN:/gm) ?? [];
    assert.equal(definitions.length, 1);
    assert.ok(source.indexOf('CHATGPT_REVIEW_BOT_LOGIN:') < source.indexOf('jobs:'));
    assert.ok(source.includes(`CHATGPT_REVIEW_BOT_LOGIN: '${BOT_REST_LOGIN}'`));
  });

  describe('synchronize "already reviewed" guard', () => {
    const body = scriptAfter('Decide whether to run');
    const run = (logins) => {
      const { github, state } = fakeSynchronizeGithub(logins);
      return runScript(body, { github, context: synchronizeContext, env: BOT_REST_LOGIN }).then(
        ({ outputs }) => ({ outputs, state })
      );
    };

    test('a prior bot comment skips the re-run before the size check', async () => {
      const { outputs, state } = await run({ commentLogins: [BOT_REST_LOGIN], reviewLogins: [] });
      assert.equal(outputs.should_run, 'false');
      assert.equal(state.sizeCheckReached, false);
    });

    test('a prior bot review skips the re-run before the size check', async () => {
      const { outputs, state } = await run({ commentLogins: [], reviewLogins: [BOT_REST_LOGIN] });
      assert.equal(outputs.should_run, 'false');
      assert.equal(state.sizeCheckReached, false);
    });

    for (const login of ['chatgpt-fan', 'my-chatgpt', 'ChatGPT-Helper[bot]']) {
      test(`"${login}" is not the bot, so the guard does not trigger`, async () => {
        const { state } = await run({ commentLogins: [login], reviewLogins: [login] });
        assert.equal(state.sizeCheckReached, true);
      });
    }

    test('a missing CHATGPT_REVIEW_BOT_LOGIN fails loudly', async () => {
      const { github } = fakeSynchronizeGithub({ commentLogins: [], reviewLogins: [] });
      await assert.rejects(
        runScript(body, { github, context: synchronizeContext, env: undefined }),
        /CHATGPT_REVIEW_BOT_LOGIN is not set/
      );
    });
  });

  describe('merge-gate unresolved-thread check', () => {
    const body = scriptAfter('Check for unresolved ChatGPT threads');
    const thread = (login, isResolved = false) => ({
      isResolved,
      comments: { nodes: [{ author: { login }, body: 'finding', path: 'a.js', originalLine: 1 }] },
    });
    const gate = (threads) =>
      runScript(body, {
        github: {
          graphql: async () => ({
            repository: { pullRequest: { reviewThreads: { nodes: threads } } },
          }),
        },
        context: { repo: { owner: 'o', repo: 'r' }, payload: { pull_request: { number: 1 } } },
        env: BOT_REST_LOGIN,
      });

    test('an unresolved bot thread blocks the merge (GraphQL login has no [bot])', async () => {
      const { failures } = await gate([thread(BOT_GRAPHQL_LOGIN)]);
      assert.equal(failures.length, 1);
    });

    test('a resolved bot thread does not block', async () => {
      const { failures } = await gate([thread(BOT_GRAPHQL_LOGIN, true)]);
      assert.deepEqual(failures, []);
    });

    test('unresolved threads from humans — even with "chatgpt" in the handle — do not block', async () => {
      const { failures } = await gate([thread('chatgpt-fan'), thread('lupinesse')]);
      assert.deepEqual(failures, []);
    });
  });
});
