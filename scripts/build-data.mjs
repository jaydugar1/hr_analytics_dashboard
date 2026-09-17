// One-time build script: reads a raw Employee Census export (and, optionally,
// a dedicated Termination Report and/or a Voluntary vs Regrettable workbook)
// and emits a small, ANONYMIZED data file that gets committed and bundled
// into the static site.
//
// Usage:
//   npm install xlsx --no-save
//   node scripts/build-data.mjs "<census.xlsx>" ["<termination report.xlsx>"] ["<V&R workbook.xlsx>"] ["<reports-to census.xlsx>"]
//   npm uninstall xlsx
//
// The optional 4th argument is a census export that includes a "Reports To
// Name" / "Manager" column (this project's real exports don't always have
// one). It's used ONLY to compute Span of Control (average direct reports,
// overall and by department) at build time — the manager names themselves
// are grouped on and counted, then discarded; they never appear in the
// output. If this export lacks fields (e.g. no location/state) that the
// main census has, that's fine — it's never used for anything but this one
// aggregate, never merged into RECORDS.
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
const reportsPath = process.argv[5];

if (!censusPath) {
  console.error('Usage: node scripts/build-data.mjs "<census.xlsx>" ["<termination report.xlsx>"] ["<V&R workbook.xlsx>"] ["<reports-to census.xlsx>"]');
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

// PRIVACY NOTE / DATA LIMITATION: joinVrFlags matches V&R rows onto
// termination records by employee id or full name. This project's real
// exports have neither (good for privacy, since nothing here can ever
// identify a person) — which also means there is NO shared key to join a
// V&R workbook onto the termination report by. When that's the case, the
// V&R rows are baked as their own small standalone dataset (VR_SEPARATIONS)
// instead of silently failing to join (which would look like it worked but
// touch zero records). If a future V&R export DOES carry a name/id, the
// join runs for real and no standalone dataset is written.
let vrSeparations = [];

if (vrPath) {
  const vr = readSheet(vrPath, 'Separations 2026');
  const vrResult = ingest('voluntary_regrettable_sheet', vr.headers, vr.rows);
  console.log(`V&R workbook: read ${vr.rows.length} rows from sheet "${vr.sheetName}", mapped ${Object.keys(vrResult.mapping.mapped).length}/${vrResult.registry.fields.length} fields.`);
  const hasJoinKey = vrResult.records.some((v) => v.employee_id != null || v.full_name);
  if (hasJoinKey) {
    terminations = joinVrFlags(terminations, vrResult.records);
    console.log('  Has a name/id column — joined its voluntary/regrettable flags onto the termination records.');
  } else {
    console.log(`  No employee id or name in this workbook, so it can't be joined to the ${terminations.length} termination records by person.`);
    console.log(`  Baking its ${vrResult.records.length} rows as a separate standalone dataset (VR_SEPARATIONS) instead.`);
    vrSeparations = vrResult.records;
  }
}

const allRecords = [...roster, ...terminations];

// ------------------------------------------------------- span of control

// PRIVACY: `manager` (mapped from a "Reports To Name" column) is grouped on
// and counted right here, in this Node script, and never leaves this
// variable scope — SPAN_OF_CONTROL below carries only the resulting
// averages/counts, never a manager's name or any per-manager breakdown.
let spanOfControl = { overallAvg: null, managerCount: 0, reportCount: 0, byDept: [] };

if (reportsPath) {
  const rep = readSheet(reportsPath, 'Employee Census Report');
  const repResult = ingest('employee_compass', rep.headers, rep.rows);
  console.log(`Reports-to census: read ${rep.rows.length} rows from sheet "${rep.sheetName}", mapped ${Object.keys(repResult.mapping.mapped).length}/${repResult.registry.fields.length} fields.`);
  const activeWithManager = repResult.records.filter((r) => r.position_status === 'active' && r.manager);
  if (!activeWithManager.length) {
    console.warn('  No active rows with a manager/"reports to" value found — Span of Control will be empty.');
  } else {
    const byManagerOverall = new Map();
    for (const r of activeWithManager) byManagerOverall.set(r.manager, (byManagerOverall.get(r.manager) || 0) + 1);
    const managerCount = byManagerOverall.size;
    const reportCount = activeWithManager.length;

    // By department: among active reports IN this department, group by their
    // manager and average the resulting group sizes. This is "how many
    // people in this department report to the same manager", on the
    // assumption (usually true) that a manager's reports mostly share their
    // department — not "the manager's own total headcount across all
    // departments", since we have no way to look up a manager's own
    // department from a name alone.
    const byDeptManagers = new Map(); // department -> Map(manager -> count)
    for (const r of activeWithManager) {
      if (!r.department) continue;
      if (!byDeptManagers.has(r.department)) byDeptManagers.set(r.department, new Map());
      const m = byDeptManagers.get(r.department);
      m.set(r.manager, (m.get(r.manager) || 0) + 1);
    }
    const byDept = [...byDeptManagers.entries()].map(([department, managers]) => {
      const counts = [...managers.values()];
      const reports = counts.reduce((a, b) => a + b, 0);
      return {
        department,
        avgDirectReports: Math.round((reports / counts.length) * 10) / 10,
        managerCount: counts.length,
        reportCount: reports,
      };
    }).sort((a, b) => b.reportCount - a.reportCount);

    spanOfControl = {
      overallAvg: Math.round((reportCount / managerCount) * 10) / 10,
      managerCount,
      reportCount,
      byDept,
    };
    console.log(`  Span of control: ${reportCount} active reports across ${managerCount} distinct managers (overall avg ${spanOfControl.overallAvg}), ${byDept.length} departments.`);
  }
}

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

// The standalone V&R dataset (see note above) — a separate, usually smaller
// and differently-dated population from RECORDS' terminations, never merged
// with them since there's no key to join on. Deliberately narrow: only the
// four fields needed for its own aggregate stats.
const vrOut = vrSeparations.map((v) => ({
  separation_date: v.termination_date instanceof Date ? toIso(v.termination_date) : null,
  separation_type: v.separation_type ?? v.termination_reason ?? null,
  voluntary_flag: v.voluntary_flag ?? null,
  regrettable_flag: v.regrettable_flag ?? null,
}));

const outPath = path.join(__dirname, '..', 'src', 'data.js');
const header = `// ============================================================================
// GENERATED by scripts/build-data.mjs from a real Employee Census export.
// Do not hand-edit. Re-run the script to refresh.
// ============================================================================
// RECORDS contains ONLY: department, work location, worker category,
// position status, contractor flag, annual salary, hire/rehire/termination
// dates, termination reason, and voluntary/regrettable flags. Job title was
// deliberately dropped too (see git history) — combined with department it
// could narrow a small team down to one identifiable person.
// No names, employee ids, or manager fields are present — those are
// stripped by this script before writing (see IDENTITY_FIELDS above) even
// though the census/termination/V&R exports it read from may carry them.
//
// VR_SEPARATIONS is a SEPARATE, standalone dataset from a V&R workbook that
// had no employee id or name to join onto RECORDS' terminations (see the
// note in this script) — a different, usually smaller and differently-dated
// population. Never combine its counts with RECORDS' termination counts as
// if they were the same population.
//
// SPAN_OF_CONTROL is computed from a census export with a "Reports To Name"
// column, grouped and counted in scripts/build-data.mjs and never carried
// past that script — only the resulting averages/counts are here, no
// manager names or per-manager rows. byDept's avgDirectReports means "among
// this department's active people, the average team size of the manager
// they report to" (see the script for why it's computed this way).
// ============================================================================
export const RECORDS = ${JSON.stringify(out, null, 2)};
export const VR_SEPARATIONS = ${JSON.stringify(vrOut, null, 2)};
export const SPAN_OF_CONTROL = ${JSON.stringify(spanOfControl, null, 2)};
`;
fs.writeFileSync(outPath, header);

console.log(`\nWrote ${out.length} records to ${outPath} (${roster.length} roster + ${terminations.length} termination rows read; ${droppedNoStart} dropped for no usable start date).`);
if (vrOut.length) console.log(`Also wrote ${vrOut.length} standalone VR_SEPARATIONS rows (not joined to RECORDS).`);
console.log('Identity fields stripped from every record:', IDENTITY_FIELDS.join(', '));
