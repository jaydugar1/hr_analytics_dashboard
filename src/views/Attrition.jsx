import React, { useMemo, useState } from 'react';
import { Kpi, WidgetUnavailable } from '../components/ui.jsx';
import { periodAttrition, isVoluntaryReason, MONTHS, periodBounds, shiftPeriod } from '../lib/metrics.js';

// Adapted from the main repo's src/views/Attrition.jsx. This page is
// entirely aggregate (rates, counts, headcounts) in the original too, so no
// privacy simplification was needed here beyond dropping the
// upload/mapping-status plumbing (`compass`/`term.missingFields`) that this
// static build has no equivalent of.

const TERM_TYPES = [['all', 'Overall'], ['vol', 'Voluntary'], ['invol', 'Involuntary']];
const TYPE_NOTE = { all: '', vol: ' · voluntary', invol: ' · involuntary' };
const fmtD = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const fmtHC = (n) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 }));

export default function Attrition({ census, terms }) {
  const [includeContractors, setIncludeContractors] = useState(false);
  const { all, termSource } = useMemo(() => {
    const inPop = (r) => includeContractors || r.is_contractor !== true;
    return { all: census.filter(inPop), termSource: terms.filter(inPop) };
  }, [census, terms, includeContractors]);

  const [termType, setTermType] = useState('all');
  const termsForCount = useMemo(() => {
    if (termType === 'all') return termSource;
    return termSource.filter((r) => isVoluntaryReason(r.termination_reason) === (termType === 'vol'));
  }, [termSource, termType]);

  const maxDate = useMemo(() => {
    let max = null;
    for (const r of termSource) {
      const d = r.termination_date;
      if (d instanceof Date && !isNaN(d) && (!max || d > max)) max = d;
    }
    return max || new Date();
  }, [termSource]);

  const [view, setView] = useState('month');
  const [sel, setSel] = useState(null);
  const [picked, setPicked] = useState(null);
  const selected = sel || { year: maxDate.getFullYear(), idx: view === 'month' ? maxDate.getMonth() : Math.floor(maxDate.getMonth() / 3) };
  const selectAnchor = (next) => { setSel(next); setPicked(null); };

  const switchView = (v) => {
    if (v === view) return;
    if (v === 'year' || view === 'year') {
      setSel(null);
    } else {
      const cur = selected;
      setSel(v === 'quarter' ? { year: cur.year, idx: Math.floor(cur.idx / 3) } : { year: cur.year, idx: cur.idx * 3 + 2 });
    }
    setPicked(null);
    setView(v);
  };

  const years = useMemo(() => {
    const ys = new Set(termSource.map((r) => (r.termination_date instanceof Date && !isNaN(r.termination_date) ? r.termination_date.getFullYear() : null)).filter(Boolean));
    ys.add(maxDate.getFullYear());
    return [...ys].sort();
  }, [termSource, maxDate]);

  const trailingN = view === 'month' ? 12 : 8;
  const periods = useMemo(() => {
    if (view === 'year') {
      const out = years.slice(-8).map((y) => {
        const b = periodBounds('year', y, 0);
        return { ...b, year: y, idx: 0, partial: b.end > maxDate, ...periodAttrition(all, termsForCount, b.start, b.end, 1) };
      });
      const ltmEnd = maxDate;
      const ltmStart = new Date(maxDate.getFullYear() - 1, maxDate.getMonth(), maxDate.getDate() + 1);
      out.push({ label: 'L12M', name: 'Last 12 months', year: 'ltm', idx: 0, factor: 1, partial: false, ...periodAttrition(all, termsForCount, ltmStart, ltmEnd, 1) });
      return out;
    }
    const out = [];
    for (let k = trailingN - 1; k >= 0; k--) {
      const p = shiftPeriod(view, selected.year, selected.idx, -k);
      const b = periodBounds(view, p.year, p.idx);
      out.push({ ...b, year: p.year, idx: p.idx, partial: b.end > maxDate, ...periodAttrition(all, termsForCount, b.start, b.end, b.factor) });
    }
    return out;
  }, [view, selected.year, selected.idx, all, termsForCount, trailingN, maxDate, years]);

  const current = (picked && periods.find((p) => p.year === picked.year && p.idx === picked.idx)) || periods[periods.length - 1];

  if (!termSource.length) {
    return <WidgetUnavailable note="No termination data is loaded yet." />;
  }

  const W = 780, H = 300, PAD_L = 44, PAD_B = 40, PAD_T = 26;
  const plotW = W - PAD_L - 16, plotH = H - PAD_T - PAD_B;
  const yMax = Math.max(10, ...periods.map((p) => p.rate || 0)) * 1.1;
  const slot = plotW / periods.length;
  const barW = Math.min(48, slot * 0.62);
  const pillStyle = (active) => ({
    fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 9999,
    border: `1px solid ${active ? '#005042' : '#d4cfc5'}`, background: active ? '#005042' : '#FFFFFF',
    color: active ? '#FEF8E8' : '#311E04', cursor: 'pointer',
  });
  const periodChoices = view === 'month' ? MONTHS : ['Q1', 'Q2', 'Q3', 'Q4'];

  return (
    <div className="view-stack">
      <div className="card" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={pillStyle(view === 'month')} onClick={() => switchView('month')}>Month view</button>
          <button style={pillStyle(view === 'quarter')} onClick={() => switchView('quarter')}>Quarter view</button>
          <button style={pillStyle(view === 'year')} onClick={() => switchView('year')}>Year view</button>
        </div>
        <div style={{ width: 1, alignSelf: 'stretch', background: '#e8e5de' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={pillStyle(!includeContractors)} onClick={() => setIncludeContractors(false)}>Employees only</button>
          <button style={pillStyle(includeContractors)} onClick={() => setIncludeContractors(true)}>All workers</button>
        </div>
        <div style={{ width: 1, alignSelf: 'stretch', background: '#e8e5de' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          {TERM_TYPES.map(([id, label]) => (
            <button key={id} style={pillStyle(termType === id)} onClick={() => setTermType(id)}>{label}</button>
          ))}
        </div>
        <div style={{ width: 1, alignSelf: 'stretch', background: '#e8e5de' }} />
        {view === 'year' ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {periods.map((p) => (
              <button key={p.name} style={{ ...pillStyle(current.name === p.name), padding: '6px 11px', fontWeight: 500 }} onClick={() => setPicked({ year: p.year, idx: p.idx })}>
                {p.name === 'Last 12 months' ? 'Last 12 mo' : p.label}
              </button>
            ))}
          </div>
        ) : (
          <>
            <select value={selected.year} onChange={(e) => selectAnchor({ year: Number(e.target.value), idx: selected.idx })} className="review-select" style={{ fontWeight: 600 }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {periodChoices.map((label, i) => (
                <button key={label} style={{ ...pillStyle(selected.idx === i), padding: '6px 11px', fontWeight: 500 }} onClick={() => selectAnchor({ year: selected.year, idx: i })}>{label}</button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="kpi-grid-3x">
        <Kpi value={current.rate == null ? '—' : current.rate.toFixed(1) + '%'} label={`Attrition Rate — ${current.name} (${current.factor === 1 ? 'actual' : `annualized ×${current.factor}`})${TYPE_NOTE[termType]}${current.partial ? ' · partial period' : ''}`} />
        <Kpi value={current.terminated} label={`Terminated in ${current.name}${TYPE_NOTE[termType]}`} />
        <Kpi value={fmtHC(current.avgHC)} label="Average Headcount" />
        <div className="card" style={{ padding: '16px 20px', fontSize: 13, color: '#655e52', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
          <div><span style={{ fontFamily: 'var(--font-headline)', fontWeight: 600, fontSize: 12, letterSpacing: '0.04em', color: '#311E04' }}>PERIOD</span> &nbsp;{fmtD(current.start)} – {fmtD(current.end)}</div>
          <div><span style={{ fontFamily: 'var(--font-headline)', fontWeight: 600, fontSize: 12, letterSpacing: '0.04em', color: '#311E04' }}>HEADCOUNT</span> &nbsp;{fmtHC(current.startHC)} start → {fmtHC(current.endHC)} end</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card card--pad">
          <div className="card-title">
            {view === 'year' ? 'Actual attrition — by year (terms ÷ average headcount, no annualization)' : `Annualized attrition — trailing ${trailingN} ${view === 'month' ? 'months' : 'quarters'}`}
            {termType !== 'all' && <span style={{ color: '#FF6947' }}> — {termType === 'vol' ? 'voluntary' : 'involuntary'} terminations only</span>}
          </div>
          <div style={{ fontSize: 12.5, color: '#655e52', margin: '4px 0 6px' }}>
            Click a bar to see that period's calculation.
            {periods.some((p) => p.partial) && <> &nbsp;* Partial period — data runs through {fmtD(maxDate)}, so the annualized rate is understated.</>}
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
            {[0, 1, 2, 3].map((t) => {
              const val = (yMax / 3) * t;
              const y = PAD_T + plotH - (val / yMax) * plotH;
              return (
                <g key={t}>
                  <line x1={PAD_L} y1={y} x2={W - 16} y2={y} stroke={t === 0 ? '#e8e5de' : '#f5f4f0'} strokeWidth="1" />
                  <text x={PAD_L - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#8a8070">{Math.round(val)}%</text>
                </g>
              );
            })}
            {periods.map((p, i) => {
              const isSel = p.year === current.year && p.idx === current.idx;
              const h = p.rate == null ? 0 : (Math.min(p.rate, yMax) / yMax) * plotH;
              const x = PAD_L + i * slot + (slot - barW) / 2;
              const y = PAD_T + plotH - h;
              return (
                <g key={p.name} style={{ cursor: 'pointer' }} onClick={() => setPicked({ year: p.year, idx: p.idx })}>
                  <rect x={PAD_L + i * slot} y={PAD_T} width={slot} height={plotH} fill="transparent" />
                  <rect x={x} y={y} width={barW} height={h} rx="4" fill={isSel ? '#FF6947' : '#005042'} opacity={p.partial ? 0.45 : 1} />
                  <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill={isSel ? '#e04a28' : '#005042'} opacity={p.partial ? 0.6 : 1}>
                    {p.rate == null ? '—' : p.rate.toFixed(1) + '%'}
                  </text>
                  <text x={PAD_L + i * slot + slot / 2} y={H - PAD_B + 18} textAnchor="middle" fontSize="11" fill={isSel ? '#311E04' : '#8a8070'} fontWeight={isSel ? 700 : 400}>
                    {p.label}{p.partial ? '*' : ''}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: '18px 20px', fontSize: 13.5, color: '#655e52', lineHeight: 1.7 }}>
            <div style={{ fontFamily: 'var(--font-headline)', fontWeight: 600, fontSize: 13, color: '#311E04', marginBottom: 8 }}>Calculation — {current.name}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Start headcount ({fmtD(current.start)})</span><strong style={{ color: '#005042' }}>{fmtHC(current.startHC)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>End headcount ({fmtD(current.end)})</span><strong style={{ color: '#005042' }}>{fmtHC(current.endHC)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f5f4f0', paddingBottom: 6 }}><span>Average headcount</span><strong style={{ color: '#005042' }}>{fmtHC(current.avgHC)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6 }}><span>Terminated in period{TYPE_NOTE[termType] ? ` (${termType === 'vol' ? 'voluntary' : 'involuntary'})` : ''}</span><strong style={{ color: '#005042' }}>{current.terminated}</strong></div>
            {current.factor !== 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f5f4f0', paddingBottom: 6, paddingTop: 6 }}><span>Annualization factor</span><strong style={{ color: '#005042' }}>×{current.factor}</strong></div>
            )}
            <div style={{ paddingTop: 8, fontSize: 13 }}>
              {current.factor === 1 ? <>{current.terminated} ÷ {fmtHC(current.avgHC)} = </> : <>({current.terminated} × {current.factor}) ÷ {fmtHC(current.avgHC)} = </>}
              <strong style={{ color: '#005042', fontSize: 15 }}>{current.rate == null ? '—' : current.rate.toFixed(2) + '%'}</strong>
            </div>
          </div>
          <div className="callout">
            <div className="callout-title">How attrition is computed</div>
            Terminations in the period × annualization factor (12 for a month, 4 for a quarter), divided by the average
            of start-of-period and end-of-period headcount. Voluntary = reason “S - Voluntary Resignation” or
            “N - Personal”; involuntary = every other reason. Population:{' '}
            <strong>{includeContractors ? 'all workers (contractors included)' : 'employees only — contractors excluded'}</strong>.
          </div>
        </div>
      </div>
    </div>
  );
}
