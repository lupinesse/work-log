/**
 * Shared helpers for the AI review dialogue: fetching review threads with
 * full history, replying to existing threads, and updating issue comments
 * in place across runs (so each phase produces at most one comment per PR
 * rather than accumulating one per push).
 *
 * Consumed by chatgpt-review.mjs, chatgpt-claude-dialogue.mjs, and
 * claude-chatgpt-dialogue.mjs.
 *
 * All HTTP via native `fetch` (Node ≥ 22).
 */

/**
 * @typedef {{
 *   id: string,
 *   isResolved: boolean,
 *   firstCommentId: number,
 *   author: string,
 *   path: string,
 *   line: number,
 *   body: string,
 *   replies: Array<{ author: string, body: string }>,
 * }} ThreadSummary
 */

/**
 * Build the standard headers for the GitHub REST API.
 * @param {string} token
 * @returns {Record<string, string>}
 */
export function ghHeaders(token) {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch all review threads on the PR with full comment history.
 * Each thread includes its first comment (the finding) and any replies
 * (including verdict replies from the other AI).
 *
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @returns {Promise<ThreadSummary[]>}
 */
export async function fetchAllThreads({ token, owner, repo, prNumber }) {
  const query = `
    query($owner:String!, $name:String!, $number:Int!) {
      repository(owner:$owner, name:$name) {
        pullRequest(number:$number) {
          reviewThreads(first:100) {
            nodes {
              id
              isResolved
              comments(first:20) {
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
    headers: ghHeaders(token),
    body: JSON.stringify({
      query,
      variables: { owner, name: repo, number: prNumber },
    }),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL ${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (data.errors) throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);

  const threads = [];
  for (const t of data.data.repository.pullRequest.reviewThreads.nodes) {
    const comments = t.comments.nodes;
    if (!comments.length) continue;
    const first = comments[0];
    threads.push({
      id: t.id,
      isResolved: t.isResolved,
      firstCommentId: first.databaseId,
      author: (first.author?.login || '').toLowerCase(),
      path: first.path,
      line: first.originalLine,
      body: first.body || '',
      replies: comments.slice(1).map((c) => ({
        author: (c.author?.login || '').toLowerCase(),
        body: c.body || '',
      })),
    });
  }
  return threads;
}

/**
 * Post a reply into an existing inline review thread.
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @param {number} params.commentId  REST integer id of the first comment in the thread.
 * @param {string} params.body
 * @returns {Promise<object>}
 */
export async function replyToThread({ token, owner, repo, prNumber, commentId, body }) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`,
    { method: 'POST', headers: ghHeaders(token), body: JSON.stringify({ body }) }
  );
  if (!response.ok) throw new Error(`Reply API ${response.status}: ${await response.text()}`);
  return response.json();
}

/**
 * Re-open a previously-resolved review thread. Used when one bot wants to
 * raise a regression on a thread the other bot resolved — re-opening signals
 * to the next dialogue phase that the finding needs fresh attention.
 *
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.threadId  GraphQL node id of the thread.
 */
export async function unresolveThread({ token, threadId }) {
  const mutation = `mutation($id:ID!){unresolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}`;
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({ query: mutation, variables: { id: threadId } }),
  });
  if (!response.ok) throw new Error(`Unresolve API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (data.errors) throw new Error(`GraphQL: ${JSON.stringify(data.errors)}`);
}

/**
 * Mark an open review thread as resolved. Used by Phase 4 when ChatGPT has
 * verified Claude's promised fix is present in the current diff and posts a
 * "✅ Verified as fixed" confirmation — closing the thread completes the
 * audit trail and clears the merge-gate.
 *
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.threadId  GraphQL node id of the thread.
 */
export async function resolveThread({ token, threadId }) {
  const mutation = `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}`;
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({ query: mutation, variables: { id: threadId } }),
  });
  if (!response.ok) throw new Error(`Resolve API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (data.errors) throw new Error(`GraphQL: ${JSON.stringify(data.errors)}`);
}

/**
 * Fetch all issue comments for a PR, paginating until the API returns fewer
 * than a full page. Comments are returned oldest-first (API default order).
 * Callers that need newest-first should reverse the result.
 *
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @returns {Promise<object[]>}
 */
export async function fetchAllIssueComments({ token, owner, repo, prNumber }) {
  const MAX_PAGES = 200;
  const all = [];
  let page = 1;
  while (true) {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      { headers: ghHeaders(token) }
    );
    if (!response.ok)
      throw new Error(`List comments API ${response.status}: ${await response.text()}`);
    const batch = await response.json();
    all.push(...batch);
    if (batch.length < 100) break;
    if (page >= MAX_PAGES) {
      throw new Error(
        `fetchAllIssueComments: reached page limit (${MAX_PAGES}) for PR #${prNumber} — ` +
          'possible API response loop; halting to avoid runaway pagination'
      );
    }
    page++;
  }
  return all;
}

/**
 * Find the most recent issue comment containing `marker` in its body, then
 * PATCH it with `body`. If no previous comment matches, POST a new one.
 * Used to keep one persistent comment per phase rather than accumulating one
 * per push. Searches all pages so the marker is found even on high-volume PRs.
 *
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @param {string} params.marker   Substring that uniquely identifies this phase's comment.
 * @param {string} params.body     New body content.
 * @returns {Promise<{ comment: object, updated: boolean }>}
 */
export async function upsertIssueComment({ token, owner, repo, prNumber, marker, body }) {
  const comments = await fetchAllIssueComments({ token, owner, repo, prNumber });

  // Walk newest-first so we update the latest matching comment.
  let previous = null;
  for (const c of [...comments].reverse()) {
    if (c.body && c.body.includes(marker)) {
      previous = c;
      break;
    }
  }

  if (previous) {
    const patchResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/comments/${previous.id}`,
      { method: 'PATCH', headers: ghHeaders(token), body: JSON.stringify({ body }) }
    );
    if (!patchResp.ok)
      throw new Error(`PATCH comment API ${patchResp.status}: ${await patchResp.text()}`);
    return { comment: await patchResp.json(), updated: true };
  }

  const postResp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    { method: 'POST', headers: ghHeaders(token), body: JSON.stringify({ body }) }
  );
  if (!postResp.ok)
    throw new Error(`POST comment API ${postResp.status}: ${await postResp.text()}`);
  return { comment: await postResp.json(), updated: false };
}

/**
 * Find the most recent PR review by `marker` in its body and DISMISS it,
 * then post a fresh review. GitHub's reviews API doesn't allow editing the
 * body of a submitted review, so dismiss-and-replace is the closest we can
 * get to "one review per phase".
 *
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @param {string} params.headSha   Required for posting a new review.
 * @param {string} params.marker    Substring that uniquely identifies this phase's review.
 * @param {string} params.body
 * @returns {Promise<{ review: object, replaced: boolean }>}
 */
export async function upsertReview({ token, owner, repo, prNumber, headSha, marker, body }) {
  // Paginate to handle PRs that accumulate more than 100 reviews across re-runs.
  const MAX_PAGES = 50; // 5 000 reviews is an unreachable ceiling in practice
  const reviews = [];
  let reviewPage = 1;
  while (true) {
    const listResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100&page=${reviewPage}`,
      { headers: ghHeaders(token) }
    );
    if (!listResp.ok)
      throw new Error(`List reviews API ${listResp.status}: ${await listResp.text()}`);
    const batch = await listResp.json();
    reviews.push(...batch);
    if (batch.length < 100) break;
    if (reviewPage >= MAX_PAGES) {
      throw new Error(
        `upsertReview: reached page limit (${MAX_PAGES}) for PR #${prNumber} — halting to avoid runaway pagination`
      );
    }
    reviewPage++;
  }

  // Pick the most recent matching, non-dismissed review.
  let previous = null;
  for (const r of [...reviews].reverse()) {
    if (r.state !== 'DISMISSED' && r.body && r.body.includes(marker)) {
      previous = r;
      break;
    }
  }

  let replaced = false;
  if (previous) {
    // Dismissals require a reason; the API rejects an empty string.
    const dismissResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews/${previous.id}/dismissals`,
      {
        method: 'PUT',
        headers: ghHeaders(token),
        body: JSON.stringify({ message: 'Superseded by a newer review from this bot.' }),
      }
    );
    if (dismissResp.ok) {
      replaced = true;
    } else {
      // Non-fatal — fall through and post a new review anyway so we never
      // lose the verdict. The stale review just stays visible.
      console.warn(
        `  could not dismiss previous review #${previous.id}: ${dismissResp.status} ${await dismissResp.text()}`
      );
    }
  }

  const postResp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    {
      method: 'POST',
      headers: ghHeaders(token),
      body: JSON.stringify({ commit_id: headSha, body, event: 'COMMENT' }),
    }
  );
  if (!postResp.ok) throw new Error(`POST review API ${postResp.status}: ${await postResp.text()}`);
  return { review: await postResp.json(), replaced };
}

/**
 * Add a reaction to a pull-request review comment (inline thread comment).
 * Idempotent: GitHub returns 200 when the reaction already exists for this
 * user, 201 when newly created — both are treated as success.
 *
 * Used to signal "still seeing this" on a suppressed duplicate finding instead
 * of posting a verbose identical comment.
 *
 * @param {object} params
 * @param {string} params.token      GitHub auth token.
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.commentId  REST integer id of the comment to react to.
 * @param {string} params.content    Reaction name — e.g. 'eyes', '+1', 'hooray'.
 * @returns {Promise<object>} GitHub API reaction object.
 */
export async function addReactionToComment({ token, owner, repo, commentId, content }) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/comments/${commentId}/reactions`,
    {
      method: 'POST',
      headers: ghHeaders(token),
      body: JSON.stringify({ content }),
    }
  );
  if (!response.ok) throw new Error(`Reaction API ${response.status}: ${await response.text()}`);
  return response.json();
}

/**
 * Post a single inline pull-request review comment on a specific file line.
 * Each call creates a separate resolvable thread. Used only when no existing
 * thread is appropriate to reply to.
 *
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @param {string} params.headSha   Commit SHA to attach the comment to.
 * @param {string} params.path      File path relative to the repo root.
 * @param {number} params.line      Line number in the new (right-side) version of the file.
 * @param {string} params.body      Comment body (markdown).
 * @returns {Promise<object>} GitHub API response object.
 * @throws {Error} if the API rejects the comment (e.g. line not in the diff).
 */
export async function postInlineComment({
  token,
  owner,
  repo,
  prNumber,
  headSha,
  path,
  line,
  body,
}) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
    {
      method: 'POST',
      headers: ghHeaders(token),
      body: JSON.stringify({ body, commit_id: headSha, path, line, side: 'RIGHT' }),
    }
  );
  if (!response.ok)
    throw new Error(`GitHub comments API ${response.status}: ${await response.text()}`);
  return response.json();
}

/**
 * Build a compact, indexed summary of existing threads for an AI prompt.
 * Each entry includes index, path:line, author, resolution state, finding
 * body, and any replies — enough for the model to decide whether a new
 * finding overlaps with an existing thread.
 *
 * @param {ThreadSummary[]} threads
 * @returns {string}
 */
export function formatThreadsForPrompt(threads) {
  if (!threads.length) return '(no existing review threads on this PR)';
  return threads
    .map((t, i) => {
      const replyLines = t.replies.length
        ? '\n' +
          t.replies
            .map((r) => `  ↳ ${r.author}: ${r.body.slice(0, 400).replace(/\n/g, ' ')}`)
            .join('\n')
        : '';
      const state = t.isResolved ? 'resolved' : 'open';
      return `[Thread ${i}] ${t.path}:${t.line} (by ${t.author}, ${state})\n${t.body.slice(0, 400)}${replyLines}`;
    })
    .join('\n\n---\n\n');
}
