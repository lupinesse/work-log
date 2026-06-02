#!/usr/bin/env node
/**
 * ChatGPT-driven PR code review — Phase 1 of the AI dialogue.
 *
 * Sends the PR diff to OpenAI, expects a structured JSON response with
 * per-line findings. New findings are batched into a single review
 * submission (one "reviewed" banner). Replies go to existing threads.
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
 *   MODEL              default 'gpt-4o-2024-08-06'
 *   PROMPT             default = the project's review brief (below)
 *   MAX_DIFF_CHARS     default 30000 — truncate larger diffs
 *   MAX_TOKENS         default '3072'
 *   DIFF_PATH          default 'pr.diff'
 */

import { readFileSync } from 'node:fs';
import {
  addReactionToComment,
  fetchAllThreads,
  formatThreadsForPrompt,
  ghHeaders,
  replyToThread,
  unresolveThread,
  upsertIssueComment,
} from './lib/github-threads.mjs';
import { coerceThreadIndex, normaliseReplyAction } from './lib/parse-reply-action.mjs';

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

const MODEL = process.env.MODEL || 'gpt-4o-2024-08-06';
const MAX_DIFF_CHARS = parseInt(process.env.MAX_DIFF_CHARS || '30000', 10);
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '3072', 10);
const DIFF_PATH = process.env.DIFF_PATH || 'pr.diff';

const ATTRIBUTION = `*Automated review by ChatGPT \`${MODEL}\` · commit \`${HEAD_SHA.slice(0, 7)}\`*`;

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
{"thread_actions":[{"type":"new","path":"exact file path from diff header","line":<integer line in new file>,"body":"markdown — prefix with 🔴 Blocking or 🟡 Non-blocking"},{"type":"reply","thread_index":<integer matching a thread shown below>,"unresolve":false,"body":"markdown — your follow-up. Reference what you're adding (e.g. 'Still present after the latest commit:' or 'Related issue on this line:')."}]}

Rules: for "new", path must exactly match a file path from a diff header line (e.g. src/js/06-focus.js) and line must be a real line number in the new (right-side) version of that file. For "reply", thread_index must be one of the integers shown in the existing-threads list below. Only include items you can cite specifically; put general observations in summary instead.

Focus on: correctness (logic errors, edge cases, null/undefined), single-purpose functions (flag any doing more than one thing), informative naming (flag single-letter variables outside tight map/filter chains), error handling (use wlLog.warn/error — never silent catch), test coverage (every new exported function in .github/scripts/lib/ needs a unit test — tests live in .github/scripts/test/*.test.mjs, not test/unit.cjs which does not exist). Ignore auto-generated files: script.js, styles.css, docs/*.html. Be direct and specific; cite file and line for every finding.

Important: if you would raise a \`new\` finding at a path+line that is already covered by an existing thread (open or resolved), use \`reply\` instead — the runtime suppresses exact-location duplicates with a 👀 reaction rather than posting a separate comment.`;

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
      temperature: 0.2,
      max_completion_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!response.ok) die(`OpenAI API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (data.error) die(`OpenAI API error (${data.error.code}): ${data.error.message}`);
  const usage = data.usage ?? {};
  console.log(
    `  tokens: ${usage.prompt_tokens ?? '?'} in / ${usage.completion_tokens ?? '?'} out` +
      (usage.total_tokens != null ? ` / ${usage.total_tokens} total` : '')
  );
  return (data.choices?.[0]?.message?.content || '').trim();
}

// ─────────────────────────── output parsing ───────────────────────────

/**
 * @typedef {{ type: 'new', path: string, line: number, body: string }} NewAction
 * @typedef {{ type: 'reply', threadIndex: number, body: string, unresolve: boolean }} ReplyAction
 * @typedef {NewAction | ReplyAction} ThreadAction
 * @typedef {{ actions: ThreadAction[], invalidActions: unknown[] }} Review
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
    // Absent type (undefined/null) defaults to 'new' for legacy-schema compat.
    // Non-string non-null values (e.g. true, 123) are model errors and go to
    // fallback. Unknown strings ("NEW", "new ") also go to fallback.
    const rawType = a.type;
    const type = rawType == null ? 'new' : typeof rawType === 'string' ? rawType.trim() : null;
    if (type === null || (type !== 'new' && type !== 'reply')) {
      console.warn(`  unknown action type ${JSON.stringify(rawType)} — moved to fallback`);
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
    actions,
    invalidActions,
  };
}

// ─────────────────────────── GitHub ───────────────────────────

const FALLBACK_MARKER = '<!-- chatgpt-phase1-fallback -->';

const GH_CTX = { token: GITHUB_TOKEN, owner: OWNER, repo: REPO, prNumber: parseInt(PR_NUMBER, 10) };

// ─────────────────────────── GitHub posting ───────────────────────────

/**
 * Post all new findings as a single batched review so the PR shows one
 * "reviewed" banner regardless of how many findings there are.
 *
 * @param {Array<{path: string, line: number, body: string}>} findings
 * @returns {Promise<object>} GitHub API review object.
 */
async function postBatchedReview(findings) {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/reviews`,
    {
      method: 'POST',
      headers: ghHeaders(GITHUB_TOKEN),
      body: JSON.stringify({
        commit_id: HEAD_SHA,
        event: 'COMMENT',
        comments: findings.map((f) => ({
          path: f.path,
          line: f.line,
          side: 'RIGHT',
          body: f.body,
        })),
      }),
    }
  );
  if (!response.ok)
    throw new Error(`Batch review API ${response.status}: ${await response.text()}`);
  return response.json();
}

// ─────────────────────────── main ───────────────────────────

async function main() {
  console.log(
    `ChatGPT review for ${OWNER}/${REPO} PR #${PR_NUMBER} (head ${HEAD_SHA.slice(0, 7)})`
  );
  console.log(`  model: ${MODEL}`);

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
    `  new: ${newCount}, replies: ${replyCount}` +
      (review.invalidActions.length ? `, invalid (fallback): ${review.invalidActions.length}` : '')
  );

  // Pass 1 — replies go to existing threads individually (each gets its own
  // replyToThread call so thread context is preserved).
  const unpostable = [];
  for (const a of review.actions.filter((x) => x.type === 'reply')) {
    const bodyWithAttribution = `${a.body}${REPLY_ATTRIBUTION}`;
    try {
      const target = existingThreads[a.threadIndex];
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
      console.log(
        `  reply → ${target.path}:${target.line} (thread ${a.threadIndex}): ${reply.html_url}`
      );
    } catch (err) {
      console.warn(`  could not post reply thread[${a.threadIndex}] — ${err.message}`);
      unpostable.push(a);
    }
  }

  // Pass 2 — new findings batched into one review so the PR shows one
  // "reviewed" banner regardless of how many findings there are.
  //
  // Before batching, check each finding against existing threads: if the model
  // produced a "new" action at a path+line already covered by an existing
  // thread it should have replied to instead, suppress the duplicate and react
  // with 👀 on the original so the reviewer knows the issue was re-noticed.
  const newActions = [];
  for (const a of review.actions.filter((x) => x.type === 'new')) {
    const dup = existingThreads.find((t) => t.path === a.path && t.line === a.line);
    if (dup) {
      try {
        await addReactionToComment({ ...GH_CTX, commentId: dup.firstCommentId, content: 'eyes' });
        console.log(
          `  duplicate suppressed — reacted 👀 on existing thread at ${a.path}:${a.line}`
        );
      } catch (err) {
        console.warn(
          `  could not react to duplicate at ${a.path}:${a.line} — ${err.message} — posting anyway`
        );
        newActions.push(a);
      }
    } else {
      newActions.push(a);
    }
  }
  if (newActions.length > 0) {
    const findings = newActions.map((a) => ({
      path: a.path,
      line: a.line,
      body: `${a.body}${REPLY_ATTRIBUTION}`,
    }));
    try {
      const batchResult = await postBatchedReview(findings);
      console.log(`  batched ${findings.length} new finding(s): ${batchResult.html_url}`);
    } catch (batchErr) {
      console.warn(`  batch review failed (${batchErr.message}) — retrying individually`);
      for (const f of findings) {
        let retryError = '';
        try {
          const resp = await fetch(
            `https://api.github.com/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/reviews`,
            {
              method: 'POST',
              headers: ghHeaders(GITHUB_TOKEN),
              body: JSON.stringify({
                commit_id: HEAD_SHA,
                event: 'COMMENT',
                comments: [{ path: f.path, line: f.line, side: 'RIGHT', body: f.body }],
              }),
            }
          );
          if (resp.ok) {
            console.log(`  individual retry: ${f.path}:${f.line}`);
          } else {
            retryError = `HTTP ${resp.status}: ${await resp.text()}`;
          }
        } catch (retryErr) {
          retryError = retryErr.message;
        }
        if (retryError) {
          console.warn(`  could not post ${f.path}:${f.line} — ${retryError}`);
          unpostable.push({ path: f.path, line: f.line, body: f.body });
        }
      }
    }
  }

  // Build the fallback comment from unpostable actions + invalid actions
  // (parse rejects). Nothing the model produced is silently dropped.
  const fallbackEntries = [
    ...unpostable.map((a) => ({
      label:
        a.type === 'reply'
          ? `(reply to thread ${a.threadIndex})`
          : `${a.path ?? '?'}:${a.line ?? '?'}`,
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
