import React, { useMemo, useState } from 'react';
import { Kpi } from '../components/ui.jsx';
import { buildTenureRoster, tenureTotals, tenureByDept, tenureBands, fmtYears } from '../lib/tenure.js';

/**
 * Tenure — adapted from the main repo's src/views/Tenure.jsx.
 *
 * PRIVACY SIMPLIFICATION: the main repo shows a per-person table (name, job
 * title, location, dates, tenure) when a department is selected. Since this
 * static build's roster carries no names, that table is dropped entirely —
 * selecting a department only scopes the KPIs/bands/chart above, no
 * individual rows are ever listed.
 */
export default function Tenure({ census }) {
  const [population, setPopulation] = useState('active');
  const [selectedDept, setSelectedDept] = useState(null);

  const all = useMemo(() => buildTenureRoster(census, population), [census, population]);
  const byDeptAll = useMemo(() => tenureByDept(all, 1), [all]);
  const filtered = useMemo(() => (selectedDept ? all.filter((r) => r.dept === selectedDept) : all), [all, selectedDept]);
  const totals = useMemo(() => tenureTotals(filtered), [filtered]);
  const deptsInView = useMemo(() => tenureByDept(filtered, 1), [filtered]);
  const bands = useMemo(() => tenureBands(filtered), [filtered]);

  const pill = (active) => ({
    fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 9999,
    border: `1px solid ${active ? '#005042' : '#d4cfc5'}`,
    background: active ? '#005042' : '#FFFFFF', color: active ? '#FEF8E8' : '#311E04', cursor: 'pointer',
  });
  const pickDept = (name) => setSelectedDept((cur) => (cur === name ? null : name));
  const maxBandCount = Math.max(1, ...bands.map((b) => b.count));
  const maxDeptYears = Math.max(1, ...byDeptAll.map((d) => d.avgYears ?? 0));

  return (
    <div className="view-stack">
      <div className="card" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={pill(population === 'active')} onClick={() => { setPopulation('active'); setSelectedDept(null); }}>Active employees</button>
          <button style={pill(population === 'terminated')} onClick={() => { setPopulation('terminated'); setSelectedDept(null); }}>Terminated employees</button>
        </div>
        {selectedDept && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ color: '#005042', fontWeight: 600 }}>Showing: {selectedDept}</span>
            <button className="btn btn-clear" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={() => setSelectedDept(null)}>Clear</button>
          </div>
        )}
        <span style={{ fontSize: 12, color: '#8a8070', marginLeft: 'auto' }}>
          {population === 'active' ? 'Tenure measured through today' : 'Tenure measured through each termination date'}
        </span>
      </div>

      <div className="kpi-grid-4x">
        <Kpi value={totals.count.toLocaleString()} label={population === 'active' ? 'Active Employees' : 'Terminated Employees'} />
        <Kpi value={fmtYears(totals.avgYears)} label="Average Tenure" />
        <Kpi value={fmtYears(totals.medianYears)} label="Median Tenure" />
        <Kpi value={deptsInView.length.toLocaleString()} label="Departments" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card card--clip">
          <div className="tbl-head"><span>DEPARTMENT (shortest tenure first)</span><span>Avg Tenure · People</span></div>
          <div className="tbl-scroll" style={{ maxHeight: 460 }}>
            {byDeptAll.map((d) => {
              const isSel = selectedDept === d.name;
              return (
                <div key={d.name} className="tbl-row tbl-row--click" onClick={() => pickDept(d.name)} style={{ cursor: 'pointer', background: isSel ? '#e8f5f2' : undefined }}>
                  <span style={isSel ? { fontWeight: 700, color: '#005042' } : undefined}>{d.name}</span>
                  <span className="tbl-count">{fmtYears(d.avgYears)} · {d.count}p</span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card--pad">
            <div className="card-title">Tenure distribution</div>
            <div style={{ fontSize: 12.5, color: '#655e52', margin: '4px 0 14px' }}>
              How the {totals.count.toLocaleString()} {population} employees{selectedDept ? ` in ${selectedDept}` : ''} split by years of service
            </div>
            <div className="bar-list">
              {bands.map((b) => (
                <div key={b.name} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 90px', gap: 10, alignItems: 'center' }}>
                  <span className="bar-label">{b.name}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: Math.max(2, Math.round((b.count / maxBandCount) * 100)) + '%', background: '#005042' }} /></div>
                  <span style={{ fontSize: 12.5, color: '#311E04', whiteSpace: 'nowrap' }}>
                    <strong>{b.count.toLocaleString()}</strong> <span style={{ color: '#8a8070' }}>· {totals.count ? Math.round((b.count / totals.count) * 100) : 0}%</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card card--pad">
            <div className="card-title">Average tenure by department</div>
            <div style={{ fontSize: 12.5, color: '#655e52', margin: '4px 0 14px' }}>Click a bar to scope the whole page to that department</div>
            <div className="bar-list">
              {byDeptAll.map((d) => {
                const isSel = selectedDept === d.name;
                return (
                  <div key={d.name} onClick={() => pickDept(d.name)} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 90px', gap: 10, alignItems: 'center', cursor: 'pointer', borderRadius: 6, padding: '2px 4px', background: isSel ? '#e8f5f2' : 'transparent' }}>
                    <span className="bar-label" title={d.name} style={isSel ? { fontWeight: 700, color: '#005042' } : undefined}>{d.name}</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width: Math.max(2, Math.round(((d.avgYears ?? 0) / maxDeptYears) * 100)) + '%', background: isSel ? '#005042' : '#FF6947' }} /></div>
                    <span style={{ fontSize: 12.5, color: '#311E04', whiteSpace: 'nowrap' }}>{fmtYears(d.avgYears)} · {d.count}p</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="callout">
        <div className="callout-title">How tenure is measured</div>
        Tenure starts at a person's <strong>rehire date</strong> when present (a rehire restarts the clock), otherwise
        their original <strong>hire date</strong>. For active employees it runs through today; for terminated employees,
        through their termination date. Click any department, in the table or the chart, to scope every number on this
        page to it. This dashboard's data has no names, so there is no individual-level list to drill into further.
      </div>
    </div>
  );
}
