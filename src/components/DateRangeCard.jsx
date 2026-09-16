import React, { useEffect, useRef, useState } from 'react';

const fmt = (d) => (d ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` : '—');
const toInput = (d) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
const fromInput = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/**
 * The "TERMINATION DATE" card, clickable: opens a popover to set the date
 * window the page filters on.
 * - dataRange: {min, max} — full span present in the data
 * - value: {from, to} | null (null = all time)
 * - onChange(next): next is {from, to} or null
 */
export default function DateRangeCard({ label = 'TERMINATION DATE', dataRange, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const ref = useRef(null);

  // sync drafts every time the popover opens
  useEffect(() => {
    if (open) {
      setFrom(toInput(value?.from ?? dataRange.min));
      setTo(toInput(value?.to ?? dataRange.max));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const applyRange = (f, t) => {
    // whole-window selection = no filter
    const isAll = (!f || (dataRange.min && f <= dataRange.min)) && (!t || (dataRange.max && t >= dataRange.max));
    onChange(isAll ? null : { from: f, to: t });
    setOpen(false);
  };
  const apply = () => applyRange(fromInput(from), fromInput(to));
  // presets apply in one click
  const preset = (f, t) => applyRange(f, t);
  const max = dataRange.max || new Date();
  const shownFrom = value?.from ?? dataRange.min;
  const shownTo = value?.to ?? dataRange.max;

  return (
    <div
      ref={ref}
      className="card daterange-card"
      onClick={() => setOpen((o) => !o)}
      title="Click to change the date window"
    >
      <div className="dr-label">
        {label}
        {value && <span className="dr-flag">● filtered</span>}
      </div>
      <div className="dr-value">
        {fmt(shownFrom)} – {fmt(shownTo)} <span className="dr-caret">▾</span>
      </div>

      {open && (
        <div className="daterange-pop" onClick={(e) => e.stopPropagation()}>
          <div className="dr-row">
            <label>From</label>
            <input type="date" className="review-select" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="dr-row">
            <label>To</label>
            <input type="date" className="review-select" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="dr-presets">
            <button className="btn btn-clear dr-preset" onClick={() => preset(dataRange.min, dataRange.max)}>All time</button>
            <button className="btn btn-clear dr-preset" onClick={() => preset(new Date(max.getFullYear() - 1, max.getMonth(), max.getDate() + 1), max)}>Last 12 mo</button>
            <button className="btn btn-clear dr-preset" onClick={() => preset(new Date(max.getFullYear(), 0, 1), max)}>YTD</button>
            <button className="btn btn-clear dr-preset" onClick={() => preset(new Date(max.getFullYear() - 1, 0, 1), new Date(max.getFullYear() - 1, 11, 31))}>{max.getFullYear() - 1}</button>
          </div>
          <div className="dr-actions">
            <button className="btn btn-primary dr-apply" onClick={apply}>Apply</button>
            <button className="btn btn-clear" onClick={() => { onChange(null); setOpen(false); }}>Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}
