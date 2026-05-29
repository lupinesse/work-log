#!/usr/bin/env node
/**
 * Phase 2 of the review dialogue — Claude responds to ChatGPT's findings.
 *
 * 1. Fetch all unresolved inline threads posted by the ChatGPT Reviewer App.
 * 2. Call Claude API with the diff + all threads as context.
 * 3. Claude evaluates each finding (agree / disagree / partial) and replies.
 * 4. Post each reply to the thread, then resolve the thread.
 * 5. Post Claude's synthesis as a PR issue comment.
 *
 * Falls back gracefully: thread replies that fail (permissions, etc.) are
 * collected and included in the synthesis comment so nothing is lost.
 *
 * Required env vars:
 *   CLAUDE_CODE_OAUTH_TOKEN  Claude Code OAuth token (`claude setup-token`) — uses your
 *                            Claude subscription at no extra API cost.
 *   GITHUB_TOKEN             GitHub auth (Claude Reviewer App token or fallback)
 *   GITHUB_REPOSITORY        "owner/repo" — auto-set by Actions
 *   PR_NUMBER                Pull-request number
 *   HEAD_SHA                 Head SHA of the PR
 *
 * Optional env vars:
 *   MODEL              default 'claude-opus-4-8'
 *   MAX_TOKENS         default 8192
 *   DIFF_PATH          default 'pr.diff'
 *   MAX_DIFF_CHARS     default 40000
 */

import { readFileSync } from 'node:fs';
import {
  fetchAllThreads,
  replyToThread,
  resolveThread,
  upsertIssueComment,
} from './lib/github-threads.mjs';

// ─────────────────────────── helpers ───────────────────────────

/** @param {string} msg */
const die = (msg) => { console.error(msg); process.exit(1); };

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

const CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN || '';
if (!CLAUDE_CODE_OAUTH_TOKEN) {
  die('Missing required env var: CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`)');
}

const GITHUB_TOKEN      = must('GITHUB_TOKEN');
const [OWNER, REPO]     = must('GITHUB_REPOSITORY').split('/');
const PR_NUMBER         = must('PR_NUMBER');
const HEAD_SHA          = must('HEAD_SHA');

const MODEL          = process.env.MODEL          || 'claude-opus-4-8';
const MAX_TOKENS     = parseInt(process.env.MAX_TOKENS     || '8192',  10);
const DIFF_PATH      = process.env.DIFF_PATH      || 'pr.diff';
const MAX_DIFF_CHARS = parseInt(process.env.MAX_DIFF_CHARS || '40000', 10);

const ATTRIBUTION = `*Claude \`${MODEL}\` responding to ChatGPT's review · commit \`${HEAD_SHA.slice(0, 7)}\`*`;

// Per-reply attribution so each verdict reply is clearly authored by Claude
// regardless of which GitHub account (App token, github-actions[bot], or a
// manual gh CLI run) actually posts the comment.
const REPLY_ATTRIBUTION = `\n\n<sub>_— Claude \`${MODEL}\` · \`${HEAD_SHA.slice(0, 7)}\`_</sub>`;

// ─────────────────────────── diff ───────────────────────────

/**
 * @returns {string|null}
 */
function loadDiff() {
  let raw;
  try { raw = readFileSync(DIFF_PATH, 'utf8'); } catch (e) { die(`Cannot read diff: ${e.message}`); }
  if (!raw.trim()) return null;
  return raw.length > MAX_DIFF_CHARS ? raw.slice(0, MAX_DIFF_CHARS) + '\n\n[diff truncated]' : raw;
}

// ─────────────────────────── GitHub ───────────────────────────

/**
 * Fetch all unresolved review threads posted by the ChatGPT Reviewer App.
 *
 * Delegates to the shared {@link fetchAllThreads} helper, then filters for
 * ChatGPT-authored threads by login, attribution text, or finding-prefix
 * emoji. The attribution check is the most reliable fallback when running
 * under the default github-actions[bot] token, where the login test fails.
 *
 * Threads are returned as {@link import('./lib/github-threads.mjs').ThreadSummary}
 * objects — callers use `.firstCommentId`, `.path`, `.line`, `.body`, and
 * `.replies` rather than the raw GraphQL `comments.nodes` shape.
 *
 * @returns {Promise<import('./lib/github-threads.mjs').ThreadSummary[]>}
 */
async function fetchChatGptThreads() {
  const all = await fetchAllThreads({
    token: GITHUB_TOKEN,
    owner: OWNER,
    repo:  REPO,
    prNumber: parseInt(PR_NUMBER, 10),
  });
  return all.filter(t =>
    !t.isResolved &&
    (t.author.includes('chatgpt') ||
     t.body.includes('— ChatGPT') ||
     /^🔴|^🟡|^🔵/.test(t.body))
  );
}

// Marker for the synthesis comment. Stable across runs so the comment is
// updated in place rather than stacking a new one per push.
const SYNTHESIS_MARKER = "Claude's synthesis";
const GH_CTX = { token: GITHUB_TOKEN, owner: OWNER, repo: REPO, prNumber: parseInt(PR_NUMBER, 10) };

// ─────────────────────────── Claude API ───────────────────────────

/**
 * Ask Claude to evaluate ChatGPT's findings and produce a JSON response.
 *
 * Threads are passed as an indexed list so Claude can reference them by
 * index rather than echoing opaque IDs (which it might misformat).
 *
 * @param {string} diff
 * @param {Array}  threads
 * @returns {Promise<string>} Raw text response.
 */
async function callClaudeApi(diff, threads) {
  const threadList = threads.map((t, i) => {
    // Show the full conversation including any replies. This lets Claude see
    // its own earlier verdict (if any) and ChatGPT's re-raise on a previously
    // resolved thread.
    const replyLines = t.replies.map(r =>
      `  ↳ ${r.author || 'unknown'}: ${r.body.slice(0, 400).replace(/\n/g, ' ')}`
    ).join('\n');
    const header = `Thread ${i} | ${t.path}:${t.line}`;
    return replyLines
      ? `${header}\n${t.body}\n${replyLines}`
      : `${header}\n${t.body}`;
  }).join('\n\n---\n\n');

  const system = `You are Claude, the implementing author of this pull request and also an AI code reviewer. You have already done your own independent review. Now you are reading the findings posted by ChatGPT (a peer AI reviewer) on the same code.

You are the final authority on whether a finding gets fixed: as the author, your call stands. ChatGPT does not get to re-litigate a finding you have rejected. But you owe an explicit, substantive reply on EVERY finding — never resolve with just "agree" or "disagree". The reply will be posted before the thread is resolved, so it must explain your reasoning clearly enough that a human reviewer reading only your reply understands the decision.

**Re-raised threads.** Some threads show reply history (lines starting with "↳"). If you see your own earlier verdict (a reply containing ✅/👍/❌/↔️) followed by a later ChatGPT reply, that means ChatGPT re-opened the thread because the issue is back. Treat this as a fresh request: re-evaluate against the current diff. If the issue genuinely came back (e.g. a later commit reintroduced it), give a new verdict — typically agree_fix. If ChatGPT is just re-litigating a finding you previously rejected with disagree, reply disagree again and explain that your earlier decision still stands.

For each ChatGPT finding (including re-raises), pick exactly one verdict and write a reply that justifies it:

- **agree_fix** — The finding is valid AND you will fix it in this PR. Your reply MUST describe HOW you will fix it (e.g., "Will replace the silent catch with wlLog.warn", "Will rename to descriptiveName"). The thread stays OPEN — the author/merge-gate uses it as a follow-up checklist.
- **agree_noted** — The finding is valid but you are deliberately not fixing it in this PR. Your reply MUST explain why deferring is OK (e.g., "Out of scope — tracked in #123", "Pre-existing on main, not introduced by this PR"). The thread is RESOLVED.
- **disagree** — The finding does not apply or is wrong. Your reply MUST explain WHY (e.g., "Line 26 has no variable v — refers to a stale diff state", "This pattern is intentional because X"). The thread is RESOLVED and your decision is final.
- **partial** — Part of the finding is valid. Your reply MUST separate what you agree with (and how you'll fix it) from what you reject (and why). The thread stays OPEN.

Output a single raw JSON object — no markdown wrapper:
{
  "thread_responses": [
    {
      "index": <integer matching the thread index above>,
      "verdict": "agree_fix" | "agree_noted" | "disagree" | "partial",
      "reply": "<2-4 sentences — must include the reasoning required by the verdict above. Never just 'agree' or 'disagree'.>"
    }
  ],
  "synthesis": "<3-5 sentences: key issues in the PR, how ChatGPT's findings compare to your own read, what still needs attention>"
}`;

  const user = `ChatGPT's findings (${threads.length} thread${threads.length === 1 ? '' : 's'}):\n\n${threadList}\n\nPR diff:\n\`\`\`diff\n${diff}\n\`\`\``;

  // lgtm[js/file-access-to-http] — diff is trusted CI output, not user input
  const authHeader = { 'Authorization': `Bearer ${CLAUDE_CODE_OAUTH_TOKEN}` };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      ...authHeader,
      'anthropic-version':  '2023-06-01',
      'content-type':       'application/json',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!response.ok) die(`Anthropic API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (data.error) die(`Anthropic error (${data.error.type}): ${data.error.message}`);
  return (data.content?.[0]?.text || '').trim();
}

// ─────────────────────────── output parsing ───────────────────────────

/**
 * @typedef {{ index: number, verdict: string, reply: string }} ThreadResponse
 * @typedef {{ thread_responses: ThreadResponse[], invalidResponses: unknown[], synthesis: string }} DialogueResponse
 */

/**
 * Parse Claude's raw response. Normalises recoverable values (numeric-string
 * indices are coerced; missing verdict defaults to "comment") and collects
 * unrecoverable entries in `invalidResponses` so the caller can surface them
 * in the synthesis comment instead of silently dropping them — keeping the
 * "every finding gets a reply" guarantee even when the model occasionally
 * returns a malformed entry.
 *
 * @param {string} rawText
 * @returns {DialogueResponse}
 * @throws {Error}
 */
function parseResponse(rawText) {
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed.thread_responses) || !parsed.synthesis) {
    throw new Error('Missing required fields: thread_responses, synthesis');
  }

  const thread_responses = [];
  const invalidResponses = [];

  for (const r of parsed.thread_responses) {
    if (!r || typeof r !== 'object') { invalidResponses.push(r); continue; }
    const idx = Number.isInteger(r.index) ? r.index
              : Number.isInteger(Number(r.index)) ? Number(r.index)
              : null;
    const reply = typeof r.reply === 'string' ? r.reply : null;
    if (idx === null || !reply) {
      console.warn(`  invalid thread_response (index=${JSON.stringify(r.index)}, reply=${typeof r.reply}) — moved to fallback`);
      invalidResponses.push(r);
      continue;
    }
    thread_responses.push({
      index:   idx,
      verdict: r.verdict || 'comment',
      reply,
    });
  }

  return { thread_responses, invalidResponses, synthesis: String(parsed.synthesis) };
}

// ─────────────────────────── main ───────────────────────────

async function main() {
  console.log(`Claude→ChatGPT dialogue for ${OWNER}/${REPO} PR #${PR_NUMBER}`);

  const diff = loadDiff();
  if (!diff) { console.log('Empty diff — skipping.'); return; }

  const threads = await fetchChatGptThreads();
  console.log(`  Found ${threads.length} unresolved ChatGPT thread(s)`);
  if (!threads.length) { console.log('  Nothing to respond to — skipping.'); return; }

  const rawText = await callClaudeApi(diff, threads);
  if (!rawText) { console.warn('Empty Claude response — skipping.'); return; }

  let parsed;
  try {
    parsed = parseResponse(rawText);
  } catch (e) {
    console.warn(`JSON parse failed (${e.message}) — posting raw as fallback.`);
    // Use the synthesis marker so a parse-failure run still replaces (rather
    // than duplicates) the previous synthesis comment.
    const { comment, updated } = await upsertIssueComment({
      ...GH_CTX,
      marker: SYNTHESIS_MARKER,
      body: `${SYNTHESIS_MARKER} (parse failed)\n\n${rawText}\n\n---\n${ATTRIBUTION}`,
    });
    console.log(`${updated ? 'Updated' : 'Posted'} fallback comment: ${comment.html_url}`);
    return;
  }

  console.log(`  ${parsed.thread_responses.length} response(s) + synthesis`);

  const verdictEmoji = { agree_fix: '✅', agree_noted: '👍', disagree: '❌', partial: '↔️' };
  // Only auto-resolve threads where no fix is required. agree_fix and partial
  // threads stay open so the author knows what still needs to be addressed.
  const RESOLVABLE = new Set(['disagree', 'agree_noted']);

  const failed = [];
  /** @type {Map<number, {posted: boolean, thread: object, verdict: string}>} */
  const replyResults = new Map();

  // Pass 1 — post all replies before resolving anything.
  for (const tr of parsed.thread_responses) {
    const thread = threads[tr.index];
    if (!thread) {
      console.warn(`  Index ${tr.index} out of range — skipping`);
      continue;
    }

    const commentId = thread.firstCommentId;
    const emoji = verdictEmoji[tr.verdict] || '💬';
    const replyBody = `${emoji} ${tr.reply}${REPLY_ATTRIBUTION}`;

    let posted = false;
    try {
      const reply = await replyToThread({ ...GH_CTX, commentId, body: replyBody });
      posted = true;
      console.log(`  replied thread[${tr.index}]: ${reply.html_url}`);
    } catch (err) {
      console.warn(`  reply failed thread[${tr.index}]: ${err.message}`);
      failed.push({ tr, thread });
    }

    replyResults.set(tr.index, { posted, thread, verdict: tr.verdict });
  }

  // Pass 2 — resolve only threads where the reply posted successfully and the
  // verdict requires no further action. agree_fix/partial threads stay open so
  // the author and merge-gate can see what still needs fixing.
  for (const [idx, { posted, thread, verdict }] of replyResults) {
    if (posted && RESOLVABLE.has(verdict)) {
      try {
        await resolveThread({ token: GITHUB_TOKEN, threadId: thread.id });
        console.log(`  resolved thread[${idx}]`);
      } catch (err) {
        console.warn(`  resolve failed thread[${idx}]: ${err.message}`);
      }
    } else if (!RESOLVABLE.has(verdict)) {
      console.log(`  thread[${idx}] left open (${verdict} — fix required)`);
    } else {
      console.log(`  thread[${idx}] left open (reply did not post)`);
    }
  }

  // Retroactive pass — re-query for any threads that should have been resolved
  // but weren't (failed earlier, race condition, or pre-existing threads from
  // previous CI runs that were included in this session). Ensures the synthesis
  // is only posted after all feasible resolutions are complete.
  const verdictById = new Map(
    [...replyResults.values()].map(({ thread, verdict }) => [thread.id, verdict])
  );
  const stillUnresolved = await fetchChatGptThreads();
  for (const t of stillUnresolved) {
    const verdict = verdictById.get(t.id);
    if (verdict && RESOLVABLE.has(verdict)) {
      try {
        await resolveThread({ token: GITHUB_TOKEN, threadId: t.id });
        console.log(`  retroactive resolve: ${t.id.slice(-8)}`);
      } catch (err) {
        console.warn(`  retroactive resolve failed: ${err.message}`);
      }
    }
  }

  // Pass 3 — post synthesis only after all feasible resolutions are complete.
  let synthesisBody = `## Claude's synthesis\n\n${parsed.synthesis}`;
  if (failed.length) {
    const extras = failed.map(({ tr, thread }) =>
      `**${thread.path}:${thread.line}** (could not reply inline)\n\n${verdictEmoji[tr.verdict] || '💬'} ${tr.reply}`
    ).join('\n\n---\n\n');
    synthesisBody += `\n\n---\n\n**Responses that could not be posted inline:**\n\n${extras}`;
  }
  // Surface any malformed thread_responses the parser couldn't normalise, so
  // a missing/garbled entry doesn't silently swallow a verdict on a real
  // ChatGPT finding.
  if (parsed.invalidResponses.length) {
    const dropped = parsed.invalidResponses
      .map(r => `\`\`\`json\n${JSON.stringify(r, null, 2)}\n\`\`\``)
      .join('\n\n');
    synthesisBody += `\n\n---\n\n**Malformed thread_responses (could not match to a ChatGPT thread):**\n\n${dropped}`;
  }
  synthesisBody += `\n\n---\n${ATTRIBUTION}`;

  const { comment: synthesis, updated } = await upsertIssueComment({
    ...GH_CTX,
    marker: SYNTHESIS_MARKER,
    body: synthesisBody,
  });
  console.log(`  ${updated ? 'Updated' : 'Posted'} synthesis: ${synthesis.html_url}`);
}

main().catch((err) => die(`Unhandled error: ${err.stack || err.message}`));
