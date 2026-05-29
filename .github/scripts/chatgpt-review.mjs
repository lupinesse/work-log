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
 *   MODEL              default 'gpt-5.5'
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
const GITHUB_TOKEN   = must('GITHUB_TOKEN');
const [OWNER, REPO]  = must('GITHUB_REPOSITORY').split('/');
const PR_NUMBER      = must('PR_NUMBER');
const HEAD_SHA       = must('HEAD_SHA');

const MODEL            = process.env.MODEL            || 'gpt-5.5';
// 'medium' balances CoT depth against token budget; 'high' exhausted 8192
// tokens entirely on reasoning, leaving nothing for visible output.
const REASONING_EFFORT = process.env.REASONING_EFFORT || 'medium';
const MAX_DIFF_CHARS   = parseInt(process.env.MAX_DIFF_CHARS || '50000', 10);
// Budget must cover both internal reasoning tokens and the visible reply.
// 32768 provides headroom for a thorough review even at medium effort.
const MAX_TOKENS       = parseInt(process.env.MAX_TOKENS || '32768', 10);
const DIFF_PATH        = process.env.DIFF_PATH        || 'pr.diff';

const ATTRIBUTION = `*Automated review by ChatGPT \`${MODEL}\` (reasoning_effort: \`${REASONING_EFFORT}\`) · commit \`${HEAD_SHA.slice(0, 7)}\`*`;

const DEFAULT_PROMPT = `You are reviewing a pull request in a personal time-tracking web app (vanilla JavaScript ES modules, SCSS, HTML). The project follows the UK Government Analysis Function Higher QA standard.

Output your review as a single raw JSON object — no markdown wrapper, no text outside the JSON. Schema:
{"verdict":"APPROVE"|"REQUEST_CHANGES"|"COMMENT","summary":"2-4 sentence overall assessment","findings":[{"path":"exact file path from diff header","line":<integer line in new file>,"body":"markdown — prefix with 🔴 Blocking or 🟡 Non-blocking"}]}

Rules for findings: path must exactly match a file path from a diff header line (e.g. src/js/06-focus.js). line must be a real line number in the new (right-side) version of that file — pick the last line of the relevant block if the issue spans multiple lines. Only include a finding when you can cite a specific line; put general observations in summary instead.

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
  return raw.length > MAX_DIFF_CHARS
    ? raw.slice(0, MAX_DIFF_CHARS) + '\n\n[diff truncated]'
    : raw;
}

// ─────────────────────────── OpenAI ───────────────────────────

/**
 * Send the diff to OpenAI and return the raw text of the model's reply.
 * @param {string} diff
 * @returns {Promise<string>}
 */
async function reviewWithOpenAI(diff) {
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
        {
          role: 'user',
          content: `Review this diff:\n\n\`\`\`diff\n${diff}\n\`\`\``,
        },
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
 * @typedef {{ path: string, line: number, body: string }} Finding
 * @typedef {{ verdict: string, summary: string, findings: Finding[] }} Review
 */

/**
 * Parse the raw OpenAI response into a structured review object.
 * Strips any accidental markdown code-fence wrapping before JSON.parse.
 * @param {string} rawText
 * @returns {Review}
 * @throws {Error} if JSON is malformed or required fields are missing.
 */
function parseReviewOutput(rawText) {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const parsed = JSON.parse(cleaned);

  if (!parsed.verdict || !parsed.summary) {
    throw new Error('Missing required fields: verdict, summary');
  }
  const validVerdicts = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];
  if (!validVerdicts.includes(parsed.verdict)) {
    throw new Error(`Unexpected verdict value: ${JSON.stringify(parsed.verdict)}`);
  }
  if (!Array.isArray(parsed.findings)) parsed.findings = [];

  return {
    verdict: parsed.verdict,
    summary: String(parsed.summary),
    findings: parsed.findings
      .filter(f =>
        f &&
        typeof f.path === 'string' &&
        Number.isInteger(f.line) &&
        f.line > 0 &&
        typeof f.body === 'string'
      )
      .map(f => ({ path: f.path.trim(), line: f.line, body: f.body })),
  };
}

// ─────────────────────────── GitHub ───────────────────────────

const GH_HEADERS = {
  Authorization:          `token ${GITHUB_TOKEN}`,
  Accept:                 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type':         'application/json',
};

/**
 * Post the overall PR review (verdict label + summary body, no inline comments).
 * Always uses 'COMMENT' event so the bot review never blocks merge via
 * required-reviewer rules.
 * @param {string} body  Markdown body for the review.
 * @returns {Promise<object>} GitHub API response object.
 */
async function postReview(body) {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/reviews`,
    {
      method: 'POST',
      headers: GH_HEADERS,
      body: JSON.stringify({ commit_id: HEAD_SHA, body, event: 'COMMENT' }),
    }
  );
  if (!response.ok) die(`GitHub reviews API ${response.status}: ${await response.text()}`);
  return response.json();
}

/**
 * Post a single inline pull-request review comment on a specific file line.
 * Each call creates a separate resolvable thread.
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
      headers: GH_HEADERS,
      body: JSON.stringify({ body, commit_id: HEAD_SHA, path, line, side: 'RIGHT' }),
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub comments API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

/**
 * Post a plain issue comment.
 * Used as a fallback when JSON parsing fails or when inline posting fails
 * for a finding — ensures nothing is silently lost.
 * @param {string} body
 * @returns {Promise<object>} GitHub API response object.
 */
async function postIssueComment(body) {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments`,
    {
      method: 'POST',
      headers: GH_HEADERS,
      body: JSON.stringify({ body }),
    }
  );
  if (!response.ok) die(`GitHub issues API ${response.status}: ${await response.text()}`);
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

  const rawText = await reviewWithOpenAI(diff);
  if (!rawText) {
    console.warn('OpenAI returned an empty review — skipping comment.');
    return;
  }

  // Parse the structured JSON output. On failure, fall back to a plain comment
  // so the review is never silently lost.
  let review;
  try {
    review = parseReviewOutput(rawText);
  } catch (parseErr) {
    console.warn(`JSON parse failed (${parseErr.message}) — posting as plain issue comment.`);
    const comment = await postIssueComment(`${rawText}\n\n---\n${ATTRIBUTION}`);
    console.log(`Posted fallback comment: ${comment.html_url}`);
    return;
  }

  console.log(`  verdict: ${review.verdict}, findings: ${review.findings.length}`);

  // Post the top-level review: verdict label + overall summary.
  const reviewBody = `**${review.verdict}** — ${review.summary}\n\n---\n${ATTRIBUTION}`;
  const reviewResult = await postReview(reviewBody);
  console.log(`Posted review (${review.verdict}): ${reviewResult.html_url}`);

  // Post each finding as an individual inline comment thread.
  // Failures (e.g. line not in diff) are collected for a fallback comment
  // rather than silently dropped.
  const unpostable = [];
  for (const finding of review.findings) {
    try {
      const comment = await postInlineComment(finding.path, finding.line, finding.body);
      console.log(`  inline: ${finding.path}:${finding.line} → ${comment.html_url}`);
    } catch (err) {
      console.warn(`  could not post inline on ${finding.path}:${finding.line} — ${err.message}`);
      unpostable.push(finding);
    }
  }

  // Inline findings that the GitHub API rejected (e.g. hallucinated line numbers)
  // go into a single follow-up issue comment so they are visible and resolvable.
  if (unpostable.length > 0) {
    const sections = unpostable
      .map(f => `**\`${f.path}:${f.line}\`**\n\n${f.body}`)
      .join('\n\n---\n\n');
    const fallback = await postIssueComment(
      `The following findings could not be posted as inline comments:\n\n${sections}`
    );
    console.log(`  fallback comment for ${unpostable.length} finding(s): ${fallback.html_url}`);
  }
}

main().catch((error) => die(`Unhandled error: ${error.stack || error.message}`));
