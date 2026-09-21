import React, { useMemo, useState } from 'react';
import { Kpi, WidgetUnavailable } from '../components/ui.jsx';
import { cleanDepartment } from '../lib/department.js';
import { SPAN_OF_CONTROL } from '../lib/loadData.js';

const TEAL = '#005042';
const CORAL = '#FF6947';

/**
 * Horizontal bar chart matching the Head of HR's Lantern-brand chart
 * standard (see memory/span-of-control-methodology.md §12): sorted
 * descending, teal bars at/above target, coral below, a dashed
 * company-average line and a dotted target line, value labels beside each
 * bar. Every value here is directly measured from the data — no
 * estimated/inferred adjustments (the runbook's Technology contractor
 * adjustment was deliberately dropped per the user's 2026-09-21 call).
 */
function SpanChart({ rows, target, companyAvg, title, subtitle, labelFor = (r) => cleanDepartment(r.department), keyFor = (r) => r.department }) {
  const domainMax = useMemo(() => {
    const values = rows.map((r) => r.avgDirectReports);
    const max = Math.max(target, companyAvg, ...values);
    return Math.ceil((max * 1.15) / 2) * 2; // round up to an even number with headroom
  }, [rows, target, companyAvg]);

  const gridStep = domainMax > 16 ? 4 : 2;
  const gridValues = [];
  for (let v = 0; v <= domainMax; v += gridStep) gridValues.push(v);

  const pct = (v) => `${(v / domainMax) * 100}%`;

  return (
    <div className="card card--pad">
      <div className="soc-chart-title">{title}</div>
      <div className="soc-chart-subtitle">{subtitle}</div>

      <div className="soc-chart-area">
        <div className="soc-chart-grid">
          {rows.map((r) => {
            const value = r.avgDirectReports;
            const meetsTarget = value >= target;
            return (
              <React.Fragment key={keyFor(r)}>
                <div className="soc-row-label">{labelFor(r)}</div>
                <div className="soc-row-bar-cell">
                  <div className="soc-bar" style={{ width: pct(value), background: meetsTarget ? TEAL : CORAL }} />
                  <span className="soc-bar-value" style={{ left: `calc(${pct(value)} + 8px)` }}>
                    {value.toFixed(2)}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Positioned separately from the grid (not as a grid item) — an
            item with both axes pinned to a column would otherwise "reserve"
            that column ahead of the auto-placed row items, pushing every
            other row into column 1 and collapsing the whole layout. */}
        <div className="soc-overlay">
          {gridValues.map((v) => (
            <div key={v} className="soc-gridline" style={{ left: pct(v) }} />
          ))}
          <div className="soc-refline soc-refline--avg" style={{ left: pct(companyAvg) }}>
            <span>avg {companyAvg.toFixed(2)}</span>
          </div>
          <div className="soc-refline soc-refline--target" style={{ left: pct(target) }}>
            <span>target {target}</span>
          </div>
        </div>
      </div>

      <div className="soc-axis">
        <div style={{ width: 180, flexShrink: 0 }} />
        <div className="soc-axis-track">
          {gridValues.map((v) => <span key={v} style={{ left: pct(v) }}>{v}</span>)}
        </div>
      </div>
    </div>
  );
}

/**
 * Average direct reports, overall and by department. The underlying numbers
 * are computed once at build time (scripts/build-data.mjs) from a census
 * export with a "Reports To Name" column — manager identities are grouped
 * on and counted there, then discarded; this page only ever sees the
 * resulting averages/counts, never a name.
 */
export default function SpanOfControl() {
  const full = SPAN_OF_CONTROL;
  const [excludeContractors, setExcludeContractors] = useState(false);

  if (!full || full.overallAvg == null) {
    return (
      <WidgetUnavailable note="No reports-to data has been loaded yet — see scripts/build-data.mjs's 4th argument." />
    );
  }

  // Two full variants are baked at build time (see scripts/build-data.mjs)
  // since this page's per-record data can't live in the browser for the
  // page-wide filter bar to narrow live — this local toggle just switches
  // which precomputed variant renders, rather than filtering anything here.
  const hasExcluding = full.excludingContractors?.overallAvg != null;
  const s = excludeContractors && hasExcluding ? full.excludingContractors : full;

  const target = s.target ?? 7;

  return (
    <div className="view-stack">
      <div className="card" style={{ padding: '14px 20px', fontSize: 12.5, color: '#655e52' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <span>
            This page is a fixed aggregate computed from a separate export — the department/exempt filters above
            don't apply here (there's no per-person data behind it to filter, only the averages themselves).
          </span>
          {hasExcluding && (
            <button
              className={'filter-bar-toggle' + (excludeContractors ? ' filter-bar-toggle--on' : '')}
              onClick={() => setExcludeContractors((v) => !v)}
              style={{ marginLeft: 'auto', flexShrink: 0 }}
            >
              {excludeContractors ? '✓ ' : ''}Exclude contractors/interns
            </button>
          )}
        </div>
        Departments are consolidated per the People Team's Span of Control runbook (e.g. Engineering + Core
        Technology + Data Management → Technology).{' '}
        {s.activationResolved ? (
          <>The Activation carve-out and Product-transition individual reassignments from that runbook are applied.</>
        ) : (
          <><strong>Known gap:</strong> the runbook also calls for a new "Activation" department (David Huck's full
          downstream org) and several named-individual reassignments out of Product — neither could be resolved from
          the export used to build this (it needs a column identifying an employee's own name, not just who manages
          them). Product is left folded into Marketing here.</>
        )}
      </div>

      <div className="kpi-grid-3x">
        <Kpi value={s.overallAvg} label="Avg Direct Reports" />
        <Kpi value={s.managerCount.toLocaleString()} label="Distinct Managers" />
        <Kpi value={s.reportCount.toLocaleString()} label="Active Reports Counted" />
      </div>

      <SpanChart
        rows={s.byDept}
        target={target}
        companyAvg={s.overallAvg}
        title="Span of Control by Department — Current"
        subtitle={`${s.managerCount.toLocaleString()} managers · company average ${s.overallAvg.toFixed(2)} · target ${target}`}
      />

      {s.byExemptStatus?.length > 0 && (
        <SpanChart
          rows={s.byExemptStatus}
          target={target}
          companyAvg={s.overallAvg}
          title="Span of Control by Exempt Status — Current"
          subtitle="Grouped by each report's own exempt/non-exempt classification, not the manager's — a manager with a mixed team counts toward both groups"
          labelFor={(r) => r.exemptStatus}
          keyFor={(r) => r.exemptStatus}
        />
      )}

      <div className="callout">
        <div className="callout-title">How this is computed</div>
        Among each consolidated department's active people, we group by who they report to and average the resulting
        team sizes. Every figure here is directly measured from the census and reports-to export — no estimated or
        inferred adjustments (e.g. Technology's contractors are only counted if they appear in the export with a
        resolved manager; nothing is added on top for contractors the data doesn't capture). Figures reflect ongoing
        organizational restructuring, so minor mismatches vs. other reports may exist, but the analysis is
        directionally accurate.
      </div>
    </div>
  );
}
