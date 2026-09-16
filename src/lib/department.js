/**
 * Display name for a department: strip the leading code.
 * "100011-Core Technology" -> "Core Technology"
 * "100009 - Member Services" -> "Member Services"
 * "HR - HR ONLY" -> "HR ONLY"; plain names are left alone.
 *
 * Ported from the main HR Dashboard Tool repo's src/lib/budget.js
 * (cleanDepartment) — extracted on its own here since the Compensation /
 * Budget page that file otherwise belongs to is out of scope for this
 * static build.
 */
export function cleanDepartment(name) {
  if (name == null) return null;
  const original = String(name).replace(/\s+/g, ' ').trim();
  if (!original) return null;
  const stripped = original
    .replace(/^\d[\dA-Za-z]*\s*[-–—]\s*/, '')
    .replace(/^[A-Z]{2,5}\s*[-–—]\s*/, '');
  return stripped.trim() || original;
}
