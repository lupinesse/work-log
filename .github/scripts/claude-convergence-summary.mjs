#!/usr/bin/env node
/**
 * Phase 3 of the review dialogue — Claude posts a convergence summary.
 *
 * Replaces the standalone /pr-review run. Instead of a second independent
 * review, this produces a structured synthesis of the Phase 1–2 dialogue:
 *
 * 1. Fetch all review threads (ChatGPT's findings + Claude's Phase 2 replies).
 * 2. Call Claude API with diff + threads to produce a convergence summary.
 * 3. Post (or update) the summary as the persistent PR comment.
 *
 * The summary organises threads by outcome and adds a brief "independent
 * gaps" section for anything Claude notices that neither reviewer raised.
 * Phase 4 (chatgpt-claude-dialogue.mjs) reads this via the
 * <!-- claude-pr-review-comment --> marker — unchanged from before.
 *
 * Required env vars:
 *   CLAUDE_CODE_OAUTH_TOKEN  Claude Code OAuth token (`claude setup-token`)
 *   GITHUB_TOKEN             GitHub auth (Claude Reviewer App token or fallback)
 *   GITHUB_REPOSITORY        "owner/repo" — auto-set by Actions
 *   PR_NUMBER                Pull-request number
 *   HEAD_SHA                 Head SHA of the PR
 *
 * Optional env vars:
 *   MODEL              Override model (default 'claude-sonnet-4-6')
 *   MAX_TOKENS         default 2000
 *   DIFF_PATH          default 'pr.diff'
 *   MAX_DIFF_CHARS     default 30000
 *   CLAUDE_MD_PATH     default 'CLAUDE.md' (relative to CWD; included as cached system prefix)
 */

import { readFileSync } from 'node:fs';
import {
  fetchAllThreads,
  formatThreadsForPrompt,
  upsertIssueComment,
} from './lib/github-threads.mjs';
import {
  resolveAnthropicAuthChain,
  selectModel,
  shouldFallThrough,
} from './lib/anthropic-auth.mjs';
import { loadClaudeMd } from './lib/load-claude-md.mjs';

// ─────────────────────────── helpers ───────────────────────────

/** @param {string} msg */
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

/**
 * @param {string} key
 * @returns {string}
 */
const must = (key) => {
  const v = process.env[key];
  if (!v) die(`Missing required env var: ${key}`);
  return v;
};

// ─────────────────────────── config ───────────────────────────

const AUTH_CHAIN = resolveAnthropicAuthChain(process.env);
if (AUTH_CHAIN.length === 0) {
  die('Missing Anthropic credentials: set CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`)');
}
console.log(
  `Auth: ${AUTH_CHAIN.length} candidate(s) → ${AUTH_CHAIN.map((a) => a.source).join(', ')}`
);

const GITHUB_TOKEN = must('GITHUB_TOKEN');
const [OWNER, REPO] = must('GITHUB_REPOSITORY').split('/');
const PR_NUMBER = must('PR_NUMBER');
const HEAD_SHA = must('HEAD_SHA');

const MODEL_OVERRIDE = process.env.MODEL || '';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '2000', 10);
const DIFF_PATH = process.env.DIFF_PATH || 'pr.diff';
const MAX_DIFF_CHARS = parseInt(process.env.MAX_DIFF_CHARS || '30000', 10);
const CLAUDE_MD_PATH = process.env.CLAUDE_MD_PATH || 'CLAUDE.md';

const COMMENT_MARKER = '<!-- claude-pr-review-comment -->';

const GH_CTX = { token: GITHUB_TOKEN, owner: OWNER, repo: REPO, prNumber: parseInt(PR_NUMBER, 10) };

// ─────────────────────────── diff ───────────────────────────

/**
 * @returns {string|null} Non-empty diff content (possibly truncated), or null if the file is empty.
 * @throws {never} Exits via `die()` if the diff file is missing or unreadable.
 */
function loadDiff() {
  let raw;
  try {
    raw = readFileSync(DIFF_PATH, 'utf8');
  } catch (e) {
    die(`Cannot read diff at ${DIFF_PATH}: ${e.message}`);
  }
  if (!raw.trim()) return null;
  return raw.length > MAX_DIFF_CHARS ? raw.slice(0, MAX_DIFF_CHARS) + '\n\n[diff truncated]' : raw;
}

// ─────────────────────────── Claude API ───────────────────────────

/**
 * Ask Claude to synthesise the Phase 1–2 dialogue into a convergence summary.
 *
 * All threads (resolved and open) are shown so Claude can categorise each by
 * outcome (agreed-fix, deferred, disagreed, partial). The diff is included so
 * Claude can identify any novel issues not yet raised by either reviewer.
 *
 * @param {string}      diff
 * @param {import('./lib/github-threads.mjs').ThreadSummary[]} threads
 * @param {string|null} claudeMd  Project quality standard (CLAUDE.md); forms the cached prefix.
 * @returns {Promise<{text: string, model: string}>}
 */
async function callClaudeApi(diff, threads, claudeMd) {
  const threadBlock = formatThreadsForPrompt(threads);

  const system = `You are Claude, an AI code reviewer. You have just completed Phase 2 of a structured peer review dialogue with ChatGPT on this pull request. All review threads are shown — each includes ChatGPT's original finding and, where present, your Phase 2 verdict reply (✅ agree_fix, 👍 agree_noted, ❌ disagree, ↔️ partial).

Your task is to write a **convergence summary** — a single structured comment that records the outcome of the Phase 1–2 dialogue for the PR author and for ChatGPT (who reads it in Phase 4 before responding).

Use the following structure. Omit sections that are empty. Be concise — one bullet per thread.

## Agreed — will fix in this PR
List every ✅ agree_fix thread (still open). One line each: \`file:line\` — issue + your fix description.

## Acknowledged — deferred
List every 👍 agree_noted thread. One line: \`file:line\` — issue + reason for deferral.

## Claude's counter-positions
List every ❌ disagree thread. One line each: \`file:line\` — what ChatGPT flagged + your counter-reasoning (condensed from your Phase 2 reply). ChatGPT reads this in Phase 4, so the reasoning must be clear and specific — not just "this is intentional".

## Partially agreed
List every ↔️ partial thread. One line: \`file:line\` — what was accepted vs. rejected.

## Independent gaps
Scan the diff for issues NOT covered by any existing thread (resolved or open). Limit to ≤3 blocking issues. If you find nothing novel, write exactly: "No independent gaps found."

## Verdict
One sentence: overall status. Examples: "Blocked on N agreed fixes." / "Clean — no blocking issues." / "Blocked on N agreed fixes; N counter-positions on record for Phase 4."`;

  const user = `All review threads (${threads.length} total, resolved and open):\n\n${threadBlock}\n\nPR diff:\n\`\`\`diff\n${diff}\n\`\`\``;

  for (let i = 0; i < AUTH_CHAIN.length; i++) {
    const auth = AUTH_CHAIN[i];
    const model = selectModel(auth.source, MODEL_OVERRIDE);

    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          ...auth.headers,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        // codeql[js/file-access-to-http] — diff and claudeMd are trusted CI workspace files, not user input
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          // Two-block system: CLAUDE.md (stable, large) forms the cached prefix; the
          // convergence rubric follows. Both blocks carry cache_control so the full
          // prefix is cached in one round-trip. Diff and threads (volatile) are in
          // the user message and are never cached.
          system: [
            ...(claudeMd
              ? [{ type: 'text', text: claudeMd, cache_control: { type: 'ephemeral' } }]
              : []),
            { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: user }],
        }),
      });
    } catch (err) {
      const nextAuth = AUTH_CHAIN[i + 1];
      if (nextAuth) {
        console.warn(
          `Auth: ${auth.source} fetch failed (${err.message}); trying ${nextAuth.source}`
        );
        continue;
      }
      die(`Anthropic API: network error with ${auth.source}: ${err.message}`);
    }

    if (response.ok) {
      const data = await response.json();
      if (data.error) die(`Anthropic error (${data.error.type}): ${data.error.message}`);
      const usage = data.usage ?? {};
      console.log(
        `Auth: used ${auth.source} (model ${model}) | ` +
          `tokens: ${usage.input_tokens ?? '?'} in / ${usage.output_tokens ?? '?'} out` +
          (usage.cache_creation_input_tokens
            ? ` / ${usage.cache_creation_input_tokens} cache_write`
            : '') +
          (usage.cache_read_input_tokens ? ` / ${usage.cache_read_input_tokens} cache_read` : '')
      );
      return { text: (data.content?.[0]?.text || '').trim(), model };
    }

    const body = await response.text();
    const nextAuth = AUTH_CHAIN[i + 1];
    if (shouldFallThrough(response.status) && nextAuth) {
      console.warn(
        `Auth: ${auth.source} returned HTTP ${response.status}; falling back to ${nextAuth.source}`
      );
      continue;
    }
    die(`Anthropic API ${response.status} with ${auth.source}: ${body}`);
  }

  die('Anthropic API: exhausted all auth candidates without a response');
}

// ─────────────────────────── main ───────────────────────────

async function main() {
  console.log(`Phase 3 convergence summary for ${OWNER}/${REPO} PR #${PR_NUMBER}`);

  const diff = loadDiff();
  if (!diff) {
    console.log('Empty diff — skipping.');
    return;
  }

  const claudeMd = loadClaudeMd(CLAUDE_MD_PATH);
  const threads = await fetchAllThreads(GH_CTX);
  console.log(`  Fetched ${threads.length} total thread(s) (resolved + open)`);

  const { text: summaryText, model: usedModel } = await callClaudeApi(diff, threads, claudeMd);
  if (!summaryText) {
    console.warn('Empty Claude response — skipping.');
    return;
  }

  const body =
    `${COMMENT_MARKER}\n\n` +
    summaryText +
    `\n\n---\n*Convergence summary by Claude \`${usedModel}\` · commit \`${HEAD_SHA.slice(0, 7)}\`*`;

  const { comment, updated } = await upsertIssueComment({
    ...GH_CTX,
    marker: COMMENT_MARKER,
    body,
  });
  console.log(`${updated ? 'Updated' : 'Posted'} convergence summary: ${comment.html_url}`);
}

main().catch((err) => die(`Unhandled error: ${err.stack || err.message}`));
