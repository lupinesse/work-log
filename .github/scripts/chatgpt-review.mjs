#!/usr/bin/env node
/**
 * ChatGPT-driven PR code review — posts inline comment threads.
 *
 * Sends the PR diff to OpenAI, expects a structured JSON response with
 * per-line findings, then creates individual inline pull-request review
 * comment threads (one per finding) plus an overall PR review body with
 * the verdict. Each inline thread can be independently resolved by a reviewer.
 *
 * Falls back to a single issue comment if the JSON response cannot be parsed,
 * and posts findings that fail the inline API (invalid path/line) as a
 * follow-up issue comment rather than silently dropping them.
 *
 * All HTTP via native `fetch` (Node ≥ 22); no external deps.
 *
 * Required env vars:
 *   OPENAI_API_KEY     OpenAI bearer token
 *   GITHUB_TOKEN       GitHub auth (App installation token or default)
 *   GITHUB_REPOSITORY  "owner/repo" — auto-set by Actions
 *   PR_NUMBER          Pull-request number
 *   HEAD_SHA           Head SHA of the PR
 *
 * Optional env vars (all have sensible defaults):
 *   MODEL              default 'gpt-5.4'
 *   REASONING_EFFORT   default 'medium' (low | medium | high) — 'high' exhausted the token budget on CoT
 *   PROMPT             default = the project's review brief (below)
 *   MAX_DIFF_CHARS     default 50000 — truncate larger diffs
 *   MAX_TOKENS         default '32768' (covers CoT + visible reply at medium effort)
 *   DIFF_PATH          default 'pr.diff'
 *
 * Note: `temperature` is intentionally omitted from the OpenAI request.
 * Reasoning-class models (GPT-5 family) reject it when `reasoning_effort`
 * is also set — sending both is an API error.
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
import { coerceThreadIndex, normaliseReplyAction } from './lib/parse-reply-action.mjs';
import { normaliseGithubVerdict } from './lib/parse-verdict.mjs';

// ─────────────────────────── helpers ───────────────────────────

/** @param {string} msg */
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

/**
 * Read a required environment variable or exit with an informative error.
 * @param {string} key
 * @returns {string}
 */
const must = (key) => {
  const value = process.env[key];
  if (!value) die(`Missing required env var: ${key}`);
  return value;
};

// ─────────────────────────── config ───────────────────────────

const OPENAI_API_KEY = must('OPENAI_API_KEY');
const GITHUB_TOKEN = must('GITHUB_TOKEN');
const [OWNER, REPO] = must('GITHUB_REPOSITORY').split('/');
const PR_NUMBER = must('PR_NUMBER');
const HEAD_SHA = must('HEAD_SHA');

const MODEL = process.env.MODEL || 'gpt-5.4';
// 'medium' balances CoT depth against token budget; 'high' exhausted 8192
// tokens entirely on reasoning, leaving nothing for visible output.
const REASONING_EFFORT = process.env.REASONING_EFFORT || 'medium';
const MAX_DIFF_CHARS = parseInt(process.env.MAX_DIFF_CHARS || '50000', 10);
// Budget must cover both internal reasoning tokens and the visible reply.
// 32768 provides headroom for a thorough review even at medium effort.
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '32768', 10);
const DIFF_PATH = process.env.DIFF_PATH || 'pr.diff';

const ATTRIBUTION = `*Automated review by ChatGPT \`${MODEL}\` (reasoning_effort: \`${REASONING_EFFORT}\`) · commit \`${HEAD_SHA.slice(0, 7)}\`*`;

// Short attribution appended to every inline reply/finding body so the
// persona is clear regardless of which GitHub account posts it (App token,
// github-actions[bot] fallback, or a manual gh CLI run).
const REPLY_ATTRIBUTION = `\n\n<sub>_— ChatGPT \`${MODEL}\` · \`${HEAD_SHA.slice(0, 7)}\`_</sub>`;

const DEFAULT_PROMPT = `You are reviewing a pull request in a personal time-tracking web app (vanilla JavaScript ES modules, SCSS, HTML). The project follows the UK Government Analysis Function Higher QA standard.

You will be shown the diff AND a list of existing review threads already on this PR (from prior runs of this workflow). For each issue you would raise, you must choose ONE of two actions:

- **reply** — the issue is the same as, or directly related to, an existing thread. Continue the conversation in that thread instead of creating a new one. Use this for: identical findings, the same root cause flagged on a nearby line, an old finding now reappearing in modified code, or a clarification on a thread you previously opened.
- **new** — the issue is genuinely new and does not overlap with any existing thread.

Bias toward **reply** when in doubt. Duplicate inline comments on the same line/issue are the main thing this workflow is trying to avoid.

When replying to a **resolved** thread, set "unresolve": true if the reply represents a regression / re-raise / "issue is back" — that re-opens the thread so the other reviewer (Claude) re-evaluates it. Leave "unresolve" off (or false) for replies that just add context to an already-fixed thread.

Output your review as a single raw JSON object — no markdown wrapper, no text outside the JSON. Schema:
{"verdict":"APPROVE"|"REQUEST_CHANGES"|"COMMENT","summary":"2-4 sentence overall assessment","thread_actions":[{"type":"new","path":"exact file path from diff header","line":<integer line in new file>,"body":"markdown — prefix with 🔴 Blocking or 🟡 Non-blocking"},{"type":"reply","thread_index":<integer matching a thread shown below>,"unresolve":false,"body":"markdown — your follow-up. Reference what you're adding (e.g. 'Still present after the latest commit:' or 'Related issue on this line:')."}]}

Rules: for "new", path must exactly match a file path from a diff header line (e.g. src/js/06-focus.js) and line must be a real line number in the new (right-side) version of that file. For "reply", thread_index must be one of the integers shown in the existing-threads list below. Only include items you can cite specifically; put general observations in summary instead.

Focus on: correctness (logic errors, edge cases, null/undefined), single-purpose functions (flag any doing more than one thing), informative naming (flag single-letter variables outside tight map/filter chains), error handling (use wlLog.warn/error — never silent catch), test coverage (every new exported function needs a unit test in test/unit.cjs). Ignore auto-generated files: script.js, styles.css, docs/*.html. Be direct and specific; cite file and line for every finding.`;

const PROMPT = process.env.PROMPT || DEFAULT_PROMPT;

// ─────────────────────────── diff loading ───────────────────────────

/**
 * Read and optionally truncate the diff file.
 * @returns {string|null} Diff text, or null if the file is empty.
 */
function loadDiff() {
  let raw;
  try {
    raw = readFileSync(DIFF_PATH, 'utf8');
  } catch (error) {
    die(`Could not read diff at '${DIFF_PATH}': ${error.message}`);
  }
  if (!raw.trim()) return null;
  return raw.length > MAX_DIFF_CHARS ? raw.slice(0, MAX_DIFF_CHARS) + '\n\n[diff truncated]' : raw;
}

// ─────────────────────────── OpenAI ───────────────────────────

/**
 * Send the diff and existing-thread context to OpenAI and return the raw
 * text of the model's reply.
 *
 * @param {string} diff
 * @param {import('./lib/github-threads.mjs').ThreadSummary[]} existingThreads
 * @returns {Promise<string>}
 */
async function reviewWithOpenAI(diff, existingThreads) {
  const threadBlock = formatThreadsForPrompt(existingThreads);
  const userContent =
    `Existing review threads on this PR (reply to one of these if your finding overlaps; otherwise post new):\n\n${threadBlock}\n\n` +
    `PR diff:\n\`\`\`diff\n${diff}\n\`\`\``;

  // lgtm[js/file-access-to-http] — diff is trusted CI output, not user input
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: REASONING_EFFORT,
      max_completion_tokens: MAX_TOKENS,
      // No `temperature` — GPT-5 reasoning models reject it alongside
      // `reasoning_effort`. Reasoning level is the controlling knob.
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!response.ok) die(`OpenAI API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (data.error) die(`OpenAI API error (${data.error.code}): ${data.error.message}`);
  return (data.choices?.[0]?.message?.content || '').trim();
}

// ─────────────────────────── output parsing ───────────────────────────

/**
 * @typedef {{ type: 'new', path: string, line: number, body: string }} NewAction
 * @typedef {{ type: 'reply', threadIndex: number, body: string, unresolve: boolean }} ReplyAction
 * @typedef {NewAction | ReplyAction} ThreadAction
 * @typedef {{ verdict: string, summary: string, actions: ThreadAction[], invalidActions: unknown[] }} Review
 */

/**
 * Parse the raw OpenAI response into a structured review object.
 * Strips any accidental markdown code-fence wrapping before JSON.parse.
 * Normalises recoverable values (e.g. numeric string → integer line number).
 * Unrecoverable actions are collected in `invalidActions` so the caller
 * can include them in a fallback comment instead of silently dropping them.
 *
 * Accepts the new dual-mode schema (`thread_actions`) and falls back to the
 * legacy `findings` schema for backwards compatibility — older model output
 * is treated as all "new" actions.
 *
 * @param {string} rawText
 * @param {number} existingThreadCount  Used to validate reply thread_index.
 * @returns {Review}
 * @throws {Error} if JSON is malformed or required fields are missing.
 */
function parseReviewOutput(rawText, existingThreadCount) {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const parsed = JSON.parse(cleaned);

  const verdict = normaliseGithubVerdict(parsed.verdict);
  if (!parsed.summary) {
    throw new Error('Missing required fields: summary');
  }

  // Accept either the new `thread_actions` schema or the legacy `findings`
  // schema (treated as all type="new").
  const rawActions = Array.isArray(parsed.thread_actions)
    ? parsed.thread_actions
    : Array.isArray(parsed.findings)
      ? parsed.findings.map((f) => ({ type: 'new', ...f }))
      : [];

  const actions = [];
  const invalidActions = [];

  for (const a of rawActions) {
    if (!a || typeof a !== 'object') {
      invalidActions.push(a);
      continue;
    }
    // Trim and validate type; absent type defaults to 'new'. Unknown values
    // (e.g. true, "NEW", "new ") are rejected to invalidActions so they don't
    // silently post as inline comments.
    const type = typeof a.type === 'string' ? a.type.trim() : 'new';
    if (type !== 'new' && type !== 'reply') {
      console.warn(`  unknown action type ${JSON.stringify(a.type)} — moved to fallback`);
      invalidActions.push(a);
      continue;
    }
    const body = typeof a.body === 'string' ? a.body.trim() : null;
    if (!body) {
      invalidActions.push(a);
      continue;
    }

    if (type === 'reply') {
      try {
        const normalised = normaliseReplyAction(a, existingThreadCount);
        actions.push({ type: 'reply', ...normalised });
      } catch (err) {
        console.warn(`  invalid reply action — ${err.message} — moved to fallback`);
        invalidActions.push(a);
        continue;
      }
    } else {
      const path = typeof a.path === 'string' ? a.path.trim() : null;
      const rawLine = a.line;
      const line = coerceThreadIndex(rawLine);
      if (!path || line === null || line <= 0) {
        console.warn(
          `  invalid new action (path=${JSON.stringify(path)}, line=${JSON.stringify(rawLine)}) — moved to fallback`
        );
        invalidActions.push(a);
        continue;
      }
      actions.push({ type: 'new', path, line, body });
    }
  }

  return {
    verdict,
    summary: String(parsed.summary),
    actions,
    invalidActions,
  };
}

// ─────────────────────────── GitHub ───────────────────────────

// Identifies this phase's top-level review for upsert across runs. The
// attribution footer is included in every review body and is stable enough
// to use as a marker — Phase 4's review uses "responding to Claude" instead.
const REVIEW_MARKER = 'Automated review by ChatGPT';
const FALLBACK_MARKER = '<!-- chatgpt-phase1-fallback -->';

const GH_CTX = { token: GITHUB_TOKEN, owner: OWNER, repo: REPO, prNumber: parseInt(PR_NUMBER, 10) };

/**
 * Post a single inline pull-request review comment on a specific file line.
 * Each call creates a separate resolvable thread. Used only when no related
 * existing thread is appropriate.
 * @param {string} path  File path relative to the repo root.
 * @param {number} line  Line number in the new (right-side) version of the file.
 * @param {string} body  Comment body (markdown).
 * @returns {Promise<object>} GitHub API response object.
 * @throws {Error} if the API rejects the comment (e.g. line not in the diff).
 */
async function postInlineComment(path, line, body) {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body, commit_id: HEAD_SHA, path, line, side: 'RIGHT' }),
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub comments API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

// ─────────────────────────── main ───────────────────────────

async function main() {
  console.log(
    `ChatGPT review for ${OWNER}/${REPO} PR #${PR_NUMBER} (head ${HEAD_SHA.slice(0, 7)})`
  );
  console.log(`  model: ${MODEL}, reasoning_effort: ${REASONING_EFFORT}`);

  const diff = loadDiff();
  if (!diff) {
    console.log(
      `Empty diff at '${DIFF_PATH}' (after generated-file filtering) — nothing to review.`
    );
    return;
  }
  console.log(`  diff size: ${diff.length} chars`);

  // Pull existing threads so the model can choose to reply rather than
  // duplicate. We only show threads (not Claude's issue comments) — those
  // would dilute the dedup signal without helping much.
  const existingThreads = await fetchAllThreads(GH_CTX);
  console.log(`  existing threads on PR: ${existingThreads.length}`);

  const rawText = await reviewWithOpenAI(diff, existingThreads);
  if (!rawText) {
    console.warn('OpenAI returned an empty review — skipping comment.');
    return;
  }

  // Parse the structured JSON output. On failure, fall back to a plain comment
  // so the review is never silently lost.
  let review;
  try {
    review = parseReviewOutput(rawText, existingThreads.length);
  } catch (parseErr) {
    console.warn(`JSON parse failed (${parseErr.message}) — posting as plain issue comment.`);
    const { comment, updated } = await upsertIssueComment({
      ...GH_CTX,
      marker: FALLBACK_MARKER,
      body: `${FALLBACK_MARKER}\n${rawText}\n\n---\n${ATTRIBUTION}`,
    });
    console.log(`${updated ? 'Updated' : 'Posted'} fallback comment: ${comment.html_url}`);
    return;
  }

  const newCount = review.actions.filter((a) => a.type === 'new').length;
  const replyCount = review.actions.filter((a) => a.type === 'reply').length;
  console.log(
    `  verdict: ${review.verdict}, new: ${newCount}, replies: ${replyCount}` +
      (review.invalidActions.length ? `, invalid (fallback): ${review.invalidActions.length}` : '')
  );

  // Upsert the top-level review (replaces any previous Phase 1 review from
  // this bot rather than stacking one per push).
  const reviewBody = `**${review.verdict}** — ${review.summary}\n\n---\n${ATTRIBUTION}`;
  const { review: reviewResult, replaced } = await upsertReview({
    ...GH_CTX,
    headSha: HEAD_SHA,
    marker: REVIEW_MARKER,
    body: reviewBody,
  });
  console.log(
    `${replaced ? 'Replaced' : 'Posted'} review (${review.verdict}): ${reviewResult.html_url}`
  );

  // Dispatch each action: replies go to existing threads, news create them.
  // Re-raises on resolved threads unresolve them first so Phase 2 picks them
  // up and Claude posts a fresh verdict.
  const unpostable = [];
  for (const a of review.actions) {
    const bodyWithAttribution = `${a.body}${REPLY_ATTRIBUTION}`;
    try {
      if (a.type === 'reply') {
        const target = existingThreads[a.threadIndex];
        if (a.unresolve && target.isResolved) {
          try {
            await unresolveThread({ ...GH_CTX, threadId: target.id });
            console.log(`  unresolved thread ${a.threadIndex} (re-raise)`);
          } catch (err) {
            // Non-fatal — post the reply anyway so the regression is visible.
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

  // Build the fallback comment from unpostable actions + invalid actions
  // (parse rejects). Nothing the model produced is silently dropped.
  const fallbackEntries = [
    ...unpostable.map((a) => ({
      label: a.type === 'reply' ? `(reply to thread ${a.threadIndex})` : `${a.path}:${a.line}`,
      body: a.body,
    })),
    ...review.invalidActions.map((a) => ({
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

main().catch((error) => die(`Unhandled error: ${error.stack || error.message}`));
