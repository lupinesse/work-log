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
 * @typedef {{
 *   path: string,
 *   line: number,
 *   chatgptBody: string,
 *   claudeVerdict: string|null,
 *   claudeReply: string|null,
 * }} ThreadHistoryEntry
 *
 * @typedef {{
 *   synthesis: string|null,
 *   finalReview: string|null,
 *   threadHistory: ThreadHistoryEntry[],
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
 * Fetch Phase 1 thread history: each ChatGPT-authored review thread, with
 * Claude's verdict reply if one was posted in Phase 2.
 *
 * Used to tell ChatGPT in Phase 4 exactly what Claude already addressed, so
 * it does not re-raise rejected findings.
 *
 * @returns {Promise<ThreadHistoryEntry[]>}
 */
async function fetchThreadHistory() {
  const query = `
    query($owner:String!, $name:String!, $number:Int!) {
      repository(owner:$owner, name:$name) {
        pullRequest(number:$number) {
          reviewThreads(first:100) {
            nodes {
              comments(first:10) {
                nodes {
                  author { login }
                  body
                  path
                  originalLine
                }
              }
            }
          }
        }
      }
    }`;

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: GH_HEADERS,
    body: JSON.stringify({
      query,
      variables: { owner: OWNER, name: REPO, number: parseInt(PR_NUMBER, 10) },
    }),
  });
  if (!response.ok) die(`GitHub GraphQL ${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (data.errors) die(`GraphQL errors: ${JSON.stringify(data.errors)}`);

  const history = [];
  for (const t of data.data.repository.pullRequest.reviewThreads.nodes) {
    const comments = t.comments.nodes;
    if (!comments.length) continue;
    const first = comments[0];
    const firstLogin = (first.author?.login || '').toLowerCase();
    // Only include threads whose first comment is from the ChatGPT Reviewer App.
    // Tolerates token fallback (github-actions[bot]) by also matching body markers.
    const isChatGpt = firstLogin.includes('chatgpt') || /^🔴|^🟡|^🔵/.test(first.body || '');
    if (!isChatGpt) continue;

    // Find Claude's reply — the first non-ChatGPT reply with a recognised verdict emoji.
    let claudeVerdict = null;
    let claudeReply = null;
    for (const c of comments.slice(1)) {
      const v = parseVerdictFromReply(c.body || '');
      if (v) { claudeVerdict = v; claudeReply = c.body; break; }
    }

    history.push({
      path: first.path,
      line: first.originalLine,
      chatgptBody: first.body,
      claudeVerdict,
      claudeReply,
    });
  }
  return history;
}

/**
 * Fetch Claude's context from PR issue comments:
 * - synthesis: Phase 2 output — how Claude responded to ChatGPT's threads.
 * - finalReview: Phase 3 output — Claude's independent /pr-review verdict,
 *   posted by the claude-final-review job after the thread resolution.
 *
 * Both are identified by their attribution footers and the Claude Reviewer
 * bot login. Returns the most recent match for each.
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
 * Convenience wrapper — fetches issue comments and thread history in parallel
 * and returns the full ClaudeContext for the OpenAI prompt.
 * @returns {Promise<ClaudeContext>}
 */
async function fetchClaudeContext() {
  const [issueComments, threadHistory] = await Promise.all([
    fetchClaudeIssueComments(),
    fetchThreadHistory(),
  ]);
  return { ...issueComments, threadHistory };
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
  const { synthesis, finalReview, threadHistory } = claudeContext;

  // Build the context block shown to ChatGPT — include whatever is available.
  const contextBlocks = [];

  if (threadHistory.length) {
    const historyLines = threadHistory.map((h, i) => {
      const verdict = h.claudeVerdict || '(no reply)';
      const reply = h.claudeReply ? h.claudeReply.trim() : '(Claude did not reply)';
      return `### Thread ${i + 1} — \`${h.path}:${h.line}\`\n\n**Your original finding:**\n${h.chatgptBody}\n\n**Claude's verdict:** \`${verdict}\`\n\n**Claude's reply:** ${reply}`;
    }).join('\n\n---\n\n');
    contextBlocks.push(`**Phase 1 thread history (your findings + Claude's per-thread verdicts):**\n\n${historyLines}`);
  }
  if (synthesis) {
    contextBlocks.push(`**Claude's synthesis (response to your Phase 1 threads):**\n\n${synthesis}`);
  }
  if (finalReview) {
    contextBlocks.push(`**Claude's final /pr-review verdict (posted after resolving your threads):**\n\n${finalReview}`);
  }
  const claudeContext_ = contextBlocks.join('\n\n---\n\n');

  const system = `You are ChatGPT, an AI code reviewer. You have already posted your own independent inline review findings on this pull request. Now you are reading Claude's full response:

1. Claude replied to each of your inline threads with a verdict (agree_fix / agree_noted / disagree / partial) and explanation.
2. Claude posted a synthesis comment.
3. Claude then ran its own complete /pr-review and posted that verdict.

**CRITICAL — Claude is the implementing author. Claude's verdict on a finding is FINAL:**

- If Claude rejected a finding with \`disagree\`: do NOT re-raise the same finding, do not re-litigate it, do not flag the same line for the same reason in different words. Claude has read your concern and explained why it does not apply. Move on.
- If Claude accepted with \`agree_fix\`: trust the stated fix plan. Only push back if Claude's reply contradicts the diff (e.g. Claude said "will fix in this PR" but the diff clearly does not fix it).
- If Claude accepted with \`agree_noted\` (acknowledged but deferred): do not re-raise.
- If Claude responded \`partial\`: you may push back on the part Claude rejected, but only with new evidence — not a restatement of the original finding.

Your task:
1. Identify ONLY issues that are genuinely new — things Claude's review (per-thread replies, synthesis, and /pr-review) did not address at all. Each must be anchored to a specific file path and line number from the diff.
2. If the diff has new commits since Phase 1 (visible at the top of the diff), it is fair game to flag issues introduced by those new commits.
3. If you have no new findings, say so clearly in the summary and return an empty new_findings array. That is the expected outcome when Claude's review was thorough.

Output a single raw JSON object — no markdown wrapper:
{
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "summary": "<3-5 sentences: your overall response to Claude's verdict, what still concerns you (only NEW concerns), what you consider resolved>",
  "new_findings": [
    {
      "path": "<exact file path from diff header>",
      "line": <integer line in new file>,
      "body": "<markdown — prefix with 🔴 Blocking or 🟡 Non-blocking. Must NOT duplicate a finding already in the thread history above.>"
    }
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
  const rejectedCount = claudeContext.threadHistory.filter(h => h.claudeVerdict === 'disagree').length;
  console.log(
    `  Claude context: synthesis=${!!claudeContext.synthesis}, finalReview=${!!claudeContext.finalReview}, ` +
    `threadHistory=${claudeContext.threadHistory.length} (rejected=${rejectedCount})`
  );

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
