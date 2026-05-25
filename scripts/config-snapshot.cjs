// scripts/config-snapshot.cjs
// Reads src/js/00-config.js and prints a Markdown block listing every
// compile-time constant (let / const declaration) and its default value.
// Used by the GitHub Release workflow to permanently record which config
// defaults were baked into each release.
//
// Usage: node scripts/config-snapshot.cjs [--stdout]
//   Prints Markdown to stdout.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_SRC = path.join(__dirname, '../src/js/00-config.js');
const src = fs.readFileSync(CONFIG_SRC, 'utf8');

// Extract `let NAME = value;` and `const NAME = value;` lines.
// Handles: numbers, strings, empty objects {}, multi-word strings.
// Skips block-comment-only lines, closing braces etc.
const rows = [];
for (const line of src.split('\n')) {
  const m = line.match(/^\s*(?:let|const)\s+(\w+)\s*=\s*(.+?)(?:\s*;)?\s*$/);
  if (!m) continue;
  const [, name, rawVal] = m;
  // Skip object-open lines like `const FOO = {` (value captured as `{`)
  if (rawVal.trim() === '{') continue;
  rows.push({ name, value: rawVal.trim().replace(/;$/, '') });
}

const lines = [
  '',
  '## Config defaults at this release',
  '',
  'These are the compile-time defaults baked into `src/js/00-config.js`.',
  'Runtime overrides (weather location etc.) are set per-machine in `config.local.ps1`.',
  '',
  '| Constant | Default value |',
  '|----------|---------------|',
];

for (const { name, value } of rows) {
  // Wrap in backticks for readability; escape any pipe characters
  const safeVal = value.replace(/\|/g, '\\|');
  lines.push(`| \`${name}\` | \`${safeVal}\` |`);
}

lines.push('');
console.log(lines.join('\n'));
