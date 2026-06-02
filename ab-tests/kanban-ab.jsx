'use strict';

// Shared mini-card used within both board variants.
const COL_ACCENT = {
  todo: '#94a3b8', inprogress: '#2563eb', done: '#059669',
  pending: '#d97706', blocked: '#dc2626',
};

function MiniCard({ task }) {
  const isDone = task.status === 'done';
  return (
    <div style={{
      background: '#fff', border: '1px solid #e4e9f2', borderRadius: 5,
      borderLeft: `3px solid ${COL_ACCENT[task.status] || '#ccc'}`,
      padding: '6px 8px',
      opacity: isDone ? 0.6 : 1,
    }}>
      <div style={{
        fontSize: 12, color: '#1a2434', marginBottom: 3,
        fontWeight: task.status === 'inprogress' ? 600 : 400,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textDecoration: isDone ? 'line-through' : 'none',
      }}>
        {task.status === 'inprogress' && (
          <span style={{ color: '#2563eb', marginRight: 4 }}>▶</span>
        )}
        {task.name}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <CatChip cat={task.cat} />
        <ElapsedBadge elapsed={task.elapsed} />
        {task.note && <span style={{ fontSize: 10, color: '#92400e' }}>💬</span>}
      </div>
    </div>
  );
}

function KbColumn({ title, tasks, dotColor, wip = false }) {
  return (
    <div className={`kb-col${wip ? ' kb-col--wip' : ''}`}>
      <div className="kb-col__head">
        <span style={{
          width: 8, height: 8, borderRadius: 2,
          background: dotColor, flexShrink: 0,
        }} />
        <span className="kb-col__title">{title}</span>
        <span className="kb-col__count">{tasks.length}</span>
      </div>
      <div className="kb-cards">
        {tasks.map(t => <MiniCard key={t.id} task={t} />)}
        {tasks.length === 0 && (
          <div style={{ color: '#b5bdd0', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>
            empty
          </div>
        )}
      </div>
    </div>
  );
}

// ── Variant A: 3-column board ─────────────────────────────────────────────────
// Pending / blocked fold into To Do. Done column shows today's completed.

function ThreeColBoard() {
  const all = window.SAMPLE_TASKS;
  const inprog  = all.filter(t => t.status === 'inprogress');
  const done    = all.filter(t => t.status === 'done');
  // Pending + blocked absorb into To Do with their existing badge treatment
  const todo    = all.filter(t => ['todo', 'pending', 'blocked'].includes(t.status));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
      <KbColumn title="To Do"       tasks={todo}   dotColor="#94a3b8" />
      <KbColumn title="In Progress" tasks={inprog}  dotColor="#2563eb" wip={inprog.length > 1} />
      <KbColumn title="Done"        tasks={done}   dotColor="#059669" />
    </div>
  );
}

// ── Variant B: 4-column board ─────────────────────────────────────────────────
// Pending / blocked get their own lane so they remain visible without scrolling.

function FourColBoard() {
  const all = window.SAMPLE_TASKS;
  const todo    = all.filter(t => t.status === 'todo');
  const inprog  = all.filter(t => t.status === 'inprogress');
  const pending = all.filter(t => ['pending', 'blocked'].includes(t.status));
  const done    = all.filter(t => t.status === 'done');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
      <KbColumn title="To Do"          tasks={todo}    dotColor="#94a3b8" />
      <KbColumn title="In Progress"    tasks={inprog}  dotColor="#2563eb" wip={inprog.length > 1} />
      <KbColumn title="Pending/Blocked" tasks={pending} dotColor="#d97706" />
      <KbColumn title="Done"           tasks={done}    dotColor="#059669" />
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

window.KanbanAB = function KanbanAB() {
  return (
    <AbFrame
      title="Kanban board layout — A / B"
      labelA="A — 3 columns (pending + blocked fold into To Do)"
      labelB="B — 4 columns (separate Pending / Blocked lane)"
      variantA={<ThreeColBoard />}
      variantB={<FourColBoard />}
    />
  );
};
