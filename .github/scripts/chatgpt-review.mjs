#!/usr/bin/env node
/**
 * ChatGPT-driven PR code review.
 *
 * Standalone replacement for `anc95/ChatGPT-CodeReview` after that action
 * stopped tracking current OpenAI features (no `reasoning_effort` parameter,
 * Node 20 runtime deprecated by GitHub Actions in June 2026, sparse
 * maintenance). Extracted from the inline `actions/github-script` block that
 * previously lived in `.github/workflows/chatgpt-pr-review.yml` so the logic
 * can be read, tested, and modified in a real `.mjs` file with proper
 * tooling rather than 100 lines of JavaScript embedded in YAML.
 *
 * Behaviour: read the pre-filtered diff at `pr.diff` (written by the
 * workflow), send it to one OpenAI chat-completions call with
 * `reasoning_effort: 'high'`, and post the review as a single PR issue
 * comment. Single-call / single-comment by design — keeps the per-PR
 * OpenAI bill small for a personal project.
 *
 * All HTTP via native `fetch` (Node ≥ 22); no external deps.
 *
 * Required env vars:
 *   OPENAI_API_KEY     OpenAI bearer token
 *   GITHUB_TOKEN       GitHub auth (App installation token or default)
 *   GITHUB_REPOSITORY  "owner/repo" — auto-set by Actions
 *   PR_NUMBER          Pull-request number
 *   HEAD_SHA           Head SHA of the PR (used only in the attribution footer)
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

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

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

const MODEL = process.env.MODEL || 'gpt-5.5';
// 'medium' balances CoT depth against token budget; 'high' exhausted 8192
// tokens entirely on reasoning, leaving nothing for visible output.
const REASONING_EFFORT = process.env.REASONING_EFFORT || 'medium';
const MAX_DIFF_CHARS = parseInt(process.env.MAX_DIFF_CHARS || '50000', 10);
// Reasoning models use max_completion_tokens, not max_tokens.
// Budget must cover both internal reasoning tokens and the visible reply.
// 32768 provides headroom for a thorough review even at medium effort.
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '32768', 10);
const DIFF_PATH = process.env.DIFF_PATH || 'pr.diff';

const DEFAULT_PROMPT = [
  'You are reviewing a pull request in a personal time-tracking web app',
  '(vanilla JavaScript ES modules, SCSS, HTML). The project follows the',
  'UK Government Analysis Function Higher QA standard. Focus on:',
  'correctness (logic errors, edge cases, null/undefined),',
  'single-purpose functions (flag any function doing more than one thing),',
  'informative naming (flag single-letter variables outside tight map/filter chains),',
  'error handling (failures must call wlLog.warn or wlLog.error — never silent catch),',
  'and test coverage (every new exported function needs a unit test in test/unit.cjs).',
  'Ignore auto-generated files: script.js, styles.css, docs/*.html.',
  'Be direct and specific; cite file and line number for every finding.',
].join(' ');

const PROMPT = process.env.PROMPT || DEFAULT_PROMPT;

// ─────────────────────────── diff loading ───────────────────────────

function loadDiff() {
  let raw;
  try {
    raw = readFileSync(DIFF_PATH, 'utf8');
  } catch (error) {
    die(`Could not read diff at '${DIFF_PATH}': ${error.message}`);
  }
  if (!raw.trim()) return null;
  if (raw.length > MAX_DIFF_CHARS) {
    return raw.slice(0, MAX_DIFF_CHARS) + '\n\n[diff truncated]';
  }
  return raw;
}

// ─────────────────────────── OpenAI ───────────────────────────

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

  if (!response.ok) {
    die(`OpenAI API ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  if (data.error) {
    die(`OpenAI API error (${data.error.code}): ${data.error.message}`);
  }
  return (data.choices?.[0]?.message?.content || '').trim();
}

// ─────────────────────────── GitHub ───────────────────────────

async function postComment(body) {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    }
  );
  if (!response.ok) {
    die(`GitHub API ${response.status}: ${await response.text()}`);
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

  const reviewText = await reviewWithOpenAI(diff);
  if (!reviewText) {
    console.warn('OpenAI returned an empty review — skipping comment.');
    return;
  }

  const body = `${reviewText}\n\n---\n*Automated review by ChatGPT \`${MODEL}\` (reasoning_effort: \`${REASONING_EFFORT}\`) · commit \`${HEAD_SHA.slice(0, 7)}\`*`;
  const comment = await postComment(body);
  console.log(`Posted: ${comment.html_url}`);
}

main().catch((error) => die(`Unhandled error: ${error.stack || error.message}`));
