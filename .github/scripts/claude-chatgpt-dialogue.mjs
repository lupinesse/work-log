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
 *   ANTHROPIC_API_KEY  Anthropic API key
 *   GITHUB_TOKEN       GitHub auth (Claude Reviewer App token or fallback)
 *   GITHUB_REPOSITORY  "owner/repo" — auto-set by Actions
 *   PR_NUMBER          Pull-request number
 *   HEAD_SHA           Head SHA of the PR
 *
 * Optional env vars:
 *   MODEL              default 'claude-opus-4-8'
 *   MAX_TOKENS         default 8192
 *   DIFF_PATH          default 'pr.diff'
 *   MAX_DIFF_CHARS     default 40000
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

const ANTHROPIC_API_KEY = must('ANTHROPIC_API_KEY');
const GITHUB_TOKEN      = must('GITHUB_TOKEN');
const [OWNER, REPO]     = must('GITHUB_REPOSITORY').split('/');
const PR_NUMBER         = must('PR_NUMBER');
const HEAD_SHA          = must('HEAD_SHA');

const MODEL          = process.env.MODEL          || 'claude-opus-4-8';
const MAX_TOKENS     = parseInt(process.env.MAX_TOKENS     || '8192',  10);
const DIFF_PATH      = process.env.DIFF_PATH      || 'pr.diff';
const MAX_DIFF_CHARS = parseInt(process.env.MAX_DIFF_CHARS || '40000', 10);

const ATTRIBUTION = `*Claude \`${MODEL}\` responding to ChatGPT's review · commit \`${HEAD_SHA.slice(0, 7)}\`*`;

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
 * Fetch all unresolved review threads from the ChatGPT Reviewer App.
 * Identifies the bot by its login containing 'chatgpt' (case-insensitive).
 * @returns {Promise<Array>}
 */
async function fetchChatGptThreads() {
  const query = `
    query($owner:String!, $name:String!, $number:Int!) {
      repository(owner:$owner, name:$name) {
        pullRequest(number:$number) {
          reviewThreads(first:50) {
            nodes {
              id
              isResolved
              comments(first:1) {
                nodes {
                  databaseId
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

  return data.data.repository.pullRequest.reviewThreads.nodes.filter(t => {
    if (t.isResolved) return false;
    const login = (t.comments.nodes[0]?.author?.login || '').toLowerCase();
    return login.includes('chatgpt');
  });
}

/**
 * Post a reply into an existing inline review thread.
 * @param {number} commentId  REST API integer ID of the first comment in the thread.
 * @param {string} body
 * @returns {Promise<object>}
 */
async function replyToThread(commentId, body) {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/pulls/comments/${commentId}/replies`,
    { method: 'POST', headers: GH_HEADERS, body: JSON.stringify({ body }) }
  );
  if (!response.ok) throw new Error(`Reply API ${response.status}: ${await response.text()}`);
  return response.json();
}

/**
 * Resolve a review thread via GraphQL.
 * @param {string} threadId  GraphQL node ID.
 */
async function resolveThread(threadId) {
  const mutation = `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}`;
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: GH_HEADERS,
    body: JSON.stringify({ query: mutation, variables: { id: threadId } }),
  });
  if (!response.ok) throw new Error(`Resolve API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (data.errors) throw new Error(`GraphQL: ${JSON.stringify(data.errors)}`);
}

/**
 * Post a plain issue comment (used for the synthesis and as a fallback).
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
    const c = t.comments.nodes[0];
    return `Thread ${i} | ${c.path}:${c.originalLine}\n${c.body}`;
  }).join('\n\n---\n\n');

  const system = `You are Claude, an AI code reviewer. You have already done your own independent review of this pull request. Now you are reading the findings posted by ChatGPT (a peer AI reviewer) on the same code.

For each of ChatGPT's findings, state whether you agree, disagree, or partially agree, and give a brief direct explanation. Then provide an overall synthesis.

Output a single raw JSON object — no markdown wrapper:
{
  "thread_responses": [
    {
      "index": <integer matching the thread index above>,
      "verdict": "agree_fix" | "agree_noted" | "disagree" | "partial",
      "reply": "<1-3 direct sentences — your assessment of this specific finding>"
    }
  ],
  "synthesis": "<3-5 sentences: key issues in the PR, how ChatGPT's findings compare to your own read, what still needs attention>"
}`;

  const user = `ChatGPT's findings (${threads.length} thread${threads.length === 1 ? '' : 's'}):\n\n${threadList}\n\nPR diff:\n\`\`\`diff\n${diff}\n\`\`\``;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':          ANTHROPIC_API_KEY,
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
 * @typedef {{ thread_responses: ThreadResponse[], synthesis: string }} DialogueResponse
 */

/**
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
  return {
    thread_responses: parsed.thread_responses
      .filter(r => Number.isInteger(r.index) && typeof r.reply === 'string')
      .map(r => ({
        index:   r.index,
        verdict: r.verdict || 'comment',
        reply:   r.reply,
      })),
    synthesis: String(parsed.synthesis),
  };
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
    const c = await postIssueComment(`${rawText}\n\n---\n${ATTRIBUTION}`);
    console.log(`Fallback comment: ${c.html_url}`);
    return;
  }

  console.log(`  ${parsed.thread_responses.length} response(s) + synthesis`);

  const verdictEmoji = { agree_fix: '✅', agree_noted: '👍', disagree: '❌', partial: '↔️' };
  const failed = [];

  for (const tr of parsed.thread_responses) {
    const thread = threads[tr.index];
    if (!thread) {
      console.warn(`  Index ${tr.index} out of range — skipping`);
      continue;
    }

    const commentId = thread.comments.nodes[0]?.databaseId;
    const emoji = verdictEmoji[tr.verdict] || '💬';
    const replyBody = `${emoji} ${tr.reply}`;

    // Post reply
    try {
      const reply = await replyToThread(commentId, replyBody);
      console.log(`  replied thread[${tr.index}]: ${reply.html_url}`);
    } catch (err) {
      console.warn(`  reply failed thread[${tr.index}]: ${err.message}`);
      failed.push({ tr, thread });
    }

    // Resolve thread (best-effort — proceed even if it fails)
    try {
      await resolveThread(thread.id);
      console.log(`  resolved thread[${tr.index}]`);
    } catch (err) {
      console.warn(`  resolve failed thread[${tr.index}]: ${err.message}`);
    }
  }

  // Build synthesis, appending any replies that couldn't be posted inline.
  let synthesisBody = `## Claude's synthesis\n\n${parsed.synthesis}`;
  if (failed.length) {
    const extras = failed.map(({ tr, thread }) => {
      const c = thread.comments.nodes[0];
      return `**${c.path}:${c.originalLine}** (could not reply inline)\n\n${verdictEmoji[tr.verdict] || '💬'} ${tr.reply}`;
    }).join('\n\n---\n\n');
    synthesisBody += `\n\n---\n\n**Responses that could not be posted inline:**\n\n${extras}`;
  }
  synthesisBody += `\n\n---\n${ATTRIBUTION}`;

  const synthesis = await postIssueComment(synthesisBody);
  console.log(`  Synthesis: ${synthesis.html_url}`);
}

main().catch((err) => die(`Unhandled error: ${err.stack || err.message}`));
