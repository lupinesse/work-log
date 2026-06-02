'use strict';

function DoneCard({ task }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e4e9f2', borderRadius: 5,
      borderLeft: '3px solid #059669', padding: '6px 8px',
      opacity: 0.6,
    }}>
      <div style={{
        fontSize: 12, color: '#1a2434', marginBottom: 3,
        textDecoration: 'line-through',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {task.name}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <CatChip cat={task.cat} />
        <ElapsedBadge elapsed={task.elapsed} />
      </div>
    </div>
  );
}

// Group an array of tasks by their `day` field, preserving insertion order.
function groupByDay(items) {
  const map = {};
  items.forEach(t => {
    if (!map[t.day]) map[t.day] = [];
    map[t.day].push(t);
  });
  return Object.entries(map);
}

// ── Variant A: Done column with inline ▸ expander ─────────────────────────────

function DoneColumnWithExpander({ todaysDone, history }) {
  const [open, setOpen] = React.useState(false);
  const grouped = groupByDay(history);

  return (
    <div className="kb-col">
      <div className="kb-col__head">
        <span style={{ width: 8, height: 8, borderRadius: 2, background: '#059669', flexShrink: 0 }} />
        <span className="kb-col__title">Done</span>
        <span className="kb-col__count">{todaysDone.length}</span>
      </div>

      <div className="kb-cards">
        {todaysDone.length > 0
          ? todaysDone.map(t => <DoneCard key={t.id} task={t} />)
          : <div style={{ color: '#b5bdd0', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>nothing done yet today</div>
        }
      </div>

      {history.length > 0 && (
        <>
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              width: '100%', marginTop: 8, padding: '5px 8px',
              border: '1px dashed #d1fae5', borderRadius: 5,
              background: open ? '#ecfdf5' : 'transparent',
              color: '#047857', fontSize: 11, cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            {open ? '▾' : '▸'} {history.length} earlier this iteration
          </button>

          {open && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {grouped.map(([day, tasks]) => (
                <div key={day}>
                  <div style={{
                    fontSize: 9, color: '#9aa3b2', letterSpacing: '.06em',
                    textTransform: 'uppercase', padding: '4px 0 2px',
                  }}>{day}</div>
                  {tasks.map(t => <DoneCard key={t.id} task={t} />)}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Variant B: standalone 14-day timeline below the board ─────────────────────

function CompletedTimeline({ items }) {
  const grouped = groupByDay(items);
  return (
    <div style={{
      background: '#f4f6fb', border: '1px solid #dde3ef',
      borderRadius: 8, padding: '12px 14px',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.07em',
        textTransform: 'uppercase', color: '#6b7a9a', marginBottom: 12,
      }}>
        Completed — past 14 days
      </div>
      {grouped.map(([day, tasks]) => (
        <div key={day} style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
            textTransform: 'uppercase', color: '#6b7a9a',
            paddingBottom: 5, marginBottom: 6, borderBottom: '1px solid #e4e9f2',
          }}>
            {day} · {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {tasks.map(t => (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 8px', background: '#fff',
                border: '1px solid #e4e9f2', borderRadius: 5,
              }}>
                <span style={{ color: '#047857', fontSize: 12 }}>✓</span>
                <span style={{
                  flex: 1, fontSize: 12, color: '#6b7a9a',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{t.name}</span>
                <CatChip cat={t.cat} />
                <ElapsedBadge elapsed={t.elapsed} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Placeholder column — represents To Do or In Progress in the board mock.
function PlaceholderCol({ title, count, dotColor }) {
  return (
    <div className="kb-col">
      <div className="kb-col__head">
        <span style={{ width: 8, height: 8, borderRadius: 2, background: dotColor, flexShrink: 0 }} />
        <span className="kb-col__title">{title}</span>
        <span className="kb-col__count">{count}</span>
      </div>
      <div className="kb-cards">
        <div style={{ color: '#b5bdd0', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>
          {count} task{count !== 1 ? 's' : ''}…
        </div>
      </div>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

window.CompletedAB = function CompletedAB() {
  const todaysDone = window.SAMPLE_TASKS.filter(t => t.status === 'done');
  const history    = window.SAMPLE_COMPLETED;

  return (
    <AbFrame
      title="Completed history — A / B"
      labelA="A — Done column with ▸ expander (inline in board)"
      labelB="B — Standalone 14-day timeline below the board"
      variantA={
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
            <PlaceholderCol title="To Do"       count={3} dotColor="#94a3b8" />
            <PlaceholderCol title="In Progress" count={2} dotColor="#2563eb" />
            <DoneColumnWithExpander todaysDone={todaysDone} history={history} />
          </div>
          <div style={{ fontSize: 11, color: '#9aa3b2', textAlign: 'center' }}>
            History stays inside the Done column
          </div>
        </div>
      }
      variantB={
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            <PlaceholderCol title="To Do"       count={3} dotColor="#94a3b8" />
            <PlaceholderCol title="In Progress" count={2} dotColor="#2563eb" />
            <div className="kb-col">
              <div className="kb-col__head">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#059669', flexShrink: 0 }} />
                <span className="kb-col__title">Done</span>
                <span className="kb-col__count">{todaysDone.length}</span>
              </div>
              <div className="kb-cards">
                {todaysDone.map(t => <DoneCard key={t.id} task={t} />)}
              </div>
            </div>
          </div>
          <CompletedTimeline items={history} />
        </div>
      }
    />
  );
};
