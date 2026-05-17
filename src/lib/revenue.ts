/**
 * Canonical revenue-band estimator — single source of truth so the list card,
 * customer-list sidebar, drawer, and table view never disagree.
 *
 * Order of preference:
 *   1. Crustdata-reported revenue (rev_higher_usd) when present — this is the
 *      real figure piped through `scripts/build-companies.ts`. We pick a band
 *      whose upper bound matches the Crustdata bracket (a $750M company sits
 *      in the "250M-1B" band, not "50-250M").
 *   2. Employees-derived fallback when Crustdata revenue is null. This is the
 *      legacy heuristic — rough pharma/manufacturing proxy.
 *
 * The "1B+ uncapped" sentinel from Crustdata (1e12) is clamped to 1e9 in
 * build-companies.ts, so anything ≥ 1e9 here means "1B+".
 */
export function revenueBand(
  employees: number | null | undefined,
  revLowerUsd: number | null | undefined,
  revHigherUsd: number | null | undefined,
): string {
  if (revHigherUsd != null) {
    if (revHigherUsd >= 1e9) return "1B+";
    if (revHigherUsd >= 2.5e8) return "250M-1B";
    if (revHigherUsd >= 5e7) return "50-250M";
    if (revHigherUsd >= 2e7) return "20-50M";
    if (revHigherUsd >= 5e6) return "5-20M";
    if (revHigherUsd >= 1e6) return "1-5M";
    // Fall through to employees-based fallback when revHigher is too small to
    // be meaningful (the subsidiary-misreport guard usually nulls these in
    // build-companies.ts, but defensively we still fall back here).
  }
  void revLowerUsd;
  if (employees == null) return "—";
  if (employees < 100) return "1-5M";
  if (employees < 500) return "5-20M";
  if (employees < 2000) return "20-50M";
  if (employees < 10000) return "50-250M";
  if (employees < 50000) return "250M-1B";
  return "1B+";
}

/** Numeric sort key — higher band = higher value. Matches `revenueBand`. */
export function revenueOrder(
  employees: number | null | undefined,
  revLowerUsd: number | null | undefined,
  revHigherUsd: number | null | undefined,
): number {
  if (revHigherUsd != null) {
    if (revHigherUsd >= 1e9) return 7;
    if (revHigherUsd >= 2.5e8) return 6;
    if (revHigherUsd >= 5e7) return 5;
    if (revHigherUsd >= 2e7) return 4;
    if (revHigherUsd >= 5e6) return 3;
    if (revHigherUsd >= 1e6) return 2;
  }
  void revLowerUsd;
  if (employees == null) return -1;
  if (employees < 100) return 2;
  if (employees < 500) return 3;
  if (employees < 2000) return 4;
  if (employees < 10000) return 5;
  if (employees < 50000) return 6;
  return 7;
}
