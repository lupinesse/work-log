'use strict';

const WIP_ACCENT = {
  todo: '#94a3b8', inprogress: '#2563eb', done: '#059669',
};

function MiniCard({ task, actionLabel, onAction }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e4e9f2', borderRadius: 5,
      borderLeft: `3px solid ${WIP_ACCENT[task.status] || '#ccc'}`,
      padding: '6px 8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {task.status === 'inprogress' && (
          <span style={{ color: '#2563eb', fontSize: 11 }}>▶</span>
        )}
        <span style={{
          flex: 1, fontSize: 12, color: '#1a2434',
          fontWeight: task.status === 'inprogress' ? 600 : 400,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {task.name}
        </span>
        {onAction && (
          <button
            aria-label={actionLabel}
            onClick={onAction}
            style={{
              fontSize: 10, padding: '2px 6px', cursor: 'pointer',
              border: '1px solid #dde3ef', borderRadius: 3,
              background: '#f4f6fb', color: '#2563eb', flexShrink: 0,
            }}
          >
            {actionLabel}
          </button>
        )}
      </div>
      <div style={{ marginTop: 3 }}>
        <CatChip cat={task.cat} />
      </div>
    </div>
  );
}

function KbCol({ title, dotColor, wip, children, count }) {
  return (
    <div className={`kb-col${wip ? ' kb-col--wip' : ''}`}>
      <div className="kb-col__head">
        <span style={{ width: 8, height: 8, borderRadius: 2, background: dotColor, flexShrink: 0 }} />
        <span className="kb-col__title">{title}</span>
        <span className="kb-col__count">{count}</span>
      </div>
      {children}
    </div>
  );
}

// ── Variant A: soft WIP warn ───────────────────────────────────────────────────
// Moving a second card to In Progress is allowed; the column turns amber and
// shows a dismissable warning banner.

function SoftWipBoard() {
  const [inProg, setInProg] = React.useState([
    { id: 1, name: 'Refactor auth module', status: 'inprogress', cat: 'Dev' },
  ]);
  const [todo, setTodo] = React.useState([
    { id: 2, name: 'Update API docs',        status: 'todo', cat: 'Docs' },
    { id: 3, name: 'Fix login redirect bug', status: 'todo', cat: 'Dev'  },
  ]);
  const [warnDismissed, setWarnDismissed] = React.useState(false);

  function start(task) {
    setTodo(prev => prev.filter(t => t.id !== task.id));
    setInProg(prev => [...prev, { ...task, status: 'inprogress' }]);
    setWarnDismissed(false);
  }

  const isOver = inProg.length > 1;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
      <KbCol title="To Do" dotColor="#94a3b8" count={todo.length}>
        <div className="kb-cards">
          {todo.map(t => (
            <MiniCard key={t.id} task={t} actionLabel="→ start" onAction={() => start(t)} />
          ))}
          {todo.length === 0 && (
            <div style={{ color: '#b5bdd0', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>empty</div>
          )}
        </div>
      </KbCol>

      <KbCol title="In Progress" dotColor="#2563eb" wip={isOver} count={inProg.length}>
        {isOver && !warnDismissed && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
            padding: '6px 8px', borderRadius: 5,
            background: '#fef3c7', border: '1px solid #fde68a',
            fontSize: 11, color: '#92400e',
          }}>
            <span style={{ flex: 1 }}>⚠ {inProg.length} in progress — pick one to focus</span>
            <button
              aria-label="Dismiss warning"
              onClick={() => setWarnDismissed(true)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#b45309', fontSize: 14, lineHeight: 1 }}
            >×</button>
          </div>
        )}
        <div className="kb-cards">
          {inProg.map(t => <MiniCard key={t.id} task={t} />)}
        </div>
      </KbCol>

      <KbCol title="Done" dotColor="#059669" count={0}>
        <div className="kb-cards">
          <div style={{ color: '#b5bdd0', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>nothing done yet</div>
        </div>
      </KbCol>
    </div>
  );
}

// ── Variant B: hard cap ───────────────────────────────────────────────────────
// Only 1 card may be In Progress at a time. Attempting to start a second shows
// an inline swap prompt instead of moving the card.

function HardCapBoard() {
  const [inProg, setInProg] = React.useState([
    { id: 1, name: 'Refactor auth module', status: 'inprogress', cat: 'Dev' },
  ]);
  const [todo, setTodo] = React.useState([
    { id: 2, name: 'Update API docs',        status: 'todo', cat: 'Docs' },
    { id: 3, name: 'Fix login redirect bug', status: 'todo', cat: 'Dev'  },
  ]);
  const [pendingSwap, setPendingSwap] = React.useState(null);

  function tryStart(task) {
    if (inProg.length === 0) {
      setTodo(prev => prev.filter(t => t.id !== task.id));
      setInProg([{ ...task, status: 'inprogress' }]);
    } else {
      setPendingSwap(task);
    }
  }

  function confirmSwap() {
    const current = inProg[0];
    setTodo(prev =>
      prev
        .filter(t => t.id !== pendingSwap.id)
        .concat({ ...current, status: 'todo' })
    );
    setInProg([{ ...pendingSwap, status: 'inprogress' }]);
    setPendingSwap(null);
  }

  function cancelSwap() {
    setPendingSwap(null);
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <KbCol title="To Do" dotColor="#94a3b8" count={todo.length}>
          <div className="kb-cards">
            {todo.map(t => (
              <MiniCard key={t.id} task={t} actionLabel="→ start" onAction={() => tryStart(t)} />
            ))}
            {todo.length === 0 && (
              <div style={{ color: '#b5bdd0', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>empty</div>
            )}
          </div>
        </KbCol>

        <KbCol title="In Progress" dotColor="#2563eb" count={`${inProg.length}/1`}>
          <div className="kb-cards">
            {inProg.map(t => <MiniCard key={t.id} task={t} />)}
            {inProg.length === 0 && (
              <div style={{ color: '#b5bdd0', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>nothing in progress</div>
            )}
          </div>
        </KbCol>

        <KbCol title="Done" dotColor="#059669" count={0}>
          <div className="kb-cards">
            <div style={{ color: '#b5bdd0', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>nothing done yet</div>
          </div>
        </KbCol>
      </div>

      {/* Swap prompt rendered below the board when a conflict is pending */}
      {pendingSwap && (
        <div style={{
          marginTop: 10, padding: '10px 12px',
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 7,
        }}>
          <div style={{ fontSize: 12, color: '#1e40af', fontWeight: 600, marginBottom: 6 }}>
            Already working on "{inProg[0]?.name}"
          </div>
          <div style={{ fontSize: 11, color: '#3b82f6', marginBottom: 10 }}>
            Starting "{pendingSwap.name}" will move the current task back to To Do.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={confirmSwap}
              style={{
                padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: '#2563eb', color: '#fff', border: 'none', borderRadius: 5,
              }}
            >
              Swap — move current back to To Do
            </button>
            <button
              onClick={cancelSwap}
              style={{
                padding: '5px 12px', fontSize: 11, cursor: 'pointer',
                background: '#fff', color: '#6b7a9a',
                border: '1px solid #dde3ef', borderRadius: 5,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

window.WipAB = function WipAB() {
  return (
    <AbFrame
      title="Board behaviors — WIP limit A / B"
      labelA="A — soft warn (amber tint + dismissable banner, ≥ 2 in progress)"
      labelB="B — hard cap (1 in progress max; swap prompt on conflict)"
      variantA={<SoftWipBoard />}
      variantB={<HardCapBoard />}
    />
  );
};
