// deploy-portable.js — copies the portable/ folder to a destination (e.g. USB drive).
//
// Usage:
//   node deploy-portable.js D:\worklog
//   npm run portable:deploy -- D:\worklog
//
// The destination is remembered in .portable-dest (gitignored) so subsequent
// runs can skip the argument:
//   npm run portable:deploy

import { existsSync, readFileSync, writeFileSync, rmSync, cpSync, statSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { PORTABLE_OUT as SRC, DEST_FILE } from './build-config.js';

function getDestArg() {
  const arg = process.argv[2];
  if (arg) return arg;
  if (existsSync(DEST_FILE)) return readFileSync(DEST_FILE, 'utf8').trim();
  return null;
}

const dest = getDestArg();
if (!dest) {
  console.error('Usage: node deploy-portable.js <destination-path>');
  console.error('Example: node deploy-portable.js D:\\worklog');
  console.error('(After the first run the path is remembered.)');
  process.exit(1);
}

if (!existsSync(SRC)) {
  console.error(`'${SRC}/' doesn't exist — run "npm run portable" first.`);
  process.exit(1);
}

const resolvedDest = resolve(dest);

// Sanity check: refuse to delete anything that isn't a portable folder.
// A "portable" folder is identified by the presence of work-log.html at its root.
if (existsSync(resolvedDest)) {
  const looksPortable =
    existsSync(resolve(resolvedDest, 'work-log.html')) || readdirSync(resolvedDest).length === 0;
  if (!looksPortable) {
    console.error(
      `Refusing to overwrite '${resolvedDest}' — it isn't empty and doesn't look like a portable worklog folder.`
    );
    console.error('Either point to an empty folder or delete the contents first.');
    process.exit(1);
  }
  rmSync(resolvedDest, { recursive: true, force: true });
}

cpSync(SRC, resolvedDest, { recursive: true });

const totalBytes = readdirSync(resolvedDest, { recursive: true })
  .map((f) => {
    try {
      return statSync(resolve(resolvedDest, f)).size;
    } catch {
      return 0;
    }
  })
  .reduce((a, b) => a + b, 0);

writeFileSync(DEST_FILE, dest);
console.log(`✓ Deployed to ${resolvedDest} (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
console.log(`  Saved destination to ${DEST_FILE} — next run no argument needed.`);
