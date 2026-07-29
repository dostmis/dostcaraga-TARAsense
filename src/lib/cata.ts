/**
 * Shared CATA (Check-All-That-Apply) response helpers, used by both the web
 * (`response-actions.ts`) and mobile (`consumer-response.ts`) submit paths.
 *
 * CATA terms are configured on the study and stored in `Study.targetDemographics`
 * JSON under `cataTerms`; a panelist's per-sample selections ride inside the
 * `SensoryResponse.data` JSON under `cataSelections`.
 */

/**
 * Response key holding the selected CATA terms for a sample inside the
 * test-interface's per-sample response map / draft. CATA selections are
 * submitted separately (as `cataSelections`), so this key must be stripped from
 * the attribute payload and skipped by attribute validators.
 */
export const CATA_RESPONSE_KEY = "__cata__";

export interface CataSelectionInput {
  sampleNumber: number;
  terms: string[];
}

/** Canonical, deduped CATA terms configured on the study (from targetDemographics). */
export function resolveStudyCataTerms(targetDemographics: unknown): string[] {
  if (!targetDemographics || typeof targetDemographics !== "object") {
    return [];
  }
  const raw = (targetDemographics as { cataTerms?: unknown }).cataTerms;
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const value = entry.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(value);
  }
  return terms;
}

/**
 * Validate a panelist's CATA selections against the study's terms and sample
 * count: drop out-of-range samples, keep only configured terms (canonicalized,
 * deduped). Empty term arrays are preserved ("none apply" is a valid answer).
 */
export function normalizeCataSelections(
  selections: CataSelectionInput[] | undefined,
  cataTerms: string[],
  sampleCount: number
): CataSelectionInput[] {
  if (!selections || cataTerms.length === 0) {
    return [];
  }
  const termByLower = new Map(cataTerms.map((term) => [term.toLowerCase(), term]));
  const bySample = new Map<number, string[]>();
  for (const entry of selections) {
    if (!Number.isInteger(entry.sampleNumber) || entry.sampleNumber < 1 || entry.sampleNumber > sampleCount) {
      continue;
    }
    const seen = new Set<string>();
    const terms: string[] = [];
    for (const term of entry.terms) {
      const canonical = termByLower.get(term.trim().toLowerCase());
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      terms.push(canonical);
    }
    bySample.set(entry.sampleNumber, terms);
  }
  return Array.from(bySample.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([sampleNumber, terms]) => ({ sampleNumber, terms }));
}
