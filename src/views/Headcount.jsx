import React, { useMemo, useState } from 'react';
import { Kpi, TableCard } from '../components/ui.jsx';
import { rollup, distinct } from '../lib/metrics.js';

/**
 * Headcount — adapted from the main repo's src/views/Headcount.jsx.
 *
 * PRIVACY SIMPLIFICATION: the main repo's DrillPanel lists individual people
 * (name, job title, department, worker category, location) behind a clicked
 * row. This static build's data.js never carries names at all, so that
 * per-person table is replaced with a second aggregate breakdown (counts by
 * another dimension) — never a list of people.
 */

const STATUS_LABEL = { active: 'A - Active', leave: 'L - Leave', terminated: 'T - Terminated' };
const DIM_LABELS = {
  department: 'Department', location_state: 'Location', worker_category: 'Worker Category',
  position_status: 'Position Status',
};
const SUB_DIMS = ['department', 'worker_category', 'location_state', 'position_status'];
const DEFAULT_SUB = { department: 'worker_category', location_state: 'department', worker_category: 'department', position_status: 'department' };

const dimValue = (r, dim) =>
  dim === 'position_status' ? (STATUS_LABEL[r.position_status] || r.position_status || '(Blank)') : (r[dim] ?? '(Blank)');

function countBy(people, dim) {
  const by = new Map();
  for (const r of people) {
    const k = dimValue(r, dim);
    by.set(k, (by.get(k) || 0) + 1);
  }
  return [...by.entries()].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
}

function DrillPanel({ drill, people, onClose }) {
  const [subDim, setSubDim] = useState(DEFAULT_SUB[drill.dim] || 'department');
  const breakdown = useMemo(() => countBy(people, subDim), [people, subDim]);
  const pill = (active) => ({
    fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 9999,
    border: `1px solid ${active ? '#005042' : '#d4cfc5'}`,
    background: active ? '#005042' : '#FFFFFF', color: active ? '#FEF8E8' : '#311E04', cursor: 'pointer',
  });
  return (
    <div className="card card--clip">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '2px solid #005042', flexWrap: 'wrap' }}>
        <div className="card-title">{DIM_LABELS[drill.dim]}: {drill.value}</div>
        <span style={{ fontSize: 12.5, color: '#655e52' }}>{people.length.toLocaleString()} {people.length === 1 ? 'person' : 'people'}</span>
        <button className="btn btn-clear" style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: 12 }} onClick={onClose}>Close</button>
      </div>
      <div style={{ padding: '14px 20px' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: '#8a8070', alignSelf: 'center', marginRight: 2 }}>Break down by</span>
          {SUB_DIMS.filter((d) => d !== drill.dim).map((d) => (
            <button key={d} style={pill(subDim === d)} onClick={() => setSubDim(d)}>{DIM_LABELS[d]}</button>
          ))}
        </div>
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {breakdown.map((b) => {
            const max = breakdown[0].count || 1;
            return (
              <div key={b.name} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 46px', gap: 8, alignItems: 'center', padding: '6px 6px', borderBottom: '1px solid #f5f4f0', fontSize: 13 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.name}>{b.name}</span>
                <span className="bar-track" style={{ height: 10 }}>
                  <span className="bar-fill" style={{ display: 'block', height: 10, width: Math.max(4, Math.round((b.count / max) * 100)) + '%', background: '#005042' }} />
                </span>
                <span style={{ textAlign: 'right', fontWeight: 600, color: '#005042' }}>{b.count.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Headcount({ census }) {
  const records = useMemo(() => census.filter((r) => r.position_status !== 'terminated'), [census]);
  const terms = useMemo(() => census.filter((r) => r.position_status === 'terminated'), [census]);
  const [drill, setDrill] = useState(null);

  const isContractor = (r) => r.is_contractor === true;

  const m = useMemo(() => {
    const contractors = records.filter(isContractor).length;
    const deptMap = new Map();
    for (const r of records) {
      const k = r.department ?? '(Blank)';
      if (!deptMap.has(k)) deptMap.set(k, { name: k, ees: 0, cont: 0 });
      deptMap.get(k)[isContractor(r) ? 'cont' : 'ees']++;
    }
    const departments = [...deptMap.values()].map((d) => ({ ...d, total: d.ees + d.cont })).sort((a, b) => b.total - a.total);
    const statuses = rollup(records, 'position_status').map((s) => ({ ...s, name: STATUS_LABEL[s.name] || s.name }));
    if (terms.length) statuses.push({ name: 'T - Terminated', count: terms.length });
    return {
      total: records.length, contractors, employees: records.length - contractors, departments,
      locations: rollup(records, 'location_state'), workerCats: rollup(records, 'worker_category'), statuses,
      deptCount: distinct(records, 'department'), stateCount: distinct(records, 'location_state'),
    };
  }, [records, terms]);

  const drillPeople = useMemo(() => {
    if (!drill) return [];
    if (drill.dim === 'position_status' && drill.value === 'T - Terminated') return terms;
    return records.filter((r) => dimValue(r, drill.dim) === drill.value);
  }, [drill, records, terms]);

  const openDrill = (dim) => (row) => setDrill((cur) => (cur && cur.dim === dim && cur.value === row.name ? null : { dim, value: row.name }));
  const selFor = (dim) => (drill && drill.dim === dim ? drill.value : null);
  const gridCols = '1fr 60px 90px 60px';

  return (
    <div className="view-stack">
      <div className="kpi-grid-5">
        <Kpi value={m.total} label="Total Headcount" />
        <Kpi value={m.deptCount} label="Departments" />
        <Kpi value={m.stateCount} label="States" />
        <Kpi value={m.contractors} label="Contractors" />
        <Kpi value={m.employees} label="Employees" />
      </div>

      <div style={{ fontSize: 12.5, color: '#8a8070' }}>Click any row below to break it down further (aggregate counts only — no individual names).</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.5fr 1fr', gap: 16, alignItems: 'start' }}>
        <TableCard header="LOCATION" headerRight="EE COUNT" rows={m.locations} total={m.total} onRowClick={openDrill('location_state')} selectedName={selFor('location_state')} />

        <div className="card card--clip">
          <div className="tbl-head" style={{ display: 'grid', gridTemplateColumns: gridCols }}>
            <span>HOME DEPARTMENT</span><span style={{ textAlign: 'right' }}>EEs</span><span style={{ textAlign: 'right' }}>Contractors</span><span style={{ textAlign: 'right' }}>Total</span>
          </div>
          <div className="tbl-scroll">
            {m.departments.map((d) => {
              const isSel = selFor('department') === d.name;
              return (
                <div key={d.name} className="tbl-row--click" onClick={() => openDrill('department')(d)} style={{ display: 'grid', gridTemplateColumns: gridCols, padding: '9px 18px', borderBottom: '1px solid #f5f4f0', fontSize: 14, background: isSel ? '#e8f5f2' : undefined }}>
                  <span style={isSel ? { fontWeight: 700, color: '#005042' } : undefined}>{d.name}</span>
                  <span style={{ textAlign: 'right' }}>{d.ees}</span>
                  <span style={{ textAlign: 'right', color: '#655e52' }}>{d.cont || '—'}</span>
                  <span style={{ textAlign: 'right', fontWeight: 600, color: '#005042' }}>{d.total}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, padding: '12px 18px', borderTop: '1px solid #e8e5de', fontWeight: 700, fontSize: 14 }}>
            <span>Total</span><span style={{ textAlign: 'right' }}>{m.employees}</span><span style={{ textAlign: 'right' }}>{m.contractors}</span><span style={{ textAlign: 'right' }}>{m.total}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <TableCard header="WORKER CATEGORY" rows={m.workerCats} total={m.total} small onRowClick={openDrill('worker_category')} selectedName={selFor('worker_category')} />
          <TableCard header="POSITION STATUS" rows={m.statuses} small onRowClick={openDrill('position_status')} selectedName={selFor('position_status')} />
        </div>
      </div>

      {drill && <DrillPanel key={drill.dim + '|' + drill.value} drill={drill} people={drillPeople} onClose={() => setDrill(null)} />}
    </div>
  );
}
