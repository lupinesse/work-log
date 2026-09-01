/* ── Render — header stat tiles and sub-stat tiles ── */
// Split out of 04-render.js (QA finding: module size). Both functions only
// read entries/document and write into the #stat* elements render() already
// expects to exist; neither depends on render()'s other sections running
// first or after.

/**
 * Renders the three header stat tiles (distinct tasks today / distinct epics
 * this week / current streak) and the collapsed one-line summary that
 * mirrors them.
 */
function renderHeaderStatTiles() {
  const todayKey = dk(new Date());
  document.getElementById('statToday').textContent = new Set(
    entries.filter((entry) => entry.date === todayKey).map((entry) => entry.text.toLowerCase())
  ).size;
  document.getElementById('statWeek').textContent = (() => {
    const weekStart = mondayOfWeek();
    return new Set(
      entries.filter((entry) => entry.ts >= weekStart).map((entry) => entry.tag || 'other')
    ).size;
  })();
  document.getElementById('statStreak').textContent = calcStreak();

  // Collapsed summary: mirrors the three values into a single header line so
  // the section communicates its data without needing to be opened.
  document.getElementById('analyticsSummary').textContent = [
    `${document.getElementById('statToday').textContent} tasks today`,
    `${document.getElementById('statWeek').textContent} epics this week`,
    `${document.getElementById('statStreak').textContent}-day streak`,
  ].join(' · ');
}

/**
 * Builds the HTML for a sub-stat tile's task line: a Jira ticket link (when
 * the label parses as one) plus the task name, or the raw label when it
 * doesn't, followed by the formatted duration.
 * @param {string} label - Task text, possibly Jira-prefixed.
 * @param {number} ms - Tracked duration in milliseconds.
 * @returns {string} HTML string for the tile body.
 */
function buildStatSubHtml(label, ms) {
  const { ticket, name } = parseJiraLabel(label);
  const keyHtml = ticket
    ? `<a class="jira-key-link" href="${JIRA_BASE}/${ticket}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escHtml(ticket)}</a>`
    : null;
  return keyHtml
    ? `${keyHtml}${name ? `<div class="stat-sub-title">${escHtml(name)}</div>` : ''}<div class="stat-sub-value">${fmtDur(ms)}</div>`
    : `<div class="stat-sub-title">${escHtml(label)}</div><div class="stat-sub-value">${fmtDur(ms)}</div>`;
}

/**
 * Renders the three sub-stat tiles beneath the header stats: today's
 * most-tracked task, this week's most-tracked task, and the streak day with
 * the longest tracked time. Hides each tile when there's no data for it.
 */
function renderSubStatTiles() {
  const todayKey = dk(new Date());

  // Today: task with most tracked time
  const todayTimed = entries.filter(
    (entry) => entry.date === todayKey && entry.tsEnd && entry.tsEnd > entry.ts
  );
  const todayByTask = {};
  todayTimed.forEach((entry) => {
    const taskKey = entry.text.toLowerCase();
    if (!todayByTask[taskKey]) todayByTask[taskKey] = { label: entry.text, ms: 0 };
    todayByTask[taskKey].ms += entry.tsEnd - entry.ts;
  });
  const topTask = Object.values(todayByTask).sort((a, b) => b.ms - a.ms)[0];
  const todaySub = document.getElementById('statTodaySub');
  if (topTask) {
    todaySub.innerHTML = buildStatSubHtml(topTask.label, topTask.ms);
    todaySub.style.display = '';
  } else {
    todaySub.style.display = 'none';
  }

  // This week: task with most tracked time
  const thisWeekStart = new Date();
  thisWeekStart.setDate(thisWeekStart.getDate() - ((thisWeekStart.getDay() + 6) % 7));
  thisWeekStart.setHours(0, 0, 0, 0);
  const weekTimed = entries.filter(
    (entry) => new Date(entry.ts) >= thisWeekStart && entry.tsEnd && entry.tsEnd > entry.ts
  );
  const weekByTask = {};
  weekTimed.forEach((entry) => {
    const taskKey = entry.text.toLowerCase();
    if (!weekByTask[taskKey]) weekByTask[taskKey] = { label: entry.text, ms: 0 };
    weekByTask[taskKey].ms += entry.tsEnd - entry.ts;
  });
  const topWeekTask = Object.values(weekByTask).sort((a, b) => b.ms - a.ms)[0];
  const weekSub = document.getElementById('statWeekSub');
  if (topWeekTask) {
    weekSub.innerHTML = buildStatSubHtml(topWeekTask.label, topWeekTask.ms);
    weekSub.style.display = '';
  } else {
    weekSub.style.display = 'none';
  }

  // Streak: day with longest tracked time
  const streakDays = [];
  {
    const streakCursor = new Date();
    streakCursor.setDate(streakCursor.getDate() - 1);
    const daysWithEntries = new Set(entries.map((entry) => entry.date));
    while (daysWithEntries.has(dk(streakCursor))) {
      streakDays.push(dk(streakCursor));
      streakCursor.setDate(streakCursor.getDate() - 1);
    }
  }
  const streakSub = document.getElementById('statStreakSub');
  if (streakDays.length > 0) {
    let bestDay = null,
      bestMs = 0;
    streakDays.forEach((dateKey2) => {
      const ms = entries
        .filter((entry) => entry.date === dateKey2 && entry.tsEnd && entry.tsEnd > entry.ts)
        .reduce((sum, entry) => sum + (entry.tsEnd - entry.ts), 0);
      if (ms > bestMs) {
        bestMs = ms;
        bestDay = dateKey2;
      }
    });
    if (bestDay && bestMs > 0) {
      const bestStreakDay = new Date(bestDay + 'T12:00:00');
      const dayName = isToday(bestStreakDay)
        ? 'today'
        : bestStreakDay.toLocaleDateString('en', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          });
      streakSub.innerHTML = `<div class="stat-sub-title">Longest date tracked</div><div class="stat-sub-title">${escHtml(dayName)}</div><div class="stat-sub-value">${fmtDur(bestMs)}</div>`;
      streakSub.style.display = '';
    } else {
      streakSub.style.display = 'none';
    }
  } else {
    streakSub.style.display = 'none';
  }
}
