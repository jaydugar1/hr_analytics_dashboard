import { RECORDS } from '../data.js';

/** 'YYYY-MM-DD' -> local Date, or null. Matches the main repo's date handling
 * (a plain local Date, no timezone shift) so metrics/tenure/attritionCost —
 * ported unmodified from that repo — work against these records exactly as
 * they do there. */
function parseIsoDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * The census population: every record from src/data.js with its date fields
 * turned into Date objects. This single array plays the role that
 * `data.censusPopulation` plays in the main repo (App.jsx) — it already
 * carries both active and terminated rows, with termination_reason/
 * voluntary_flag/regrettable_flag on the terminated ones directly (this
 * static build has no separate Termination Report / V&R workbook to join —
 * see scripts/build-data.mjs for how a real export is merged before this
 * point).
 */
export const CENSUS = RECORDS.map((r) => ({
  ...r,
  hire_date: parseIsoDate(r.hire_date),
  rehire_date: parseIsoDate(r.rehire_date),
  termination_date: parseIsoDate(r.termination_date),
}));

/**
 * Terminated rows only — the role `terms` plays in the main repo. Matches
 * either `position_status === 'terminated'` (rows sourced from the census)
 * or a row with no position_status at all but a termination_date (rows
 * sourced from a dedicated Termination Report, which has no position_status
 * column) — not just "has a termination_date", so an active/on-leave roster
 * row that happens to carry a past termination_date (e.g. a rehire) is never
 * misclassified as terminated.
 */
export const TERMS = CENSUS.filter((r) => r.position_status === 'terminated' || (!r.position_status && r.termination_date));
