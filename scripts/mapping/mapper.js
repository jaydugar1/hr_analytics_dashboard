/**
 * Row mapper — MAPPING_SPEC.md §3–§4
 *
 * Applies a MappingResult to raw rows, producing canonical records.
 * Graceful degradation: a field that fails to parse becomes null plus a
 * value warning — the ROW IS KEPT. The dashboard never sees raw columns.
 */

import { registryWithSynonyms } from './registry.js';
import { matchHeaders, recomputeMissing } from './matcher.js';

/**
 * Parse raw rows into canonical records using a mapping.
 * @param rows      array of objects keyed by raw header
 * @param mapping   MappingResult from matchHeaders (or a confirmed override)
 * @param registry  the dataset registry
 * @returns { records, valueWarnings }  — warnings aggregated {field, value, rows}
 */
export function applyMapping(rows, mapping, registry) {
  const warningCounts = new Map(); // "field\u0000value" -> count
  const records = rows.map((row) => {
    const rec = {};
    for (const field of registry.fields) {
      const m = mapping.mapped[field.key];
      if (!m) { rec[field.key] = null; continue; }
      const raw = row[m.rawHeader];
      const parsed = field.parse ? field.parse(raw) : raw;
      if (parsed === undefined) {
        // parse failure → null + value warning, row kept (§4)
        rec[field.key] = null;
        const k = field.key + '\u0000' + String(raw);
        warningCounts.set(k, (warningCounts.get(k) || 0) + 1);
      } else if (parsed && typeof parsed === 'object' && !(parsed instanceof Date)) {
        // enum result {value, raw, unrecognized?}
        rec[field.key] = parsed.value;
        rec[field.key + '_raw'] = parsed.raw;
        if (parsed.unrecognized) {
          const k = field.key + '\u0000' + parsed.raw;
          warningCounts.set(k, (warningCounts.get(k) || 0) + 1);
        }
      } else {
        rec[field.key] = parsed;
      }
    }
    // fill composite fields (full_name from last/first, contractor flag…)
    return registry.derive ? registry.derive(rec) : rec;
  });

  const valueWarnings = [...warningCounts.entries()].map(([k, count]) => {
    const [field, value] = k.split('\u0000');
    return { field, value, rows: count };
  }).sort((a, b) => b.rows - a.rows);

  return { records, valueWarnings };
}

/**
 * Full pipeline for one parsed file: match headers → apply rows.
 * `options.confirmedMapping` (canonicalKey -> rawHeader) applies remembered or
 * admin-confirmed mappings, clearing those keys from lowConfidence.
 * `options.learnedSynonyms` (canonicalKey -> string[]) extends the registry.
 */
export function ingest(dataset, headers, rows, options = {}) {
  const registry = registryWithSynonyms(dataset, options.learnedSynonyms || {});
  const result = matchHeaders(headers, registry);

  if (options.confirmedMapping) {
    for (const [key, rawHeader] of Object.entries(options.confirmedMapping)) {
      if (rawHeader === null) {
        // admin explicitly unmapped this field
        delete result.mapped[key];
        continue;
      }
      if (!headers.includes(rawHeader)) continue; // header gone — fall back to matcher
      // release any field currently holding this header
      for (const [k, m] of Object.entries(result.mapped)) {
        if (k !== key && m.rawHeader === rawHeader) delete result.mapped[k];
      }
      result.mapped[key] = { rawHeader, confidence: 1.0, tier: 'confirmed' };
    }
    result.lowConfidence = result.lowConfidence.filter((k) => !(k in options.confirmedMapping));
    recomputeMissing(result, registry);
    const used = new Set(Object.values(result.mapped).map((m) => m.rawHeader));
    result.unmappedColumns = headers.filter((h) => !used.has(h));
    result.suspectColumns = result.suspectColumns.filter(
      (s) => !used.has(s.header) && !(s.candidateField in options.confirmedMapping)
    );
  }

  const { records, valueWarnings } = applyMapping(rows, result, registry);
  result.valueWarnings = valueWarnings;
  return { mapping: result, records, registry };
}

/**
 * Ingest with mapping memory, self-healing (§5, v2):
 * a remembered confirmation is only honored when it is at least as good as a
 * fresh match — same or fewer missing required fields AND same or more mapped
 * fields. A poisoned memory (a bad manual remap confirmed once) must never
 * silently degrade every future upload of that file shape.
 *
 * Returns { mapping, records, registry, usedMemory }.
 */
export function ingestWithMemory(dataset, headers, rows, memory, fingerprint) {
  const learnedSynonyms = memory.learnedSynonyms(dataset);
  const fresh = ingest(dataset, headers, rows, { learnedSynonyms });
  const remembered = memory.recallExact(dataset, fingerprint);
  if (!remembered) return { ...fresh, usedMemory: false };

  const withMem = ingest(dataset, headers, rows, { confirmedMapping: remembered, learnedSynonyms });
  const memOk =
    withMem.mapping.missingRequired.length <= fresh.mapping.missingRequired.length &&
    Object.keys(withMem.mapping.mapped).length >= Object.keys(fresh.mapping.mapped).length;
  return memOk ? { ...withMem, usedMemory: true } : { ...fresh, usedMemory: false };
}

/**
 * Does the mapping need human review before apply? (§6.2, v2)
 * Genuine ambiguity or missing required data — plain extra columns never
 * block an apply (a 319-column census would otherwise always prompt).
 */
export function needsReview(mapping) {
  return mapping.lowConfidence.length > 0 ||
         mapping.missingRequired.length > 0 ||
         (mapping.suspectColumns || []).length > 0;
}

/** Compact badge text, e.g. "9/9 fields mapped" or "7/9 mapped · 2 warnings" (§6.3) */
export function mappingBadge(mapping, totalFields) {
  const mappedCount = Object.keys(mapping.mapped).length;
  const warnings =
    mapping.missingRequired.length +
    mapping.lowConfidence.length +
    (mapping.suspectColumns || []).length +
    mapping.valueWarnings.length;
  return warnings === 0
    ? `${mappedCount}/${totalFields} fields mapped`
    : `${mappedCount}/${totalFields} mapped · ${warnings} warning${warnings === 1 ? '' : 's'}`;
}

/**
 * A census export carries roster AND termination data on the same rows.
 * Split canonical census records into the two datasets the dashboard uses:
 * roster (non-terminated) and termination records (terminated rows).
 */
export function splitCensusRecords(records) {
  const roster = [];
  const terminations = [];
  for (const rec of records) {
    const terminated = rec.position_status === 'terminated' ||
      (rec.position_status == null && rec.termination_date != null);
    if (terminated) {
      terminations.push(rec);
    } else {
      roster.push(rec);
    }
  }
  return { roster, terminations };
}

/** Does this mapping look like a full census (roster + termination dates)? */
export function isCensusShape(mapping) {
  return !!(mapping.mapped.position_status && mapping.mapped.termination_date);
}
