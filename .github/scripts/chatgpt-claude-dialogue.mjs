#!/usr/bin/env node
/**
 * Phase 4 of the review dialogue — ChatGPT responds to Claude's full response.
 *
 * 1. Fetch Claude's synthesis comment + final /pr-review verdict from issue
 *    comments.
 * 2. Fetch the full Phase 1 thread history: each of ChatGPT's original
 *    findings plus Claude's verdict reply (`agree_fix` / `disagree` / etc).
 * 3. Call OpenAI with diff + Claude's synthesis + final verdict + per-thread
 *    history as context. Critically, ChatGPT is told NOT to re-raise findings
 *    Claude rejected (`disagree`) — Claude is the author and that call is
 *    final.
 * 4. ChatGPT raises only NEW issues Claude missed, or confirms resolution.
 * 5. Post the overall response as a top-level review; post any new findings
 *    as inline threads. Fall back to issue comment for unpostable findings.
 *
 * Required env vars:
 *   OPENAI_API_KEY     OpenAI bearer token
 *   GITHUB_TOKEN       GitHub auth (ChatGPT Reviewer App token or fallback)
 *   GITHUB_REPOSITORY  "owner/repo" — auto-set by Actions
 *   PR_NUMBER          Pull-request number
 *   HEAD_SHA           Head SHA of the PR
 *
 * Optional env vars:
 *   MODEL                default 'gpt-5.5'
 *   REASONING_EFFORT     default 'medium'
 *   MAX_DIFF_CHARS       default 40000
 *   MAX_TOKENS           default 16384
 *   DIFF_PATH            default 'pr.diff'
 */

import { readFileSync } from 'node:fs';
import {
  fetchAllThreads,
  formatThreadsForPrompt,
  replyToThread,
  unresolveThread,
  upsertReview,
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

const OPENAI_API_KEY = must('OPENAI_API_KEY');
const GITHUB_TOKEN   = must('GITHUB_TOKEN');
const [OWNER, REPO]  = must('GITHUB_REPOSITORY').split('/');
const PR_NUMBER      = must('PR_NUMBER');
const HEAD_SHA       = must('HEAD_SHA');

const MODEL            = process.env.MODEL            || 'gpt-5.5';
const REASONING_EFFORT = process.env.REASONING_EFFORT || 'medium';
const MAX_DIFF_CHARS   = parseInt(process.env.MAX_DIFF_CHARS || '40000', 10);
const MAX_TOKENS       = parseInt(process.env.MAX_TOKENS     || '16384', 10);
const DIFF_PATH        = process.env.DIFF_PATH        || 'pr.diff';

const ATTRIBUTION = `*ChatGPT \`${MODEL}\` responding to Claude's review · commit \`${HEAD_SHA.slice(0, 7)}\`*`;

// Per-comment attribution so the persona is unambiguous regardless of which
// GitHub account actually posts the comment (App token, github-actions[bot],
// or a manual gh CLI run).
const REPLY_ATTRIBUTION = `\n\n<sub>_— ChatGPT \`${MODEL}\` · \`${HEAD_SHA.slice(0, 7)}\`_</sub>`;

const GH_HEADERS = {
  Authorization:          `token ${GITHUB_TOKEN}`,
  Accept:                 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type':         'application/json',
};

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

// Markers that identify this phase's persistent comments across runs.
// upsertReview / upsertIssueComment locate the previous match and update it
// in place rather than stacking a new comment per push.
const REVIEW_MARKER   = "responding to Claude's review";
const FALLBACK_MARKER = '<!-- chatgpt-phase4-fallback -->';

const GH_CTX = { token: GITHUB_TOKEN, owner: OWNER, repo: REPO, prNumber: parseInt(PR_NUMBER, 10) };

/**
 * @typedef {import('./lib/github-threads.mjs').ThreadSummary} ThreadSummary
 *
 * @typedef {{
 *   synthesis: string|null,
 *   finalReview: string|null,
 *   threads: ThreadSummary[],
 * }} ClaudeContext
 */

/**
 * Map Claude's reply emoji prefix back to the verdict it represents.
 * Mirrors the verdictEmoji map in claude-chatgpt-dialogue.mjs.
 * @param {string} reply
 * @returns {string|null}
 */
function parseVerdictFromReply(reply) {
  const trimmed = reply.trimStart();
  if (trimmed.startsWith('✅')) return 'agree_fix';
  if (trimmed.startsWith('👍')) return 'agree_noted';
  if (trimmed.startsWith('❌')) return 'disagree';
  if (trimmed.startsWith('↔️')) return 'partial';
  return null;
}

/**
 * Find the Claude verdict (if any) recorded in a thread's replies.
 * @param {ThreadSummary} thread
 * @returns {string|null}
 */
function claudeVerdictForThread(thread) {
  for (const r of thread.replies) {
    const v = parseVerdictFromReply(r.body);
    if (v) return v;
  }
  return null;
}

/**
 * Fetch Claude's issue comments (synthesis + final /pr-review verdict)
 * from the PR.
 * @returns {Promise<{synthesis: string|null, finalReview: string|null}>}
 */
async function fetchClaudeIssueComments() {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments?per_page=100`,
    { headers: GH_HEADERS }
  );
  if (!response.ok) die(`Issue comments API ${response.status}: ${await response.text()}`);
  const comments = await response.json();

  let synthesis   = null;
  let finalReview = null;
  // Walk newest-first; identify by body content only so the lookup tolerates
  // token-fallback cases (comment posted by github-actions[bot]).
  for (const c of [...comments].reverse()) {
    if (!synthesis && c.body.includes("Claude's synthesis")) synthesis = c.body;
    if (!finalReview && c.body.includes('/pr-review')) finalReview = c.body;
    if (synthesis && finalReview) break;
  }
  return { synthesis, finalReview };
}

/**
 * Build the full ClaudeContext: synthesis, final review, and all PR threads
 * (so Phase 4 can choose to reply to an existing thread rather than open a
 * duplicate).
 * @returns {Promise<ClaudeContext>}
 */
async function fetchClaudeContext() {
  const [issueComments, threads] = await Promise.all([
    fetchClaudeIssueComments(),
    fetchAllThreads(GH_CTX),
  ]);
  return { ...issueComments, threads };
}

/**
 * Post a single inline pull-request review comment on a specific file line.
 * @param {string} path
 * @param {number} line
 * @param {string} body
 * @returns {Promise<object>}
 * @throws {Error} if the API rejects the comment (e.g. line not in diff).
 */
async function postInlineComment(path, line, body) {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/comments`,
    {
      method: 'POST',
      headers: GH_HEADERS,
      body: JSON.stringify({ body, commit_id: HEAD_SHA, path, line, side: 'RIGHT' }),
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub comments API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

// ─────────────────────────── OpenAI ───────────────────────────

/**
 * Ask ChatGPT to respond to Claude's full review context and post any
 * remaining findings.
 *
 * @param {string}       diff
 * @param {ClaudeContext} claudeContext  Synthesis (Phase 2) and final verdict
 *                                      (Phase 3) from Claude.
 * @returns {Promise<string>} Raw text response.
 */
async function callOpenAI(diff, claudeContext) {
  const { synthesis, finalReview, threads } = claudeContext;

  // Build the context block shown to ChatGPT — include whatever is available.
  // The threads block is the dedup signal (each thread is indexed so the model
  // can reply to it instead of opening a new one).
  const contextBlocks = [];
  contextBlocks.push(`**All existing review threads on this PR (each shows path:line, author, resolution state, the original finding, and any replies including Claude's verdict emoji):**\n\n${formatThreadsForPrompt(threads)}`);
  if (synthesis) {
    contextBlocks.push(`**Claude's synthesis (Phase 2 — response to your Phase 1 threads):**\n\n${synthesis}`);
  }
  if (finalReview) {
    contextBlocks.push(`**Claude's final /pr-review verdict (Phase 3 — posted after resolving your threads):**\n\n${finalReview}`);
  }
  const claudeContext_ = contextBlocks.join('\n\n---\n\n');

  const system = `You are ChatGPT, an AI code reviewer. You have already posted your own independent inline review findings on this pull request. Now you are reading Claude's full response:

1. Claude replied to each of your inline threads with a verdict (agree_fix / agree_noted / disagree / partial) — visible as emoji prefixes (✅ 👍 ❌ ↔️) in the thread replies shown to you.
2. Claude posted a synthesis comment.
3. Claude then ran its own complete /pr-review and posted that verdict.

**CRITICAL — Claude is the implementing author. Claude's verdict on a finding is FINAL:**

- If Claude rejected a finding with ❌ \`disagree\`: do NOT re-raise it. Move on.
- If Claude accepted with ✅ \`agree_fix\`: trust the stated fix. Only follow up if the diff clearly does NOT contain the promised fix.
- If Claude accepted with 👍 \`agree_noted\` (acknowledged but deferred): do not re-raise.
- If Claude responded ↔️ \`partial\`: you may follow up on the rejected part, but only with new evidence — not a restatement.

**CRITICAL — never duplicate an existing thread:**

For each concern you have, choose one action:
- **reply** to an existing thread when the concern overlaps with one already shown above (same file/line, same root cause, related issue on a nearby line, or a follow-up to your own earlier finding). Bias toward replying. This is the main way to keep the comment count under control.
- **new** only when the concern is genuinely novel — no existing thread touches the same code or root cause.

When replying to a **resolved** thread, set "unresolve": true if your reply is a regression / re-raise (the issue is back despite an earlier verdict). That re-opens the thread so Claude re-evaluates and posts a fresh verdict. Leave "unresolve" off for replies that just add context to an already-fixed thread. Re-raising is reserved for genuine regressions — do not use it to re-litigate a finding Claude rejected with ❌ disagree.

If everything you'd want to say belongs in existing threads (or has already been addressed by Claude), produce an empty thread_actions array and say so in the summary. That is the expected outcome on a thorough review.

Output a single raw JSON object — no markdown wrapper:
{
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "summary": "<3-5 sentences: your overall response to Claude's verdict, what still concerns you (only NEW concerns), what you consider resolved>",
  "thread_actions": [
    { "type": "new",   "path": "<file path from diff>", "line": <integer>, "body": "<markdown — prefix with 🔴 Blocking or 🟡 Non-blocking>" },
    { "type": "reply", "thread_index": <integer matching a thread above>, "unresolve": false, "body": "<your follow-up — reference what you're adding (e.g. 'Still present after the latest commit:' or 'Related concern on this line:')>" }
  ]
}`;

  const user = `${claudeContext_}\n\nPR diff:\n\`\`\`diff\n${diff}\n\`\`\``;

  // lgtm[js/file-access-to-http] — diff is trusted CI output, not user input
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:                 MODEL,
      reasoning_effort:      REASONING_EFFORT,
      max_completion_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
    }),
  });

  if (!response.ok) die(`OpenAI API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (data.error) die(`OpenAI error (${data.error.code}): ${data.error.message}`);
  return (data.choices?.[0]?.message?.content || '').trim();
}

// ─────────────────────────── output parsing ───────────────────────────

/**
 * @typedef {{ type: 'new', path: string, line: number, body: string }} NewAction
 * @typedef {{ type: 'reply', threadIndex: number, body: string, unresolve: boolean }} ReplyAction
 * @typedef {NewAction | ReplyAction} ThreadAction
 * @typedef {{ verdict: string, summary: string, actions: ThreadAction[], invalidActions: unknown[] }} DialogueResponse
 */

/**
 * Parse OpenAI's response. Accepts both the new `thread_actions` schema and
 * the legacy `new_findings` schema (treated as all type="new") for
 * backwards compatibility.
 *
 * @param {string} rawText
 * @param {number} threadCount  Used to validate reply thread_index range.
 * @returns {DialogueResponse}
 * @throws {Error}
 */
function parseResponse(rawText, threadCount) {
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(cleaned);

  if (!parsed.verdict || !parsed.summary) {
    throw new Error('Missing required fields: verdict, summary');
  }
  const validVerdicts = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];
  if (!validVerdicts.includes(parsed.verdict)) {
    throw new Error(`Unexpected verdict value: ${JSON.stringify(parsed.verdict)}`);
  }

  const rawActions = Array.isArray(parsed.thread_actions)
    ? parsed.thread_actions
    : Array.isArray(parsed.new_findings)
      ? parsed.new_findings.map(f => ({ type: 'new', ...f }))
      : [];

  const actions = [];
  const invalidActions = [];

  for (const a of rawActions) {
    if (!a || typeof a !== 'object') { invalidActions.push(a); continue; }
    const type = a.type || 'new';
    const body = typeof a.body === 'string' ? a.body : null;
    if (!body) { invalidActions.push(a); continue; }

    if (type === 'reply') {
      const idx = Number.isInteger(a.thread_index) ? a.thread_index : Number(a.thread_index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= threadCount) {
        console.warn(`  invalid reply action (thread_index=${JSON.stringify(a.thread_index)}, valid 0..${threadCount - 1}) — moved to fallback`);
        invalidActions.push(a);
        continue;
      }
      actions.push({ type: 'reply', threadIndex: idx, body, unresolve: a.unresolve === true });
    } else {
      const path = typeof a.path === 'string' ? a.path.trim() : null;
      const rawLine = a.line;
      const line = Number.isInteger(rawLine) ? rawLine : Number.isInteger(Number(rawLine)) ? Number(rawLine) : null;
      if (!path || line === null || line <= 0) {
        console.warn(`  invalid new action (path=${JSON.stringify(path)}, line=${JSON.stringify(rawLine)}) — moved to fallback`);
        invalidActions.push(a);
        continue;
      }
      actions.push({ type: 'new', path, line, body });
    }
  }

  return {
    verdict: parsed.verdict,
    summary: String(parsed.summary),
    actions,
    invalidActions,
  };
}

// ─────────────────────────── main ───────────────────────────

async function main() {
  console.log(`ChatGPT→Claude dialogue for ${OWNER}/${REPO} PR #${PR_NUMBER}`);

  const diff = loadDiff();
  if (!diff) { console.log('Empty diff — skipping.'); return; }

  const claudeContext = await fetchClaudeContext();
  if (!claudeContext.synthesis && !claudeContext.finalReview) {
    console.log("  No Claude comments found (synthesis or /pr-review) — skipping.");
    return;
  }
  const rejected = claudeContext.threads.filter(t => claudeVerdictForThread(t) === 'disagree').length;
  console.log(
    `  Claude context: synthesis=${!!claudeContext.synthesis}, finalReview=${!!claudeContext.finalReview}, ` +
    `threads=${claudeContext.threads.length} (claude_disagreed=${rejected})`
  );

  const rawText = await callOpenAI(diff, claudeContext);
  if (!rawText) { console.warn('OpenAI returned an empty response — skipping.'); return; }

  let parsed;
  try {
    parsed = parseResponse(rawText, claudeContext.threads.length);
  } catch (e) {
    console.warn(`JSON parse failed (${e.message}) — posting raw as fallback.`);
    const { comment, updated } = await upsertIssueComment({
      ...GH_CTX,
      marker: FALLBACK_MARKER,
      body: `${FALLBACK_MARKER}\n${rawText}\n\n---\n${ATTRIBUTION}`,
    });
    console.log(`${updated ? 'Updated' : 'Posted'} fallback comment: ${comment.html_url}`);
    return;
  }

  const newCount = parsed.actions.filter(a => a.type === 'new').length;
  const replyCount = parsed.actions.filter(a => a.type === 'reply').length;
  console.log(`  verdict: ${parsed.verdict}, new: ${newCount}, replies: ${replyCount}`);

  // Upsert the top-level response review (replaces any previous Phase 4 review
  // from this bot rather than stacking one per push).
  const reviewBody = `**${parsed.verdict}** — ${parsed.summary}\n\n---\n${ATTRIBUTION}`;
  const { review: reviewResult, replaced } = await upsertReview({
    ...GH_CTX,
    headSha: HEAD_SHA,
    marker: REVIEW_MARKER,
    body: reviewBody,
  });
  console.log(`${replaced ? 'Replaced' : 'Posted'} review (${parsed.verdict}): ${reviewResult.html_url}`);

  // Dispatch actions: replies go to existing threads, news create them.
  // Re-raises on resolved threads unresolve them first so Phase 2 picks them
  // up next run and Claude posts a fresh verdict.
  const unpostable = [];
  for (const a of parsed.actions) {
    const bodyWithAttribution = `${a.body}${REPLY_ATTRIBUTION}`;
    try {
      if (a.type === 'reply') {
        const target = claudeContext.threads[a.threadIndex];
        if (a.unresolve && target.isResolved) {
          try {
            await unresolveThread({ ...GH_CTX, threadId: target.id });
            console.log(`  unresolved thread ${a.threadIndex} (re-raise)`);
          } catch (err) {
            console.warn(`  could not unresolve thread ${a.threadIndex}: ${err.message}`);
          }
        }
        const reply = await replyToThread({
          ...GH_CTX,
          commentId: target.firstCommentId,
          body: bodyWithAttribution,
        });
        console.log(`  reply → ${target.path}:${target.line} (thread ${a.threadIndex}): ${reply.html_url}`);
      } else {
        const comment = await postInlineComment(a.path, a.line, bodyWithAttribution);
        console.log(`  new inline: ${a.path}:${a.line} → ${comment.html_url}`);
      }
    } catch (err) {
      const where = a.type === 'reply' ? `reply thread[${a.threadIndex}]` : `${a.path}:${a.line}`;
      console.warn(`  could not post ${where} — ${err.message}`);
      unpostable.push(a);
    }
  }

  const fallbackEntries = [
    ...unpostable.map(a => ({
      label: a.type === 'reply' ? `(reply to thread ${a.threadIndex})` : `${a.path}:${a.line}`,
      body:  a.body,
    })),
    ...parsed.invalidActions.map(a => ({
      label: '(malformed action)',
      body:  typeof a?.body === 'string' ? a.body : JSON.stringify(a),
    })),
  ];
  if (fallbackEntries.length > 0) {
    const sections = fallbackEntries
      .map(f => `**\`${f.label}\`**\n\n${f.body}`)
      .join('\n\n---\n\n');
    const { comment, updated } = await upsertIssueComment({
      ...GH_CTX,
      marker: FALLBACK_MARKER,
      body: `${FALLBACK_MARKER}\nThe following actions could not be posted as inline comments or replies:\n\n${sections}\n\n---\n${ATTRIBUTION}`,
    });
    console.log(`${updated ? 'Updated' : 'Posted'} fallback comment for ${fallbackEntries.length} action(s): ${comment.html_url}`);
  }
}

main().catch((err) => die(`Unhandled error: ${err.stack || err.message}`));
