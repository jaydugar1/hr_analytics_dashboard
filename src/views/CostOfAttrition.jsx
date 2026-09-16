import React, { useMemo, useState } from 'react';
import { Kpi, WidgetUnavailable } from '../components/ui.jsx';
import {
  buildAttritionCostRoster, costRoster, attritionCostTotals, attritionCostByBucket,
  attritionCostByGroup, DEFAULT_ASSUMPTIONS, fmtMoney, fmtMoneyShort, fmtPct1,
  filterByDateRange, resolveDatePreset, terminationYears,
} from '../lib/attritionCost.js';

/**
 * Cost of Attrition — adapted from the main repo's src/views/CostOfAttrition.jsx.
 *
 * PRIVACY SIMPLIFICATIONS:
 * - `buildAttritionCostRoster` here takes only `census` (see lib/attritionCost.js
 *   for why the name-based join to a second terms array was dropped).
 * - "Manager" is dropped from the group-by dimensions (this build's data has
 *   no manager field at all) and the per-person write-off table at the
 *   bottom of the main repo's page — which lists name, hire/term dates, and
 *   $ write-off per person — is removed entirely; clicking a bucket/group
 *   here only ever narrows the aggregate $ total shown, never a person list.
 * - Defaults to 'all' time, matching this task's instruction that there is
 *   no live upload to filter against "today".
 */

const DATE_PRESETS = [['all', 'All time'], ['ytd', 'YTD'], ['ltm', 'Last 12 months']];
const fmtD = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const GROUP_DIMS = [['dept', 'Department'], ['hireQuarter', 'Hire cohort'], ['voluntary', 'Voluntary vs involuntary']];
const BUCKET_COLOR = { 'pre-ramp': '#c43d76', 'ramp-to-breakeven': '#FF6947', 'post-breakeven': '#005042' };

function NumberField({ label, value, onChange, step = 1, prefix, suffix, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 150 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: '#655e52' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {prefix && <span style={{ fontSize: 13, color: '#8a8070' }}>{prefix}</span>}
        <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: 80, fontSize: 13.5, padding: '6px 8px', border: '1px solid #d4cfc5', borderRadius: 6, color: '#311E04' }} />
        {suffix && <span style={{ fontSize: 13, color: '#8a8070' }}>{suffix}</span>}
      </div>
      {hint && <span style={{ fontSize: 10.5, color: '#8a8070', lineHeight: 1.4 }}>{hint}</span>}
    </div>
  );
}

function CostBars({ rows, max: maxIn, onSelect, selected }) {
  const max = maxIn ?? Math.max(1, ...rows.map((r) => r.totalWriteOff));
  return (
    <div className="bar-list">
      {rows.map((r) => {
        const isSel = selected != null && selected === (r.name ?? r.label);
        const label = r.name ?? r.label;
        const color = r.color || '#c43d76';
        return (
          <div key={label} onClick={onSelect ? () => onSelect(isSel ? null : label) : undefined}
            style={{ display: 'grid', gridTemplateColumns: '190px 1fr 150px', gap: 10, alignItems: 'center', cursor: onSelect ? 'pointer' : undefined, borderRadius: 6, padding: '2px 4px', background: isSel ? '#e8f5f2' : 'transparent' }}>
            <span className="bar-label" title={label} style={isSel ? { fontWeight: 700, color: '#005042' } : undefined}>{label}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: Math.max(2, Math.round((r.totalWriteOff / max) * 100)) + '%', background: color }} /></div>
            <span style={{ fontSize: 12.5, textAlign: 'right', whiteSpace: 'nowrap', color: '#311E04' }}>
              <strong>{fmtMoney(r.totalWriteOff)}</strong> <span style={{ color: '#8a8070' }}>· {r.count}p</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function CostOfAttrition({ census }) {
  const [rampMonths, setRampMonths] = useState(DEFAULT_ASSUMPTIONS.rampMonths);
  const [paybackMonths, setPaybackMonths] = useState(DEFAULT_ASSUMPTIONS.paybackMonths);
  const [costToHire, setCostToHire] = useState(DEFAULT_ASSUMPTIONS.costToHire);
  const [loadFactor, setLoadFactor] = useState(DEFAULT_ASSUMPTIONS.loadFactor);
  const [groupDim, setGroupDim] = useState('dept');
  const [picked, setPicked] = useState(null);
  const [datePreset, setDatePreset] = useState('all');

  const assumptions = { rampMonths, paybackMonths, costToHire, loadFactor };

  const roster = useMemo(() => buildAttritionCostRoster(census, assumptions), [census, rampMonths, paybackMonths]);
  const years = useMemo(() => terminationYears(roster), [roster]);
  const dateRange = useMemo(() => resolveDatePreset(datePreset), [datePreset]);
  const inWindow = useMemo(() => filterByDateRange(roster, dateRange), [roster, dateRange]);
  const costed = useMemo(() => costRoster(inWindow, assumptions), [inWindow, rampMonths, costToHire, loadFactor]);

  const totals = useMemo(() => attritionCostTotals(costed), [costed]);
  const byBucket = useMemo(() => attritionCostByBucket(costed).map((b) => ({ ...b, color: BUCKET_COLOR[b.bucket] })), [costed]);
  const grouped = useMemo(() => attritionCostByGroup(costed, groupDim), [costed, groupDim]);
  const byVoluntary = useMemo(() => attritionCostByGroup(costed, 'voluntary'), [costed]);

  if (!census || !census.length) return <WidgetUnavailable note="No data loaded yet." />;
  if (!roster.length) return <WidgetUnavailable note="No terminated employees have both a hire date and a termination date to measure against." />;

  const maxBucket = Math.max(1, ...byBucket.map((b) => b.totalWriteOff));
  const groupLabel = GROUP_DIMS.find(([id]) => id === groupDim)[1];
  const pillStyle = (active) => ({
    fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 9999,
    border: `1px solid ${active ? '#005042' : '#d4cfc5'}`, background: active ? '#005042' : '#FFFFFF',
    color: active ? '#FEF8E8' : '#311E04', cursor: 'pointer',
  });
  const pickDatePreset = (id) => { setDatePreset(id); setPicked(null); };

  return (
    <div className="view-stack">
      <div className="card" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {DATE_PRESETS.map(([id, label]) => (
          <button key={id} style={pillStyle(datePreset === id)} onClick={() => pickDatePreset(id)}>{label}</button>
        ))}
        {years.map((y) => (
          <button key={y} style={pillStyle(datePreset === String(y))} onClick={() => pickDatePreset(String(y))}>{y}</button>
        ))}
        <span style={{ fontSize: 12, color: '#8a8070', marginLeft: 'auto' }}>
          {dateRange ? <>Terminated {fmtD(dateRange.from)} – {fmtD(dateRange.to)}</> : 'All terminations, any date'}
        </span>
      </div>

      {!inWindow.length ? (
        <WidgetUnavailable note="No terminated employees fall in this date range — try a wider window." />
      ) : (
        <>
          <div className="card" style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: 20 }}>
            <NumberField label="Ramp time" value={rampMonths} onChange={setRampMonths} suffix="months" hint="Placeholder — flat assumption until role/level data exists." />
            <NumberField label="Payback period" value={paybackMonths} onChange={setPaybackMonths} suffix="months" hint="Time after ramp needed for output to offset cost." />
            <NumberField label="Cost to hire" value={costToHire} onChange={setCostToHire} prefix="$" hint="SHRM 2025 Benchmarking Report, national avg." />
            <NumberField label="Comp load factor" value={loadFactor} onChange={setLoadFactor} step={0.05} suffix="×" hint="Benefits/taxes on top of base salary." />
          </div>

          <div className="kpi-grid-4x">
            <Kpi value={totals.count.toLocaleString()} label="Exits Analyzed" />
            <Kpi value={fmtPct1(totals.preThresholdPct)} label={`Left Before ${rampMonths + paybackMonths}-Month Threshold`} />
            <Kpi value={fmtMoneyShort(totals.totalWriteOff)} label="Estimated $ Written Off" />
            <Kpi value={totals.excludedNoSalary.toLocaleString()} label="Excluded — No Salary on File" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, alignItems: 'start' }}>
            <div className="card card--pad">
              <div className="card-title">Exits by value-capture bucket</div>
              <div style={{ fontSize: 12.5, color: '#655e52', margin: '4px 0 14px' }}>Aggregate $ written off per bucket</div>
              <CostBars
                rows={byBucket.map((b) => ({ label: b.label, totalWriteOff: b.totalWriteOff, count: b.count, color: b.color }))}
                max={maxBucket}
                selected={picked?.dim === 'bucket' ? byBucket.find((b) => b.label === picked.value)?.label : null}
                onSelect={(label) => { const b = byBucket.find((x) => x.label === label); setPicked(b ? { dim: 'bucket', value: b.bucket } : null); }}
              />
            </div>
            <div className="card card--pad">
              <div className="card-title">Pre-threshold exits — voluntary vs involuntary</div>
              <div style={{ fontSize: 12.5, color: '#655e52', margin: '4px 0 14px' }}>
                A lot of involuntary pre-ramp loss points at sourcing/screening; a lot of voluntary loss points at onboarding or early retention.
              </div>
              <CostBars rows={byVoluntary} selected={picked?.dim === 'voluntary' ? picked.value : null} onSelect={(value) => setPicked(value ? { dim: 'voluntary', value } : null)} />
            </div>
          </div>

          <div className="card card--pad">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <div className="card-title">Cost of attrition by {groupLabel}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {GROUP_DIMS.map(([id, label]) => (
                  <button key={id} onClick={() => { setGroupDim(id); setPicked(null); }}
                    style={{ fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 9999, border: `1px solid ${groupDim === id ? '#005042' : '#d4cfc5'}`, background: groupDim === id ? '#005042' : '#FFFFFF', color: groupDim === id ? '#FEF8E8' : '#311E04', cursor: 'pointer' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: '#655e52', margin: '4px 0 14px' }}>Sorted by estimated $ written off, aggregate totals only</div>
            <div style={{ maxHeight: 380, overflowY: 'auto', paddingRight: 6 }}>
              <CostBars rows={grouped} selected={picked?.dim === groupDim ? picked.value : null} onSelect={(value) => setPicked(value ? { dim: groupDim, value } : null)} />
            </div>
          </div>
        </>
      )}

      <div className="callout">
        <div className="callout-title">Methodology and sources</div>
        <p style={{ margin: '6px 0' }}>
          Every departed employee is compared against a <strong>value-capture threshold</strong> of{' '}
          <strong>{rampMonths + paybackMonths} months</strong> ({rampMonths}-month ramp + {paybackMonths}-month payback).
          <strong> Pre-ramp</strong> exits are a pure write-off of hire cost plus comp paid; <strong>ramp-to-breakeven</strong> exits
          add the full ramp period's comp; everyone past the threshold is <strong>post-breakeven</strong>, no write-off.
        </p>
        <p style={{ margin: '6px 0' }}>
          Cost to hire (${costToHire.toLocaleString()}) is SHRM's 2025 Talent Acquisition Benchmarking Report national average
          for non-executive roles — not a healthcare- or company-size-specific figure. The {loadFactor}× compensation load
          factor is a common rule-of-thumb for benefits/taxes on top of base salary, not verified against this organization's
          actual benefits cost. Vacancy/backfill cost and output/productivity value are not modeled (see the main dashboard's
          Cost of Attrition page for the full write-up of that tradeoff).
        </p>
      </div>
    </div>
  );
}
