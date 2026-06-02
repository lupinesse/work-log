#!/usr/bin/env node
/**
 * Phase 4 of the review dialogue — ChatGPT responds to Claude's full response.
 *
 * 1. Fetch Claude's /pr-review verdict from issue comments.
 * 2. Fetch all PR threads (Claude's verdict replies give context).
 * 3. Call OpenAI with diff + Claude's verdict + per-thread history. ChatGPT
 *    is told NOT to re-raise findings Claude rejected (`disagree`).
 * 4. Replies go to existing threads; new findings are batched into one
 *    review submission (one "reviewed" banner). No top-level review body.
 * 5. Falls back to issue comment for unpostable findings.
 *
 * Required env vars:
 *   OPENAI_API_KEY     OpenAI bearer token
 *   GITHUB_TOKEN       GitHub auth (ChatGPT Reviewer App token or fallback)
 *   GITHUB_REPOSITORY  "owner/repo" — auto-set by Actions
 *   PR_NUMBER          Pull-request number
 *   HEAD_SHA           Head SHA of the PR
 *
 * Optional env vars:
 *   MODEL                default 'gpt-4o-mini'
 *   MAX_DIFF_CHARS       default 25000
 *   MAX_TOKENS           default 3072
 *   MAX_CONTEXT_CHARS    default 3000 — cap on the final-review context block
 *   DIFF_PATH            default 'pr.diff'
 */

import { readFileSync } from 'node:fs';
import {
  fetchAllIssueComments,
  fetchAllThreads,
  formatThreadsForPrompt,
  replyToThread,
  resolveThread,
  unresolveThread,
  upsertIssueComment,
} from './lib/github-threads.mjs';
import { parsePhase4Response } from './lib/parse-phase4-response.mjs';

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

const OPENAI_API_KEY = must('OPENAI_API_KEY');
const GITHUB_TOKEN = must('GITHUB_TOKEN');
const [OWNER, REPO] = must('GITHUB_REPOSITORY').split('/');
const PR_NUMBER = must('PR_NUMBER');
const HEAD_SHA = must('HEAD_SHA');

const MODEL = process.env.MODEL || 'gpt-4o-mini';
const MAX_DIFF_CHARS = parseInt(process.env.MAX_DIFF_CHARS || '25000', 10);
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '3072', 10);
const MAX_CONTEXT_CHARS = parseInt(process.env.MAX_CONTEXT_CHARS || '3000', 10);
const DIFF_PATH = process.env.DIFF_PATH || 'pr.diff';

const ATTRIBUTION = `*ChatGPT \`${MODEL}\` responding to Claude's review · commit \`${HEAD_SHA.slice(0, 7)}\`*`;

// Per-comment attribution so the persona is unambiguous regardless of which
// GitHub account actually posts the comment (App token, github-actions[bot],
// or a manual gh CLI run).
const REPLY_ATTRIBUTION = `\n\n<sub>_— ChatGPT \`${MODEL}\` · \`${HEAD_SHA.slice(0, 7)}\`_</sub>`;

// ─────────────────────────── diff ───────────────────────────

/**
 * @returns {string|null}
 */
function loadDiff() {
  let raw;
  try {
    raw = readFileSync(DIFF_PATH, 'utf8');
  } catch (e) {
    die(`Cannot read diff: ${e.message}`);
  }
  if (!raw.trim()) return null;
  return raw.length > MAX_DIFF_CHARS ? raw.slice(0, MAX_DIFF_CHARS) + '\n\n[diff truncated]' : raw;
}

// ─────────────────────────── GitHub ───────────────────────────

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

// Markers Claude's other phases write into their issue comments. The
// final-review marker is the HTML comment that pr-review.yml and the
// claude-final-review job in chatgpt-pr-review.yml insert at the top of
// every /pr-review verdict comment; checking it directly is more robust
// than substring-matching "/pr-review" in the attribution footer (which
// would break if the attribution wording changed).
const FINAL_REVIEW_MARKER = '<!-- claude-pr-review-comment -->';
const SYNTHESIS_MARKER_PHRASE = "Claude's synthesis";

/**
 * Fetch Claude's issue comments (synthesis + final /pr-review verdict) from
 * the PR, walking all pages so findings are not missed on high-volume PRs.
 * Identified by body markers, not author login — tolerates token-fallback
 * cases where the comment is posted by github-actions[bot] rather than the
 * Claude Reviewer App. Falls back to the stable attribution footer
 * (`claude.ai/claude-code`) for comments written before the HTML marker was
 * introduced; this string only appears in Claude-generated output, never in
 * a bare `/pr-review` user invocation.
 *
 * @returns {Promise<{synthesis: string|null, finalReview: string|null}>}
 */
async function fetchClaudeIssueComments() {
  const comments = await fetchAllIssueComments(GH_CTX);

  let synthesis = null;
  let finalReview = null;
  // Walk newest-first so we pick up the latest version of each.
  for (const c of [...comments].reverse()) {
    const body = c.body || '';
    const isSynthesis = body.includes(SYNTHESIS_MARKER_PHRASE);
    if (!synthesis && isSynthesis) synthesis = body;
    // Gate the footer fallback on !isSynthesis so a synthesis comment that
    // happens to mention claude.ai/claude-code (current attribution doesn't,
    // but attribution wording can drift) is never mis-classified as the final
    // /pr-review verdict. The HTML marker stays a primary signal regardless
    // because it's only injected by the pr-review-comment workflow step.
    if (
      !finalReview &&
      !isSynthesis &&
      (body.includes(FINAL_REVIEW_MARKER) || body.includes('claude.ai/claude-code'))
    ) {
      finalReview = body;
    }
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
  const { finalReview, threads } = claudeContext;

  // Build the context block shown to ChatGPT.
  // Thread replies already carry Claude's full verdict body (up to 400 chars
  // each), so the Phase 2 synthesis is redundant here — omitting it saves
  // tokens without losing signal. Only the final /pr-review verdict is
  // included as supplementary context.
  const contextBlocks = [];
  contextBlocks.push(
    `**All existing review threads on this PR (each shows path:line, author, resolution state, the original finding, and any replies including Claude's verdict emoji):**\n\n${formatThreadsForPrompt(threads)}`
  );
  if (finalReview) {
    const truncatedFinalReview =
      finalReview.length > MAX_CONTEXT_CHARS
        ? finalReview.slice(0, MAX_CONTEXT_CHARS) + '\n\n[truncated]'
        : finalReview;
    contextBlocks.push(
      `**Claude's final /pr-review verdict (Phase 3 — posted after resolving your threads):**\n\n${truncatedFinalReview}`
    );
  }
  const claudeContext_ = contextBlocks.join('\n\n---\n\n');

  const system = `You are ChatGPT, an AI code reviewer. You have already posted your own independent inline review findings on this pull request. Now you are reading Claude's full response:

1. Claude replied to each of your inline threads with a verdict (agree_fix / agree_noted / disagree / partial) — visible as emoji prefixes (✅ 👍 ❌ ↔️) in the thread replies shown to you.
2. Claude posted a convergence summary (Phase 3) that organises every thread by outcome and notes any independent gaps Claude found.

Your job in Phase 4 is to close the dialogue loop:
- **Verify agreed fixes** — confirm Claude's \`agree_fix\` changes are actually in the diff.
- **Accept or challenge counter-positions** — if Claude's \`disagree\` reasoning is convincing, accept it; if you have new evidence it's wrong, say so.
- **Flag regressions** — if a previously verified fix has disappeared from the diff.
- **Do NOT raise new findings.** Phase 4 is strictly a reply-only phase; \`type: "new"\` actions are rejected. Any genuinely novel blocking issue you notice belongs in a separate PR comment outside this dialogue.

**CRITICAL — Claude's verdict on each finding is FINAL (absent new evidence):**

- If Claude rejected a finding with ❌ \`disagree\`: do NOT re-raise it. Move on.
- If Claude accepted with ✅ \`agree_fix\`: do NOT trust the claim blind. Claude's reply describes WHAT was changed (e.g., "Will replace the silent catch with wlLog.warn") — locate that exact change in the current diff at the relevant file/line. Then:
  - **Fix is present, thread does NOT yet show your verification reply** → post a reply starting with "✅ Verified as fixed" (briefly say what you checked, e.g., "wlLog.warn now in place at 12-meetings.js:73") and set \`resolve: true\` so the thread closes and the merge-gate clears.
  - **Fix is present, thread already shows "✅ Verified as fixed" from a prior Phase 4 run** → omit. Do not re-post the same confirmation; you are idempotent.
  - **Fix is absent** (the change Claude described isn't in the diff, or a later commit reverted it) → post a reply starting with "🔁 Reopened —" and quote the line(s) where the fix should appear but doesn't. Set \`unresolve: true\` if the thread is currently resolved. That tells Claude's next Phase 2 run to re-evaluate.
  - The same verification rule applies when Claude's synthesis or \`/pr-review\` verdict claims something is "now fixed" or "addressed in commit X": confirm against the diff before trusting.
- If Claude accepted with 👍 \`agree_noted\` (acknowledged but deferred): do not re-raise.
- If Claude responded ↔️ \`partial\`: you may follow up on the rejected part, but only with new evidence — not a restatement.

**CRITICAL — scan ALL threads (resolved AND open) before raising anything:**

The threads list above shows every review thread on this PR with its resolution state and Claude's verdict reply. Walk it before choosing any action — re-raising a finding an earlier thread already covered (even as a "new" thread on a different line) is the most common Phase 4 failure mode.

For each concern you have, choose one action:
- **reply with \`resolve: true\`** — when you've verified Claude's \`agree_fix\` change is present in the current diff and the thread does NOT already show your "✅ Verified as fixed" confirmation. Body must start with "✅ Verified as fixed" and briefly state what you checked. This both audits the verification and closes the thread for the merge-gate.
- **reply with \`unresolve: true\`** — when the issue regressed: the thread was resolved (or already showed your "Verified as fixed" from a prior run) but Claude's promised change is no longer in the diff. Body must start with "🔁 Reopened —" and quote the missing change. Reserved for genuine regressions; do not use it to re-litigate a finding Claude rejected with ❌ \`disagree\`.
- **omit entirely** (do not add to thread_actions) when the thread is already in a stable state — you previously posted "✅ Verified as fixed" and nothing has changed, OR Claude resolved it with \`disagree\` / \`agree_noted\` and you accept that. Silence is the correct signal once verification is on record; re-posting the same confirmation every run is noise.
- **reply** (no flag) when the concern overlaps with an existing thread (same file/line, same root cause, related issue on a nearby line, follow-up to your own earlier finding) but is NOT fully addressed. Bias toward replying.

**Verdict:** pick **APPROVE** when every concern you'd raise is already covered (resolved, freshly verified with "✅ Verified as fixed", or open with Claude's ✅ \`agree_fix\` — those open threads are tracked by the merge-gate). Pick **REQUEST_CHANGES** only when you posted a "🔁 Reopened" on a genuine regression of a blocking finding. Pick **COMMENT** for non-blocking follow-ups or when you're only posting verification confirmations.

**Reply flags (\`resolve\` / \`unresolve\`):** mutually exclusive — never set both on the same reply.
- \`resolve: true\` — close the thread after posting. Use only with a "✅ Verified as fixed" reply. No-op if the thread is already resolved.
- \`unresolve: true\` — re-open a resolved thread before posting. Use only with a "🔁 Reopened —" regression reply. No-op if the thread is already open.
- Neither set — reply is added with no change to resolution state.

If everything you'd want to say belongs in existing threads (or has already been addressed by Claude and you've already posted the verification on a prior run), produce an empty thread_actions array and say so in the summary. That is the expected outcome on a thorough review with no regressions.

Output a single raw JSON object — no markdown wrapper:
{
  "thread_actions": [
    { "type": "reply", "thread_index": <integer matching a thread above>, "resolve": false, "unresolve": false, "body": "<for verifications: '✅ Verified as fixed — <what you checked>'. For regressions: '🔁 Reopened — <quote missing change>'. For other follow-ups: plain markdown.>" }
  ]
}`;

  const user = `${claudeContext_}\n\nPR diff:\n\`\`\`diff\n${diff}\n\`\`\``;

  // lgtm[js/file-access-to-http] — diff is trusted CI output, not user input
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_completion_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!response.ok) die(`OpenAI API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (data.error) die(`OpenAI error (${data.error.code}): ${data.error.message}`);
  const usage = data.usage ?? {};
  console.log(
    `  tokens: ${usage.prompt_tokens ?? '?'} in / ${usage.completion_tokens ?? '?'} out` +
      (usage.total_tokens != null ? ` / ${usage.total_tokens} total` : '')
  );
  return (data.choices?.[0]?.message?.content || '').trim();
}

// ─────────────────────────── main ───────────────────────────

async function main() {
  console.log(`ChatGPT→Claude dialogue for ${OWNER}/${REPO} PR #${PR_NUMBER}`);

  const diff = loadDiff();
  if (!diff) {
    console.log('Empty diff — skipping.');
    return;
  }

  const claudeContext = await fetchClaudeContext();
  if (!claudeContext.finalReview) {
    console.log(
      '  No Claude /pr-review verdict (Phase 3) found — skipping; synthesis alone is not enough for Phase 4.'
    );
    return;
  }
  if (claudeContext.threads.length === 0) {
    console.log('  No review threads on PR — nothing to reply to.');
    return;
  }
  const rejected = claudeContext.threads.filter(
    (t) => claudeVerdictForThread(t) === 'disagree'
  ).length;
  console.log(
    `  Claude context: synthesis=${!!claudeContext.synthesis}, finalReview=${!!claudeContext.finalReview}, ` +
      `threads=${claudeContext.threads.length} (claude_disagreed=${rejected})`
  );

  const rawText = await callOpenAI(diff, claudeContext);
  if (!rawText) {
    console.warn('OpenAI returned an empty response — skipping.');
    return;
  }

  let parsed;
  try {
    parsed = parsePhase4Response(rawText, claudeContext.threads.length);
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

  console.log(`  replies: ${parsed.actions.length}, invalid: ${parsed.invalidActions.length}`);
  if (parsed.invalidActions.length > 0) {
    const sample = parsed.invalidActions.slice(0, 3);
    for (const action of sample) {
      let id;
      if (action.thread_index != null) {
        id = `thread=${action.thread_index}`;
      } else if (action.path) {
        id = `path=${action.path}`;
      } else {
        id = `body="${String(action.body ?? '').slice(0, 40)}"`;
      }
      console.log(`    invalid action: type=${action.type ?? '(missing)'} ${id}`);
    }
  }

  // Replies go to existing threads individually.
  const unpostable = [];
  for (const a of parsed.actions) {
    const bodyWithAttribution = `${a.body}${REPLY_ATTRIBUTION}`;
    try {
      const target = claudeContext.threads[a.threadIndex];
      // Unresolve first so a "🔁 Reopened" reply lands on an open thread —
      // Claude's Phase 2 picks it up on the next run and re-evaluates.
      if (a.unresolve && target.isResolved) {
        try {
          await unresolveThread({ ...GH_CTX, threadId: target.id });
          console.log(`  unresolved thread ${a.threadIndex} (reopened)`);
        } catch (err) {
          console.warn(`  could not unresolve thread ${a.threadIndex}: ${err.message}`);
        }
      }
      const reply = await replyToThread({
        ...GH_CTX,
        commentId: target.firstCommentId,
        body: bodyWithAttribution,
      });
      console.log(
        `  reply → ${target.path}:${target.line} (thread ${a.threadIndex}): ${reply.html_url}`
      );
      // Resolve AFTER posting so the "✅ Verified as fixed" confirmation is
      // visible on the thread before it closes — clears the merge-gate.
      if (a.resolve && !target.isResolved) {
        try {
          await resolveThread({ ...GH_CTX, threadId: target.id });
          console.log(`  resolved thread ${a.threadIndex} (verified fix)`);
        } catch (err) {
          console.warn(`  could not resolve thread ${a.threadIndex}: ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`  could not post reply thread[${a.threadIndex}] — ${err.message}`);
      unpostable.push(a);
    }
  }

  const fallbackEntries = [
    ...unpostable.map((a) => ({
      label: `(reply to thread ${a.threadIndex})`,
      body: a.body,
    })),
    ...parsed.invalidActions.map((a) => ({
      label: '(malformed action)',
      body: typeof a?.body === 'string' ? a.body : JSON.stringify(a),
    })),
  ];
  if (fallbackEntries.length > 0) {
    const sections = fallbackEntries
      .map((f) => `**\`${f.label}\`**\n\n${f.body}`)
      .join('\n\n---\n\n');
    const { comment, updated } = await upsertIssueComment({
      ...GH_CTX,
      marker: FALLBACK_MARKER,
      body: `${FALLBACK_MARKER}\nThe following actions could not be posted as inline comments or replies:\n\n${sections}\n\n---\n${ATTRIBUTION}`,
    });
    console.log(
      `${updated ? 'Updated' : 'Posted'} fallback comment for ${fallbackEntries.length} action(s): ${comment.html_url}`
    );
  }
}

main().catch((err) => die(`Unhandled error: ${err.stack || err.message}`));
