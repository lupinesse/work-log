'use strict';

// ── Variant A: current row-style card ─────────────────────────────────────────
// Status select on left, task name + meta in middle, actions reveal on hover.

const STATUS_BG = {
  todo: '#e8ecf4', inprogress: '#dbeafe', done: '#d1fae5',
  pending: '#fef3c7', blocked: '#fee2e2',
};
const STATUS_LABEL = {
  todo: 'to do', inprogress: 'in progress', done: 'done',
  pending: 'pending', blocked: 'blocked',
};
const STATUS_BORDER = {
  todo: '#94a3b8', inprogress: '#2563eb', done: '#059669',
  pending: '#d97706', blocked: '#dc2626',
};

function RowCard({ task }) {
  const [hovered, setHovered] = React.useState(false);
  const isActive = task.status === 'inprogress';
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '8px 10px', borderRadius: 6, cursor: 'default',
        background: isActive ? '#f0f7ff' : '#fff',
        border: '1px solid #e4e9f2',
        outline: isActive ? '1.5px solid #93c5fd' : 'none',
      }}
    >
      {/* Status select */}
      <select
        value={task.status}
        onChange={() => {}}
        style={{
          flexShrink: 0, width: 92, padding: '3px 4px',
          border: '1px solid #dde3ef', borderRadius: 4,
          fontSize: 10, fontWeight: 600,
          background: STATUS_BG[task.status], color: '#1a2434',
          cursor: 'pointer', appearance: 'none', textAlign: 'center',
        }}
      >
        <option value={task.status}>{STATUS_LABEL[task.status]}</option>
      </select>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {isActive && <span style={{ color: '#2563eb', fontSize: 11 }}>▶</span>}
          <span style={{
            fontSize: 13, color: '#1a2434',
            fontWeight: isActive ? 600 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {task.name}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <CatChip cat={task.cat} />
          <ElapsedBadge elapsed={task.elapsed} />
          {task.note && <span style={{ fontSize: 10, color: '#92400e' }}>💬 {task.note}</span>}
        </div>
      </div>

      {/* Hover actions */}
      <div style={{
        display: 'flex', gap: 4, flexShrink: 0,
        opacity: hovered ? 1 : 0, transition: 'opacity .15s',
      }}>
        {[
          { label: '▸ track', aria: 'Track' },
          { label: 'edit',    aria: 'Edit'  },
          { label: '×',       aria: 'Delete' },
        ].map(({ label, aria }) => (
          <button key={label} aria-label={aria} style={{
            padding: '2px 7px', fontSize: 10, cursor: 'pointer',
            border: '1px solid #dde3ef', borderRadius: 4,
            background: '#f4f6fb', color: '#6b7a9a',
          }}>{label}</button>
        ))}
      </div>
    </div>
  );
}

// ── Variant B: compact card with coloured left border ─────────────────────────
// Status visible via left accent + inline chip; actions always shown at small size.

function BorderCard({ task }) {
  const isDone = task.status === 'done';
  return (
    <div style={{
      borderLeft: `3px solid ${STATUS_BORDER[task.status]}`,
      background: '#fff', border: '1px solid #e4e9f2',
      borderRadius: 6, padding: '7px 10px',
      opacity: isDone ? 0.6 : 1,
    }}>
      {/* Header row: prio dot + name + action icons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <PrioDot prio={task.prio} />
        <span style={{
          flex: 1, fontSize: 13, color: '#1a2434',
          fontWeight: task.status === 'inprogress' ? 600 : 400,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: isDone ? 'line-through' : 'none',
        }}>
          {task.status === 'inprogress' && (
            <span style={{ color: '#2563eb', marginRight: 4 }}>▶</span>
          )}
          {task.name}
        </span>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {[
            { icon: '▸', aria: 'Track'  },
            { icon: '✎', aria: 'Edit'   },
            { icon: '×', aria: 'Delete' },
          ].map(({ icon, aria }) => (
            <button key={icon} aria-label={aria} style={{
              width: 20, height: 20, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 11,
              border: 'none', borderRadius: 3,
              background: 'transparent', color: '#b5bdd0', cursor: 'pointer',
            }}>{icon}</button>
          ))}
        </div>
      </div>

      {/* Footer row: status chip + cat + elapsed */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <StatusChip status={task.status} />
        <CatChip cat={task.cat} />
        <ElapsedBadge elapsed={task.elapsed} />
        {task.note && (
          <span style={{ fontSize: 10, color: '#92400e', marginLeft: 'auto' }}>
            💬 {task.note}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

window.CardAB = function CardAB() {
  const tasks = window.SAMPLE_TASKS;
  return (
    <AbFrame
      title="Card style — A / B"
      labelA="A — current (status select · hover actions)"
      labelB="B — compact card (left accent border · inline actions)"
      variantA={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tasks.map(t => <RowCard key={t.id} task={t} />)}
        </div>
      }
      variantB={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tasks.map(t => <BorderCard key={t.id} task={t} />)}
        </div>
      }
    />
  );
};
