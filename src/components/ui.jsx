import React from 'react';

// Shared small components, ported/trimmed from the main HR Dashboard Tool
// repo's src/components/ui.jsx. Dropped: RefreshButton (upload flow is out
// of scope) and any prop related to ExportScope/PDF export (also out of
// scope for this static build).

export function Kpi({ value, label }) {
  return (
    <div className="card card--pad">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

export function Legend({ items, dot }) {
  return (
    <div className="legend">
      {items.map(([label, color]) => (
        <span className="legend-item" key={label}>
          <span className={'legend-swatch' + (dot ? ' legend-swatch--dot' : '')} style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * Horizontal bar rows (charts only — coral/pink permitted here).
 * Pass `onSelect` to make rows clickable; `selected` highlights one.
 */
export function BarList({ rows, narrow, stacked, selected, onSelect }) {
  return (
    <div className="bar-list">
      {rows.map((r) => {
        const isSel = selected != null && selected === r.label;
        return (
          <div
            className={'bar-row' + (narrow ? ' bar-row--narrow' : '')}
            key={r.label}
            onClick={onSelect ? () => onSelect(isSel ? null : r.label) : undefined}
            title={onSelect ? (isSel ? 'Click to clear' : 'Click to filter') : undefined}
            style={onSelect ? {
              cursor: 'pointer', borderRadius: 6, padding: '2px 4px',
              background: isSel ? '#e8f5f2' : 'transparent',
            } : undefined}
          >
            <span className="bar-label" title={r.label} style={isSel ? { fontWeight: 700, color: '#005042' } : undefined}>{r.label}</span>
            {stacked ? (
              <div className="bar-track" style={{ display: 'flex', gap: 2 }}>
                <div className="bar-fill" style={{ width: r.regPct + '%', background: '#FF6947', borderRadius: '4px 0 0 4px' }} />
                <div className="bar-fill" style={{ width: r.nonPct + '%', background: '#005042', borderRadius: '0 4px 4px 0' }} />
              </div>
            ) : (
              <div className="bar-track">
                <div className="bar-fill" style={{ width: r.pct + '%', background: r.color }} />
              </div>
            )}
            <span className="bar-count">{r.count}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * White table card: header row + scrollable count rows + optional total.
 * Pass `onRowClick` to make rows clickable (aggregate drill-down only —
 * this static build never lists individual people, so onRowClick must only
 * ever narrow to another aggregate breakdown).
 */
export function TableCard({ header, headerRight = 'Count', rows, total, maxHeight = 480, small, onRowClick, selectedName }) {
  return (
    <div className="card card--clip">
      <div className="tbl-head"><span>{header}</span><span>{headerRight}</span></div>
      <div className="tbl-scroll" style={{ maxHeight }}>
        {rows.map((r, i) => {
          const isSel = onRowClick && selectedName != null && String(selectedName) === String(r.name);
          return (
            <div
              className={'tbl-row' + (small ? ' tbl-row--sm' : '') + (onRowClick ? ' tbl-row--click' : '')}
              key={r.name + i}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              title={onRowClick ? (isSel ? 'Click to close' : 'Click to break this down') : undefined}
              style={isSel ? { background: '#e8f5f2' } : undefined}
            >
              <span style={isSel ? { fontWeight: 700, color: '#005042' } : undefined}>{r.name}</span>
              <span className="tbl-count">{r.count}</span>
            </div>
          );
        })}
      </div>
      {total !== undefined && (
        <div className="tbl-total"><span>Total</span><span>{total}</span></div>
      )}
    </div>
  );
}

/** Checkbox filter card. `selected` is a {name: bool} map. */
export function FilterCard({ title, names, selected, onToggle }) {
  return (
    <div className="card card--clip">
      <div className="filter-card-title">{title}</div>
      <div className="filter-scroll">
        {names.map((n) => (
          <label className="filter-item" key={n}>
            <input type="checkbox" checked={!!selected[n]} onChange={() => onToggle(n)} />
            {n}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Cream empty state for a widget with no data to show. */
export function WidgetUnavailable({ field, note }) {
  return (
    <div className="widget-unavailable">
      <div className="callout-title" style={{ marginBottom: 4 }}>Unavailable</div>
      {note || <>This view needs the field <strong>{field}</strong>, which wasn't found in the data.</>}
    </div>
  );
}
