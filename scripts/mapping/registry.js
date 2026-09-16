/**
 * Canonical Schema Registry — MAPPING_SPEC.md §1
 *
 * One registry per dataset. Each field: key, type, required, synonyms[],
 * optional normalize fn for enum/boolean value normalization.
 * The dashboard reads ONLY these canonical keys — never raw file columns.
 *
 * Synonym lists are PRIORITY-ORDERED: when two columns exact-match the same
 * field (an ADP census has ASSOCIATE ID, FILE NUMBER, ...), the earlier
 * synonym wins automatically. Synonyms below are tuned against the real
 * "Employee Census Report" export (319 columns, 7/22 Census.xlsx).
 *
 * `exclude` lists decoy patterns a field must never claim (LEGAL MIDDLE NAME
 * looks fuzzy-close to "legal name"; REHIRE DATE to "hire date").
 * `derive` runs after each row is parsed and fills canonical fields that
 * real files split across columns (full_name from legal last/first name,
 * is_contractor from worker_category). `requiredAlternatives` lets a
 * required field be satisfied by its parts (full_name via last+first).
 */

// ---------- value parsers / normalizers ----------

export function parseDateValue(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? undefined : v;
  // Excel serial date numbers
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d) ? undefined : d;
  }
  const s = String(v).trim();
  if (!s) return null;
  // masked dates like "01/01/XXXX" are legitimately blank, not a warning
  if (/x{2,}|y{2,}/i.test(s)) return null;
  // M/D/YYYY, M-D-YYYY
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(yr, Number(m[1]) - 1, Number(m[2]));
    return isNaN(d) ? undefined : d;
  }
  // ISO YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d) ? undefined : d;
  }
  const d = new Date(s);
  return isNaN(d) ? undefined : d; // undefined = parse failure (null = legitimately blank)
}

export function parseBoolValue(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  const TRUE = ['true', 'yes', 'y', '1', 'v', 'vol', 'voluntary', 'regrettable', 'reg', 'x'];
  const FALSE = ['false', 'no', 'n', '0', 'i', 'invol', 'involuntary', 'non-regrettable', 'nonregrettable', 'non regrettable', 'non-reg', ''];
  if (TRUE.includes(s)) return true;
  if (FALSE.includes(s)) return false;
  return undefined; // unrecognized → value warning
}

export function parseNumberValue(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? undefined : v;
  const n = Number(String(v).replace(/[,$\s]/g, ''));
  return isNaN(n) ? undefined : n;
}

export function parseStringValue(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Enum normalization — unknown values pass through tagged `unrecognized`
 * (surfaced as value warnings, never dropped). MAPPING_SPEC.md §1.
 */
function makeEnumParser(map) {
  return (v) => {
    const s = parseStringValue(v);
    if (s === null) return null;
    const key = s.toLowerCase();
    for (const [pattern, canonical] of map) {
      if (key === pattern || key.startsWith(pattern + ' ') || key.startsWith(pattern + ' -') || key.split(/\s*-\s*/)[0].trim() === pattern) {
        return { value: canonical, raw: s };
      }
    }
    return { value: s, raw: s, unrecognized: true };
  };
}

const positionStatusParser = makeEnumParser([
  ['a', 'active'], ['active', 'active'],
  ['l', 'leave'], ['leave', 'leave'], ['loa', 'leave'],
  ['t', 'terminated'], ['terminated', 'terminated'], ['term', 'terminated'],
]);

const workerCategoryParser = (v) => {
  const s = parseStringValue(v);
  if (s === null) return null;
  return { value: s, raw: s };
};

export function isContractorCategory(workerCategory) {
  return /contractor|contingent|\bct3p\b|\bcmsp\b|\b1099\b|\bcont\b/i.test(workerCategory || '');
}

/**
 * The V&R workbook covers a single year ("Separations 2026") — every
 * separation date is assumed to be this year, even when a cell was typed
 * with a different year. Bump when the team starts a new year's sheet.
 */
export const VR_SHEET_YEAR = 2026;

/**
 * V&R sheet: SEPARATION TYPE → voluntary flag.
 * Voluntary → true; Involuntary/Layoff/Contract Ended/RIF/Performance → false;
 * anything else (e.g. "Did Not Start") → null (neither).
 */
export function separationTypeToVoluntary(type) {
  if (!type) return null;
  const t = String(type).toLowerCase();
  if (t.includes('involuntary')) return false;
  if (t.includes('voluntary')) return true;
  if (/layoff|contract|rif|reduction|performance|termination/.test(t)) return false;
  return null;
}

/**
 * ADP termination reasons encode voluntariness in the label:
 * "S - Voluntary Resignation" → true, "M - Performance" → false, …
 * Unknown/neutral ("Retired", "X - Import Created Action") → null.
 */
export function reasonToVoluntary(reason) {
  if (!reason) return null;
  const t = String(reason).toLowerCase();
  if (/involuntary/.test(t)) return false;
  if (/resignation|voluntary|personal|new position|tax setup/.test(t)) return true;
  if (/performance|mutual|reorgani|attendance|abandon|layoff|reduction|misconduct|no.?show|dismiss|cause|contract/.test(t)) return false;
  return null;
}

/** V&R sheet REGRETTABLE column: Yes / No / "New Hire" (counts as non-regrettable). */
function parseRegrettableValue(v) {
  const s = parseStringValue(v);
  if (s === null) return null;
  if (/new hire/i.test(s)) return false;
  return parseBoolValue(s);
}

// ---------- registries ----------

const str = { parse: parseStringValue };

// shared person/roster fields (census vocabulary), priority-ordered
const employeeIdField = {
  key: 'employee_id', type: 'string', required: true, ...str,
  exclude: /tax|dependent|pcp|position/,
  synonyms: ['associate id', 'employee id', 'ee id', 'emp id', 'emp no', 'worker id', 'employee number', 'file number'],
};
const NAME_DECOYS = /middle|preferred|chosen|dependent|suffix|maiden|pcp|phone|mail|address|plan|user/;
const nameFields = [
  { key: 'full_name', type: 'string', required: true, ...str, exclude: NAME_DECOYS,
    synonyms: ['employee name', 'name', 'full name', 'worker', 'worker name', 'legal name', 'payroll name'] },
  { key: 'last_name', type: 'string', required: false, ...str, exclude: NAME_DECOYS,
    synonyms: ['legal last name', 'last name', 'surname', 'family name'] },
  { key: 'first_name', type: 'string', required: false, ...str, exclude: NAME_DECOYS,
    synonyms: ['legal first name', 'first name', 'given name'] },
];
const departmentField = {
  key: 'department', type: 'string', required: true, ...str,
  synonyms: ['home department', 'department', 'dept', 'department name', 'home department description', 'home dept', 'cost center'],
};
const managerField = {
  key: 'manager', type: 'string', required: false, ...str,
  synonyms: ['reports to name', 'manager', 'supervisor', 'reports to', 'manager name', 'supervisor name'],
};
const roleField = {
  key: 'role', type: 'string', required: false, ...str,
  exclude: /\bid\b|number|eeoc|class\b/,
  synonyms: ['job title', 'role', 'position', 'title', 'job title description', 'position description'],
};
const TERM_DATE_DECOYS = /plan|enrollment|coverage|benefit|marital|birth/;

/** Compose split-name columns and derive contractor flag. */
function deriveRosterFields(rec) {
  if (!rec.full_name && (rec.last_name || rec.first_name)) {
    rec.full_name = [rec.last_name, rec.first_name].filter(Boolean).join(', ');
  }
  if (rec.is_contractor == null && rec.worker_category) {
    rec.is_contractor = isContractorCategory(rec.worker_category);
  }
  return rec;
}

export const REGISTRIES = {
  /**
   * Roster / headcount. A full census export (roster + termination columns)
   * also lands here — the app splits terminated rows into termination
   * records after ingest (see splitCensusRecords in mapper.js).
   */
  employee_compass: {
    dataset: 'employee_compass',
    label: 'Employee Census / Compass',
    derive: (rec) => {
      deriveRosterFields(rec);
      if (rec.voluntary_flag == null) rec.voluntary_flag = reasonToVoluntary(rec.termination_reason);
      return rec;
    },
    requiredAlternatives: { full_name: ['last_name', 'first_name'] },
    fields: [
      employeeIdField,
      ...nameFields,
      departmentField,
      { key: 'location_state', type: 'string', required: false, ...str,
        exclude: /dependent|address|zip|marital/,
        synonyms: ['worked in state', 'work state', 'lived in state', 'state', 'home state', 'location state', 'state province'] },
      // ADP LOCATION column ("OSDAL - Onsite-Dallas", "R-TX - Remote-Texas",
      // "0001 - Legal Address") — drives the Employee Locations page
      { key: 'work_location', type: 'string', required: false, ...str,
        exclude: /dependent|address|zip|state/,
        synonyms: ['location', 'work location', 'location code', 'office location'] },
      // joins the census to the salary-history export (both carry POSITION ID)
      { key: 'position_id', type: 'string', required: false, ...str,
        exclude: /tax|dependent|pcp/,
        synonyms: ['position id', 'position'] },
      // current pay from the census — the salary-history export often ships
      // its amount columns blank, so this is the usable salary figure
      { key: 'annual_salary', type: 'number', required: false, parse: parseSignedNumber,
        exclude: /currency|change|benefit|earnings|dependent|rate/,
        synonyms: ['annual salary', 'salary', 'annual rate'] },
      { key: 'currency', type: 'string', required: false, ...str,
        exclude: /dependent/,
        synonyms: ['annual salary currency', 'currency', 'pay currency'] },
      { key: 'worker_category', type: 'enum', required: true, parse: workerCategoryParser,
        synonyms: ['worker category', 'ee type', 'employee type', 'pay type', 'worker category description'] },
      { key: 'position_status', type: 'enum', required: true, parse: positionStatusParser,
        exclude: /marital|dependent/,
        synonyms: ['position status', 'status', 'employment status', 'active status', 'employee status'] },
      managerField,
      roleField,
      { key: 'is_contractor', type: 'boolean', required: false, parse: parseBoolValue,
        synonyms: ['contractor', 'contingent', 'is contractor', 'contingent worker'] },
      { key: 'hire_date', type: 'date', required: false, parse: parseDateValue,
        exclude: /rehire|plan|enrollment|coverage|marital|birth/,
        synonyms: ['hire date', 'start date', 'date of hire', 'original hire date'] },
      // rehires: current employment stint starts at the rehire date
      { key: 'rehire_date', type: 'date', required: false, parse: parseDateValue,
        exclude: /plan|enrollment|coverage|marital|birth/,
        synonyms: ['rehire date', 'most recent hire date', 'rehire'] },
      // census exports carry termination data on the same row (optional here)
      { key: 'termination_date', type: 'date', required: false, parse: parseDateValue,
        exclude: TERM_DATE_DECOYS,
        synonyms: ['termination date', 'term date', 'separation date', 'termination effective date'] },
      { key: 'termination_reason', type: 'string', required: false, ...str,
        synonyms: ['termination reason', 'term reason', 'reason', 'separation reason', 'termination reason code', 'termination reason description'] },
      { key: 'voluntary_flag', type: 'boolean', required: false, parse: parseBoolValue,
        synonyms: ['voluntary', 'vol invol', 'voluntary vs involuntary', 'termination type', 'voluntary flag'] },
      { key: 'regrettable_flag', type: 'boolean', required: false, parse: parseBoolValue,
        synonyms: ['regrettable', 'regrettable vs non regrettable', 'regrettable flag'] },
    ],
  },
  /**
   * Dedicated termination export (real shape: "Termination 3.12.26.xlsx" —
   * NAME, HOME DEPARTMENT, JOB TITLE, HIRE/TERMINATION DATE, REASON,
   * REPORTS TO). It has no employee id (POSITION ID is not a person key)
   * and no voluntary column — voluntary derives from the REASON label.
   */
  termination_report: {
    dataset: 'termination_report',
    label: 'Termination Report',
    derive: (rec) => {
      deriveRosterFields(rec);
      if (rec.voluntary_flag == null) rec.voluntary_flag = reasonToVoluntary(rec.termination_reason);
      return rec;
    },
    requiredAlternatives: {
      full_name: ['last_name', 'first_name'],
      voluntary_flag: ['termination_reason'],
    },
    fields: [
      { ...employeeIdField, required: false },
      ...nameFields,
      departmentField,
      managerField,
      roleField,
      { key: 'hire_date', type: 'date', required: false, parse: parseDateValue,
        exclude: /rehire|plan|enrollment|coverage|marital|birth/,
        synonyms: ['hire date', 'start date', 'date of hire', 'original hire date'] },
      { key: 'termination_date', type: 'date', required: true, parse: parseDateValue,
        exclude: TERM_DATE_DECOYS,
        synonyms: ['termination date', 'term date', 'separation date', 'last day', 'last day worked', 'termination effective date'] },
      { key: 'termination_reason', type: 'string', required: true, ...str,
        synonyms: ['termination reason', 'term reason', 'reason', 'termination reason code', 'separation reason', 'termination reason description'] },
      { key: 'voluntary_flag', type: 'boolean', required: true, parse: parseBoolValue,
        synonyms: ['voluntary', 'vol invol', 'voluntary vs involuntary', 'voluntary flag', 'vol'] },
      { key: 'regrettable_flag', type: 'boolean', required: false, parse: parseBoolValue,
        synonyms: ['regrettable', 'regrettable vs non regrettable', 'regrettable flag', 'regret'] },
    ],
  },
  /**
   * The "Voluntary vs Regrettable" workbook ("Separations 2026" sheet) —
   * uploaded in Admin or read from the OneDrive-synced copy. Needed fields
   * per the dashboard owner: FIRST NAME, LAST NAME, SEPARATION DATE,
   * SEPARATION TYPE (Voluntary/Involuntary/Layoff/Contract Ended/Did Not
   * Start), REGRETTABLE (Yes/No/New Hire). No employee id — joins to
   * terminations BY NAME. The sheet covers one year (VR_SHEET_YEAR): all
   * separation dates are assumed to be that year regardless of the year
   * typed in the cell.
   */
  voluntary_regrettable_sheet: {
    dataset: 'voluntary_regrettable_sheet',
    label: 'Voluntary & Regrettable sheet',
    derive: (rec) => {
      deriveRosterFields(rec);
      if (rec.voluntary_flag == null) rec.voluntary_flag = separationTypeToVoluntary(rec.separation_type);
      if (!rec.termination_reason && rec.separation_type) rec.termination_reason = rec.separation_type;
      const d = rec.termination_date;
      if (d instanceof Date && !isNaN(d) && d.getFullYear() !== VR_SHEET_YEAR) {
        rec.termination_date = new Date(VR_SHEET_YEAR, d.getMonth(), d.getDate());
      }
      return rec;
    },
    requiredAlternatives: {
      full_name: ['last_name', 'first_name'],
      voluntary_flag: ['separation_type'],
    },
    fields: [
      { key: 'employee_id', type: 'string', required: false, ...str,
        exclude: /tax|dependent|pcp|position|ticket/,
        synonyms: ['associate id', 'employee id', 'ee id', 'emp id', 'employee number', 'file number'] },
      ...nameFields,
      { key: 'termination_date', type: 'date', required: true, parse: parseDateValue,
        exclude: /offboarding|ticket|email|created/,
        synonyms: ['separation date', 'termination date', 'term date'] },
      { key: 'separation_type', type: 'string', required: true, ...str,
        synonyms: ['separation type', 'termination type', 'separation category'] },
      { key: 'termination_reason', type: 'string', required: false, ...str,
        synonyms: ['termination reason', 'reason', 'term reason'] },
      { key: 'voluntary_flag', type: 'boolean', required: true, parse: parseBoolValue,
        synonyms: ['voluntary', 'vol', 'voluntary flag'] },
      { key: 'regrettable_flag', type: 'boolean', required: true, parse: parseRegrettableValue,
        synonyms: ['regrettable', 'regrettable flag', 'regret'] },
    ],
  },
};

/**
 * Number that may carry currency symbols/codes, thousands separators,
 * percent signs, parenthesised negatives, or a trailing minus (mainframe
 * style, e.g. "1000-"). Returns null for blanks, undefined when genuinely
 * unparseable (which surfaces as a value warning).
 */
export function parseSignedNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? undefined : v;
  let s = String(v).replace(/ /g, ' ').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }   // (1,000)
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1).trim(); }         // 1000-
  s = s.replace(/[−–—]/g, '-');                        // unicode minus/dashes
  s = s.replace(/[$€£¥]/g, '');                                       // currency symbols
  s = s.replace(/[A-Za-z]+$/, '').trim();                             // trailing code: "1,234 USD"
  s = s.replace(/[%\s,']/g, '');                                      // % , spaces, thousands quote
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  if (isNaN(n)) return undefined;
  return neg ? -Math.abs(n) : n;
}

REGISTRIES.comp_changes = {
  /**
   * Compensation change log (pay-change export). Real headers:
   * COMPANY CODE, NAME, POSITION ID, RATE TYPE, HOME DEPARTMENT,
   * EFFECTIVE DATE, ANNUAL SALARY, CURRENCY, AMOUNT CHANGE,
   * PERCENT CHANGE, STANDARD HOURS, CHANGE REASON, RATE 1.
   *
   * ANNUAL SALARY is the rate AFTER the change, so the prior salary is
   * (annual_salary - amount_change) — used to sanity-check the percent
   * column, which some exports store as a fraction (0.035) and others as a
   * percent (3.5). `derive` normalizes both to a percent.
   */
  dataset: 'comp_changes',
  label: 'Compensation Changes',
  derive: (rec) => {
    deriveRosterFields(rec);
    const prior = rec.annual_salary != null && rec.amount_change != null
      ? rec.annual_salary - rec.amount_change
      : null;
    rec.prior_salary = prior;
    const derived = prior && prior !== 0 && rec.amount_change != null
      ? (rec.amount_change / prior) * 100
      : null;
    rec.percent_derived = derived;
    const raw = rec.percent_change;
    if (raw == null) {
      rec.percent_change = derived;
    } else if (derived != null && raw !== 0) {
      // pick the reading (percent vs fraction) that agrees with the math
      rec.percent_change = Math.abs(derived - raw * 100) < Math.abs(derived - raw) ? raw * 100 : raw;
    } else if (Math.abs(raw) > 0 && Math.abs(raw) <= 1) {
      rec.percent_change = raw * 100; // fraction with nothing to check against
    }
    return rec;
  },
  requiredAlternatives: { full_name: ['last_name', 'first_name'] },
  fields: [
    ...nameFields,
    { key: 'company_code', type: 'string', required: false, ...str,
      synonyms: ['company code', 'company', 'co code'] },
    { key: 'position_id', type: 'string', required: false, ...str,
      synonyms: ['position id', 'position', 'associate id', 'employee id', 'file number'] },
    { key: 'rate_type', type: 'string', required: false, ...str,
      synonyms: ['rate type', 'pay rate type', 'salary type'] },
    { ...departmentField, required: false },
    { key: 'effective_date', type: 'date', required: true, parse: parseDateValue,
      exclude: /hire|termination|birth|plan|enrollment/,
      synonyms: ['effective date', 'change effective date', 'rate effective date', 'date'] },
    { key: 'annual_salary', type: 'number', required: false, parse: parseSignedNumber,
      exclude: /change|currency|prior|previous/,
      synonyms: ['annual salary', 'new annual salary', 'salary', 'annual rate'] },
    { key: 'currency', type: 'string', required: false, ...str,
      synonyms: ['currency', 'annual salary currency', 'pay currency'] },
    { key: 'amount_change', type: 'number', required: false, parse: parseSignedNumber,
      exclude: /percent|pct/,
      synonyms: ['amount change', 'change amount', 'salary change amount', 'increase amount'] },
    { key: 'percent_change', type: 'number', required: false, parse: parseSignedNumber,
      exclude: /amount/,
      synonyms: ['percent change', 'pct change', 'percentage change', 'change percent', 'increase percent'] },
    { key: 'standard_hours', type: 'number', required: false, parse: parseSignedNumber,
      synonyms: ['standard hours', 'std hours', 'scheduled hours'] },
    { key: 'change_reason', type: 'string', required: true, ...str,
      synonyms: ['change reason', 'reason', 'reason for change', 'pay change reason', 'action reason'] },
    { key: 'rate_1', type: 'number', required: false, parse: parseSignedNumber,
      exclude: /type/,
      synonyms: ['rate 1', 'rate1', 'rate', 'hourly rate', 'pay rate'] },
  ],
};

REGISTRIES.offer_report = {
  /**
   * Talent Acquisition — offer/applicant export. Real headers:
   * First Name, Last Name, Job Name, Department, Start Date (Offer),
   * Resolved, Application Date, Status (Offer), Requisition ID, Opening ID,
   * Source, Location, Offices. Work-mode classification reads Offices first
   * (e.g. "Remote, USA"), falling back to Location.
   */
  dataset: 'offer_report',
  label: 'Offer Report',
  derive: deriveRosterFields, // full_name from first + last
  requiredAlternatives: { full_name: ['last_name', 'first_name'] },
  fields: [
    ...nameFields,
    { key: 'job_name', type: 'string', required: false, ...str,
      synonyms: ['job name', 'job title', 'position', 'role'] },
    { ...departmentField, required: false },
    { key: 'offer_start_date', type: 'date', required: false, parse: parseDateValue,
      synonyms: ['start date offer', 'start date', 'offer start date'] },
    { key: 'resolved_date', type: 'date', required: false, parse: parseDateValue,
      synonyms: ['resolved', 'resolved date', 'offer date'] },
    { key: 'application_date', type: 'date', required: false, parse: parseDateValue,
      synonyms: ['application date', 'applied date', 'date applied'] },
    { key: 'offer_status', type: 'string', required: false, ...str,
      synonyms: ['status offer', 'offer status', 'status'] },
    { key: 'requisition_id', type: 'string', required: false, ...str,
      synonyms: ['requisition id', 'req id', 'requisition'] },
    { key: 'opening_id', type: 'string', required: false, ...str,
      synonyms: ['opening id', 'opening'] },
    { key: 'source', type: 'string', required: false, ...str,
      synonyms: ['source', 'application source', 'candidate source'] },
    { key: 'location', type: 'string', required: false, ...str,
      synonyms: ['location', 'candidate location', 'work location'] },
    { key: 'offices', type: 'string', required: false, ...str,
      synonyms: ['offices', 'office', 'office name'] },
  ],
};

REGISTRIES.equipment_shipments = {
  /**
   * Equipment Tracking dashboard — shipment/billing export. Real headers are
   * CamelCase-squashed ("ShipmentTrackingNumber") with "(mm/dd/yyyy)"
   * suffixes on dates. Data is dirty: the derived `department` field uses
   * DepartmentNumber, falling back to ReferenceNotesLine1 when the number is
   * blank. Multiple rows can share one tracking number (charge lines);
   * analytics aggregate per DISTINCT tracking number.
   */
  dataset: 'equipment_shipments',
  label: 'Equipment Shipments',
  derive: (rec) => {
    if (!rec.department) {
      const num = rec.department_number != null ? String(rec.department_number).trim() : null;
      const ref = typeof rec.reference_notes === 'string' ? rec.reference_notes.replace(/\s+/g, ' ').trim() : null;
      rec.department = num || ref || null; // DepartmentNumber first; notes only when it's blank
    }
    return rec;
  },
  fields: [
    { key: 'tracking_number', type: 'string', required: true, parse: parseStringValue,
      exclude: /department|reference|invoice/,
      synonyms: ['shipmenttrackingnumber', 'shipment tracking number', 'tracking number', 'tracking id', 'tracking', 'airbill number', 'waybill number'] },
    { key: 'ship_date', type: 'date', required: true, parse: parseDateValue,
      exclude: /delivery|invoice|due/,
      synonyms: ['shipment date mm dd yyyy', 'shipment date', 'ship date', 'date shipped', 'pickup date'] },
    { key: 'delivery_date', type: 'date', required: false, parse: parseDateValue,
      synonyms: ['shipment delivery date mm dd yyyy', 'shipment delivery date', 'delivery date', 'delivered date', 'date delivered'] },
    { key: 'shipper', type: 'string', required: false, parse: parseStringValue,
      synonyms: ['shippername', 'shipper name', 'shipper', 'carrier', 'carrier name'] },
    { key: 'pieces', type: 'number', required: false, parse: parseNumberValue,
      synonyms: ['piecesinshipment', 'pieces in shipment', 'pieces', 'piece count', 'package count'] },
    { key: 'department', type: 'string', required: false, parse: parseStringValue,
      exclude: /number/,
      synonyms: ['department', 'dept', 'department name'] },
    { key: 'reference_notes', type: 'string', required: false, parse: parseStringValue,
      synonyms: ['referencenotesline1', 'reference notes line 1', 'reference notes', 'reference', 'ref notes'] },
    { key: 'department_number', type: 'string', required: false, parse: parseStringValue,
      synonyms: ['departmentnumber', 'department number', 'dept number', 'dept no'] },
    { key: 'net_charge', type: 'number', required: true, parse: parseNumberValue,
      synonyms: ['netchargeamountbilledcurrency', 'net charge amount billed currency', 'net charge amount', 'net charge', 'amount billed', 'billed amount', 'charge amount', 'total charge'] },
  ],
};

/**
 * Onboarding checklist cells are filled in by hand, so a "done" mark arrives in
 * whatever form the person reached for: Yes, Y, X, Complete, Done, Sent, N/A —
 * or a DATE, which is itself proof the step happened. Anything blank is
 * outstanding. This is deliberately generous in what counts as done, because
 * the alternative (a value warning per cell) would bury the page in noise.
 *
 * Returns true (done), false (explicitly not done / not needed), or null (blank).
 * Never returns undefined, so an unfamiliar scribble is not treated as a
 * mapping failure — it counts as done, on the reasoning that someone typing
 * something into a checklist cell meant to record progress.
 */
export function parseChecklistValue(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (v instanceof Date) return !isNaN(v);        // a date in the cell = done
  const s = String(v).trim();
  if (!s) return null;
  const t = s.toLowerCase();
  if (/^(no|n|not done|not started|pending|outstanding|tbd|todo|to do|waiting|-|--|0)$/.test(t)) return false;
  if (/^(n\/a|na|not needed|not applicable|not required)$/.test(t)) return false;
  return true;                                    // yes / y / x / done / complete / sent / a date / a note
}

/**
 * Onboarding pipeline stage. The tracker colour-codes rows, and the legend is
 * the real stage model:
 *   Red    - Didn't start        Yellow - BGC pending
 *   (none) - Nothing done        Peach  - Pushed from GHO to ADP
 *   Blue   - Hired in ADP, no invites
 *   Purple - Hired, IT onboarding sent
 *   Green  - Everything completed and sent
 * Cell fill colours are NOT readable from an .xlsx here, so we normalize the
 * Status column's text instead — it carries the same vocabulary.
 */
export const ONBOARDING_STAGES = [
  ['complete', 'Everything completed', '#005042'],
  ['it_sent', 'Hired, IT onboarding sent', '#7a4a8c'],
  ['hired_adp', 'Hired in ADP, no invites', '#3b6ea5'],
  ['pushed_adp', 'Pushed from GHO to ADP', '#e08a5f'],
  ['bgc_pending', 'BGC pending', '#c9a227'],
  ['not_started', "Didn't start", '#c43d76'],
  ['nothing_done', 'Nothing done', '#b0a898'],
];

export function parseOnboardingStatus(v) {
  const s = parseStringValue(v);
  if (s == null) return null;
  const t = s.toLowerCase();
  if (/didn'?t start|did not start|no start|declined|withdrew|rescind/.test(t)) return 'not_started';
  if (/complete|everything|all done|finished|sent and complete/.test(t)) return 'complete';
  if (/it onboarding|it sent|it invite|onboarding sent/.test(t)) return 'it_sent';
  if (/no invite|hired in adp|hired adp/.test(t)) return 'hired_adp';
  if (/gho|pushed/.test(t)) return 'pushed_adp';
  if (/bgc|background/.test(t)) return 'bgc_pending';
  if (/nothing/.test(t)) return 'nothing_done';
  return undefined;   // unrecognized → value warning, row kept
}

REGISTRIES.onboarding_tracker = {
  /**
   * The People-team onboarding tracker: one row per incoming hire, with a
   * checklist of steps that must be finished before their start date. Real
   * headers are plain title case ("BGC Completed", "IT Ticket Created").
   *
   * There is no employee id — rows are people who have not been hired in ADP
   * yet — so First/Last Name compose the name, same as the V&R sheet.
   */
  dataset: 'onboarding_tracker',
  label: 'Onboarding tracker',
  derive: (rec) => {
    if (!rec.full_name && (rec.last_name || rec.first_name)) {
      rec.full_name = [rec.last_name, rec.first_name].filter(Boolean).join(', ');
    }
    // a badge number in the sheet is itself proof the badge came through
    if (rec.badge_number != null && rec.badge_received == null) rec.badge_received = true;
    // likewise an IT ticket number means the ticket exists
    if (rec.it_ticket_number != null && rec.it_ticket_created == null) rec.it_ticket_created = true;
    return rec;
  },
  requiredAlternatives: { full_name: ['last_name', 'first_name'] },
  fields: [
    ...nameFields.map((f) => (f.key === 'full_name' ? { ...f, required: false } : f)),
    { key: 'start_date', type: 'date', required: true, parse: parseDateValue,
      exclude: /birth|termination|created|requested/,
      synonyms: ['start date', 'hire date', 'anticipated start date', 'expected start date', 'first day'] },
    { key: 'onboarding_status', type: 'string', required: false, parse: parseOnboardingStatus,
      synonyms: ['status', 'onboarding status', 'stage', 'progress'] },
    { key: 'onboarding_location', type: 'string', required: false, ...str,
      synonyms: ['onboarding location', 'location', 'onboarding site', 'work location', 'office'] },
    { ...departmentField, required: false },
    { ...roleField },
    { ...managerField },
    { key: 'created_by', type: 'string', required: false, ...str,
      synonyms: ['created by', 'requested by', 'submitted by', 'owner'] },
    { key: 'computer_type', type: 'string', required: false, ...str,
      synonyms: ['computer type', 'laptop type', 'device type', 'hardware', 'equipment type'] },
    { key: 'email', type: 'string', required: false, ...str,
      synonyms: ['email', 'email address', 'work email', 'company email'] },
    { key: 'it_ticket_number', type: 'string', required: false, ...str,
      synonyms: ['it ticket number', 'ticket number', 'it ticket #', 'ticket id'] },
    { key: 'badge_number', type: 'string', required: false, ...str,
      synonyms: ['badge number', 'badge #', 'badge id'] },
    { key: 'is_canada_worker', type: 'boolean', required: false, parse: parseChecklistValue,
      synonyms: ['canada worker', 'canadian worker', 'canada', 'is canada worker'] },

    // ---- the checklist. Each is a step that must be done before day one ----
    { key: 'badge_requested', type: 'boolean', required: false, parse: parseChecklistValue,
      exclude: /number/,
      synonyms: ['badge requested', 'badge request', 'requested badge'] },
    { key: 'it_ticket_created', type: 'boolean', required: false, parse: parseChecklistValue,
      exclude: /number|#/,
      synonyms: ['it ticket created', 'it ticket', 'ticket created', 'it request created'] },
    { key: 'bgc_completed', type: 'boolean', required: false, parse: parseChecklistValue,
      synonyms: ['bgc completed', 'bgc complete', 'bgc', 'background check completed', 'background check'] },
    { key: 'cpra_sent', type: 'boolean', required: false, parse: parseChecklistValue,
      exclude: /completed|complete/,
      synonyms: ['cpra sent', 'cpra notice sent', 'cpra'] },
    { key: 'cpra_completed', type: 'boolean', required: false, parse: parseChecklistValue,
      exclude: /\bsent\b/,
      synonyms: ['cpra completed', 'cpra complete', 'cpra returned'] },
    { key: 'personal_file_created', type: 'boolean', required: false, parse: parseChecklistValue,
      synonyms: ['personal file created', 'personnel file created', 'personal file', 'personnel file', 'file created'] },
    { key: 'photo_received', type: 'boolean', required: false, parse: parseChecklistValue,
      synonyms: ['photo received', 'photo', 'picture received', 'headshot received'] },
    { key: 'badge_received', type: 'boolean', required: false, parse: parseChecklistValue,
      exclude: /requested/,
      synonyms: ['badge received', 'badge issued', 'badge printed', 'badge done'] },
    { key: 'travel_booked', type: 'boolean', required: false, parse: parseChecklistValue,
      synonyms: ['onboarding travel booked if needed', 'onboarding travel booked', 'travel booked', 'travel arranged', 'flights booked'] },
  ],
};

/** Registry copy with extra learned synonyms merged in (mapping memory §5). */
export function registryWithSynonyms(dataset, learned = {}) {
  const base = REGISTRIES[dataset];
  if (!base) throw new Error(`Unknown dataset: ${dataset}`);
  return {
    ...base,
    fields: base.fields.map((f) => ({
      ...f,
      synonyms: [...f.synonyms, ...(learned[f.key] || [])],
    })),
  };
}
