import React from 'react';
import { Kpi, TableCard, WidgetUnavailable } from '../components/ui.jsx';
import { cleanDepartment } from '../lib/department.js';
import { SPAN_OF_CONTROL } from '../lib/loadData.js';

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

  const rows = s.byDept.map((d) => ({ name: cleanDepartment(d.department), count: d.avgDirectReports }));

  return (
    <div className="view-stack">
      <div className="card" style={{ padding: '14px 20px', fontSize: 12.5, color: '#655e52' }}>
        This page is a fixed aggregate computed from a separate export — it doesn't respond to the department/exempt
        filters above (there's no per-person data behind it to filter, only the averages themselves).
      </div>

      <div className="kpi-grid-3x">
        <Kpi value={s.overallAvg} label="Avg Direct Reports (overall)" />
        <Kpi value={s.managerCount.toLocaleString()} label="Distinct Managers" />
        <Kpi value={s.reportCount.toLocaleString()} label="Active Reports Counted" />
      </div>

      <TableCard
        header="AVG DIRECT REPORTS BY DEPARTMENT"
        headerRight="Avg"
        rows={rows}
        maxHeight={560}
      />

      <div className="callout">
        <div className="callout-title">How this is computed</div>
        Among each department's active people, we group by who they report to and average the resulting team sizes —
        this reads as "the average team size of the manager a person in this department reports to," since we have no
        way to look up a manager's own department from a name alone. Contractors, interns, and anyone without a
        recognized manager value are excluded.
      </div>
    </div>
  );
}
