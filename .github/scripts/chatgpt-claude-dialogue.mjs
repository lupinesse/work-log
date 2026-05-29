#!/usr/bin/env node
/**
 * Phase 3 of the review dialogue — ChatGPT responds to Claude's synthesis.
 *
 * 1. Fetch Claude's synthesis comment from the PR issue comments.
 * 2. Fetch any unresolved inline threads Claude posted (Phase 2 reply threads
 *    that were not resolved, if any remain).
 * 3. Call OpenAI with diff + Claude's synthesis as context.
 * 4. ChatGPT either confirms resolutions or opens new inline threads for
 *    anything it disagrees with or that Claude missed.
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

/**
 * @typedef {{ synthesis: string|null, finalReview: string|null }} ClaudeContext
 */

/**
 * Fetch Claude's context from PR issue comments:
 * - synthesis: Phase 2 output — how Claude responded to ChatGPT's threads.
 * - finalReview: Phase 3 output — Claude's independent /pr-review verdict,
 *   posted by the claude-final-review job after the thread resolution.
 *
 * Both are identified by their attribution footers and the Claude Reviewer
 * bot login. Returns the most recent match for each.
 * @returns {Promise<ClaudeContext>}
 */
async function fetchClaudeContext() {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments?per_page=100`,
    { headers: GH_HEADERS }
  );
  if (!response.ok) die(`Issue comments API ${response.status}: ${await response.text()}`);
  const comments = await response.json();

  let synthesis   = null;
  let finalReview = null;

  // Walk newest-first so we pick up the latest version of each type.
  // Identify Claude's comments by body content only — not by login — so the
  // lookup is resilient to token-fallback cases where the comment is posted
  // by github-actions[bot] instead of the Claude Reviewer App.
  for (const c of [...comments].reverse()) {
    if (!synthesis && c.body.includes("Claude's synthesis")) {
      synthesis = c.body;
    }
    if (!finalReview && c.body.includes('/pr-review')) {
      finalReview = c.body;
    }
    if (synthesis && finalReview) break;
  }

  return { synthesis, finalReview };
}

/**
 * Post the overall PR review (verdict label + summary body).
 * Uses 'COMMENT' so it never blocks merge via required-reviewer rules.
 * @param {string} body
 * @returns {Promise<object>}
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

/**
 * Post a plain issue comment.
 * @param {string} body
 * @returns {Promise<object>}
 */
async function postIssueComment(body) {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments`,
    { method: 'POST', headers: GH_HEADERS, body: JSON.stringify({ body }) }
  );
  if (!response.ok) die(`Issue comment API ${response.status}: ${await response.text()}`);
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
  const { synthesis, finalReview } = claudeContext;

  // Build the context block shown to ChatGPT — include whatever is available.
  const contextBlocks = [];
  if (synthesis) {
    contextBlocks.push(`**Claude's synthesis (response to your Phase 1 threads):**\n\n${synthesis}`);
  }
  if (finalReview) {
    contextBlocks.push(`**Claude's final /pr-review verdict (posted after resolving your threads):**\n\n${finalReview}`);
  }
  const claudeContext_ = contextBlocks.join('\n\n---\n\n');

  const system = `You are ChatGPT, an AI code reviewer. You have already posted your own independent inline review findings on this pull request. Now you are reading Claude's full response:

1. Claude replied to each of your inline threads (agreeing, disagreeing, or partially agreeing) and posted a synthesis comment.
2. Claude then ran its own complete /pr-review and posted that verdict.

Your task:
1. Assess whether Claude's final verdict and synthesis cover all the important issues in this PR.
2. Identify anything Claude missed entirely or got wrong — raise these as new findings, each anchored to a specific file path and line number from the diff.
3. If you have no new findings and largely agree with Claude's overall assessment, say so clearly.

Output a single raw JSON object — no markdown wrapper:
{
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "summary": "<3-5 sentences: your overall response to Claude's verdict, what still concerns you, what you consider resolved>",
  "new_findings": [
    {
      "path": "<exact file path from diff header>",
      "line": <integer line in new file>,
      "body": "<markdown — prefix with 🔴 Blocking or 🟡 Non-blocking>"
    }
  ]
}

Rules for new_findings: only include a finding if Claude's response did not address it and it represents a real problem. If Claude's review correctly covered all your concerns, return an empty array.`;

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
 * @typedef {{ path: string, line: number, body: string }} Finding
 * @typedef {{ verdict: string, summary: string, new_findings: Finding[] }} DialogueResponse
 */

/**
 * @param {string} rawText
 * @returns {DialogueResponse}
 * @throws {Error}
 */
function parseResponse(rawText) {
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(cleaned);

  if (!parsed.verdict || !parsed.summary) {
    throw new Error('Missing required fields: verdict, summary');
  }
  const validVerdicts = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];
  if (!validVerdicts.includes(parsed.verdict)) {
    throw new Error(`Unexpected verdict value: ${JSON.stringify(parsed.verdict)}`);
  }
  if (!Array.isArray(parsed.new_findings)) parsed.new_findings = [];

  return {
    verdict: parsed.verdict,
    summary: String(parsed.summary),
    new_findings: parsed.new_findings
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
  console.log(`  Claude context: synthesis=${!!claudeContext.synthesis}, finalReview=${!!claudeContext.finalReview}`);

  const rawText = await callOpenAI(diff, claudeContext);
  if (!rawText) { console.warn('OpenAI returned an empty response — skipping.'); return; }

  let parsed;
  try {
    parsed = parseResponse(rawText);
  } catch (e) {
    console.warn(`JSON parse failed (${e.message}) — posting raw as fallback.`);
    const c = await postIssueComment(`${rawText}\n\n---\n${ATTRIBUTION}`);
    console.log(`Fallback comment: ${c.html_url}`);
    return;
  }

  console.log(`  verdict: ${parsed.verdict}, new findings: ${parsed.new_findings.length}`);

  // Post the top-level response as a review.
  const reviewBody = `**${parsed.verdict}** — ${parsed.summary}\n\n---\n${ATTRIBUTION}`;
  const reviewResult = await postReview(reviewBody);
  console.log(`Posted review (${parsed.verdict}): ${reviewResult.html_url}`);

  // Post any new findings as inline threads.
  const unpostable = [];
  for (const finding of parsed.new_findings) {
    try {
      const comment = await postInlineComment(finding.path, finding.line, finding.body);
      console.log(`  inline: ${finding.path}:${finding.line} → ${comment.html_url}`);
    } catch (err) {
      console.warn(`  could not post inline on ${finding.path}:${finding.line} — ${err.message}`);
      unpostable.push(finding);
    }
  }

  if (unpostable.length > 0) {
    const sections = unpostable
      .map(f => `**\`${f.path}:${f.line}\`**\n\n${f.body}`)
      .join('\n\n---\n\n');
    const fallback = await postIssueComment(
      `The following new findings could not be posted as inline comments:\n\n${sections}\n\n---\n${ATTRIBUTION}`
    );
    console.log(`  fallback comment for ${unpostable.length} finding(s): ${fallback.html_url}`);
  }
}

main().catch((err) => die(`Unhandled error: ${err.stack || err.message}`));
