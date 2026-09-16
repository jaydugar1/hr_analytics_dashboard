/**
 * Tenure analytics — how long people stay, from the Employee Census.
 *
 * Ported from the main HR Dashboard Tool repo's src/lib/tenure.js, with the
 * only change being the cleanDepartment import path (src/lib/department.js
 * here instead of src/lib/budget.js, since Budget is out of scope).
 *
 * A person's tenure clock starts at their REHIRE date when present (a rehire
 * restarts the clock — the gap in between isn't tenure), else their original
 * HIRE date, matching the same "current employment stint" rule used for
 * headcount math elsewhere (metrics.js `stintStart`). For active employees,
 * tenure runs through today; for terminated employees, through their
 * termination date.
 */
import { cleanDepartment } from './department.js';

const validDate = (d) => d instanceof Date && !isNaN(d);
const YEAR_MS = 365.25 * 86400000;

function stintStart(r) {
  if (validDate(r.rehire_date)) return r.rehire_date;
  if (validDate(r.hire_date)) return r.hire_date;
  return null;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);

/**
 * One row per person in the selected population, with tenure in years.
 * `population`: 'active' | 'terminated'. Rows with no usable start date, or
 * (for terminated people) no termination date on/after that start, are
 * skipped rather than guessed at.
 *
 * NOTE: unlike the main repo, this row deliberately carries no `name` or
 * `role` (job title) field — the census baked into this static site's bundle
 * has neither (see src/data.js). Only `location_state` remains, for
 * aggregate breakdowns.
 */
export function buildTenureRoster(censusRecords, population = 'active', asOf = new Date()) {
  const rows = [];
  for (const c of censusRecords || []) {
    const isTerminated = c.position_status === 'terminated';
    if (population === 'active' && isTerminated) continue;
    if (population === 'terminated' && !isTerminated) continue;

    const start = stintStart(c);
    if (!start) continue;
    const end = population === 'terminated' ? (validDate(c.termination_date) ? c.termination_date : null) : asOf;
    if (!end || end < start) continue;

    rows.push({
      dept: cleanDepartment(c.department) || '(Unassigned)',
      location_state: c.location_state ?? null,
      startDate: start,
      endDate: population === 'terminated' ? end : null,
      years: (end - start) / YEAR_MS,
      status: isTerminated ? 'terminated' : 'active',
    });
  }
  return rows;
}

/** Headcount + average/median tenure across the whole roster. */
export function tenureTotals(rows) {
  const yrs = rows.map((r) => r.years);
  return { count: rows.length, avgYears: avg(yrs), medianYears: median(yrs) };
}

/**
 * Average tenure by department, ascending (shortest-tenured department
 * first) — surfaces which teams skew newest. Departments below `minHead`
 * are dropped so a team of one can't top the list.
 */
export function tenureByDept(rows, minHead = 1) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.dept)) by.set(r.dept, []);
    by.get(r.dept).push(r);
  }
  return [...by.entries()]
    .map(([name, group]) => ({
      name,
      count: group.length,
      avgYears: avg(group.map((r) => r.years)),
      medianYears: median(group.map((r) => r.years)),
    }))
    .filter((d) => d.count >= minHead)
    .sort((a, b) => a.avgYears - b.avgYears);
}

/** Tenure distribution bands, for a shape-of-the-roster view. */
export function tenureBands(rows) {
  const defs = [
    ['< 1 year', (y) => y < 1],
    ['1–2 years', (y) => y >= 1 && y < 2],
    ['2–5 years', (y) => y >= 2 && y < 5],
    ['5–10 years', (y) => y >= 5 && y < 10],
    ['10+ years', (y) => y >= 10],
  ];
  return defs.map(([name, test]) => ({ name, count: rows.filter((r) => test(r.years)).length }));
}

export const fmtYears = (y) => {
  if (y == null) return '—';
  if (y < 1) return `${Math.max(0, Math.round(y * 12))} mo`;
  return `${y.toFixed(1)} yrs`;
};
