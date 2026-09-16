/**
 * Talent Acquisition — Employee Locations analytics.
 *
 * Work-mode classification rules (documented on the page):
 * - Remote:     text contains "Remote" or starts with an "R-" code
 *               (place = what follows "Remote-", e.g. Texas, Canada)
 * - In person:  text contains "Onsite"/"On-site" or starts with an "OS" code
 *               (office = what follows "Onsite-", e.g. Dallas); a plain
 *               office name (offer report) also counts as in person
 * - Hybrid:     text contains "Hybrid"
 * - Unspecified: blank, or ADP's "0001 - Legal Address" default — NOT a real
 *               assignment. Percentages are computed over classified people;
 *               the unspecified count is reported separately, never hidden.
 */

/**
 * Place aliases — variants of the same office/city report as one category.
 * First matching pattern wins; add rows here as new variants appear.
 */
const PLACE_ALIASES = [
  [/dallas/i, 'Dallas'],
  [/chicago|evanston/i, 'Chicago'],
];

/**
 * The CLOSED list of in-person offices (per the dashboard owner): Dallas,
 * New York, Vancouver, Chicago. An in-person location maps to whichever of
 * these appears anywhere in its text; no match → "Other". Add a row when a
 * real new office opens.
 */
export const OFFICE_ALIASES = [
  [/dallas/i, 'Dallas'],
  [/new york|\bnyc\b|\bny\b/i, 'New York'],
  [/vancouver/i, 'Vancouver'],
  [/chicago|evanston/i, 'Chicago'],
];

export function normalizePlace(place) {
  if (!place) return place;
  for (const [re, name] of PLACE_ALIASES) {
    if (re.test(place)) return name;
  }
  return place;
}

export function classifyWorkLocation(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s || /legal address|^0001\b/i.test(s)) return { mode: null, place: null };
  const lower = s.toLowerCase();

  // "Offshore India", "OFF - Offshore-India", plain "Offshore" — remote, not an office
  if (lower.includes('offshore')) {
    const m = s.match(/offshore[\s-]*(.+)$/i);
    let p = m && m[1] ? normalizePlace(m[1].trim()) : null;
    if (!p || /offshore/i.test(p)) p = 'Offshore';
    return { mode: 'remote', place: p };
  }

  if (lower.includes('remote') || /^r-/i.test(s)) {
    let place = null;
    const suffix = s.match(/remote\s*[-–]\s*(.+)$/i);
    if (suffix) {
      place = suffix[1].trim();
    } else if (s.includes(',')) {
      // "Remote, USA" → USA
      const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
      place = parts[parts.length - 1] || null;
      if (place && /^remote$/i.test(place)) place = null;
    } else {
      const dash = s.split(/\s[-–]\s/);
      place = dash.length > 1 ? dash[dash.length - 1].trim() : s;
    }
    return { mode: 'remote', place: normalizePlace(place) };
  }

  // Everything else is IN PERSON — hybrid counts as in person. The office is
  // whichever KNOWN city appears anywhere in the text ("New York, NY - Hybrid
  // (3x in office/week)" → New York). The office list is closed on purpose:
  // an unrecognized location shows as "Other" so it gets an alias added here
  // instead of leaking schedule text like "3x in office/week" as a city.
  for (const [re, name] of OFFICE_ALIASES) {
    if (re.test(s)) return { mode: 'onsite', place: name };
  }
  return { mode: 'onsite', place: 'Other' };
}

/** Classify an active-census employee (uses the ADP LOCATION column). */
export function classifyEmployee(rec) {
  return classifyWorkLocation(rec.work_location);
}

/** Classify an offer/applicant row (Offices first, then Location). */
export function classifyApplicant(rec) {
  const text = (rec.offices && String(rec.offices).trim()) || rec.location;
  return classifyWorkLocation(text);
}

/**
 * Mode breakdown for a list of {mode} classifications:
 * counts + percentages over CLASSIFIED people (unspecified excluded from %).
 * Two real modes — in person (onsite, hybrid included) and remote.
 */
export function modeBreakdown(classified) {
  const counts = { onsite: 0, remote: 0, unspecified: 0 };
  for (const c of classified) counts[c.mode === 'onsite' || c.mode === 'remote' ? c.mode : 'unspecified'] += 1;
  const known = counts.onsite + counts.remote;
  const pct = (n) => (known ? (n / known) * 100 : null);
  return {
    total: classified.length,
    known,
    counts,
    pct: { onsite: pct(counts.onsite), remote: pct(counts.remote) },
  };
}

/** [{name, count}] of places for a given mode, sorted desc, dirty spellings grouped. */
export function placeRollup(classified, mode) {
  const by = new Map();
  for (const c of classified) {
    if (c.mode !== mode) continue;
    const raw = c.place && c.place.trim() ? c.place.trim() : '(Unknown)';
    const key = raw.toLowerCase();
    if (!by.has(key)) by.set(key, { count: 0, spellings: new Map() });
    const e = by.get(key);
    e.count += 1;
    e.spellings.set(raw, (e.spellings.get(raw) || 0) + 1);
  }
  return [...by.values()].map((e) => ({
    name: [...e.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
    count: e.count,
  })).sort((a, b) => b.count - a.count);
}
