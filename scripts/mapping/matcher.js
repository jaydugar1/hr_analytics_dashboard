/**
 * Header Matcher — MAPPING_SPEC.md §2 (+ v2 amendments for wide HRIS exports)
 *
 * Maps raw file headers → canonical fields by NAME SIMILARITY, never position.
 * Tiers (first hit wins): exact synonym (1.0) → token-set Jaccard (≥0.6)
 * → fuzzy Jaro-Winkler (≥0.85). One raw column per canonical field.
 *
 * v2 amendments (driven by real 319-column ADP census exports):
 * - Synonym order = priority. Two exact matches for one field (e.g.
 *   "ASSOCIATE ID" vs "FILE NUMBER") auto-resolve to the higher-priority
 *   synonym instead of flagging a tie — the registry documents the preference.
 * - Unmapped columns are informational, not review-blocking. Only "suspect"
 *   columns — near-misses whose target field is unmapped or weakly mapped —
 *   demand review. A benefits export's 290 extra columns never block apply.
 */

const NOISE_TOKENS = new Set(['code', 'desc', 'description', '#', 'no', 'num']);

export function normalizeHeader(h) {
  return String(h ?? '')
    .toLowerCase()
    .replace(/[_\-./\\()\[\]:,'"&|]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(s, dropNoise = false) {
  const t = normalizeHeader(s).split(' ').filter(Boolean);
  return dropNoise ? t.filter((x) => !NOISE_TOKENS.has(x)) : t;
}

export function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  if (!len1 || !len2) return 0;
  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const m1 = new Array(len1).fill(false);
  const m2 = new Array(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const lo = Math.max(0, i - matchWindow);
    const hi = Math.min(len2 - 1, i + matchWindow);
    for (let j = lo; j <= hi; j++) {
      if (!m2[j] && s1[i] === s2[j]) { m1[i] = true; m2[j] = true; matches++; break; }
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < len1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  const jaro = (matches / len1 + matches / len2 + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, len1, len2); i++) {
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Best confidence of one raw header against one field.
 * Returns {score, tier, synIndex} — synIndex is the position of the matched
 * synonym in the field's list (0 = highest priority) for tie-breaking.
 */
export function scoreHeaderAgainstField(rawHeader, field) {
  const norm = normalizeHeader(rawHeader);
  // registry-declared decoys: columns this field must NEVER claim
  // (e.g. LEGAL MIDDLE NAME looks fuzzy-close to "legal name" but isn't one)
  if (field.exclude && field.exclude.test(norm)) return { score: 0, tier: 'none', synIndex: -1 };
  const rawToks = tokens(rawHeader);
  const rawToksClean = tokens(rawHeader, true);
  const syns = [field.key.replace(/_/g, ' '), ...field.synonyms];
  let best = { score: 0, tier: 'none', synIndex: -1 };

  for (let si = 0; si < syns.length; si++) {
    const synNorm = normalizeHeader(syns[si]);
    // Tier 2: exact synonym match — first (highest-priority) exact wins outright
    if (norm === synNorm) return { score: 1.0, tier: 'exact', synIndex: si };
    // Tier 3: token-set Jaccard (noise tokens dropped at tie-break)
    const j = Math.max(
      jaccard(rawToks, tokens(syns[si])),
      jaccard(rawToksClean, tokens(syns[si], true))
    );
    if (j >= 0.6 && j > best.score) best = { score: j, tier: 'jaccard', synIndex: si };
    // Tier 4: fuzzy Jaro-Winkler on the normalized whole strings
    const f = jaroWinkler(norm, synNorm);
    if (f >= 0.85 && f > best.score) best = { score: f, tier: 'fuzzy', synIndex: si };
  }
  return best;
}

/** Stable fingerprint: hash of sorted normalized headers (FNV-1a). */
export function fileFingerprint(rawHeaders) {
  const s = rawHeaders.map(normalizeHeader).sort().join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const TIE_EPSILON = 0.03;

/**
 * Match raw headers against a registry. Returns a MappingResult (§3),
 * minus valueWarnings (added when rows are parsed in mapper.js).
 */
export function matchHeaders(rawHeaders, registry) {
  // score every (header, field) pair
  const candidates = []; // {header, key, score, tier, synIndex}
  for (const header of rawHeaders) {
    for (const field of registry.fields) {
      const c = scoreHeaderAgainstField(header, field);
      if (c.tier !== 'none') candidates.push({ header, key: field.key, ...c });
    }
  }
  // highest confidence first; equal scores resolve by synonym priority,
  // then by header order in the file (deterministic)
  candidates.sort((a, b) =>
    b.score - a.score ||
    a.synIndex - b.synIndex ||
    rawHeaders.indexOf(a.header) - rawHeaders.indexOf(b.header)
  );

  const mapped = {};          // canonicalKey -> {rawHeader, confidence, tier}
  const usedHeaders = new Set();
  const lowConfidence = new Set();

  // greedy: best candidate wins; loser falls back to its next candidate
  for (const c of candidates) {
    if (mapped[c.key] || usedHeaders.has(c.header)) continue;
    // genuine tie: another unused header scores within epsilon for this field
    // at the SAME synonym priority — priority-resolved ties are not flagged
    const rivals = candidates.filter(
      (o) => o.key === c.key && o.header !== c.header && !usedHeaders.has(o.header) &&
             Math.abs(o.score - c.score) < TIE_EPSILON && o.synIndex <= c.synIndex
    );
    mapped[c.key] = { rawHeader: c.header, confidence: Number(c.score.toFixed(3)), tier: c.tier };
    usedHeaders.add(c.header);
    // ambiguity or sub-0.85 non-exact score → needs human confirmation
    if (rivals.length > 0 || (c.tier !== 'exact' && c.score < 0.85)) lowConfidence.add(c.key);
  }

  const unmappedColumns = rawHeaders.filter((h) => !usedHeaders.has(h));

  // suspect columns: unmapped near-misses whose target field is itself
  // unmapped or only weakly mapped — these deserve a human look. Columns
  // whose target already has an exact/confirmed winner are plain leftovers.
  const suspectColumns = [];
  for (const h of unmappedColumns) {
    const near = candidates
      .filter((c) => c.header === h && c.score >= 0.6)
      .sort((a, b) => b.score - a.score)[0];
    if (!near) continue;
    const winner = mapped[near.key];
    if (!winner || winner.tier === 'jaccard' || winner.tier === 'fuzzy') {
      suspectColumns.push({ header: h, candidateField: near.key, score: Number(near.score.toFixed(3)) });
    }
  }

  const result = {
    dataset: registry.dataset,
    fileFingerprint: fileFingerprint(rawHeaders),
    mapped,
    missingRequired: [],
    missingOptional: [],
    unmappedColumns,
    suspectColumns,
    lowConfidence: [...lowConfidence],
    valueWarnings: [],
  };
  recomputeMissing(result, registry);
  return result;
}

/**
 * Recompute missingRequired/missingOptional. A required field satisfied by
 * alternatives (e.g. full_name via last_name + first_name) is not missing.
 */
export function recomputeMissing(result, registry) {
  const alts = registry.requiredAlternatives || {};
  result.missingRequired = [];
  result.missingOptional = [];
  for (const field of registry.fields) {
    if (result.mapped[field.key]) continue;
    if (field.required) {
      const alt = alts[field.key];
      if (alt && alt.every((k) => result.mapped[k])) continue; // satisfied by alternatives
      result.missingRequired.push(field.key);
    } else {
      result.missingOptional.push(field.key);
    }
  }
}
