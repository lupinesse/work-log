/* ── Notion integration ── */
// Task-to-Notion uses Notion REST API directly via /api/notion-add-task (no AI needed).
// callClaudeWithNotion is kept for the URL-bookmarking form via /api/notion-ai proxy.
// Notion token lives in config.local.ps1 (server-side, never exposed to the browser).
const STORE_ANTHROPIC_KEY = 'wl_anthropic_key'; // kept for backward compat with URL bookmarking form

/**
 * Retrieves the stored Anthropic API key from localStorage (trimmed).
 * @returns {string} The key, or an empty string if not set.
 */
function getAnthropicKey() {
  return (localStorage.getItem(STORE_ANTHROPIC_KEY) || '').trim();
}

/**
 * Stores or removes the Anthropic API key in localStorage.
 * @param {string} key - Key to store; falsy to remove.
 */
function setAnthropicKey(key) {
  if (key) localStorage.setItem(STORE_ANTHROPIC_KEY, key.trim());
  else localStorage.removeItem(STORE_ANTHROPIC_KEY);
}

/**
 * Calls the Claude API with a Notion MCP server attached, via the local proxy
 * at `/api/notion-ai` (API keys never exposed to the browser).
 * Used for the URL-bookmarking form — task imports use {@link addTaskToNotion} instead.
 * @param {string} prompt            - User prompt text.
 * @param {Object} [opts] - Optional overrides (`model` string, `maxTokens` number).
 * @returns {Promise<string>} The concatenated text content of the response.
 * @throws {Error} If the API returns a non-OK status.
 */
async function callClaudeWithNotion(prompt, opts = {}) {
  const res = await fetch('/api/notion-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model || 'claude-sonnet-4-6',
      max_tokens: opts.maxTokens || 1000,
      mcp_servers: [{ type: 'url', url: 'https://mcp.notion.com/mcp', name: 'notion' }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/**
 * Adds a work-log task to Notion as a child page under the matching project.
 * The project is looked up server-side by matching the task's category label to a
 * Notion project's Epic field. Uses `/api/notion-add-task` (Notion REST API, no AI).
 * @param {Object} task - Plan task object with at least `text` and `tag`.
 * @returns {Promise<string>} The URL of the newly created Notion page.
 * @throws {Error} If the API call fails or no URL is returned.
 */
async function addTaskToNotion(task) {
  const cat = getCat(task.tag || 'other');
  const epic = (cat.label || 'other').toLowerCase();

  const res = await fetch('/api/notion-add-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: task.text, epic }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.detail || data.error || `API ${res.status}`).slice(0, 300);
    throw new Error(msg);
  }
  if (!data.url) throw new Error('No URL returned from Notion');
  return data.url;
}

/**
 * Persists the Notion page URL on a plan task so the per-task button changes
 * to an "open in Notion" link on next render.
 * @param {string} taskId - Plan task ID.
 * @param {string} url    - Notion page URL returned by the API.
 */
function saveTaskNotionUrl(taskId, url) {
  const t = planTasks.find((t) => t.id === taskId);
  if (!t) return;
  t.notionUrl = url;
  savePlan();
  renderPlan();
}

// Delegated click handler for the per-task Notion button
document.addEventListener(
  'click',
  (e) => {
    const btn = e.target.closest('.notion-task-btn');
    if (!btn || !btn.dataset.pid) return;
    e.stopPropagation();
    const t = planTasks.find((x) => x.id === btn.dataset.pid);
    if (!t) return;
    // If already sent, open the Notion page
    if (t.notionUrl) {
      window.open(t.notionUrl, '_blank', 'noopener');
      return;
    }
    btn.disabled = true;
    btn.textContent = '…';
    addTaskToNotion(t)
      .then((url) => {
        if (url && url.startsWith('http')) {
          saveTaskNotionUrl(t.id, url);
        } else {
          btn.textContent = '📋';
          btn.disabled = false;
          alert('Notion responded but no URL: ' + url);
        }
      })
      .catch((err) => {
        btn.textContent = '📋';
        btn.disabled = false;
        alert('Failed to add to Notion: ' + err.message);
      });
  },
  true
);

// Expose for the URL-bookmarking form so it shares the same auth path
window._wlNotion = { callClaudeWithNotion, getAnthropicKey, setAnthropicKey };
