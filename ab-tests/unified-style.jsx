'use strict';

// Inject shared stylesheet once
(() => {
  if (document.getElementById('ab-styles')) return;
  const s = document.createElement('style');
  s.id = 'ab-styles';
  s.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    body { font-size: 13px; }

    /* Page chrome */
    .ab-page    { max-width: 1320px; margin: 0 auto; padding: 28px 20px; }
    .ab-heading { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
                  color: #6b7a9a; margin-bottom: 20px; }

    /* Two-panel grid */
    .ab-grid              { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
    .ab-panel             { background: #fff; border: 1px solid #dde3ef; border-radius: 10px; overflow: hidden; }
    .ab-panel__label      { padding: 9px 14px; background: #f4f6fb; border-bottom: 1px solid #dde3ef;
                            font-size: 10px; font-weight: 700; letter-spacing: .08em;
                            text-transform: uppercase; color: #7a89a8; }
    .ab-panel__body       { padding: 14px; }

    /* Status chips */
    .s-chip             { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 4px;
                          font-size: 10px; font-weight: 700; letter-spacing: .05em;
                          text-transform: uppercase; white-space: nowrap; }
    .s-chip--todo       { background: #e8ecf4; color: #4a5568; }
    .s-chip--inprogress { background: #dbeafe; color: #1d4ed8; }
    .s-chip--done       { background: #d1fae5; color: #047857; }
    .s-chip--pending    { background: #fef3c7; color: #92400e; }
    .s-chip--blocked    { background: #fee2e2; color: #991b1b; }

    /* Category chip */
    .cat-chip { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 3px;
                font-size: 10px; color: #6b7a9a; background: #eef1f8; }

    /* Elapsed */
    .elapsed { font-size: 10px; color: #6b7a9a; font-variant-numeric: tabular-nums; }

    /* Priority dot */
    .prio-dot       { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .prio-dot--high { background: #ef4444; }
    .prio-dot--med  { background: #f59e0b; }
    .prio-dot--low  { background: #94a3b8; }

    /* Kanban column */
    .kb-col        { background: #f3f6fb; border: 1px solid #dde3ef; border-radius: 8px;
                     padding: 10px; min-width: 0; }
    .kb-col--wip   { background: #fffbeb; border-color: #fde68a; }
    .kb-col__head  { display: flex; align-items: center; gap: 6px; padding-bottom: 9px;
                     margin-bottom: 9px; border-bottom: 1px solid #dde3ef; }
    .kb-col__title { font-size: 10px; font-weight: 700; letter-spacing: .07em;
                     text-transform: uppercase; color: #4a5568; flex: 1; }
    .kb-col__count { font-size: 10px; color: #9aa3b2; }
    .kb-cards      { display: flex; flex-direction: column; gap: 7px; min-height: 36px; }
  `;
  document.head.appendChild(s);
})();

// ── Sample data ───────────────────────────────────────────────────────────────

window.SAMPLE_TASKS = [
  { id: 1, name: 'Refactor auth module',     status: 'inprogress', cat: 'Dev',      prio: 'high', billable: true,  elapsed: '1h 23m' },
  { id: 2, name: 'Update API documentation', status: 'todo',       cat: 'Docs',     prio: 'med',  billable: false, elapsed: null     },
  { id: 3, name: 'Review PR #42',            status: 'inprogress', cat: 'Review',   prio: 'low',  billable: true,  elapsed: '22m'    },
  { id: 4, name: 'Fix login redirect bug',   status: 'todo',       cat: 'Dev',      prio: 'high', billable: true,  elapsed: null     },
  { id: 5, name: 'Deploy to staging',        status: 'done',       cat: 'Ops',      prio: 'med',  billable: false, elapsed: '45m'    },
  { id: 6, name: 'Design review sync',       status: 'pending',    cat: 'Meetings', prio: 'low',  billable: false, elapsed: null,    note: 'Waiting for design team' },
  { id: 7, name: 'Write unit tests',         status: 'todo',       cat: 'Dev',      prio: 'high', billable: true,  elapsed: null     },
  { id: 8, name: 'Update changelog',         status: 'done',       cat: 'Docs',     prio: 'low',  billable: false, elapsed: '12m'    },
];

window.SAMPLE_COMPLETED = [
  { id: 101, name: 'Set up CI pipeline',  cat: 'Ops',      elapsed: '3h 12m', day: '2026-06-02' },
  { id: 102, name: 'Fix CORS headers',    cat: 'Dev',      elapsed: '45m',    day: '2026-06-02' },
  { id: 103, name: 'Sprint planning',     cat: 'Meetings', elapsed: '1h 00m', day: '2026-06-01' },
  { id: 104, name: 'Database indexing',   cat: 'Dev',      elapsed: '2h 05m', day: '2026-06-01' },
  { id: 105, name: 'Write ADR-012',       cat: 'Docs',     elapsed: '30m',    day: '2026-05-31' },
  { id: 106, name: 'Stakeholder demo',    cat: 'Meetings', elapsed: '1h 30m', day: '2026-05-30' },
];

// ── Shared components ─────────────────────────────────────────────────────────

window.AbFrame = function AbFrame({ title, labelA = 'A — current', labelB = 'B — proposed', variantA, variantB }) {
  return (
    <div className="ab-page">
      <div className="ab-heading">{title}</div>
      <div className="ab-grid">
        <div className="ab-panel">
          <div className="ab-panel__label">{labelA}</div>
          <div className="ab-panel__body">{variantA}</div>
        </div>
        <div className="ab-panel">
          <div className="ab-panel__label">{labelB}</div>
          <div className="ab-panel__body">{variantB}</div>
        </div>
      </div>
    </div>
  );
};

window.StatusChip = function StatusChip({ status }) {
  const labels = { todo: 'to do', inprogress: 'in progress', done: 'done', pending: 'pending', blocked: 'blocked' };
  return <span className={`s-chip s-chip--${status}`}>{labels[status] || status}</span>;
};

window.CatChip = function CatChip({ cat }) {
  return <span className="cat-chip">{cat}</span>;
};

window.PrioDot = function PrioDot({ prio }) {
  return <span className={`prio-dot prio-dot--${prio}`} title={prio} />;
};

window.ElapsedBadge = function ElapsedBadge({ elapsed }) {
  if (!elapsed) return null;
  return <span className="elapsed">⏱ {elapsed}</span>;
};
