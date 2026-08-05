/* ── Calendar — post-meeting transition bridge (split out of 13-calendar.js) ──
   Detects a just-ended meeting and offers 3 concrete steps (via /api/ai) to
   transition into the next task. Invoked from 13-calendar.js's per-minute
   setInterval, which stays there since it also drives renderCalStrip. */

const STORE_SEEN_ENDED = 'wl_seen_ended_v1';

/**
 * Returns the set of meeting keys (`subject|start`) that have already triggered
 * a bridge banner in this session, loaded from localStorage.
 * @returns {Set<string>}
 */
function getSeenEnded() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORE_SEEN_ENDED) || '[]'));
  } catch (err) {
    return new Set();
  }
}
/**
 * Persists the set of seen-ended meeting keys to localStorage.
 * @param {Set<string>} s - Updated set to persist.
 */
function setSeenEnded(s) {
  localStorage.setItem(STORE_SEEN_ENDED, JSON.stringify([...s]));
}

/**
 * Returns a stable string key for a meeting used to deduplicate bridge banners.
 * @param {{subject: string, start: string}} m - Meeting object.
 * @returns {string}
 */
function getMeetingKey(m) {
  return `${m.subject}|${m.start}`;
}

const bannerQueue = [];
let bannerShowing = false;

/**
 * Shows the post-meeting bridge banner for the given meeting.
 * Queues the meeting if another banner is already visible.
 * @param {{subject: string, start: string, end: string}} meeting - The ended meeting.
 */
function showBridgeBanner(meeting) {
  if (bannerShowing) {
    bannerQueue.push(meeting);
    return;
  }
  bannerShowing = true;
  const banner = document.getElementById('newdayBanner');
  const msg = document.getElementById('newdayMsg');
  const expanded = document.getElementById('newdayExpanded');
  const bridgeBtn = document.getElementById('newdayBridgeBtn');
  const dismissBtn = document.getElementById('newdayDismiss');
  if (!banner || !msg) {
    bannerShowing = false;
    return;
  }

  msg.textContent = `Just finished "${meeting.subject || '(untitled)'}" — build a bridge to your next thing?`;
  expanded.innerHTML = '';
  expanded.style.display = 'none';
  banner.classList.add('show');

  const onDismiss = () => {
    banner.classList.remove('show');
    bannerShowing = false;
    if (bannerQueue.length) showBridgeBanner(bannerQueue.shift());
  };
  dismissBtn.onclick = onDismiss;
  bridgeBtn.onclick = async (event) => {
    event.stopPropagation();
    await buildBridge(meeting, expanded, bridgeBtn);
  };
}

/**
 * Determines the next task to transition to and delegates to {@link fetchBridge}.
 * If multiple tasks are in-flight the user picks from a list; a single in-progress
 * task is auto-selected; the only remaining task is auto-selected.
 * @param {{subject: string}} meeting  - The meeting that just ended.
 * @param {HTMLElement} expandedEl     - Container for the bridge content.
 * @param {HTMLElement} bridgeBtn      - "Build bridge" button (disabled during fetch).
 * @returns {Promise<void>}
 */
async function buildBridge(meeting, expandedEl, bridgeBtn) {
  const todayKey = dk(new Date());
  const notDone = planTasks.filter((task) => task.date === todayKey && task.status !== 'done');
  const inProgress = notDone.filter((task) => task.status === 'inprogress');

  let nextTask = null;
  if (inProgress.length) {
    nextTask = inProgress[0];
  } else if (notDone.length === 1) {
    nextTask = notDone[0];
  } else if (notDone.length > 1) {
    expandedEl.innerHTML = '<div style="font-size:11px;margin-bottom:6px">Pick next task:</div>';
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    notDone.forEach((task) => {
      const b = document.createElement('button');
      b.style.cssText =
        'font-size:11px;padding:4px 8px;background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--radius);cursor:pointer;text-align:left;color:var(--text2)';
      b.textContent = task.text;
      b.onclick = async () => {
        list.style.display = 'none';
        await fetchBridge(meeting, task, expandedEl, bridgeBtn);
      };
      list.appendChild(b);
    });
    expandedEl.appendChild(list);
    expandedEl.style.display = 'block';
    return;
  }

  if (!nextTask) {
    expandedEl.textContent = 'No next task found for today.';
    expandedEl.style.display = 'block';
    return;
  }
  await fetchBridge(meeting, nextTask, expandedEl, bridgeBtn);
}

/**
 * Calls the Claude API via `/api/ai` to generate 3 concrete physical steps for
 * transitioning from the ended meeting to the next task. Displays the result in
 * `expandedEl`; falls back to copying the prompt to the clipboard on API error.
 * @param {{subject: string}} meeting  - The meeting that just ended.
 * @param {{text: string}}    task     - The next plan task to transition to.
 * @param {HTMLElement} expandedEl     - Container for the bridge content.
 * @param {HTMLElement} bridgeBtn      - "Build bridge" button (disabled during fetch).
 * @returns {Promise<void>}
 */
async function fetchBridge(meeting, task, expandedEl, bridgeBtn) {
  const meetingSubject = meeting.subject || '(untitled)';
  const taskText = task.text || '(untitled)';
  const prompt = `Meeting just finished: "${meetingSubject}"\nNext task to start: "${taskText}"\n\nProvide exactly 3 concrete physical steps to transition from this meeting to starting the task. Each step specific and actionable. Total time: ~3 min. No preamble, no numbering, no labels, plain text only.`;

  expandedEl.innerHTML = '<div style="font-size:11px;color:var(--text3)">thinking…</div>';
  expandedEl.style.display = 'block';
  bridgeBtn.disabled = true;

  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system:
          'You help ADHD users switch between tasks smoothly. Reply with exactly 3 concrete physical steps, no preamble, no numbering, no labels. Plain text separated by line breaks.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    const bridgeText = data.content?.[0]?.text || '';
    if (!bridgeText) throw new Error('No content in response');
    expandedEl.textContent = bridgeText;
  } catch (err) {
    navigator.clipboard.writeText(prompt).catch(() => {});
    expandedEl.innerHTML =
      '<span style="color:var(--red,#e74c3c)">AI unavailable — prompt copied to clipboard. (Set AnthropicApiKey in config.local.ps1)</span>';
  }
  bridgeBtn.disabled = false;
}
