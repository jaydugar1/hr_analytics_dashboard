import React, { useMemo, useState } from 'react';
import { Kpi, Legend, BarList, WidgetUnavailable } from '../components/ui.jsx';
import DateRangeCard from '../components/DateRangeCard.jsx';
import { reasonBars, dateBounds, filterByDateRange } from '../lib/metrics.js';

/**
 * Voluntary & Regrettable — adapted from the main repo's src/views/VolReg.jsx.
 *
 * The main repo joins a separate "Voluntary vs Regrettable" workbook onto
 * termination records by name. This static build's single dataset already
 * carries voluntary_flag/regrettable_flag directly on every terminated
 * record (see scripts/build-data.mjs), so this view just reads `terms`
 * straight — no join, no name-based matching, no upload-status chip.
 */
export default function VolReg({ terms, vrSeparations = [] }) {
  const [dateSel, setDateSel] = useState(null);
  const bounds = useMemo(() => dateBounds(terms), [terms]);
  const records = useMemo(() => filterByDateRange(terms, dateSel), [terms, dateSel]);

  const m = useMemo(() => {
    const vol = records.filter((r) => r.voluntary_flag === true).length;
    const invol = records.filter((r) => r.voluntary_flag === false).length;
    const reg = records.filter((r) => r.regrettable_flag === true).length;
    const nonReg = records.filter((r) => r.regrettable_flag === false).length;
    return { vol, invol, reg, nonReg, bars: reasonBars(records) };
  }, [records]);

  const vr = useMemo(() => {
    const total = vrSeparations.length;
    const reg = vrSeparations.filter((r) => r.regrettable_flag === true).length;
    const nonReg = vrSeparations.filter((r) => r.regrettable_flag === false).length;
    const vol = vrSeparations.filter((r) => r.voluntary_flag === true).length;
    const invol = vrSeparations.filter((r) => r.voluntary_flag === false).length;
    return { total, reg, nonReg, vol, invol };
  }, [vrSeparations]);

  if (!terms.length) {
    return <WidgetUnavailable note="No termination data is loaded yet." />;
  }

  return (
    <div className="view-stack">
      <div style={{ minWidth: 280 }}>
        <DateRangeCard label="SEPARATION DATE" dataRange={bounds} value={dateSel} onChange={setDateSel} />
      </div>

      <div className="kpi-grid-5">
        <Kpi value={records.length} label="Separations" />
        <Kpi value={m.vol} label="Voluntary Count" />
        <Kpi value={m.invol} label="Involuntary Count" />
        <Kpi value={m.reg} label="Regrettable Count" />
        <Kpi value={m.nonReg} label="Non-Regrettable Count" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card card--pad">
          <div className="card-title">Separations by Type — Voluntary vs Involuntary</div>
          <div style={{ margin: '10px 0 16px' }}>
            <Legend items={[['Voluntary', '#005042'], ['Involuntary', '#FF6947'], ['Neither / mixed', '#b0a898']]} />
          </div>
          <BarList rows={m.bars} />
        </div>
        <div className="card card--pad">
          <div className="card-title">Separations by Type — Regrettable vs Non-Regrettable</div>
          <div style={{ margin: '10px 0 16px' }}>
            <Legend items={[['Regrettable', '#FF6947'], ['Non-regrettable', '#005042']]} />
          </div>
          <BarList rows={m.bars} stacked />
        </div>
      </div>

      {vr.total > 0 && (
        <div className="card card--pad" style={{ borderTop: '3px solid #c9a227' }}>
          <div className="card-title">Separately logged: the V&amp;R workbook</div>
          <p style={{ fontSize: 12.5, color: '#655e52', margin: '4px 0 14px', maxWidth: 720 }}>
            This workbook has no employee id or name, so its rows can't be matched to the {terms.length.toLocaleString()}{' '}
            terminations above person-by-person — it's shown here as its own separate, usually smaller and
            differently-dated count, never combined with the figures above.
          </p>
          <div className="kpi-grid-5">
            <Kpi value={vr.total} label="Logged Separations" />
            <Kpi value={vr.vol} label="Voluntary" />
            <Kpi value={vr.invol} label="Involuntary" />
            <Kpi value={vr.reg} label="Regrettable" />
            <Kpi value={vr.nonReg} label="Non-Regrettable" />
          </div>
        </div>
      )}
    </div>
  );
}
