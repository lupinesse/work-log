/**
 * Converts pa11y JSON output (pa11y-raw.json) into a GitHub PR comment
 * (comment-body.txt) in the same markdown format as the former Claude-based
 * /a11y-audit skill.
 *
 * pa11y JSON reporter writes a flat array of issue objects to stdout, one
 * entry per finding:
 *   { type, code, message, context, selector, runner, runnerExtras }
 *
 * Exit codes from pa11y:
 *   0  — no issues found
 *   1  — issues found (still valid JSON)
 *   2  — technical error (page unreachable etc.) — may produce no/invalid JSON
 *
 * Environment variables:
 *   HEAD_SHA  — commit SHA for the footer attribution line
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const MARKER = '<!-- claude-a11y-audit-comment -->';
const headSha = process.env.HEAD_SHA ?? 'unknown';

/** @returns {Array|null} parsed issues, or null on parse failure */
function loadIssues() {
  if (!existsSync('pa11y-raw.json')) return null;
  const raw = readFileSync('pa11y-raw.json', 'utf8').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // pa11y JSON reporter: flat array of issue objects
    if (Array.isArray(parsed)) return parsed;
    // Defensive: some pa11y versions wrap in { issues: [...] }
    if (parsed && Array.isArray(parsed.issues)) return parsed.issues;
    return null;
  } catch {
    return null;
  }
}

/**
 * Renders a section of issues.
 * @param {string} heading - Section heading (includes severity emoji)
 * @param {Array<{code:string,message:string,context:string,selector:string}>} list
 * @returns {string[]} markdown lines to append
 */
function renderSection(heading, list) {
  if (!list.length) return [];
  const lines = ['', `### ${heading}`];
  for (const issue of list) {
    const ctx = issue.context ? issue.context.replace(/\s+/g, ' ').trim() : '';
    lines.push('');
    lines.push(`**\`${issue.selector}\`** — ${issue.message}`);
    lines.push(`Criterion: \`${issue.code}\``);
    if (ctx) lines.push(`Context: \`${ctx}\``);
  }
  return lines;
}

/**
 * Builds the full markdown comment body.
 * @param {Array|null} issues
 * @returns {string}
 */
function buildComment(issues) {
  if (issues === null) {
    return [
      MARKER,
      '## Accessibility Audit (WCAG 2.1 AA)',
      '',
      '> ⚠️ pa11y could not produce a report. Check that the build and server',
      '> steps succeeded and that `pa11y-raw.json` was written.',
    ].join('\n');
  }

  const blocking = issues.filter((i) => i.type === 'error');
  const warnings = issues.filter((i) => i.type === 'warning');
  const notes = issues.filter((i) => i.type === 'notice');

  const lines = [
    MARKER,
    '## Accessibility Audit (WCAG 2.1 AA)',
    '',
    '### Summary',
    '| Severity | Count |',
    '|---|---|',
    `| 🔴 Blocking (clear WCAG failure) | ${blocking.length} |`,
    `| 🟡 Warning (likely failure, needs manual check) | ${warnings.length} |`,
    `| 🔵 Note (best-practice improvement) | ${notes.length} |`,
  ];

  if (!blocking.length && !warnings.length && !notes.length) {
    lines.push('', '### ✅ All clear');
  } else {
    lines.push(...renderSection('🔴 Blocking issues', blocking));
    lines.push(...renderSection('🟡 Warnings', warnings));
    lines.push(...renderSection('🔵 Notes', notes));
  }

  lines.push(
    '',
    '---',
    `*Automated audit by [pa11y](https://pa11y.org) (WCAG2AA) · commit \`${headSha.slice(0, 7)}\`*`
  );

  return lines.join('\n');
}

const issues = loadIssues();
const body = buildComment(issues);
writeFileSync('comment-body.txt', body, 'utf8');

const count = issues ? issues.length : 0;
console.log(`format-a11y-report: ${count} issue(s) written to comment-body.txt`);
