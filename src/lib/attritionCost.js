/**
 * Cost of attrition — ramp + payback framework.
 *
 * The idea: every hire costs money to acquire and takes time to become
 * productive (the "ramp"). Once ramped, it takes further time for their
 * output to pay back what was spent getting them there (the "payback
 * period"). Someone who leaves before ramp + payback is a net loss —
 * regardless of whether the exit was voluntary or involuntary, regrettable
 * or not. This module buckets every departure by where their tenure fell
 * relative to that "value capture" threshold, and estimates a dollar
 * write-off for anyone who fell short of it.
 *
 * DATA SOURCES AND ASSUMPTIONS — every number here is either pulled from
 * your own uploaded data, or a labeled, adjustable placeholder:
 *   - Hire/rehire/termination dates, department, and salary: your own
 *     Employee Census. Termination reason and voluntary/involuntary flag:
 *     your Census if it carries them, else backfilled from the Termination
 *     Report / Voluntary & Regrettable sheet by matching name.
 *   - Ramp time (default 3 months): a placeholder — there's no role/level
 *     data in the app yet to vary this by job. Once leveling data exists,
 *     this should come from that instead of one flat number.
 *   - Payback period (default 6 months): a placeholder for how long after
 *     ramp it takes typical output to offset acquisition + ramp cost.
 *   - Cost to hire (default $5,475): SHRM's 2025 Talent Acquisition
 *     Benchmarking Report, national average for non-executive roles. SHRM
 *     doesn't publish a healthcare- or company-size-specific figure, and
 *     the BLS does not track cost-per-hire at all (its ECEC survey covers
 *     ongoing compensation cost, not one-time hiring cost) — so this is a
 *     general benchmark, not a number specific to this organization.
 *   - Compensation load factor (default 1.3×): a common rule-of-thumb
 *     multiplier for benefits/taxes on top of base salary (benefits
 *     typically run ~25-35% of total compensation per BLS Employer Costs
 *     for Employee Compensation data). Not verified against this
 *     organization's actual benefits cost — adjust if you know your own.
 *   - Vacancy/backfill cost is NOT included: that needs a time-to-fill
 *     figure this app doesn't currently track.
 *   - No output/productivity value is modeled directly (there's no revenue
 *     or output metric in this data). The simplification: pre-ramp time is
 *     pure cost (zero output), and post-ramp time before the payback
 *     threshold is treated as break-even (output ≈ pay) — so the write-off
 *     for a ramp-to-breakeven exit is capped at hire cost + ramp-period
 *     comp, not growing further the longer someone stayed past ramp.
 */

const validDate = (d) => d instanceof Date && !isNaN(d);
const num = (v) => (typeof v === 'number' && !isNaN(v) ? v : null);
const DAY_MS = 86400000;
const MONTH_DAYS = 30.44; // average month length, consistent with the rest of the app's year math

function stintStart(r) {
  if (validDate(r.rehire_date)) return r.rehire_date;
  if (validDate(r.hire_date)) return r.hire_date;
  return null;
}

function cleanDepartment(name) {
  if (name == null) return null;
  const original = String(name).replace(/\s+/g, ' ').trim();
  if (!original) return null;
  const stripped = original
    .replace(/^\d[\dA-Za-z]*\s*[-–—]\s*/, '')
    .replace(/^[A-Z]{2,5}\s*[-–—]\s*/, '');
  return stripped.trim() || original;
}

export function hireQuarterLabel(d) {
  if (!validDate(d)) return null;
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

export const DEFAULT_ASSUMPTIONS = {
  rampMonths: 3,
  paybackMonths: 6,
  costToHire: 5475,
  loadFactor: 1.3,
};

/**
 * One row per terminated person with a usable start + termination date.
 *
 * Adapted from the main repo: that version joins a separate termination-
 * report/V&R array onto the census by name to backfill reason/voluntary
 * flags. This static build's single anonymized dataset already carries
 * termination_reason/voluntary_flag directly on each record (no name-based
 * join is possible or needed once names are stripped), so the second
 * argument and the join are dropped — the roster is built from
 * `censusRecords` alone. No `name` or `manager` field is produced (privacy:
 * this dataset never carries those).
 */
export function buildAttritionCostRoster(censusRecords, assumptions = {}) {
  const { rampMonths, paybackMonths } = { ...DEFAULT_ASSUMPTIONS, ...assumptions };
  const thresholdMonths = rampMonths + paybackMonths;

  const rows = [];
  for (const c of censusRecords || []) {
    // matches either a census-sourced row (position_status === 'terminated')
    // or a dedicated Termination Report row (no position_status column at
    // all, but has a termination_date) — see loadData.js's TERMS.
    const isTerminated = c.position_status === 'terminated' || (!c.position_status && !!c.termination_date);
    if (!isTerminated) continue;
    const start = stintStart(c);
    if (!start) continue;
    const end = validDate(c.termination_date) ? c.termination_date : null;
    if (!end || end < start) continue;

    const reason = c.termination_reason ?? null;
    const voluntary = c.voluntary_flag ?? null;
    const salary = num(c.annual_salary);
    const tenureMonths = (end - start) / (MONTH_DAYS * DAY_MS);

    const bucket =
      tenureMonths < rampMonths ? 'pre-ramp' :
      tenureMonths < thresholdMonths ? 'ramp-to-breakeven' :
      'post-breakeven';

    rows.push({
      dept: cleanDepartment(c.department) || '(Unassigned)',
      hireDate: start,
      termDate: end,
      hireQuarter: hireQuarterLabel(start),
      tenureMonths,
      bucket,
      reason,
      voluntary,
      salary,
    });
  }
  return rows;
}

/**
 * Attaches the estimated write-off to each row (null when salary is
 * missing — that row still counts toward bucket totals, just not the $
 * total). Kept separate from the roster builder so the cost math can be
 * re-run instantly as the assumption inputs change, without rebuilding the
 * roster from source data each time.
 */
export function costRoster(rows, assumptions = {}) {
  const { rampMonths, costToHire, loadFactor } = { ...DEFAULT_ASSUMPTIONS, ...assumptions };
  return rows.map((r) => {
    if (r.salary == null) return { ...r, writeOff: null };
    const loadedMonthly = (r.salary * loadFactor) / 12;
    let writeOff = 0;
    if (r.bucket === 'pre-ramp') writeOff = costToHire + loadedMonthly * r.tenureMonths;
    else if (r.bucket === 'ramp-to-breakeven') writeOff = costToHire + loadedMonthly * rampMonths;
    return { ...r, writeOff };
  });
}

const sum = (nums) => nums.reduce((a, b) => a + b, 0);

/** Headline numbers: how many exits missed the value-capture threshold, and what it cost. */
export function attritionCostTotals(rows) {
  const withCost = rows.filter((r) => r.writeOff != null);
  const preThreshold = rows.filter((r) => r.bucket !== 'post-breakeven');
  return {
    count: rows.length,
    preThresholdCount: preThreshold.length,
    preThresholdPct: rows.length ? (preThreshold.length / rows.length) * 100 : null,
    totalWriteOff: sum(withCost.map((r) => r.writeOff)),
    excludedNoSalary: rows.length - withCost.length,
  };
}

const BUCKET_ORDER = ['pre-ramp', 'ramp-to-breakeven', 'post-breakeven'];
const BUCKET_LABEL = {
  'pre-ramp': 'Pre-ramp (never became productive)',
  'ramp-to-breakeven': 'Ramp-to-breakeven (productive, but left before payback)',
  'post-breakeven': 'Post-breakeven (healthy attrition)',
};

/** Counts and $ written off per bucket, in a fixed, meaningful order. */
export function attritionCostByBucket(rows) {
  return BUCKET_ORDER.map((bucket) => {
    const group = rows.filter((r) => r.bucket === bucket);
    const withCost = group.filter((r) => r.writeOff != null);
    return {
      bucket,
      label: BUCKET_LABEL[bucket],
      count: group.length,
      totalWriteOff: sum(withCost.map((r) => r.writeOff)),
    };
  });
}

/**
 * Group by a field (dept, manager, hireQuarter, or a voluntary/involuntary
 * label) — counts, pre-threshold counts, and $ written off per group,
 * sorted by $ written off descending so the biggest problem areas surface
 * first.
 */
export function attritionCostByGroup(rows, dim) {
  const keyOf = dim === 'voluntary'
    ? (r) => (r.voluntary === true ? 'Voluntary' : r.voluntary === false ? 'Involuntary' : '(Unknown)')
    : (r) => r[dim] ?? '(Unassigned)';

  const by = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  return [...by.entries()].map(([name, group]) => {
    const withCost = group.filter((r) => r.writeOff != null);
    const preThreshold = group.filter((r) => r.bucket !== 'post-breakeven');
    return {
      name,
      count: group.length,
      preThresholdCount: preThreshold.length,
      totalWriteOff: sum(withCost.map((r) => r.writeOff)),
    };
  }).sort((a, b) => b.totalWriteOff - a.totalWriteOff);
}

/** Filters a roster to terminations within [from, to] (inclusive); null range = all time. */
export function filterByDateRange(rows, range) {
  if (!range) return rows;
  return rows.filter((r) => (!range.from || r.termDate >= range.from) && (!range.to || r.termDate <= range.to));
}

/**
 * Resolves a named preset to a concrete {from, to} window, or null for all
 * time. `preset` is 'all', 'ytd', 'ltm' (last 12 months), or a four-digit
 * calendar year as a string/number (e.g. '2025') — one exists per year that
 * actually has terminations, built by the caller from the roster.
 */
export function resolveDatePreset(preset, asOf = new Date()) {
  if (!preset || preset === 'all') return null;
  if (preset === 'ytd') return { from: new Date(asOf.getFullYear(), 0, 1), to: asOf };
  if (preset === 'ltm') return { from: new Date(asOf.getFullYear() - 1, asOf.getMonth(), asOf.getDate() + 1), to: asOf };
  const year = Number(preset);
  if (Number.isInteger(year) && String(year) === String(preset)) {
    return { from: new Date(year, 0, 1), to: new Date(year, 11, 31, 23, 59, 59, 999) };
  }
  return null;
}

/** Calendar years with at least one termination, descending (newest first). */
export function terminationYears(rows) {
  return [...new Set(rows.map((r) => r.termDate.getFullYear()))].sort((a, b) => b - a);
}

export const fmtMoney = (n) =>
  n == null ? '—' : (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString();
export const fmtMoneyShort = (n) => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
  return fmtMoney(n);
};
export const fmtPct1 = (n) => (n == null ? '—' : n.toFixed(1) + '%');
