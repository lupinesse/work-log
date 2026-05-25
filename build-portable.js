// build-portable.js — produces a self-contained, USB-friendly copy of the app.
//
// Output (in ./portable/):
//   work-log.html       single file with CSS + JS inlined
//   JSON backups/       copy of your local backups so data travels with you
//   launch.bat          double-click launcher
//   start-server.ps1    optional: starts the PS API server if you want namedays/calendar
//   config.local.ps1    optional: nameday API token (copied if it exists)
//   README.txt          quick-start instructions

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  statSync,
  existsSync,
} from 'fs';
import { join } from 'path';
import {
  PORTABLE_OUT as OUT_DIR,
  BACKUPS_DIR as BACKUPS,
  HTML_IN,
  CSS_OUT as CSS_IN,
  JS_OUT as JS_IN,
  PS_SERVER,
  PS_CONFIG,
} from './build-config.js';

// 1. Clean & recreate output dir
if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

// 2. Inline CSS + JS into work-log.html and inject the portable bootstrap
//    The bootstrap shows a restore prompt when localStorage is empty.
const html = readFileSync(HTML_IN, 'utf8');
const css = readFileSync(CSS_IN, 'utf8');
const js = readFileSync(JS_IN, 'utf8');

const bootstrap = `<script>
(function() {
  // Portable bootstrap: detect empty localStorage and offer to restore from a JSON backup.
  if (localStorage.getItem('wl_entries_v1')) return;

  const STORE_MAP = {
    entries: 'wl_entries_v1', categories: 'wl_cats_v1', planTasks: 'wl_plan_v1',
    blocks: 'wl_blocks_v1', pomoLog: 'wl_pomoLog_v1', devLog: 'wl_dev_log',
    distractions: 'wl_distractions_v1', qpHidden: 'wl_qp_hidden_v1',
  };

  function applyBackup(backup) {
    try {
      Object.keys(STORE_MAP).forEach(k => {
        if (backup[k] !== undefined) localStorage.setItem(STORE_MAP[k], JSON.stringify(backup[k]));
      });
      // Carry-over: re-date the most recent batch of incomplete tasks to today
      // so they appear in "today's tasks" instead of being filed under their
      // original date. Mirrors the dev-seed plugin's behavior.
      const today = new Date().toISOString().slice(0, 10);
      const plan  = Array.isArray(backup.planTasks) ? backup.planTasks.slice() : [];
      if (plan.length) {
        const hasToday = plan.some(t => t.date === today);
        if (!hasToday) {
          const incomplete = plan.filter(t =>
            t.status !== 'done' && t.date && t.date < today
          );
          if (incomplete.length) {
            const latest = incomplete.map(t => t.date).sort().pop();
            let moved = 0;
            plan.forEach(t => {
              if (t.date === latest && t.status !== 'done') { t.date = today; moved++; }
            });
            if (moved) {
              localStorage.setItem('wl_plan_v1', JSON.stringify(plan));
              console.log('[portable] Carried ' + moved + ' incomplete tasks from ' + latest + ' to ' + today);
            }
          }
        }
      }
      location.reload();
    } catch (e) {
      alert('Failed to restore: ' + e.message);
    }
  }

  function showPrompt() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:-apple-system,Segoe UI,sans-serif;';
    overlay.innerHTML = \`
      <div style="background:#fff;color:#1a1a18;padding:24px;border-radius:8px;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,0.3);">
        <h2 style="margin:0 0 12px;font-size:18px;">Welcome to Work Log (Portable)</h2>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#555;">
          This browser has no work-log data. Restore from a JSON backup (look in the <code>JSON backups</code> folder on the USB) or start fresh.
        </p>
        <input type="file" id="wlPortableFile" accept=".json" style="margin-bottom:12px;display:block;width:100%;font-size:13px;" />
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="wlPortableSkip" style="padding:8px 14px;background:#eee;border:0;border-radius:6px;cursor:pointer;font-size:13px;">Start fresh</button>
        </div>
      </div>\`;
    document.body.appendChild(overlay);
    document.getElementById('wlPortableFile').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { applyBackup(JSON.parse(reader.result)); }
        catch (err) { alert('Invalid JSON: ' + err.message); }
      };
      reader.readAsText(file);
    });
    document.getElementById('wlPortableSkip').addEventListener('click', () => overlay.remove());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showPrompt);
  } else {
    showPrompt();
  }
})();
</script>`;

const inlined = html
  .replace(/<link\s+rel="stylesheet"\s+href="styles\.css"\s*\/?>/, `<style>\n${css}\n</style>`)
  .replace(/<script\s+src="script\.js"><\/script>/, `<script>\n${js}\n</script>`)
  .replace('</head>', bootstrap + '\n</head>');

writeFileSync(join(OUT_DIR, HTML_IN), inlined);
const inlinedSize = (inlined.length / 1024).toFixed(0);
console.log(`✓ ${HTML_IN} inlined with restore bootstrap (${inlinedSize} KB)`);

// 3. Copy JSON backups (so data history travels with you)
if (existsSync(BACKUPS)) {
  mkdirSync(join(OUT_DIR, BACKUPS), { recursive: true });
  const files = readdirSync(BACKUPS).filter((f) => f.endsWith('.json'));
  files.forEach((f) => copyFileSync(join(BACKUPS, f), join(OUT_DIR, BACKUPS, f)));
  console.log(`✓ Copied ${files.length} JSON backup(s)`);
} else {
  console.log(`⚠ No "${BACKUPS}/" directory found — skipping`);
}

// 4. Copy optional PS API server + config (for namedays / Outlook calendar)
let psBundled = false;
if (existsSync(PS_SERVER)) {
  copyFileSync(PS_SERVER, join(OUT_DIR, PS_SERVER));
  psBundled = true;
  console.log(`✓ Bundled ${PS_SERVER}`);
}
if (existsSync(PS_CONFIG)) {
  copyFileSync(PS_CONFIG, join(OUT_DIR, PS_CONFIG));
  console.log(`✓ Bundled ${PS_CONFIG} (contains nameday API token)`);
}

// 5. Write launch.bat
//    - If start-server.ps1 is present, launch it (full features)
//    - Otherwise just open work-log.html directly (offline mode)
const launchBat = psBundled
  ? `@echo off
REM Portable Work Log launcher.
REM Tries to start the PowerShell API server (for namedays / Outlook calendar).
REM Falls back to opening work-log.html directly if PowerShell isn't available.
cd /d "%~dp0"
where powershell >nul 2>&1
if errorlevel 1 (
    echo PowerShell not found — opening work-log.html directly.
    echo Note: nameday and calendar features will be unavailable.
    start "" "work-log.html"
) else (
    powershell -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
)
`
  : `@echo off
REM Portable Work Log launcher (offline mode — no API server bundled).
cd /d "%~dp0"
start "" "work-log.html"
`;

writeFileSync(join(OUT_DIR, 'launch.bat'), launchBat);
console.log('✓ Wrote launch.bat');

// 6. Write README.txt
const readme = `Work Log — Portable Edition
============================

Quick start
-----------
Double-click launch.bat. Your browser will open the work log.

What's inside
-------------
  work-log.html       single self-contained file (CSS + JS inlined)
  launch.bat          double-click launcher
  JSON backups/       your historical data — used to restore the app
${
  psBundled
    ? `  start-server.ps1    PowerShell API server (namedays + Outlook calendar)
  config.local.ps1    nameday API token (if present)
`
    : ''
}
First time on a new machine
---------------------------
The browser's localStorage is per-machine, so your data won't be there yet.

When you open the app on a new machine you'll see a "Welcome" prompt:
  1. Click the file picker.
  2. Browse to the JSON backups/ folder and pick the most recent file.
  3. The page reloads with your data restored.

If you dismiss the prompt accidentally (or want to start fresh), just close
the browser tab. Next time you open work-log.html the prompt reappears as
long as localStorage is still empty.

Before unplugging
-----------------
  1. Click the 🌙 "end the day" button → exports a fresh backup.
  2. Save the JSON into JSON backups/ on the USB drive.
  3. Next machine you plug into, repeat the restore step above.

Caveats
-------
- Drive letter matters: localStorage is keyed by URL. If your USB mounts as
  D: on one PC and E: on another, the browser treats them as different
  origins and you'll need to re-import each time. This is normal.
- Without start-server.ps1 running, namedays and Outlook calendar will
  show "API unavailable" — everything else still works.
- The PS server requires PowerShell (built into Windows). The calendar
  feature also requires Outlook installed on the host machine.

Built on ${new Date().toISOString().slice(0, 10)}.
`;

writeFileSync(join(OUT_DIR, 'README.txt'), readme);
console.log('✓ Wrote README.txt');

// 7. Summary
const totalSize = readdirSync(OUT_DIR, { recursive: true })
  .map((f) => {
    try {
      return statSync(join(OUT_DIR, f)).size;
    } catch {
      return 0;
    }
  })
  .reduce((a, b) => a + b, 0);
console.log(
  `\n✓ Portable build ready in ./${OUT_DIR}/ (${(totalSize / 1024 / 1024).toFixed(2)} MB total)`
);
console.log(`  Copy this folder to your memory stick.`);
