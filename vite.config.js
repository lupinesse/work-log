import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { compile } from 'sass';

const JS_SRC = 'src/js';
const JS_OUT = 'script.js';
const CSS_SRC = 'src/css/styles.scss';
const CSS_OUT = 'styles.css';
const BACKUPS_DIR = 'JSON backups';

const LEAF_MODULES = new Set(['pure-fns.js', 'logger.js']);

function readPureFnsExports() {
  const src = readFileSync(join(JS_SRC, 'pure-fns.js'), 'utf8');
  return [...src.matchAll(/^export (?:function|const|class) (\w+)/gm)].map((m) => m[1]);
}

function buildJS() {
  const pureFnsExports = readPureFnsExports();
  const files = readdirSync(JS_SRC)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.example.js') && !LEAF_MODULES.has(f))
    .sort();
  const parts = files.map((f) => {
    const content = readFileSync(join(JS_SRC, f), 'utf8').replace(/\s+$/, '');
    return `// ── ${f} ──\n${content}`;
  });
  const imports = [
    `import { ${pureFnsExports.join(', ')} } from './src/js/pure-fns.js';`,
    `import { wlLog } from './src/js/logger.js';`,
  ].join('\n');
  const output = imports + '\n\n' + parts.join('\n\n') + '\n';
  writeFileSync(JS_OUT, output);
  return files.length;
}
function buildCSS() {
  const result = compile(CSS_SRC, { style: 'expanded' });
  writeFileSync(CSS_OUT, result.css);
}

function assetBuildPlugin() {
  return {
    name: 'asset-build',
    configureServer(_server) {
      const jsCount = buildJS();
      buildCSS();
      console.log(`✓ Built ${JS_OUT} from ${jsCount} JS files and ${CSS_OUT} from SCSS`);
    },
    handleHotUpdate({ file, server }) {
      const norm = file.replace(/\\/g, '/');
      const name = norm.split('/').pop();

      if (
        norm.includes('/' + JS_SRC + '/') &&
        file.endsWith('.js') &&
        !file.endsWith('.example.js')
      ) {
        const count = buildJS();
        console.log(`[vite] rebuilt ${JS_OUT} (${count} files) — ${name} changed`);
        server.ws.send({ type: 'full-reload' });
        return [];
      }

      if (norm.includes('/src/css/') && file.endsWith('.scss')) {
        try {
          buildCSS();
          console.log(`[vite] rebuilt ${CSS_OUT} — ${name} changed`);
          server.ws.send({ type: 'full-reload' });
        } catch (err) {
          console.error(`[vite] SCSS error in ${name}:`, err.message);
        }
        return [];
      }
    },
    buildStart() {
      buildJS();
      buildCSS();
    },
  };
}

// Dev-only plugin: seeds localStorage with the latest JSON backup when localStorage is empty.
function devSeedPlugin() {
  return {
    name: 'dev-seed',
    apply: 'serve',
    transformIndexHtml(html) {
      if (!existsSync(BACKUPS_DIR)) return html;

      const files = readdirSync(BACKUPS_DIR)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse();
      if (files.length === 0) return html;

      const latestFile = files[0];
      // Escape </ to prevent breaking out of inline <script> tag
      const backupJson = readFileSync(join(BACKUPS_DIR, latestFile), 'utf8').replace(
        /<\//g,
        '<\\/'
      );

      const seedScript = `<script>
(function() {
  function dk(d) { return d.toISOString().slice(0,10); }
  var today = dk(new Date());

  // 1. Seed from backup ONLY if localStorage is empty
  if (!localStorage.getItem('wl_entries_v1')) {
    try {
      var backup = ${backupJson};
      var map = {
        entries: 'wl_entries_v1',
        categories: 'wl_cats_v1',
        planTasks: 'wl_plan_v1',
        blocks: 'wl_blocks_v1',
        pomoLog: 'wl_pomoLog_v1',
        devLog: 'wl_dev_log',
        distractions: 'wl_distractions_v1',
        qpHidden: 'wl_qp_hidden_v1',
      };
      Object.keys(map).forEach(function(k) {
        if (backup[k] !== undefined) {
          localStorage.setItem(map[k], JSON.stringify(backup[k]));
        }
      });
      console.log('[dev] Seeded localStorage from ${latestFile}');
    } catch (e) {
      console.error('[dev] Seed failed:', e);
    }
  }

  // 2. Carry-over: if today's task list is empty but there are incomplete tasks
  // from earlier dates, re-date the most recent batch to today. Idempotent —
  // safe to run on every page load, does nothing if today already has tasks.
  try {
    var planRaw = localStorage.getItem('wl_plan_v1');
    if (!planRaw) return;
    var plan = JSON.parse(planRaw);
    if (!Array.isArray(plan) || plan.length === 0) return;

    var hasToday = plan.some(function(t) { return t.date === today; });
    if (hasToday) return;

    var pastIncomplete = plan.filter(function(t) {
      return t.status !== 'done' && t.date && t.date < today;
    });
    if (pastIncomplete.length === 0) return;

    var dates = pastIncomplete.map(function(t) { return t.date; }).sort();
    var latest = dates[dates.length - 1];

    var moved = 0;
    pastIncomplete.forEach(function(t) {
      if (t.date === latest) { t.date = today; moved++; }
    });

    localStorage.setItem('wl_plan_v1', JSON.stringify(plan));
    console.log('[dev] Carried ' + moved + ' incomplete tasks from ' + latest + ' to ' + today);
  } catch (e) {
    console.error('[dev] Carry-over failed:', e);
  }
})();
</script>`;

      return html.replace('</head>', seedScript + '\n</head>');
    },
  };
}

export default defineConfig({
  root: '.',
  server: {
    port: 8000,
    open: '/work-log.html',
    strictPort: true,
    proxy: {
      // Forward nameday / typesense / calendar API calls to the PowerShell
      // server (start-server.ps1) running on port 8080. Required for namedays,
      // holidays, flag days, and Outlook calendar meetings to show in dev.
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        configure: (proxy) => {
          let warned = false;
          proxy.on('error', (err, _req, res) => {
            if (err.code === 'ECONNREFUSED') {
              if (!warned) {
                console.warn(
                  '[vite] PowerShell API server not running on :8080 — namedays/calendar/holidays disabled. Start with .\\launch.bat to enable.'
                );
                warned = true;
              }
              try {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end('{"error":"API server unavailable"}');
              } catch {}
            } else {
              console.error('[vite] proxy error:', err.message);
            }
          });
        },
      },
    },
  },
  preview: {
    port: 8090,
    open: '/work-log.html',
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'work-log.html',
    },
  },
  plugins: [assetBuildPlugin(), devSeedPlugin()],
});
