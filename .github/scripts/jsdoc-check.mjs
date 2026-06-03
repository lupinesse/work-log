#!/usr/bin/env node
/**
 * Static JSDoc coverage check — no Claude API required.
 *
 * Scans exported symbols in changed src/js/ files (or all src/js/ files when
 * run locally without pr.diff) and classifies each as:
 *   ✅ Complete — description + @param per parameter + @returns when needed
 *   ⚠️ Partial  — block exists but is missing at least one tag
 *   ❌ Missing  — no JSDoc block above the export
 *
 * Exits 0 always; verdict is embedded in stdout (PASS / WARN / FAIL).
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// 1. Determine files to scan
// ---------------------------------------------------------------------------

/** @returns {string[]} */
function getFilesToScan() {
  if (fs.existsSync('pr.diff')) {
    const diff = fs.readFileSync('pr.diff', 'utf8');
    return [...diff.matchAll(/^\+\+\+ b\/(src\/js\/[^\s]+\.js)/gm)]
      .map((m) => m[1])
      .filter((f) => fs.existsSync(f));
  }
  // Local run: all src/js files
  return fs
    .readdirSync('src/js')
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join('src', 'js', f));
}

const filesToScan = getFilesToScan();

if (filesToScan.length === 0) {
  console.log('## JSDoc Coverage — no src/js changes in scope.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. Helpers
// ---------------------------------------------------------------------------

/**
 * Parse bare parameter names from a function signature string like
 * "(a, b = 1, { c, d }, ...rest)". Returns an array of param names.
 * Destructured objects/arrays are represented as their first identifier or
 * the literal string "{destructured}".
 *
 * @param {string} sig - Raw parameter list including surrounding parens.
 * @returns {string[]}
 */
function parseParamNames(sig) {
  const inner = sig
    .replace(/^\s*\(/, '')
    .replace(/\)\s*$/, '')
    .trim();
  if (!inner) return [];

  // Split by top-level commas
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of inner) {
    if ('{[(<'.includes(ch)) depth++;
    else if ('}])>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  return parts
    .filter((p) => p.length > 0)
    .map((p) => {
      if (p.startsWith('{') || p.startsWith('[')) return '{destructured}';
      // Strip default value and spread prefix
      return p
        .replace(/^\.\.\./, '')
        .split(/\s*=\s*/)[0]
        .trim()
        .split(/\W/)[0];
    })
    .filter((p) => p.length > 0);
}

/**
 * Find the JSDoc block that ends immediately before line index `exportIdx`.
 * Returns the joined block text, or null if absent.
 *
 * @param {string[]} lines - All source lines.
 * @param {number} exportIdx - Zero-based line index of the export statement.
 * @returns {string|null}
 */
function jsdocBefore(lines, exportIdx) {
  // Walk up from the export, skipping blank lines, looking for */
  let endIdx = -1;
  for (let j = exportIdx - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (t === '') continue;
    if (t.endsWith('*/')) {
      endIdx = j;
      break;
    }
    return null; // non-blank line that isn't end of JSDoc
  }
  if (endIdx === -1) return null;

  // Walk up to /** start
  for (let j = endIdx; j >= 0; j--) {
    if (lines[j].trim().startsWith('/**')) {
      return lines.slice(j, endIdx + 1).join('\n');
    }
  }
  return null;
}

/**
 * Detect whether an arrow function on `line` has an implicit return
 * (i.e. the body after => is not a block).
 *
 * @param {string} line - Source line containing the arrow.
 * @returns {boolean}
 */
function isImplicitArrow(line) {
  const arrowIdx = line.indexOf('=>');
  if (arrowIdx === -1) return false;
  const after = line.slice(arrowIdx + 2).trim();
  return after.length > 0 && !after.startsWith('{');
}

/**
 * Check whether a function body starting at `startIdx` has a return statement
 * within the next 40 lines.
 *
 * @param {string[]} lines - All source lines.
 * @param {number} startIdx - Line to start scanning from.
 * @returns {boolean}
 */
function bodyHasReturn(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 40, lines.length); i++) {
    if (/\breturn\s/.test(lines[i])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 3. Scan files
// ---------------------------------------------------------------------------

/** @typedef {{ file: string, line: number, name: string }} SymbolRef */
/** @typedef {SymbolRef & { issues: string[] }} PartialRef */

/** @type {SymbolRef[]} */
const complete = [];
/** @type {PartialRef[]} */
const partial = [];
/** @type {SymbolRef[]} */
const missing = [];

for (const filePath of filesToScan) {
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip re-exports: export { x } from '…'
    if (/^export\s*\{/.test(line) && /\bfrom\b/.test(line)) continue;

    let name = null;
    let paramStr = null;
    let implicitReturn = false;

    // export function / export async function
    const mFunc = line.match(/^export\s+(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))/);
    // export class
    const mClass = line.match(/^export\s+class\s+(\w+)/);
    // export const x = function(...) / = async function(...) / = (...) => / = x =>
    // Require either 'function' keyword OR '=>' so plain object/array constants are excluded.
    const mConst = line.match(
      /^export\s+const\s+(\w+)\s*=\s*(?:async\s+)?(?:function\s*\*?\s*(\([^)]*\))|(\([^)]*\)|\w+)\s*=>)/
    );
    // export default function
    const mDefault = line.match(/^export\s+default\s+(?:async\s+)?function\s*(\w*)\s*(\([^)]*\))/);

    if (mFunc) {
      name = mFunc[1];
      paramStr = mFunc[2];
    } else if (mClass) {
      name = mClass[1];
      paramStr = null;
    } else if (mConst) {
      name = mConst[1];
      paramStr = mConst[2] ?? mConst[3]; // group 2 = function form, group 3 = arrow form
      implicitReturn = isImplicitArrow(line);
    } else if (mDefault) {
      name = mDefault[1] || '(default)';
      paramStr = mDefault[2];
    }

    if (!name) continue;

    const params = paramStr ? parseParamNames(paramStr) : [];
    const returnsValue = implicitReturn || bodyHasReturn(lines, i + 1);

    const block = jsdocBefore(lines, i);

    if (!block) {
      missing.push({ file: filePath, line: i + 1, name });
      continue;
    }

    // Evaluate completeness
    const issues = [];

    // 1. Non-empty description
    const descLines = block
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l && !l.startsWith('@') && l !== '/**' && l !== '*/');
    if (descLines.length === 0) issues.push('missing description');

    // 2. @param per parameter
    const paramTags = [...block.matchAll(/@param\s+(?:\{[^}]*\}\s+)?(\w+)/g)].map((m) => m[1]);
    for (const p of params) {
      if (p === '{destructured}') {
        // Accept any @param tag as covering it
        if (paramTags.length === 0) issues.push('missing @param for destructured parameter');
      } else if (!paramTags.includes(p)) {
        issues.push(`missing @param for \`${p}\``);
      }
    }

    // 3. @returns when function returns a value
    if (returnsValue && !/@returns?\b/.test(block)) {
      issues.push('missing @returns');
    }

    if (issues.length === 0) {
      complete.push({ file: filePath, line: i + 1, name });
    } else {
      partial.push({ file: filePath, line: i + 1, name, issues });
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Write report
// ---------------------------------------------------------------------------

const out = ['## JSDoc Coverage', ''];

out.push('### Summary');
out.push('| Status | Count |');
out.push('|---|---|');
out.push(`| ✅ Complete | ${complete.length} |`);
out.push(`| ⚠️ Partial | ${partial.length} |`);
out.push(`| ❌ Missing | ${missing.length} |`);
out.push('');

if (missing.length > 0) {
  out.push('### 🔴 Blocking — missing JSDoc (CLAUDE.md: "document every exported function")');
  out.push('');
  for (const f of missing) {
    out.push(`**[${f.file} line ${f.line}]** \`${f.name}\``);
    out.push('Missing JSDoc block entirely.');
    out.push('');
  }
}

if (partial.length > 0) {
  out.push('### 🟡 Partial — incomplete JSDoc');
  out.push('');
  for (const f of partial) {
    out.push(`**[${f.file} line ${f.line}]** \`${f.name}\``);
    out.push(f.issues.join(', ') + '.');
    out.push('');
  }
}

if (missing.length === 0 && partial.length === 0) {
  out.push('### ✅ All clear');
  out.push('All exported symbols in scope have complete JSDoc.');
}

const verdict = missing.length > 0 ? 'FAIL' : partial.length > 0 ? 'WARN' : 'PASS';
out.push('');
out.push(`**Verdict: ${verdict}**`);

console.log(out.join('\n'));
