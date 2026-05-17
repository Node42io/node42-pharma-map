import type { Company, Filters, Tier } from "./types";
import { coreNaics } from "./naics";

export function applyFilters(rows: Company[], f: Filters): Company[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q) {
      const hay = [r.name, r.city, r.country, r.industry, r.description, r.buildSignal, ...(r.oncologyTags ?? []), ...(r.buckets ?? [])]
        .join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.buckets.length && !f.buckets.some((b) => r.buckets?.includes(b))) return false;
    if (f.oncologyTags.length && !f.oncologyTags.some((t) => r.oncologyTags?.includes(t))) return false;
    if (f.countries.length && !f.countries.includes(r.country)) return false;
    if (f.employeesMin != null && (r.employees ?? 0) < f.employeesMin) return false;
    if (f.employeesMax != null && (r.employees ?? Number.MAX_SAFE_INTEGER) > f.employeesMax) return false;
    if (f.status.length && !f.status.includes(r.status)) return false;
    if (f.tiers.length && !f.tiers.includes(r.tier as Tier)) return false;
    if (f.naicsGroups.length && !f.naicsGroups.includes(coreNaics(r).code)) return false;
    if (f.hasBuildSignal) {
      const hasSignal =
        !!r.buildSignal?.trim() ||
        r.growth12mPct != null ||
        !!r.lastFundingRound?.trim();
      if (!hasSignal) return false;
    }
    return true;
  });
}

export function uniqueValues<T extends keyof Company>(rows: Company[], key: T): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (Array.isArray(v)) for (const x of v) if (x) set.add(String(x));
    else if (v) set.add(String(v));
  }
  return [...set].sort();
}

export function countByValue<T extends keyof Company>(rows: Company[], key: T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const v = r[key];
    if (Array.isArray(v)) for (const x of v) if (x) out[String(x)] = (out[String(x)] ?? 0) + 1;
    else if (v) out[String(v)] = (out[String(v)] ?? 0) + 1;
  }
  return out;
}
