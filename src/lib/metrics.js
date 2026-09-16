/**
 * Derived Metrics — MAPPING_SPEC.md §7
 * All analytics are pure functions of canonical records.
 */

/** Count records by a canonical field; returns [{name, count}] sorted desc. */
export function rollup(records, field) {
  const by = new Map();
  for (const r of records) {
    const k = r[field] ?? '(Blank)';
    by.set(k, (by.get(k) || 0) + 1);
  }
  return [...by.entries()].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
}

export function distinct(records, field) {
  return new Set(records.map((r) => r[field]).filter((v) => v != null)).size;
}

/**
 * Attrition's voluntary/involuntary split, per the dashboard owner's
 * definition: VOLUNTARY = reason "S - Voluntary Resignation" or
 * "N - Personal"; INVOLUNTARY = any other reason (including blank).
 */
export function isVoluntaryReason(reason) {
  const t = String(reason ?? '').trim().toLowerCase();
  return t.startsWith('s -') || t.startsWith('s-') || t.startsWith('n -') || t.startsWith('n-');
}

/** Normalized "last, first" key for name-based joins. */
function nameKey(fullName) {
  if (!fullName) return null;
  return String(fullName).toLowerCase().replace(/[.'']/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Enrich termination records with census attributes by name — the dedicated
 * Termination Report has no worker category, so its rows can't be classified
 * employee-vs-contractor without the census. Also backfills hire/rehire dates.
 */
export function enrichTermsFromCensus(termRecords, censusRecords) {
  if (!censusRecords || !censusRecords.length) return termRecords;
  const byName = new Map();
  for (const c of censusRecords) {
    const k = nameKey(c.full_name);
    if (k && !byName.has(k)) byName.set(k, c);
  }
  return termRecords.map((t) => {
    const c = byName.get(nameKey(t.full_name) || '');
    if (!c) return t;
    return {
      ...t,
      is_contractor: t.is_contractor ?? c.is_contractor,
      hire_date: t.hire_date ?? c.hire_date,
      rehire_date: t.rehire_date ?? c.rehire_date,
    };
  });
}

/**
 * Join V&R sheet flags onto termination records — by employee_id when both
 * sides have one, otherwise by normalized full name (the live V&R sheet has
 * no employee id). V&R flags/reason override the termination report's.
 */
export function joinVrFlags(termRecords, vrRecords) {
  if (!vrRecords || !vrRecords.length) return termRecords;
  const byId = new Map();
  const byName = new Map();
  for (const v of vrRecords) {
    if (v.employee_id != null) byId.set(String(v.employee_id), v);
    const k = nameKey(v.full_name);
    if (k) byName.set(k, v);
  }
  return termRecords.map((t) => {
    const o = (t.employee_id != null && byId.get(String(t.employee_id))) ||
              byName.get(nameKey(t.full_name) || '') || null;
    if (!o) return t;
    return {
      ...t,
      voluntary_flag: o.voluntary_flag ?? t.voluntary_flag,
      regrettable_flag: o.regrettable_flag ?? t.regrettable_flag,
      termination_reason: t.termination_reason ?? o.termination_reason ?? null,
    };
  });
}

/** Department/manager/reason set-filters; empty selection = all. */
export function filterTerms(records, { depts, mgrs, reasons } = {}) {
  const dOn = depts ? Object.keys(depts).filter((k) => depts[k]) : [];
  const mOn = mgrs ? Object.keys(mgrs).filter((k) => mgrs[k]) : [];
  const rOn = reasons ? Object.keys(reasons).filter((k) => reasons[k]) : [];
  return records.filter((r) =>
    (!dOn.length || dOn.includes(r.department)) &&
    (!mOn.length || mOn.includes(r.manager)) &&
    (!rOn.length || rOn.includes(r.termination_reason)));
}

/**
 * Reason bars: sorted by count, pct vs max, colored by voluntary flag
 * (green voluntary, coral involuntary, grey mixed/unknown). Coral is
 * chart-only per brand rules.
 */
export function reasonBars(records) {
  const by = new Map();
  for (const r of records) {
    const k = r.termination_reason ?? '(Unknown)';
    if (!by.has(k)) by.set(k, { count: 0, vol: 0, invol: 0, reg: 0 });
    const e = by.get(k);
    e.count++;
    if (r.voluntary_flag === true) e.vol++;
    if (r.voluntary_flag === false) e.invol++;
    if (r.regrettable_flag === true) e.reg++;
  }
  const rows = [...by.entries()].map(([label, e]) => ({ label, ...e }))
    .sort((a, b) => b.count - a.count);
  const max = rows.length ? rows[0].count : 1;
  return rows.map((r) => ({
    ...r,
    pct: Math.max(2, Math.round((r.count / max) * 100)),
    regPct: ((r.reg / max) * 100).toFixed(1),
    nonPct: (((r.count - r.reg) / max) * 100).toFixed(1),
    color: r.vol > 0 && r.invol === 0 ? '#005042' : (r.invol > 0 && r.vol === 0 ? '#FF6947' : '#b0a898'),
  }));
}

/**
 * Terminations per {year: [12 month counts]}; records without a date are
 * skipped. Months after the newest date in the data are undefined (not 0)
 * so charts don't draw a false drop to zero for the future.
 */
export function timelineByMonth(records) {
  const byYear = {};
  let maxDate = null;
  for (const r of records) {
    const d = r.termination_date;
    if (!(d instanceof Date) || isNaN(d)) continue;
    const y = d.getFullYear();
    if (!byYear[y]) byYear[y] = Array(12).fill(0);
    byYear[y][d.getMonth()]++;
    if (!maxDate || d > maxDate) maxDate = d;
  }
  if (maxDate && byYear[maxDate.getFullYear()]) {
    const counts = byYear[maxDate.getFullYear()];
    for (let m = maxDate.getMonth() + 1; m < 12; m++) counts[m] = undefined;
  }
  return byYear;
}

/**
 * Projects the rest of the current year on the Timeline chart: a dotted
 * continuation of the latest year's line, built from how prior years'
 * terminations were shaped month-to-month (the "seasonal" pattern), scaled
 * by how this year's actual pace compares to the same months in prior years.
 *
 * Returns null when there's nothing to project — the latest year is already
 * complete, has no actual months yet, or there's no prior-year history to
 * shape a projection from. Otherwise: `{ year, lastMonth, series, scale }`,
 * where `series` is a 12-slot array with the last actual month's value
 * repeated at `lastMonth` (so a drawn line connects seamlessly to the solid
 * one) and projected values for every month after it.
 */
export function projectRemainingMonths(byYear) {
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  if (!years.length) return null;
  const year = years[years.length - 1];
  const current = byYear[year];

  let lastMonth = -1;
  for (let m = 0; m < 12; m++) if (current[m] !== undefined && current[m] !== null) lastMonth = m;
  if (lastMonth < 0 || lastMonth >= 11) return null; // no actuals yet, or the year is already complete

  const priorYears = years.slice(0, -1);
  if (!priorYears.length) return null;

  const histAvg = Array(12).fill(null);
  for (let m = 0; m < 12; m++) {
    const vals = priorYears.map((y) => byYear[y][m]).filter((v) => v !== undefined && v !== null);
    if (vals.length) histAvg[m] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  const sumThrough = (arr, upTo) => arr.slice(0, upTo + 1).reduce((a, b) => a + (b ?? 0), 0);
  const currentYTD = sumThrough(current, lastMonth);
  const priorYTDs = priorYears.map((y) => sumThrough(byYear[y], lastMonth));
  const histYTDAvg = priorYTDs.reduce((a, b) => a + b, 0) / priorYTDs.length;
  const scale = histYTDAvg > 0 ? currentYTD / histYTDAvg : 1;

  const series = Array(12).fill(undefined);
  series[lastMonth] = current[lastMonth];
  for (let m = lastMonth + 1; m < 12; m++) {
    series[m] = histAvg[m] != null ? histAvg[m] * scale : null;
  }
  return { year, lastMonth, series, scale };
}

/** Earliest/latest termination_date in the records. */
export function dateBounds(records) {
  let min = null, max = null;
  for (const r of records) {
    const d = r.termination_date;
    if (!(d instanceof Date) || isNaN(d)) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  return { min, max };
}

/** Min/max termination_date formatted M/D/YYYY, or null if none. */
export function dateRange(records) {
  const { min, max } = dateBounds(records);
  const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  return min ? `${fmt(min)} – ${fmt(max)}` : null;
}

/** Filter records to a {from, to} termination-date window (null = all). */
export function filterByDateRange(records, range) {
  if (!range) return records;
  return records.filter((r) => {
    const d = r.termination_date;
    if (!(d instanceof Date) || isNaN(d)) return false;
    return (!range.from || d >= range.from) && (!range.to || d <= range.to);
  });
}

const validDate = (d) => d instanceof Date && !isNaN(d);

/** Start of the current employment stint: rehire date when present, else hire date. */
function stintStart(r) {
  if (validDate(r.rehire_date)) return r.rehire_date;
  if (validDate(r.hire_date)) return r.hire_date;
  return null;
}

/**
 * Was this person present on the given date? Their employment stint started on
 * or before it and their termination (if any) falls after it. Records without a
 * start date count as already present; without a termination date, still active.
 */
export function isPresentAt(r, date) {
  const s = stintStart(r);
  return (s === null || s <= date) &&
         (!validDate(r.termination_date) || r.termination_date > date);
}

/** Headcount on a given date, from hire/rehire and termination dates. */
export function headcountAt(records, date) {
  return records.filter((r) => isPresentAt(r, date)).length;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Period bounds + labels — shared by the Attrition page and the chat
 * assistant so the two can never disagree about what "Q2 2026" means.
 * view: 'month' (idx 0–11, ×12) | 'quarter' (idx 0–3, ×4) | 'year' (×1 — a
 * full year needs no annualization: rate = terms ÷ average headcount).
 */
export function periodBounds(view, year, idx) {
  if (view === 'month') {
    return {
      start: new Date(year, idx, 1), end: new Date(year, idx + 1, 0),
      label: `${MONTHS[idx]} ${String(year).slice(2)}`, name: `${MONTHS[idx]} ${year}`, factor: 12,
    };
  }
  if (view === 'year') {
    return {
      start: new Date(year, 0, 1), end: new Date(year, 11, 31),
      label: String(year), name: String(year), factor: 1,
    };
  }
  return {
    start: new Date(year, idx * 3, 1), end: new Date(year, idx * 3 + 3, 0),
    label: `Q${idx + 1} ${String(year).slice(2)}`, name: `Q${idx + 1} ${year}`, factor: 4,
  };
}

/** Shift a (year, idx) period by delta periods. */
export function shiftPeriod(view, year, idx, delta) {
  const per = view === 'month' ? 12 : 4;
  const t = year * per + idx + delta;
  return { year: Math.floor(t / per), idx: ((t % per) + per) % per };
}

/**
 * Annualized attrition for one period:
 *   (# terminations in period × annualization factor)
 *   ÷ average(start-of-period headcount, end-of-period headcount)
 * factor: 12 for a month, 4 for a quarter, 1 for a year.
 * Start-of-period headcount is taken going INTO the period (someone
 * terminated on day 1 still counts at start, and as a termination).
 * `allRecords` = the full population (active + terminated) whose
 * hire/rehire/termination dates drive the point-in-time headcounts.
 */
export function periodAttrition(allRecords, termRecords, start, end, factor) {
  const dayBeforeStart = new Date(start.getTime() - 86400000);
  const startHC = headcountAt(allRecords, dayBeforeStart);
  const endHC = headcountAt(allRecords, end);
  const avgHC = (startHC + endHC) / 2;
  const terminated = termRecords.filter((r) =>
    validDate(r.termination_date) && r.termination_date >= start && r.termination_date <= end
  ).length;
  const rate = avgHC > 0 ? ((terminated * factor) / avgHC) * 100 : null;
  return { start, end, startHC, endHC, avgHC, terminated, factor, rate };
}
