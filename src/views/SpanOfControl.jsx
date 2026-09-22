import React, { useMemo } from 'react';
import { Kpi, WidgetUnavailable } from '../components/ui.jsx';
import { cleanDepartment } from '../lib/department.js';
import { SPAN_OF_CONTROL } from '../lib/loadData.js';

const TEAL = '#005042';
const CORAL = '#FF6947';

/**
 * Horizontal bar chart matching the Head of HR's Lantern-brand chart
 * standard (see memory/span-of-control-methodology.md §12): sorted
 * descending, teal/coral bars vs. target, a dashed company-average line, a
 * dotted target line, value labels beside each bar, and — restoring the
 * shading from the Head of HR's original slide — a hatched extension where
 * a group's real, visible contractors widen its average. Unlike the
 * earlier "+66 estimated Technology contractors" version, both the solid
 * and hatched portions here are directly measured over the SAME manager
 * count (see groupAndAverageWithShading in scripts/build-data.mjs) — solid
 * = non-contractor reports only, hatch = the real additional contractor
 * reports on top. Nothing is inferred.
 */
function SpanChart({ rows, target, companyAvg, title, subtitle, labelFor = (r) => cleanDepartment(r.department), keyFor = (r) => r.department }) {
  const domainMax = useMemo(() => {
    const values = rows.flatMap((r) => [r.avgDirectReports, r.avgDirectReportsAdjusted ?? 0]);
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
            const adjusted = r.avgDirectReportsAdjusted;
            // Colored by its own non-contractor value, not the adjusted one
            // — the hatch shows the real contractor add-on separately
            // rather than making the whole bar read as "meets target" off
            // a number that includes contractors.
            const meetsTarget = value >= target;
            return (
              <React.Fragment key={keyFor(r)}>
                <div className="soc-row-label">{labelFor(r)}</div>
                <div className="soc-row-bar-cell">
                  <div className="soc-bar" style={{ width: pct(value), background: meetsTarget ? TEAL : CORAL }} />
                  {adjusted != null && adjusted > value && (
                    <div className="soc-bar soc-bar--hatched" style={{ left: pct(value), width: pct(adjusted - value) }} />
                  )}
                  <span className="soc-bar-value" style={{ left: `calc(${pct(adjusted ?? value)} + 8px)`, color: adjusted != null ? TEAL : undefined }}>
                    {value.toFixed(2)}{adjusted != null ? ` → ${adjusted.toFixed(2)}` : ''}
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
  const s = SPAN_OF_CONTROL;

  if (!s || s.overallAvg == null) {
    return (
      <WidgetUnavailable note="No reports-to data has been loaded yet — see scripts/build-data.mjs's 4th argument." />
    );
  }

  const target = s.target ?? 7;
  const companyAvg = s.overallAvgWithContractors ?? s.overallAvg;

  return (
    <div className="view-stack">
      <div className="card" style={{ padding: '14px 20px', fontSize: 12.5, color: '#655e52' }}>
        This page is a fixed aggregate computed from a separate export — it doesn't respond to the department/exempt
        filters above (there's no per-person data behind it to filter, only the averages themselves). Departments are
        consolidated per the People Team's Span of Control runbook (e.g. Engineering + Core Technology + Data
        Management → Technology).{' '}
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
        <Kpi value={s.overallAvg} label="Avg Direct Reports (non-contractor)" />
        <Kpi value={s.overallAvgWithContractors ?? s.overallAvg} label="Avg Direct Reports (incl. contractors)" />
        <Kpi value={s.managerCount.toLocaleString()} label="Distinct Managers" />
      </div>

      <SpanChart
        rows={s.byDept}
        target={target}
        companyAvg={companyAvg}
        title="Span of Control by Department — Current"
        subtitle={`${s.managerCount.toLocaleString()} managers · company average ${companyAvg.toFixed(2)} (incl. contractors) · target ${target}`}
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
        Among each consolidated department's active people, we group by who they report to. The solid bar counts only
        non-contractor reports; the hatched extension (where present) adds each department's real, visible
        contractors on top — both are averaged over the exact same set of managers, so the two numbers are directly
        comparable and nothing is estimated. A department with no hatch simply has no contractors in this export.
        Figures reflect ongoing organizational restructuring, so minor mismatches vs. other reports may exist, but
        the analysis is directionally accurate.
      </div>
    </div>
  );
}
