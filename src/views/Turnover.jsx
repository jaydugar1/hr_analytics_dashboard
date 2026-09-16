import React, { useMemo, useState } from 'react';
import { Kpi, BarList, Legend, FilterCard, WidgetUnavailable } from '../components/ui.jsx';
import DateRangeCard from '../components/DateRangeCard.jsx';
import {
  reasonBars, filterTerms, distinct, dateBounds, filterByDateRange,
  timelineByMonth, projectRemainingMonths,
} from '../lib/metrics.js';

/**
 * Turnover — adapted from the main repo's src/views/Turnover.jsx.
 *
 * PRIVACY SIMPLIFICATIONS:
 * - No `manager` field exists in this build's data at all (stripped by
 *   scripts/build-data.mjs), so the Manager filter and the by-name table are
 *   both dropped — reasonPick now just narrows the reason-bars KPI note
 *   instead of opening a list of names.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEAR_COLORS = ['#b0a898', '#005042', '#FF6947'];

function linePoints(counts, yMax) {
  const pts = [];
  for (let m = 0; m < 12; m++) {
    if (counts[m] === undefined || counts[m] === null) continue;
    const x = 44 + m * (720 / 11);
    const y = 280 - (counts[m] / yMax) * 240;
    pts.push(x.toFixed(1) + ',' + y.toFixed(1));
  }
  return pts.join(' ');
}

export default function Turnover({ terms }) {
  const [deptSel, setDeptSel] = useState({});
  const [dateSel, setDateSel] = useState(null);
  const [reasonPick, setReasonPick] = useState(null);
  const [hoverM, setHoverM] = useState(null);

  const depts = useMemo(() => [...new Set(terms.map((r) => r.department).filter(Boolean))].sort(), [terms]);
  const bounds = useMemo(() => dateBounds(terms), [terms]);

  const inWindow = useMemo(() => filterByDateRange(terms, dateSel), [terms, dateSel]);
  const filtered = useMemo(() => filterTerms(inWindow, { depts: deptSel }), [inWindow, deptSel]);
  const bars = useMemo(() => reasonBars(filtered), [filtered]);

  const byYear = useMemo(() => timelineByMonth(filtered), [filtered]);
  const years = Object.keys(byYear).map(Number).sort().slice(-3);
  const projection = useMemo(() => projectRemainingMonths(byYear), [byYear]);
  const timelineMax = Math.max(4, ...years.flatMap((y) => byYear[y].filter((v) => v != null)), ...(projection ? projection.series.filter((v) => v != null) : []));
  const colorFor = (i) => YEAR_COLORS[(YEAR_COLORS.length - years.length + i) % YEAR_COLORS.length];
  const projectionColor = years.length ? colorFor(years.length - 1) : YEAR_COLORS[YEAR_COLORS.length - 1];
  const showProjection = projection && years[years.length - 1] === projection.year;

  const listed = useMemo(
    () => (reasonPick == null ? filtered : filtered.filter((r) => (r.termination_reason ?? '(Unknown)') === reasonPick)),
    [filtered, reasonPick]
  );
  const isFiltered = Object.values(deptSel).some(Boolean) || dateSel !== null;

  if (!terms.length) {
    return <WidgetUnavailable note="No termination data is loaded yet." />;
  }

  const toggle = (set) => (n) => set((s) => ({ ...s, [n]: !s[n] }));

  return (
    <div className="view-stack">
      <div className="kpi-grid-4x">
        <Kpi value={filtered.length} label="Terminated" />
        <Kpi value={filtered.filter((r) => r.voluntary_flag === true).length} label="Voluntary Count" />
        <Kpi value={filtered.filter((r) => r.voluntary_flag === false).length} label="Involuntary Count" />
        <Kpi value={distinct(filtered, 'department')} label="Departments" />
        <DateRangeCard dataRange={bounds} value={dateSel} onChange={setDateSel} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card card--pad">
          <div className="card-title">Terminations by Month and Year</div>
          <div style={{ margin: '10px 0 6px' }}>
            <Legend dot items={years.map((y, i) => [String(y), YEAR_COLORS[(YEAR_COLORS.length - years.length + i) % YEAR_COLORS.length]])} />
          </div>
          {showProjection && (
            <div style={{ fontSize: 11.5, color: '#8a8070', margin: '0 0 6px' }}>
              <span style={{ borderBottom: `2px dotted ${projectionColor}`, paddingBottom: 1 }}>Dotted</span> = projected pace for the rest
              of {projection.year}, from {MONTHS[projection.lastMonth + 1]}–Dec.
            </div>
          )}
          <svg viewBox="0 0 780 320" style={{ width: '100%', height: 'auto', display: 'block' }}>
            <line x1="44" y1="280" x2="764" y2="280" stroke="#e8e5de" strokeWidth="1" />
            {[200, 120, 40].map((y) => <line key={y} x1="44" y1={y} x2="764" y2={y} stroke="#f5f4f0" strokeWidth="1" />)}
            <text x="36" y="284" textAnchor="end" fontSize="11" fill="#8a8070">0</text>
            {[1, 2, 3].map((t) => (
              <text key={t} x="36" y={284 - t * 80} textAnchor="end" fontSize="11" fill="#8a8070">{Math.round((timelineMax * t) / 3)}</text>
            ))}
            {years.map((y, i) => (
              <polyline key={y} points={linePoints(byYear[y], timelineMax)} fill="none" stroke={YEAR_COLORS[(YEAR_COLORS.length - years.length + i) % YEAR_COLORS.length]} strokeWidth="2.5" strokeLinejoin="round" />
            ))}
            {showProjection && (
              <polyline points={linePoints(projection.series, timelineMax)} fill="none" stroke={projectionColor} strokeWidth="2.5" strokeLinejoin="round" strokeDasharray="6 5" />
            )}
            {MONTHS.map((label, m) => (
              <text key={label} x={(44 + m * (720 / 11)).toFixed(1)} y="300" textAnchor="middle" fontSize="11" fill="#8a8070">{label}</text>
            ))}
            {MONTHS.map((_, m) => (
              <rect key={'hit' + m} x={44 + m * (720 / 11) - (720 / 11) / 2} y="20" width={720 / 11} height="268" fill="transparent" onMouseEnter={() => setHoverM(m)} onMouseLeave={() => setHoverM(null)} />
            ))}
            {hoverM != null && (() => {
              const mx = 44 + hoverM * (720 / 11);
              const entries = years.map((y, i) => ({ y, count: byYear[y]?.[hoverM], color: colorFor(i) })).filter((e) => e.count !== undefined && e.count !== null);
              if (showProjection && hoverM > projection.lastMonth && projection.series[hoverM] != null) {
                entries.push({ y: `${projection.year} (est.)`, count: Math.round(projection.series[hoverM]), color: projectionColor });
              }
              if (!entries.length) return null;
              const tipW = 108, tipH = 26 + entries.length * 17;
              const tipX = mx + 12 + tipW > 764 ? mx - tipW - 12 : mx + 12;
              const tipY = 34;
              return (
                <g pointerEvents="none">
                  <line x1={mx} y1="30" x2={mx} y2="280" stroke="#d4cfc5" strokeWidth="1" strokeDasharray="3 3" />
                  {entries.map((e) => <circle key={e.y} cx={mx} cy={280 - (e.count / timelineMax) * 240} r="4" fill={e.color} stroke="#FFFFFF" strokeWidth="1.5" />)}
                  <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="8" fill="#FFFFFF" stroke="#e8e5de" />
                  <text x={tipX + 12} y={tipY + 18} fontSize="11.5" fontWeight="700" fill="#311E04">{MONTHS[hoverM]}</text>
                  {entries.map((e, i) => (
                    <g key={e.y}>
                      <rect x={tipX + 12} y={tipY + 26 + i * 17} width="8" height="8" rx="2" fill={e.color} />
                      <text x={tipX + 26} y={tipY + 34 + i * 17} fontSize="11.5" fill="#4a4338">{e.y}</text>
                      <text x={tipX + tipW - 12} y={tipY + 34 + i * 17} fontSize="11.5" fontWeight="700" fill="#311E04" textAnchor="end">{e.count}</text>
                    </g>
                  ))}
                </g>
              );
            })()}
          </svg>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FilterCard title="Department" names={depts} selected={deptSel} onToggle={toggle(setDeptSel)} />
          <button className="btn btn-clear" onClick={() => { setDeptSel({}); setDateSel(null); setReasonPick(null); }}>Clear filters</button>
        </div>
      </div>

      <div className="card card--pad">
        <div className="card-title">Terminations by Reason {isFiltered ? '(filtered)' : ''}</div>
        <div style={{ fontSize: 12.5, color: '#655e52', margin: '4px 0 14px' }}>
          Click a reason to see its count — this dashboard's data has no names, so there is no individual list to open.
        </div>
        <BarList rows={bars} narrow selected={reasonPick} onSelect={setReasonPick} />
        {reasonPick && (
          <div style={{ marginTop: 12, fontSize: 13, color: '#005042', fontWeight: 600 }}>
            {reasonPick}: {listed.length.toLocaleString()} {listed.length === 1 ? 'termination' : 'terminations'}
          </div>
        )}
      </div>
    </div>
  );
}
