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
import { cleanDepartment } from '../src/lib/department.js';

// Department consolidation mapping (Head of HR's Span of Control runbook,
// 9/15/2026 census cycle). Applied to the CLEANED (numeric-code-stripped)
// HOME DEPARTMENT name. Anything not listed here passes through unchanged.
// "Member Services" is included alongside the two Cancer Care departments
// the runbook's table lists, because the runbook's prose says "Member
// Services -> renamed to Conversion" and Member Services is overwhelmingly
// the largest department in this census -- almost certainly the department
// the runbook's "Conversion" figures are describing. Confirm with HR if the
// resulting Conversion number looks off.
const DEPT_CONSOLIDATION = {
  'Member Services': 'Conversion',
  'Cancer Care Direct Delivery': 'Conversion',
  'Cancer Care Direct Support': 'Conversion',
  'Engineering': 'Technology',
  'Core Technology': 'Technology',
  'Data Management': 'Technology',
  'Accounting': 'CFO Organization',
  'FP&A and Analytics': 'CFO Organization',
  'Legal': 'CFO Organization',
  'Information Security': 'CFO Organization',
  'Network Development': 'Provider',
  'Claims and Network Experience': 'Provider',
  'Operational Excellence': 'Provider',
  'Commercial Enablement & Operations': 'Marketing',
  'Product': 'Marketing',
};

// KNOWN GAP (see memory/span-of-control-methodology.md and the README):
// the runbook also calls for (a) a new "Activation" department carved out of
// David Huck's entire recursive downstream org plus a few named leaders'
// downstreams, and (b) several NAMED INDIVIDUALS from Product going to
// specific departments other than Marketing (Claire Cunningham -> Conversion,
// Timothy Frierdich -> Provider, etc.). Neither is computable from this
// census export: it has a "Reports To Name" column (who manages a row) but
// NO column for the row's OWN name, so we can count direct reports of a
// named manager but can't identify "which row is Claire Cunningham" to
// relabel her, nor recurse past one level to find a manager's reports'
// reports. Product is therefore left folded into Marketing (the base-case
// rule) and there is no Activation department here -- both are expected,
// documented mismatches versus HR's reference figures, not bugs.
function consolidateDepartment(raw) {
  const cleaned = cleanDepartment(raw);
  if (!cleaned) return cleaned;
  return DEPT_CONSOLIDATION[cleaned] || cleaned;
}

// Technology contractor adjustment (runbook §8): the census is FTE-only,
// and Technology carries 66 contractors the census doesn't capture, assumed
// to distribute evenly across Technology's managers.
const TECHNOLOGY_CONTRACTORS = 66;
const SPAN_TARGET = 7;

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
let spanOfControl = { overallAvg: null, overallAvgWithContractors: null, managerCount: 0, reportCount: 0, target: SPAN_TARGET, byDept: [] };

// PRIVACY: everything in this block that touches a name (LEGAL LAST/FIRST
// NAME, PREFERRED NAME, REPORTS TO NAME) lives ONLY in these local
// variables inside this Node script. Not one name is ever written to
// SPAN_OF_CONTROL, logged in a way that ends up in a file, or otherwise
// leaves this function — only aggregate counts/averages do.
function headerKey(headers, wanted) {
  const norm = wanted.trim().toLowerCase();
  return headers.find((h) => h.trim().toLowerCase() === norm) || null;
}

// Head of HR's manager-matching algorithm (runbook §4): REPORTS TO NAME is
// "Last,First..." and often carries a middle name the employee's own row
// doesn't, so a naive exact-string match drops hundreds of reporting lines.
// Match on last name + first TOKEN of the "First..." part instead, checking
// both legal and preferred first names as candidates.
function buildNameIndex(people) {
  const byLast = new Map(); // lowercased last name -> [{ i, variants: Set<string> }]
  for (const p of people) {
    if (!p.lastName) continue;
    const key = p.lastName.toLowerCase();
    const variants = new Set();
    if (p.firstName) variants.add(p.firstName.toLowerCase());
    if (p.preferredFirst) variants.add(p.preferredFirst.toLowerCase());
    if (!byLast.has(key)) byLast.set(key, []);
    byLast.get(key).push({ i: p.i, variants });
  }
  return byLast;
}

function matchManagerIndex(byLast, reportsTo) {
  if (!reportsTo) return null;
  const commaIdx = reportsTo.indexOf(',');
  if (commaIdx === -1) return null;
  const last = reportsTo.slice(0, commaIdx).trim().toLowerCase();
  const firstToken = reportsTo.slice(commaIdx + 1).trim().split(/\s+/)[0]?.toLowerCase();
  const candidates = byLast.get(last);
  if (!candidates || !candidates.length) return null;
  if (firstToken) {
    const hit = candidates.find((c) => c.variants.has(firstToken));
    if (hit) return hit.i;
  }
  return candidates[0].i; // multiple/no first-name hit -> take the first, per runbook
}

function findPerson(byLast, lastName, ...firstNameOptions) {
  const candidates = byLast.get(lastName.toLowerCase());
  if (!candidates) return null;
  for (const fn of firstNameOptions) {
    const hit = candidates.find((c) => c.variants.has(fn.toLowerCase()));
    if (hit) return hit.i;
  }
  return null;
}

if (reportsPath) {
  const rep = readSheet(reportsPath, 'Employee Census Report');
  const repResult = ingest('employee_compass', rep.headers, rep.rows);
  console.log(`Reports-to census: read ${rep.rows.length} rows from sheet "${rep.sheetName}", mapped ${Object.keys(repResult.mapping.mapped).length}/${repResult.registry.fields.length} fields.`);

  // Raw column pulls the registry won't map (its NAME_DECOYS guard
  // deliberately excludes "preferred"/"chosen" columns from full_name, to
  // avoid the main app's uploader misreading them as an employee's legal
  // name) — read directly by header text instead, index-aligned with
  // repResult.records since ingest()/applyMapping() is a 1:1 rows.map().
  const lastKey = headerKey(rep.headers, 'LEGAL LAST NAME');
  const firstKey = headerKey(rep.headers, 'LEGAL FIRST NAME');
  const preferredKey = headerKey(rep.headers, 'PREFERRED OR CHOSEN FIRST NAME');

  const people = repResult.records.map((r, i) => ({
    i,
    lastName: lastKey ? String(rep.rows[i][lastKey] || '').trim() : '',
    firstName: firstKey ? String(rep.rows[i][firstKey] || '').trim() : '',
    preferredFirst: preferredKey ? String(rep.rows[i][preferredKey] || '').trim() : '',
    reportsTo: r.manager || '',
    department: r.department,
    active: r.position_status === 'active',
  }));

  if (!lastKey || !firstKey) {
    console.warn('  This export has no employee-name column — falling back to exact REPORTS TO NAME matching (see the prior version of this script) with no Activation/Product carve-out.');
  }

  const byLast = buildNameIndex(people);
  for (const p of people) p.managerIndex = matchManagerIndex(byLast, p.reportsTo);

  const withReportsTo = people.filter((p) => p.reportsTo).length;
  const unresolved = people.filter((p) => p.reportsTo && p.managerIndex == null).length;
  console.log(`  Manager matching: ${withReportsTo - unresolved} of ${withReportsTo} "reports to" values resolved to a row (${unresolved} unresolved — expected for people managed by someone above the roster, e.g. the CEO).`);

  // children map, for the recursive Activation downstream walk (runbook §7)
  const childrenOf = new Map(); // managerIndex -> [reportIndex, ...]
  for (const p of people) {
    if (p.managerIndex == null) continue;
    if (!childrenOf.has(p.managerIndex)) childrenOf.set(p.managerIndex, []);
    childrenOf.get(p.managerIndex).push(p.i);
  }
  function downstreamOf(rootIndex) {
    const seen = new Set();
    const queue = [rootIndex];
    while (queue.length) {
      const cur = queue.shift();
      for (const k of childrenOf.get(cur) || []) {
        if (!seen.has(k)) { seen.add(k); queue.push(k); }
      }
    }
    return seen;
  }

  // ---- base consolidated department, before the Activation/Product carve-out
  for (const p of people) p.finalDept = consolidateDepartment(p.department);

  // ---- Activation carve-out (runbook §7): David Huck's full recursive
  // downstream org, plus a few other named leaders and THEIR downstreams.
  // Only attempted when we actually have name data to resolve these people.
  let activationResolved = false;
  if (lastKey && firstKey) {
    const activationLeaders = [
      ['Huck', ['David', 'Dave']],
      ['Stroik', ['Jennifer']],
      ['Prickel', ['Kasey']],
      ['Zysset', ['Maureen']],
      ['Henley', ['Irene']],
    ];
    const activationSet = new Set();
    let leadersFound = 0;
    for (const [last, firsts] of activationLeaders) {
      const idx = findPerson(byLast, last, ...firsts);
      if (idx == null) continue;
      leadersFound++;
      activationSet.add(idx);
      for (const d of downstreamOf(idx)) activationSet.add(d);
    }
    if (leadersFound > 0) {
      for (const idx of activationSet) people[idx].finalDept = 'Activation';
      activationResolved = true;
      console.log(`  Activation carve-out: resolved ${leadersFound}/${activationLeaders.length} named leaders, ${activationSet.size} people moved to Activation.`);
    } else {
      console.log('  Activation carve-out: none of the named leaders resolved in this export — skipping (Product/Activation stay at their base mapping).');
    }

    // ---- Product Leadership Transition named-individual overrides (§7).
    // Applied AFTER Activation so these explicit destinations always win
    // (e.g. Claire Cunningham must land in Conversion, never Activation,
    // even though her name is unrelated to any Activation leader here).
    const amyBrown = findPerson(byLast, 'Brown', 'Amy');
    const jenniferStroik = findPerson(byLast, 'Stroik', 'Jennifer');
    if (amyBrown != null && jenniferStroik != null) {
      // her role was eliminated; her direct reports move to Jennifer Stroik
      for (const p of people) if (p.managerIndex === amyBrown) p.managerIndex = jenniferStroik;
      people[amyBrown].excluded = true; // role eliminated -> not counted as a manager or report
    }
    const claire = findPerson(byLast, 'Cunningham', 'Claire');
    if (claire != null) {
      people[claire].finalDept = 'Conversion';
      for (const d of childrenOf.get(claire) || []) people[d].finalDept = 'Conversion';
    }
    const overrides = [
      ['Frierdich', ['Timothy'], 'Provider'],
      ['Barber', ['Elizabeth', 'Lizzy'], 'Client Success'],
      ['Cotten', ['Courtny'], 'Client Success'],
      ['Miller', ['Kelly'], 'Executive'],
      ['Wang', ['Guan'], 'Executive'],
      ['Bard', ['Spencer'], 'Activation'],
      ['Copper', ['Hope'], 'Activation'],
    ];
    let overridesResolved = 0;
    for (const [last, firsts, dept] of overrides) {
      const idx = findPerson(byLast, last, ...firsts);
      if (idx == null) continue;
      people[idx].finalDept = dept;
      overridesResolved++;
    }
    console.log(`  Product transition overrides: resolved ${overridesResolved}/${overrides.length} named individuals${claire != null ? ' + Claire Cunningham' : ''}${amyBrown != null ? ' + Amy Brown role elimination' : ''}.`);
  }

  const activeWithManager = people.filter((p) => p.active && !p.excluded && p.managerIndex != null);
  if (!activeWithManager.length) {
    console.warn('  No active rows with a resolved manager found — Span of Control will be empty.');
  } else {
    const byManagerOverall = new Map();
    for (const p of activeWithManager) byManagerOverall.set(p.managerIndex, (byManagerOverall.get(p.managerIndex) || 0) + 1);
    const managerCount = byManagerOverall.size;
    const reportCount = activeWithManager.length;

    // By department: among active reports IN this (consolidated, carved-out)
    // department, group by their manager and average the resulting group
    // sizes — "how many people in this department report to the same
    // manager." See the comment on consolidateDepartment/DEPT_CONSOLIDATION
    // above for the mapping and its documented gaps.
    const byDeptManagers = new Map(); // department -> Map(managerIndex -> count)
    for (const p of activeWithManager) {
      const dept = p.finalDept;
      if (!dept) continue;
      if (!byDeptManagers.has(dept)) byDeptManagers.set(dept, new Map());
      const m = byDeptManagers.get(dept);
      m.set(p.managerIndex, (m.get(p.managerIndex) || 0) + 1);
    }
    const byDept = [...byDeptManagers.entries()].map(([department, managers]) => {
      const counts = [...managers.values()];
      const reports = counts.reduce((a, b) => a + b, 0);
      const row = {
        department,
        avgDirectReports: Math.round((reports / counts.length) * 10) / 10,
        managerCount: counts.length,
        reportCount: reports,
      };
      // Technology contractor adjustment (runbook §8): the census is
      // FTE-only, so add the known contractor headcount on top, assumed to
      // distribute evenly across Technology's managers.
      if (department === 'Technology') {
        row.avgDirectReportsAdjusted = Math.round(((reports + TECHNOLOGY_CONTRACTORS) / counts.length) * 10) / 10;
        row.contractorsAdded = TECHNOLOGY_CONTRACTORS;
      }
      return row;
    }).sort((a, b) => b.reportCount - a.reportCount);

    spanOfControl = {
      overallAvg: Math.round((reportCount / managerCount) * 10) / 10,
      overallAvgWithContractors: Math.round(((reportCount + TECHNOLOGY_CONTRACTORS) / managerCount) * 10) / 10,
      managerCount,
      reportCount,
      target: SPAN_TARGET,
      activationResolved,
      byDept,
    };
    console.log(`  Span of control: ${reportCount} active reports across ${managerCount} distinct managers (overall avg ${spanOfControl.overallAvg}, ${spanOfControl.overallAvgWithContractors} incl. contractors), ${byDept.length} consolidated departments.`);
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
