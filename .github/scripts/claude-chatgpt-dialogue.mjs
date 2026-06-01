#!/usr/bin/env node
/**
 * Phase 2 of the review dialogue — Claude responds to ChatGPT's findings.
 *
 * 1. Fetch all unresolved inline threads posted by the ChatGPT Reviewer App.
 * 2. Call Claude API with the diff + all threads as context.
 * 3. Claude evaluates each finding and replies inline (agree_fix / agree_noted
 *    / disagree / partial). Disagree and agree_noted threads are resolved.
 * 4. Posts a fallback issue comment ONLY when replies fail to post inline.
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
 *   MAX_TOKENS         default 3000
 *   DIFF_PATH          default 'pr.diff'
 *   MAX_DIFF_CHARS     default 30000
 *   CLAUDE_MD_PATH     default 'CLAUDE.md' (relative to CWD; included as cached system prefix)
 */

import { readFileSync } from 'node:fs';
import {
  fetchAllThreads,
  replyToThread,
  resolveThread,
  upsertIssueComment,
} from './lib/github-threads.mjs';
import {
  resolveAnthropicAuthChain,
  selectModel,
  shouldFallThrough,
} from './lib/anthropic-auth.mjs';
import { parseResponse } from './lib/parse-dialogue-response.mjs';
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

// All usable credentials in preference order: the Claude subscription OAuth
// token first, then a standard API key. The request tries them in turn so an
// expired-but-present OAuth token falls through to the key instead of failing
// the whole job. Fail fast only when neither credential is configured.
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

// Both credential paths default to claude-sonnet-4-6; MODEL env overrides.
const MODEL_OVERRIDE = process.env.MODEL || '';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '3000', 10);
const DIFF_PATH = process.env.DIFF_PATH || 'pr.diff';
const MAX_DIFF_CHARS = parseInt(process.env.MAX_DIFF_CHARS || '30000', 10);
const CLAUDE_MD_PATH = process.env.CLAUDE_MD_PATH || 'CLAUDE.md';

/** @param {string} model */
const buildAttribution = (model) =>
  `*Claude \`${model}\` responding to ChatGPT's review · commit \`${HEAD_SHA.slice(0, 7)}\`*`;

// Per-reply attribution so each verdict reply is clearly authored by Claude
// regardless of which GitHub account (App token, github-actions[bot], or a
// manual gh CLI run) actually posts the comment.
/** @param {string} model */
const buildReplyAttribution = (model) =>
  `\n\n<sub>_— Claude \`${model}\` · \`${HEAD_SHA.slice(0, 7)}\`_</sub>`;

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
    repo: REPO,
    prNumber: parseInt(PR_NUMBER, 10),
  });
  return all.filter(
    (t) =>
      !t.isResolved &&
      (t.author.includes('chatgpt') || t.body.includes('— ChatGPT') || /^🔴|^🟡|^🔵/.test(t.body))
  );
}

const FALLBACK_MARKER = '<!-- claude-phase2-fallback -->';
const GH_CTX = { token: GITHUB_TOKEN, owner: OWNER, repo: REPO, prNumber: parseInt(PR_NUMBER, 10) };

// ─────────────────────────── Claude API ───────────────────────────

/**
 * Ask Claude to evaluate ChatGPT's findings and produce a JSON response.
 *
 * Threads are passed as an indexed list so Claude can reference them by
 * index rather than echoing opaque IDs (which it might misformat).
 *
 * @param {string}      diff
 * @param {Array}       threads
 * @param {string|null} claudeMd  Project quality standard (CLAUDE.md); forms the cached prefix.
 * @returns {Promise<{text: string, model: string}>}
 */
async function callClaudeApi(diff, threads, claudeMd) {
  const threadList = threads
    .map((t, i) => {
      // Show the full conversation including any replies. This lets Claude see
      // its own earlier verdict (if any) and ChatGPT's re-raise on a previously
      // resolved thread.
      const replyLines = t.replies
        .map((r) => `  ↳ ${r.author || 'unknown'}: ${r.body.slice(0, 400).replace(/\n/g, ' ')}`)
        .join('\n');
      const header = `Thread ${i} | ${t.path}:${t.line}`;
      const bodyPreview = t.body.slice(0, 400);
      return replyLines ? `${header}\n${bodyPreview}\n${replyLines}` : `${header}\n${bodyPreview}`;
    })
    .join('\n\n---\n\n');

  const system = `You are Claude, an AI code reviewer engaged in a structured peer dialogue with ChatGPT on this pull request. ChatGPT posted its Phase 1 findings as inline threads. You are now responding in Phase 2.

Your replies drive a genuine review conversation — three audiences read them:
- The PR author, who decides what to fix
- ChatGPT, who reads your reasoning in Phase 4 and either accepts it or provides counter-evidence
- Human reviewers, who read the full thread history

Because ChatGPT will engage with your actual reasoning (not just your verdict emoji), each reply must stand on its own: a reader with no other context should understand what ChatGPT flagged, what you concluded, and specifically why.

**Engage with the substance, not just the conclusion.** When you disagree, name what ChatGPT was concerned about and address the specific evidence it cited. When you agree, say what convinced you. Never just echo "agree" or "disagree" — that closes the thread without contributing to the dialogue.

**Threads with prior dialogue.** Some threads show reply history (lines starting with "↳"). If you see your own earlier verdict (✅/👍/❌/↔️) followed by a later ChatGPT reply, ChatGPT is continuing the conversation — either flagging a regression or challenging your reasoning with new evidence. Re-evaluate against the current diff. If the concern genuinely recurred or ChatGPT raised new evidence you haven't addressed, update your verdict (typically agree_fix). If ChatGPT is restating what you already addressed, reply disagree again — but acknowledge that you've considered the re-raise.

For each finding, pick one verdict and write a substantive reply:

- **agree_fix** — ChatGPT's concern is valid. Acknowledge what it flagged, confirm why it's correct, and describe exactly how you'll address it (e.g. "Will replace the silent catch with wlLog.warn at line 73"). Thread stays OPEN — used as a follow-up checklist item.
- **agree_noted** — Concern is valid but deliberately deferred. Acknowledge the issue and explain why it's out of scope now (e.g. "Pre-existing on main, not introduced by this PR — will track separately"). Thread RESOLVED.
- **disagree** — Concern doesn't apply. First name what ChatGPT flagged, then give your counter-reasoning with specific evidence from the diff (e.g. "ChatGPT flags the catch at line 26 as silent — wlLog.warn is called on line 27 in the same hunk"). This reply stays on record; ChatGPT reads it in Phase 4. Thread RESOLVED.
- **partial** — Part valid, part not. Clearly separate: what you accept (+ how you'll fix it) from what you reject (+ your counter-reasoning with evidence from the diff). Thread stays OPEN.

Reply length: 3–5 sentences for disagree/partial — you must address the specific concern ChatGPT raised. 1–2 sentences suffice for agree_fix/agree_noted — confirm and state the action.

Output a single raw JSON object — no markdown wrapper:
{
  "thread_responses": [
    {
      "index": <integer matching the thread index above>,
      "verdict": "agree_fix" | "agree_noted" | "disagree" | "partial",
      "reply": "<substantive reply — engage with ChatGPT's specific reasoning; see length guidance above>"
    }
  ]
}`;

  const user = `ChatGPT's findings (${threads.length} thread${threads.length === 1 ? '' : 's'}):\n\n${threadList}\n\nPR diff:\n\`\`\`diff\n${diff}\n\`\`\``;

  // Try each credential in turn; on an auth failure (401/403) or rate limit
  // (429) fall through to the next — an expired OAuth token or an exhausted
  // rate-limit bucket is recovered by the API key, which uses a separate quota.
  for (let i = 0; i < AUTH_CHAIN.length; i++) {
    const auth = AUTH_CHAIN[i];
    const model = selectModel(auth.source, MODEL_OVERRIDE);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
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
        // phase rubric follows. Both blocks carry cache_control so the full prefix
        // is cached in one round-trip. Diff and threads (volatile) are in the user
        // message and are never cached.
        system: [
          ...(claudeMd
            ? [{ type: 'text', text: claudeMd, cache_control: { type: 'ephemeral' } }]
            : []),
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: user }],
      }),
    });

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

  // Unreachable: the chain is non-empty (validated at startup) and the final
  // attempt always returns or dies. Kept as a guard against future edits.
  die('Anthropic API: exhausted all auth candidates without a response');
}

// ─────────────────────────── output parsing ───────────────────────────

// ─────────────────────────── main ───────────────────────────

async function main() {
  console.log(`Claude→ChatGPT dialogue for ${OWNER}/${REPO} PR #${PR_NUMBER}`);

  const diff = loadDiff();
  if (!diff) {
    console.log('Empty diff — skipping.');
    return;
  }

  const claudeMd = loadClaudeMd(CLAUDE_MD_PATH);
  const threads = await fetchChatGptThreads();
  console.log(`  Found ${threads.length} unresolved ChatGPT thread(s)`);
  if (!threads.length) {
    console.log('  Nothing to respond to — skipping.');
    return;
  }

  const { text: rawText, model: usedModel } = await callClaudeApi(diff, threads, claudeMd);
  if (!rawText) {
    console.warn('Empty Claude response — skipping.');
    return;
  }

  // Attributions name the model that actually responded (which depends on the
  // credential that succeeded), so they are built after the call.
  const attribution = buildAttribution(usedModel);
  const replyAttribution = buildReplyAttribution(usedModel);

  let parsed;
  try {
    parsed = parseResponse(rawText, threads.length);
  } catch (e) {
    console.warn(`JSON parse failed (${e.message}) — posting raw as fallback.`);
    const { comment, updated } = await upsertIssueComment({
      ...GH_CTX,
      marker: FALLBACK_MARKER,
      body: `${FALLBACK_MARKER}\n${rawText}\n\n---\n${attribution}`,
    });
    console.log(`${updated ? 'Updated' : 'Posted'} fallback comment: ${comment.html_url}`);
    return;
  }

  console.log(`  ${parsed.thread_responses.length} response(s)`);

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
    const replyBody = `${emoji} ${tr.reply}${replyAttribution}`;

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

  // Post a fallback comment only when replies failed or the parser dropped
  // entries — preserves every finding rather than silently discarding it.
  const fallbackParts = [];
  if (failed.length) {
    const extras = failed
      .map(
        ({ tr, thread }) =>
          `**${thread.path}:${thread.line}** (could not reply inline)\n\n${verdictEmoji[tr.verdict] || '💬'} ${tr.reply}`
      )
      .join('\n\n---\n\n');
    fallbackParts.push(`**Responses that could not be posted inline:**\n\n${extras}`);
  }
  if (parsed.invalidResponses.length) {
    const dropped = parsed.invalidResponses
      .map((r) => `\`\`\`json\n${JSON.stringify(r, null, 2)}\n\`\`\``)
      .join('\n\n');
    fallbackParts.push(
      `**Malformed thread_responses (could not match to a ChatGPT thread):**\n\n${dropped}`
    );
  }
  if (fallbackParts.length) {
    const { comment: fallback, updated } = await upsertIssueComment({
      ...GH_CTX,
      marker: FALLBACK_MARKER,
      body: `${FALLBACK_MARKER}\n\n${fallbackParts.join('\n\n---\n\n')}\n\n---\n${attribution}`,
    });
    console.log(`  ${updated ? 'Updated' : 'Posted'} fallback: ${fallback.html_url}`);
  }
}

main().catch((err) => die(`Unhandled error: ${err.stack || err.message}`));
