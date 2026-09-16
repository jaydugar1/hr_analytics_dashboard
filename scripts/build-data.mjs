// One-time build script: reads a raw Employee Census export (and, optionally,
// a dedicated Termination Report and/or a Voluntary vs Regrettable workbook)
// and emits a small, ANONYMIZED data file that gets committed and bundled
// into the static site.
//
// Usage:
//   npm install xlsx --no-save
//   node scripts/build-data.mjs "<census.xlsx>" ["<termination report.xlsx>"] ["<V&R workbook.xlsx>"]
//   npm uninstall xlsx
//
// When a dedicated Termination Report is supplied, it REPLACES the
// terminations derived from the census (it's richer — the census export
// usually has no termination reason at all, while a dedicated report has
// REASON, which reasonToVoluntary() turns into a voluntary flag with no V&R
// workbook needed). The V&R workbook, if also supplied, refines that further
// (adds the regrettable flag, and overrides voluntary/reason where it has
// its own data) — it's optional either way.
//
// Reuses the exact column-matching/ingest logic from the main HR Dashboard
// Tool repo (scripts/mapping/{registry,mapper,matcher}.js are verbatim
// copies of src/mapping/{registry,mapper,matcher}.js from that repo — they
// have zero cross-file dependencies outside that folder, so they were safe
// to copy as-is) instead of reimplementing header-matching here.
//
// See README.md for the exact expected file format and column names (the
// synonym lists in scripts/mapping/registry.js are the authoritative list —
// this comment summarizes the ones that matter for this build:
//   Census sheet name: "Employee Census Report"
//   Columns matched (any close synonym works): HOME DEPARTMENT, WORKED IN
//   STATE / STATE, LOCATION (ADP work-location code, e.g. "OSDAL -
//   Onsite-Dallas" / "R-TX - Remote-Texas"), WORKER CATEGORY, POSITION
//   STATUS (Active/Leave/Terminated), JOB TITLE, ANNUAL SALARY, HIRE DATE,
//   REHIRE DATE, TERMINATION DATE, TERMINATION REASON, VOLUNTARY, plus
//   whatever identity columns exist (ASSOCIATE ID, EMPLOYEE NAME, MANAGER,
//   etc — these are read only so the join logic below can match rows, and
//   are then stripped before anything is written to disk).
//
//   V&R workbook sheet: any sheet with FIRST NAME/LAST NAME, SEPARATION
//   DATE, SEPARATION TYPE, REGRETTABLE (Yes/No/New Hire) columns.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingest, splitCensusRecords } from './mapping/mapper.js';
import { joinVrFlags } from '../src/lib/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const censusPath = process.argv[2];
const termPath = process.argv[3];
const vrPath = process.argv[4];

if (!censusPath) {
  console.error('Usage: node scripts/build-data.mjs "<census.xlsx>" ["<termination report.xlsx>"] ["<V&R workbook.xlsx>"]');
  process.exit(1);
}

// `xlsx` is deliberately NOT a normal dependency (see the usage comment
// above) — install it temporarily to run this script, same pattern as the
// heat-map-dashboard sibling project's build script.
let XLSX;
try {
  ({ default: XLSX } = await import('xlsx'));
} catch {
  console.error('The "xlsx" package is not installed. Run: npm install xlsx --no-save');
  process.exit(1);
}

function readSheet(filePath, preferredSheet) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames.includes(preferredSheet) ? preferredSheet : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows, sheetName };
}

// ---------------------------------------------------------------- census

const census = readSheet(censusPath, 'Employee Census Report');
const censusResult = ingest('employee_compass', census.headers, census.rows);
console.log(`Census: read ${census.rows.length} rows from sheet "${census.sheetName}", mapped ${Object.keys(censusResult.mapping.mapped).length}/${censusResult.registry.fields.length} fields.`);
if (censusResult.mapping.missingRequired.length) {
  console.warn(`  Missing required fields: ${censusResult.mapping.missingRequired.join(', ')} — check column names against README.md.`);
}

const { roster, terminations: censusTerminations } = splitCensusRecords(censusResult.records);
let terminations = censusTerminations;

// ------------------------------------------------------- termination report

if (termPath) {
  const term = readSheet(termPath, 'Termination Report');
  const termResult = ingest('termination_report', term.headers, term.rows);
  console.log(`Termination report: read ${term.rows.length} rows from sheet "${term.sheetName}", mapped ${Object.keys(termResult.mapping.mapped).length}/${termResult.registry.fields.length} fields.`);
  if (termResult.mapping.missingRequired.length) {
    console.warn(`  Missing required fields: ${termResult.mapping.missingRequired.join(', ')} — check column names against README.md.`);
  }
  console.log(`  Replacing ${censusTerminations.length} census-derived termination rows with ${termResult.records.length} rows from the dedicated report.`);
  terminations = termResult.records;
}

// -------------------------------------------------------------- V&R sheet

if (vrPath) {
  const vr = readSheet(vrPath, 'Separations 2026');
  const vrResult = ingest('voluntary_regrettable_sheet', vr.headers, vr.rows);
  console.log(`V&R workbook: read ${vr.rows.length} rows from sheet "${vr.sheetName}", mapped ${Object.keys(vrResult.mapping.mapped).length}/${vrResult.registry.fields.length} fields.`);
  terminations = joinVrFlags(terminations, vrResult.records);
}

const allRecords = [...roster, ...terminations];

// ------------------------------------------------------------- anonymize

// PRIVACY: strip every individually-identifying field before anything is
// written to disk. This list matches what registry.js can ever produce for
// a person's identity — if a future registry field is added that could
// identify someone, add it here too.
const IDENTITY_FIELDS = [
  'full_name', 'full_name_raw', 'last_name', 'first_name', 'employee_id',
  'manager', 'position_id', 'currency', 'position_status_raw',
  'worker_category_raw', 'termination_reason_raw',
];

function toIso(d) {
  return d instanceof Date && !isNaN(d)
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : null;
}

const KEEP_FIELDS = [
  'department', 'location_state', 'work_location', 'worker_category', 'position_status',
  'is_contractor', 'annual_salary', 'hire_date', 'rehire_date', 'termination_date',
  'termination_reason', 'voluntary_flag', 'regrettable_flag',
];

let droppedNoStart = 0;
const out = [];
for (const rec of allRecords) {
  for (const f of IDENTITY_FIELDS) delete rec[f];
  if (!rec.hire_date && !rec.rehire_date && rec.position_status !== 'terminated') { droppedNoStart++; continue; }
  const clean = {};
  for (const f of KEEP_FIELDS) {
    const v = rec[f];
    clean[f] = v instanceof Date ? toIso(v) : (v ?? null);
  }
  out.push(clean);
}

const outPath = path.join(__dirname, '..', 'src', 'data.js');
const header = `// ============================================================================
// GENERATED by scripts/build-data.mjs from a real Employee Census export.
// Do not hand-edit. Re-run the script to refresh.
// ============================================================================
// Contains ONLY: department, work location, worker category, position
// status, contractor flag, annual salary, hire/rehire/termination dates,
// termination reason, and voluntary/regrettable flags. Job title was
// deliberately dropped too (see git history) — combined with department it
// could narrow a small team down to one identifiable person.
// No names, employee ids, or manager fields are present — those are
// stripped by this script before writing (see IDENTITY_FIELDS above) even
// though the census export and V&R workbook it read from carry them.
// ============================================================================
export const RECORDS = ${JSON.stringify(out, null, 2)};
`;
fs.writeFileSync(outPath, header);

console.log(`\nWrote ${out.length} records to ${outPath} (${roster.length} roster + ${terminations.length} termination rows read; ${droppedNoStart} dropped for no usable start date).`);
console.log('Identity fields stripped from every record:', IDENTITY_FIELDS.join(', '));
