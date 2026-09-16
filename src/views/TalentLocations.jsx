import React, { useMemo, useState } from 'react';
import { Kpi, WidgetUnavailable } from '../components/ui.jsx';
import { classifyEmployee, modeBreakdown } from '../lib/talent.js';

/**
 * Employee Locations — adapted from the main repo's src/views/TalentLocations.jsx
 * (office/remote work-mode breakdown from census `work_location`).
 *
 * PRIVACY SIMPLIFICATION (explicitly required): the main repo's PeopleList
 * component reveals individual names when you click an office/remote row.
 * It is removed entirely here — clicking a row only highlights it, aggregate
 * counts only, no names anywhere.
 *
 * SCOPE SIMPLIFICATION: the main repo also blends in an "Applicants" group
 * from the Offer Report. Applicants/New Hires/Onboarding are out of scope
 * for this static build (see README), so this page covers Employees and
 * Contractors only.
 */

const MODE_META = [
  ['onsite', 'In person', '#005042'],
  ['remote', 'Remote', '#FF6947'],
  ['unspecified', 'Unspecified', '#e8e5de'],
];
const GROUPS = ['Employees', 'Contractors'];
const fmtPct = (p) => (p == null ? '—' : p.toFixed(1) + '%');

function ModeBar({ title, breakdown }) {
  const { counts, total, known, pct } = breakdown;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--font-headline)', fontWeight: 600, fontSize: 13.5, color: '#311E04' }}>{title}</span>
        <span style={{ fontSize: 12.5, color: '#8a8070' }}>{total.toLocaleString()} people · {known.toLocaleString()} classified</span>
      </div>
      <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', background: '#f5f4f0' }}>
        {MODE_META.map(([key, , color]) => (counts[key] > 0 ? <div key={key} style={{ width: `${(counts[key] / (total || 1)) * 100}%`, background: color }} title={`${key}: ${counts[key]}`} /> : null))}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12.5, color: '#4a4338' }}>
        {MODE_META.map(([key, label]) => (
          <span key={key}>
            {label}: <strong style={{ color: '#311E04' }}>{counts[key].toLocaleString()}</strong>
            {key !== 'unspecified' && <span style={{ color: '#8a8070' }}> ({fmtPct(pct[key])})</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function CountBars({ rows, emptyNote, selected, onSelect }) {
  if (!rows.length) return <div style={{ fontSize: 13, color: '#8a8070', padding: '8px 0' }}>{emptyNote}</div>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="bar-list" style={{ maxHeight: 360, overflowY: 'auto', paddingRight: 6 }}>
      {rows.map((r) => {
        const isSel = selected != null && selected.toLowerCase() === r.name.toLowerCase();
        return (
          <div key={r.name} onClick={() => onSelect && onSelect(isSel ? null : r.name)}
            style={{ display: 'grid', gridTemplateColumns: '150px 1fr 46px', gap: 10, alignItems: 'center', cursor: onSelect ? 'pointer' : 'default', borderRadius: 6, padding: '2px 4px', background: isSel ? '#e8f5f2' : 'transparent' }}>
            <span className="bar-label" style={isSel ? { fontWeight: 700, color: '#005042' } : undefined}>{r.name}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: Math.max(2, Math.round((r.count / max) * 100)) + '%', background: isSel ? '#FF6947' : '#005042' }} /></div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#311E04' }}>{r.count.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function TalentLocations({ census }) {
  const active = useMemo(() => census.filter((r) => r.position_status === 'active'), [census]);
  const people = useMemo(() => active.map((r) => ({
    ...classifyEmployee(r),
    group: r.is_contractor === true ? 'Contractors' : 'Employees',
  })), [active]);

  const [groupsOn, setGroupsOn] = useState({ Employees: true, Contractors: true });
  const allOn = GROUPS.every((g) => groupsOn[g]);
  const toggleGroup = (g) => setGroupsOn((s) => ({ ...s, [g]: !s[g] }));
  const activeGroups = GROUPS.filter((g) => groupsOn[g]);
  const inView = useMemo(() => people.filter((p) => groupsOn[p.group]), [people, groupsOn]);
  const viewBreak = useMemo(() => modeBreakdown(inView), [inView]);
  const [officeSel, setOfficeSel] = useState(null);
  const [remoteSel, setRemoteSel] = useState(null);
  const groupCount = (g) => people.filter((p) => p.group === g).length;

  const rollupPlaces = (mode) => {
    const by = new Map();
    for (const p of inView) {
      if (p.mode !== mode) continue;
      const raw = p.place && p.place.trim() ? p.place.trim() : '(Unknown)';
      const key = raw.toLowerCase();
      if (!by.has(key)) by.set(key, { count: 0, spellings: new Map() });
      const e = by.get(key);
      e.count += 1;
      e.spellings.set(raw, (e.spellings.get(raw) || 0) + 1);
    }
    return [...by.values()].map((e) => ({ name: [...e.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0], count: e.count })).sort((a, b) => b.count - a.count);
  };
  const offices = useMemo(() => rollupPlaces('onsite'), [inView]); // eslint-disable-line react-hooks/exhaustive-deps
  const remotePlaces = useMemo(() => rollupPlaces('remote'), [inView]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!people.length) return <WidgetUnavailable note="No active-employee data is loaded yet." />;

  const pillStyle = (active2) => ({
    fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 9999,
    border: `1px solid ${active2 ? '#005042' : '#d4cfc5'}`, background: active2 ? '#005042' : '#FFFFFF',
    color: active2 ? '#FEF8E8' : '#311E04', cursor: 'pointer',
  });

  return (
    <div className="view-stack">
      <div className="card" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <button style={pillStyle(allOn)} onClick={() => setGroupsOn({ Employees: true, Contractors: true })}>Overall</button>
        <div style={{ width: 1, alignSelf: 'stretch', background: '#e8e5de' }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {GROUPS.map((g) => (
            <button key={g} style={pillStyle(groupsOn[g])} onClick={() => toggleGroup(g)}>{g} ({groupCount(g).toLocaleString()})</button>
          ))}
        </div>
        <span style={{ fontSize: 12.5, color: '#8a8070', marginLeft: 'auto' }}>Toggle any combination — everything below follows the selection.</span>
      </div>

      {activeGroups.length === 0 ? (
        <WidgetUnavailable note="No groups selected — turn on Employees or Contractors above." />
      ) : (
        <>
          <div className="kpi-grid-3x" style={{ gridTemplateColumns: 'repeat(2, 1fr) 1.4fr' }}>
            <Kpi value={groupCount('Employees').toLocaleString()} label="Active Employees" />
            <Kpi value={groupCount('Contractors').toLocaleString()} label="Active Contractors" />
            <div className="card" style={{ padding: '16px 20px', fontSize: 13, color: '#655e52', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
              <div style={{ fontFamily: 'var(--font-headline)', fontWeight: 600, fontSize: 12, letterSpacing: '0.04em', color: '#311E04' }}>
                WORK MODE — {activeGroups.length === GROUPS.length ? 'OVERALL' : activeGroups.join(' + ').toUpperCase()}
              </div>
              <div>In person <strong style={{ color: '#005042' }}>{fmtPct(viewBreak.pct.onsite)}</strong> · Remote <strong style={{ color: '#005042' }}>{fmtPct(viewBreak.pct.remote)}</strong></div>
            </div>
          </div>

          <div className="card card--pad">
            <div className="card-title">Work mode — in person vs remote</div>
            <div style={{ fontSize: 12.5, color: '#655e52', margin: '4px 0 18px' }}>
              Percentages are of classified people; "Unspecified" is shown separately, never guessed.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {activeGroups.map((g) => <ModeBar key={g} title={g} breakdown={modeBreakdown(people.filter((p) => p.group === g))} />)}
              {activeGroups.length > 1 && <ModeBar title="Overall" breakdown={viewBreak} />}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
            <div className="card card--pad">
              <div className="card-title">In person — by office</div>
              <div style={{ fontSize: 12.5, color: '#655e52', margin: '4px 0 14px' }}>Aggregate counts only — no per-person list</div>
              <CountBars rows={offices} emptyNote="No one in the selected groups is classified as in person." selected={officeSel} onSelect={setOfficeSel} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card card--pad">
                <div className="card-title">Remote — by location</div>
                <div style={{ fontSize: 12.5, color: '#655e52', margin: '4px 0 14px' }}>Aggregate counts only — no per-person list</div>
                <CountBars rows={remotePlaces} emptyNote="No one in the selected groups is classified as remote." selected={remoteSel} onSelect={setRemoteSel} />
              </div>
              <div className="callout">
                <div className="callout-title">Classification rules</div>
                Remote = "Remote" codes (e.g. R-TX - Remote-Texas) or "Offshore" locations. Everything else is <strong>in person</strong> at
                one of four offices — <strong>Dallas, New York, Vancouver, Chicago</strong>; hybrid counts as in person. An unrecognized
                in-person location shows as "Other". Blank locations and ADP's "0001 - Legal Address" default are Unspecified. Employees and
                contractors counted only when position status is Active.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
