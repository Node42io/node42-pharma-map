import type { Company } from "./types";

/**
 * Core NAICS group derivation for pharma companies.
 *
 * Each group is keyed by its NAICS code (string) so filter state stays a plain
 * string[]. `label` is the human-readable short label used in the table; `group`
 * is the full descriptor used in the FilterPanel list.
 */
export type NaicsGroup = {
  code: string;
  label: string;
  group: string;
};

export const NAICS_GROUPS: NaicsGroup[] = [
  {
    code: "325412",
    label: "325412 — Pharmaceutical Manufacturing",
    group: "325412 — Pharmaceutical Preparation Manufacturing",
  },
  {
    code: "325414",
    label: "325414 — Biological Products",
    group: "325414 — Biological Product (except Diagnostic) Manufacturing",
  },
  {
    code: "541714",
    label: "541714 — R&D Biotechnology",
    group: "541714 — Research and Development in Biotechnology",
  },
  {
    code: "541715",
    label: "541715 — R&D Life Sciences",
    group: "541715 — R&D in Physical, Engineering, and Life Sciences",
  },
  {
    code: "325413",
    label: "325413 — In-Vitro Diagnostics",
    group: "325413 — In-Vitro Diagnostic Substance Manufacturing",
  },
  {
    code: "339113",
    label: "339113 — Medical Instruments",
    group: "339113 — Surgical Appliance / Medical Instrument Manufacturing",
  },
  {
    code: "423450",
    label: "423450 — Medical Wholesale",
    group: "423450 — Medical Equipment Wholesalers",
  },
  {
    code: "other",
    label: "Other",
    group: "Other",
  },
];

const GROUP_BY_CODE: Record<string, NaicsGroup> = Object.fromEntries(
  NAICS_GROUPS.map((g) => [g.code, g]),
);

/**
 * Derive the canonical NAICS group for a Company from its buckets/industry.
 *
 * Decision order (first match wins):
 *  1. Diagnostics signal in industry  → 325413
 *  2. Medical-device/surgical signal  → 339113
 *  3. Wholesale/distribution signal   → 423450
 *  4. Biotech buckets/industry        → 325414
 *  5. Pharma manufacturing buckets    → 325412
 *  6. Bioprocess vendors              → 541714 (R&D biotech tooling)
 *  7. Academic GMP / pure research    → 541714 / 541715
 *  8. Fallback                        → other
 */
export function coreNaics(c: Company): NaicsGroup {
  const buckets = (c.buckets ?? []).map((b) => b.toLowerCase());
  const industry = (c.industry ?? "").toLowerCase();

  const has = (b: string) => buckets.includes(b);
  const ind = (s: string) => industry.includes(s);

  // 1. Diagnostics
  if (ind("diagnostic") || ind("in-vitro") || ind("in vitro")) {
    return GROUP_BY_CODE["325413"];
  }

  // 2. Medical devices / surgical instruments
  if (ind("medical device") || ind("surgical") || ind("medical instrument")) {
    return GROUP_BY_CODE["339113"];
  }

  // 3. Wholesale / distribution
  if (ind("wholesale") || ind("distribut")) {
    return GROUP_BY_CODE["423450"];
  }

  // 4. Biotech — ATMP/cell/gene, late-stage biotech, biotech research bucket, plasma
  if (
    has("atmp_cell_gene") ||
    has("late_stage_biotech") ||
    has("plasma_fractionation") ||
    has("biotech_research") ||
    ind("biotech") ||
    ind("biologic") ||
    ind("mrna") ||
    ind("viral vector") ||
    ind("cell ") ||
    ind("gene therapy")
  ) {
    return GROUP_BY_CODE["325414"];
  }

  // 5. Pharma preparation manufacturing — originators/generics/vaccines/CDMO/specialty/vet/cannabis/oncology
  if (
    has("originator_pharma") ||
    has("sterile_generics") ||
    has("vaccines") ||
    has("cdmo_classic") ||
    has("specialty_orphan") ||
    has("oncology_hpapi") ||
    has("veterinary_pharma") ||
    has("medical_cannabis") ||
    ind("pharmaceutical")
  ) {
    return GROUP_BY_CODE["325412"];
  }

  // 6. Bioprocess vendors — tooling/equipment for biotech R&D
  if (has("bioprocess_vendors")) {
    return GROUP_BY_CODE["541714"];
  }

  // 7. Academic GMP / research-only
  if (has("academic_gmp") || ind("research") || ind("r&d")) {
    return ind("biotech") || ind("biologic")
      ? GROUP_BY_CODE["541714"]
      : GROUP_BY_CODE["541715"];
  }

  return GROUP_BY_CODE["other"];
}

export function naicsGroupByCode(code: string): NaicsGroup | undefined {
  return GROUP_BY_CODE[code];
}
