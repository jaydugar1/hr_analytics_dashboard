/**
 * Exempt / Non-Exempt classification from the census WORKER CATEGORY field
 * (e.g. "S - Salary | Exempt", "N - Hourly | Non-Exempt"). Contractors,
 * interns, and anything else that doesn't say exempt/non-exempt fall into
 * "Other" rather than being guessed at.
 */
export function exemptStatus(workerCategory) {
  const s = String(workerCategory || '');
  if (/non-exempt/i.test(s)) return 'Non-Exempt';
  if (/exempt/i.test(s)) return 'Exempt';
  return 'Other';
}
