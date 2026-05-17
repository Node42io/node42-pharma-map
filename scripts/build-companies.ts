import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { backupCompaniesJson } from "../src/lib/backup";

type EnrichedRow = {
  name: string;
  country: string;
  city: string;
  employees: string;
  bucket: string;
  source: string;
  specialty: string;
  build_signal: string;
  source_url: string;
  oncology_tags: string;
  tier: string;
  score: string;
  score_breakdown: string;
  exclusion_reason: string;
  growth_12m_pct: string;
  growth_3m_pct: string;
  follower_growth_12m_pct: string;
  last_funding_round: string;
  last_funding_date: string;
  total_investment_usd: string;
  role_eng_pct: string;
  role_ops_pct: string;
  role_research_pct: string;
  role_qa_pct: string;
  rev_lower_usd: string;
  rev_higher_usd: string;
};

type MgmtRow = {
  person_name: string;
  title: string;
  seniority: string;
  years_at_company: string;
  company: string;
  company_linkedin_id: string;
  person_linkedin_url: string;
  location: string;
  headline: string;
};

const ROOT = process.cwd();
const ENRICHED = join(ROOT, "data/companies_enriched.csv");
// Authoritative tier + exclusion list (newer than enriched.csv; drives which
// companies ship into the UI). Excluded rows are dropped entirely.
const TIERED = join(ROOT, "data/companies_tiered.csv");
const MGMT = join(ROOT, "data/management.csv");
const MGMT_SUPPLEMENT = join(ROOT, "..", "data", "waldner_pas_tier1_management_supplement.csv");
const MGMT_SUPPLEMENT2 = join(ROOT, "..", "data", "waldner_pas_tier1_management_supplement2.csv");
const PERSON_PHOTOS = join(ROOT, "..", "data", "waldner_pas_person_photos.csv");
// Manual employees/revenue patches for mega-pharma rows whose source CSV is
// division-level rather than group-level (e.g. Bayer AG's LinkedIn export
// tracks the Pharmaceuticals Division: 22k FTE rather than the ~100k group).
// Written by scripts/tier_scoring.py (Python) — see MANUAL_OVERRIDES dict there.
const MANUAL_OVERRIDES_PATH = join(ROOT, "data", "manual_overrides.json");
type ManualOverride = {
  employees?: number;
  rev_lower_usd?: number;
  rev_higher_usd?: number;
  source?: string;
};
const manualOverrides: Record<string, ManualOverride> = existsSync(MANUAL_OVERRIDES_PATH)
  ? JSON.parse(readFileSync(MANUAL_OVERRIDES_PATH, "utf8"))
  : {};
function findManualOverride(name: string): ManualOverride | null {
  if (!name) return null;
  // Exact (case-insensitive, trimmed) match against the raw source-CSV name
  // — must match the key format written by tier_scoring.py's MANUAL_OVERRIDES.
  // This avoids false positives like "Novartis Oncology" matching "novartis".
  const n = name.trim().toLowerCase();
  return manualOverrides[n] ?? null;
}
const CACHE = join(ROOT, "scripts/.geocode-cache.json");
const OUT = join(ROOT, "public/companies.json");

// Pattern: "<role> at <Company>" / "<role> - <Company>" / "<role> @ <Company>"
function parseHeadlineCompany(h: string): string {
  if (!h) return "";
  const text = h.trim();
  for (const pat of [/\s+at\s+(.+?)$/i, /\s+-\s+(.+?)$/, /\s+@\s+(.+?)$/i]) {
    const m = text.match(pat);
    if (m) return m[1].trim();
  }
  return "";
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function splitSpecialty(s: string): { industry: string; description: string } {
  if (!s) return { industry: "", description: "" };
  const idx = s.indexOf(" / ");
  if (idx === -1) {
    // If the whole cell looks like a research-narrative (long prose with
    // parens or semicolons), treat it as description, not industry.
    const trimmed = s.trim();
    if (trimmed.length > 40 || /[();]/.test(trimmed)) {
      return { industry: "", description: trimmed };
    }
    return { industry: trimmed, description: "" };
  }
  const prefix = s.slice(0, idx).trim();
  const rest = s.slice(idx + 3).trim();
  // Prefix-leak guard: when the prefix before " / " is long-prose or contains
  // parens/semicolons, it's a hand-written research note, not an industry
  // label. Push the whole cell into description and leave industry empty.
  if (prefix.length > 40 || /[();]/.test(prefix)) {
    return { industry: "", description: s.trim() };
  }
  return { industry: prefix, description: rest };
}

function listSplit(s: string): string[] {
  if (!s) return [];
  return s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

// --- Bug 1 fix: strip parenthetical research annotations from company names.
// CEO/Sales leads were seeing names like:
//   "Pfizer Illertissen (BioNTech-comirnaty + injectables)"
//   "Hexal AG (Sandoz Group, originator-adjacent)"
//   "Minaris Regenerative Medicine (ex-Eufets)"
// The parenthetical content is research context — move it to the description
// so the rich context survives in the About panel, but the displayed name is
// clean.
//
// Strategy: ALWAYS strip parens content from name and append to description.
// Per requirements, users prefer clean names; the rare legal-parens case
// (e.g. "Sanofi-Aventis (Switzerland)") loses very little by becoming
// "Sanofi-Aventis" with "(Switzerland)" in the description.
function stripNameParens(name: string, description: string): { name: string; description: string } {
  if (!name || !name.includes("(")) return { name, description };
  // Collect all top-level parenthetical chunks. Use a simple non-nested scan.
  const parens: string[] = [];
  let depth = 0;
  let buf = "";
  let outName = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    if (ch === "(") {
      if (depth === 0) buf = "";
      else buf += ch;
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        if (buf.trim()) parens.push(buf.trim());
        buf = "";
      } else if (depth > 0) {
        buf += ch;
      }
    } else {
      if (depth === 0) outName += ch;
      else buf += ch;
    }
  }
  // Collapse whitespace + trim trailing punctuation/separators left behind.
  const cleanedName = outName.replace(/\s+/g, " ").replace(/\s+([,/])/g, "$1").trim().replace(/[,\-\/]\s*$/, "").trim();
  if (parens.length === 0) return { name: name.trim(), description };
  const annotation = parens.join("; ");
  const sep = " — ";
  const desc = description && description.trim().length > 0
    ? `${description.trim()}${sep}${annotation}`
    : annotation;
  return { name: cleanedName || name.trim(), description: desc };
}

// --- Bug 2 fix: recover industry for rows where splitSpecialty stripped it.
// Tier-1 rows with empty industry look like data-quality bugs to the CEO.
// Use oncologyTags first (most specific), buckets second (fallback), and a
// research-source default as last resort.
const ONCOLOGY_TAG_TO_INDUSTRY: Record<string, string> = {
  vaccines: "Vaccine Manufacturing",
  adc: "ADC Bioconjugates",
  cdmo: "Pharmaceutical CDMO",
  oncology_celltherapy: "Cell & Gene Therapy",
  oncology_general: "Oncology Pharmaceuticals",
  cytostatika_hpapi: "HPAPI / Cytotoxic Manufacturing",
  radiopharma: "Radiopharmaceuticals",
  immuno_oncology: "Immuno-Oncology",
};
const BUCKET_TO_INDUSTRY: Record<string, string> = {
  originator_pharma: "Originator Pharma",
  cdmo_classic: "Pharmaceutical CDMO",
  sterile_generics: "Sterile Generics",
  vaccines: "Vaccine Manufacturing",
  atmp_cell_gene: "Cell & Gene Therapy",
  veterinary_pharma: "Veterinary Pharmaceuticals",
  medical_cannabis: "Medical Cannabis",
  late_stage_biotech: "Late-Stage Biotech",
  specialty_orphan: "Specialty & Orphan Drugs",
  academic_gmp: "Academic GMP Manufacturing",
  plasma_fractionation: "Plasma Fractionation",
  bioprocess_vendors: "Bioprocess Equipment & Services",
  oncology_hpapi: "HPAPI / Cytotoxic Manufacturing",
};
function recoverIndustry(
  oncologyTags: string[],
  buckets: string[],
  source: string,
): string {
  // 1) Dominant oncology tag
  for (const t of oncologyTags) {
    const hit = ONCOLOGY_TAG_TO_INDUSTRY[t];
    if (hit) return hit;
  }
  // 2) Dominant bucket
  for (const b of buckets) {
    const hit = BUCKET_TO_INDUSTRY[b];
    if (hit) return hit;
    // Generic prettifier as a soft fallback
    if (b) {
      const pretty = b.split(/[_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      return pretty;
    }
  }
  // 3) Research-sourced default
  if ((source || "").toLowerCase().includes("research")) {
    return "Pharmaceutical Manufacturing";
  }
  return "";
}

function parseEmployees(s: string): number | null {
  if (!s) return null;
  // Strings may look like:
  //   "162555"             — plain int
  //   "~2,800"             — tilde + thousands-separator
  //   "1,500-2,000"        — range
  //   "~2,400 (DE mfg)"    — trailing parenthetical annotation
  //   "~3,800 (Marburg)"   — ditto
  // Previously we did `s.replace(/[~,]/g, "").match(/(\d+)/)` which would
  // strip the comma in "2,400" → "2400" but then any leading single-digit
  // (the `~` already stripped) like "2,400 (DE mfg)" worked — but when the
  // string was "~3,800 (Marburg)" the parenthetical was kept and the regex
  // happened to still match the leading run. The real bug: when the value
  // is something like "3,800 (Marburg)" without the leading `~`, the comma
  // strip yields "3800 (Marburg)" and `\d+` correctly returns 3800. But
  // when the value is "~12,500 (DE)" the strip yields "12500 (DE)" → 12500
  // OK. The actual failure case found in the wild is values like
  // "~3,800 (Marburg)" where SOMETIMES the upstream string contains a
  // leading non-digit-numeric annotation eg. "Marburg ~3,800" or where
  // the parenthetical contains digits like "(2,400 DE)" that the simple
  // `\d+` would catch first. Defensive fix:
  //   1) strip everything from the first '(' onward
  //   2) match a thousands-separator-aware number group
  //   3) parse to int
  const stripped = s.split("(")[0];
  const m = stripped.match(/\d{1,3}(?:[,.]\d{3})+|\d+/);
  if (!m) return null;
  return Number(m[0].replace(/[,.]/g, ""));
}

function parseNum(s: string): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Pipe Crustdata's `rev_lower_usd` / `rev_higher_usd` into the JSON with two
 * safety nets:
 *
 *   FIX 2 — "1B+ uncapped" sentinel: Crustdata emits 1e12 (1_000_000_000_000)
 *   as a stand-in for "any revenue ≥ $1B" (the API does not give a precise
 *   number above 1B). Anything ≥ 1e10 is clearly a sentinel, not a real
 *   figure (no pharma company has $10B+ in revenue from a single segment row)
 *   so clamp to 1e9 — the UI band logic will then treat it as "1B+".
 *
 *   FIX 3 — subsidiary mis-report guard: when a row has employees > 1000 but
 *   `rev_higher < $10M`, the row is a subsidiary entity filing with a clearly
 *   bogus low revenue (CSL Behring GmbH: ~3,800 employees but rev=$0.5-1M).
 *   Drop the revenue figure so the fallback to headcount-derived takes over.
 */
function resolveRevenue(
  rawLower: string,
  rawHigher: string,
  employees: number | null,
): { revLowerUsd: number | null; revHigherUsd: number | null } {
  let lower = parseNum(rawLower);
  let higher = parseNum(rawHigher);
  if (lower === 0 && higher === 0) {
    lower = null;
    higher = null;
  }
  // Fix 2: clamp the "1B+ uncapped" sentinel.
  if (higher != null && higher >= 1e10) {
    higher = 1e9;
    if (lower != null && lower > 1e9) lower = 1e9;
  }
  // Fix 3: subsidiary mis-report.
  if (
    higher != null &&
    higher < 1e7 &&
    employees != null &&
    employees > 1000
  ) {
    lower = null;
    higher = null;
  }
  return { revLowerUsd: lower, revHigherUsd: higher };
}

function key(city: string, country: string) {
  return `${city.trim().toLowerCase()}|${country.trim().toUpperCase()}`;
}

const cache: Record<string, { lat: number; lon: number } | null> = existsSync(CACHE)
  ? JSON.parse(readFileSync(CACHE, "utf8"))
  : {};

// Defensive centroid filter — mirrors scripts/geocode.ts. Old cache files
// can contain country-centroid coordinates from the previous FALLBACK behaviour
// (which piled ~60 pins on the dead centre of Germany). Treat those as
// "geocode failed" so the row gets lat/lon = null instead of a fake pin.
const COUNTRY_CENTROIDS_GUARD: Array<{ lat: number; lon: number }> = [
  { lat: 51.1657, lon: 10.4515 }, // DEU
  { lat: 46.8182, lon: 8.2275 },  // CHE
  { lat: 47.5162, lon: 14.5501 }, // AUT
  { lat: 39.8283, lon: -98.5795 }, // USA
  { lat: 55.3781, lon: -3.4360 }, // GBR
  { lat: 46.2276, lon: 2.2137 },  // FRA
  { lat: 41.8719, lon: 12.5674 }, // ITA
  { lat: 40.4637, lon: -3.7492 }, // ESP
  { lat: 52.1326, lon: 5.2913 },  // NLD
  { lat: 50.5039, lon: 4.4699 },  // BEL
  { lat: 56.2639, lon: 9.5018 },  // DNK
  { lat: 60.1282, lon: 18.6435 }, // SWE
];
function isCountryCentroidCoord(lat: number, lon: number): boolean {
  for (const c of COUNTRY_CENTROIDS_GUARD) {
    if (Math.abs(lat - c.lat) < 0.01 && Math.abs(lon - c.lon) < 0.01) return true;
  }
  return false;
}
let cacheCentroidStripped = 0;
for (const k of Object.keys(cache)) {
  const v = cache[k];
  if (v && isCountryCentroidCoord(v.lat, v.lon)) {
    cache[k] = null;
    cacheCentroidStripped++;
  }
}
if (cacheCentroidStripped > 0) {
  console.log(`stripped ${cacheCentroidStripped} centroid cache entries (re-run \`npm run geocode\` to re-resolve)`);
}

const enrichedCsv = readFileSync(ENRICHED, "utf8");
const enrichedParsed = Papa.parse<EnrichedRow>(enrichedCsv, { header: true, skipEmptyLines: true });

// Crustdata logo permalinks (aggregated from data/crustdata/buckets/*.json
// by scripts/build-companies-precheck script — see top of pipeline.)
type LogoEntry = { logo: string; name: string; linkedin_id: string };
type LogoIndex = { byLinkedInId: Record<string, LogoEntry>; byName: Record<string, LogoEntry> };
const LOGOS_PATH = join(ROOT, "data/company_logos.json");
const logoIndex: LogoIndex = existsSync(LOGOS_PATH)
  ? JSON.parse(readFileSync(LOGOS_PATH, "utf8"))
  : { byLinkedInId: {}, byName: {} };

// Full LinkedIn descriptions extracted from Crustdata bucket JSONs.
// Used to replace the CSV's truncated `specialty` description (truncated at ~85
// chars upstream, often ending mid-sentence like "working in the field of ").
type DescIndex = { byLinkedInId?: Record<string, string>; byName?: Record<string, string> };
const DESCRIPTIONS_PATH = join(ROOT, "data/company_descriptions.json");
const descIndex: DescIndex = existsSync(DESCRIPTIONS_PATH)
  ? JSON.parse(readFileSync(DESCRIPTIONS_PATH, "utf8"))
  : {};
const descNameKeys = Object.keys(descIndex.byName || {});
function findFullDescription(companyName: string): string | null {
  if (!companyName) return null;
  const exact = descIndex.byName?.[companyName.toLowerCase()];
  if (exact) return exact;
  const norm = normalizeCompanyName(companyName);
  if (!norm || norm.length < 4) return null;
  for (const k of descNameKeys) {
    if (normalizeCompanyName(k) === norm) return descIndex.byName![k];
  }
  for (const k of descNameKeys) {
    const kn = normalizeCompanyName(k);
    if (kn.length < 4) continue;
    if (kn.includes(norm) || norm.includes(kn)) return descIndex.byName![k];
  }
  return null;
}

// CSV description is considered truncated when it ends without sentence-ending
// punctuation OR mid-preposition. Heuristic catches "...in the field of",
// "...It empl" and similar.
function isTruncatedDescription(s: string): boolean {
  if (!s) return true;
  const trimmed = s.trim();
  if (trimmed.length < 30) return true;
  if (/[.!?…”"]$/.test(trimmed)) return false;
  return true;
}

// CSV's build_signal is sometimes literally the raw growth percentage like
// "5.813953488372093% growth". Suppress it in the JSON (the growth tile in the
// drawer already shows the rounded version).
function cleanBuildSignal(s: string): string {
  const t = (s || "").trim();
  if (!t) return "";
  // Drop "<long-decimal>% growth" / "<int>% growth" with nothing else
  if (/^[+-]?\d+(\.\d+)?\s*%\s*growth\.?$/i.test(t)) return "";
  return t;
}
const logoNameKeys = Object.keys(logoIndex.byName || {});
function findLogoUrl(companyName: string): string | null {
  const exact = logoIndex.byName?.[companyName.toLowerCase()];
  if (exact) return exact.logo;
  // Try normalized substring
  const norm = normalizeCompanyName(companyName);
  if (!norm || norm.length < 4) return null;
  for (const k of logoNameKeys) {
    if (normalizeCompanyName(k) === norm) return logoIndex.byName[k].logo;
  }
  // Substring match either direction
  for (const k of logoNameKeys) {
    const kn = normalizeCompanyName(k);
    if (kn.length < 4) continue;
    if (kn.includes(norm) || norm.includes(kn)) return logoIndex.byName[k].logo;
  }
  return null;
}

// ----------------------------------------------------------------------------
// Crustdata multi-location ingest (Step 2 of the multi-site rebuild).
// Recursively reads every JSON under data/crustdata/, normalises each company's
// HQ + office_addresses into Location[] records, and exposes a lookup keyed by
// the normalised company name. The main loop joins each output row against
// this lookup; when found, the row's lat/lon become the HQ's geocoded coords
// and the full Location[] is stamped onto the company.
// ----------------------------------------------------------------------------
type Location = {
  role: "HQ" | "office";
  street: string | null;
  city: string;
  postcode: string | null;
  country: string;        // ISO3
  lat: number | null;
  lon: number | null;
  employeesHint: number | null;
};

const CRUSTDATA_ROOT = join(ROOT, "..", "data", "crustdata");
const ADDRESS_CACHE_PATH = join(ROOT, "scripts/.address-geocode-cache.json");

// ISO2 → ISO3. Only the countries that surface in our Crustdata dumps need to
// be covered; unknown codes fall through unchanged (which is fine — the UI
// only filters on DEU/AUT/CHE).
const ISO2_TO_ISO3: Record<string, string> = {
  DE: "DEU", AT: "AUT", CH: "CHE", US: "USA", GB: "GBR", FR: "FRA",
  IT: "ITA", ES: "ESP", NL: "NLD", BE: "BEL", DK: "DNK", SE: "SWE",
  NO: "NOR", FI: "FIN", PL: "POL", CZ: "CZE", HU: "HUN", IE: "IRL",
  PT: "PRT", GR: "GRC", TR: "TUR", CA: "CAN", JP: "JPN", CN: "CHN",
  IN: "IND", AU: "AUS", BR: "BRA", MX: "MEX", AR: "ARG", CO: "COL",
  PE: "PER", CL: "CHL", VE: "VEN", PA: "PAN", PR: "PRI", DO: "DOM",
  GT: "GTM", CR: "CRI", UY: "URY", EC: "ECU", BO: "BOL", PY: "PRY",
  HN: "HND", SV: "SLV", NI: "NIC", BS: "BHS", BB: "BRB", JM: "JAM",
  TT: "TTO", KR: "KOR", SG: "SGP", HK: "HKG", TW: "TWN", TH: "THA",
  MY: "MYS", ID: "IDN", PH: "PHL", VN: "VNM", PK: "PAK", BD: "BGD",
  LK: "LKA", NP: "NPL", AE: "ARE", SA: "SAU", QA: "QAT", KW: "KWT",
  OM: "OMN", BH: "BHR", JO: "JOR", LB: "LBN", IL: "ISR", EG: "EGY",
  MA: "MAR", TN: "TUN", DZ: "DZA", ZA: "ZAF", NG: "NGA", KE: "KEN",
  GH: "GHA", ET: "ETH", UG: "UGA", TZ: "TZA", SN: "SEN", CI: "CIV",
  AO: "AGO", MZ: "MOZ", ZW: "ZWE", ZM: "ZMB", CM: "CMR", AL: "ALB",
  MK: "MKD", BG: "BGR", RO: "ROU", RS: "SRB", HR: "HRV", SI: "SVN",
  SK: "SVK", EE: "EST", LV: "LVA", LT: "LTU", LU: "LUX", IS: "ISL",
  MT: "MLT", CY: "CYP", BY: "BLR", UA: "UKR", RU: "RUS", KZ: "KAZ",
  UZ: "UZB", AZ: "AZE", AM: "ARM", GE: "GEO", IR: "IRN", IQ: "IRQ",
  AF: "AFG", NZ: "NZL", LI: "LIE", AD: "AND", MC: "MCO", SM: "SMR",
  VA: "VAT", MD: "MDA", BA: "BIH", ME: "MNE", XK: "XKX",
};
const ISO3_NAME: Record<string, string> = {
  DEU: "Germany", AUT: "Austria", CHE: "Switzerland", USA: "United States",
  GBR: "United Kingdom", FRA: "France", ITA: "Italy", ESP: "Spain",
  NLD: "Netherlands", BEL: "Belgium", DNK: "Denmark", SWE: "Sweden",
  NOR: "Norway", FIN: "Finland", POL: "Poland", CZE: "Czechia",
  HUN: "Hungary", IRL: "Ireland", PRT: "Portugal", GRC: "Greece",
  CHN: "China", JPN: "Japan", IND: "India", BRA: "Brazil", CAN: "Canada",
  AUS: "Australia", MEX: "Mexico", KOR: "South Korea", SGP: "Singapore",
};

function toISO3(raw: string): string {
  const v = (raw || "").trim().toUpperCase();
  if (v.length === 3) return v;
  if (v.length === 2 && ISO2_TO_ISO3[v]) return ISO2_TO_ISO3[v];
  // hq_country in Crustdata is sometimes the full name when ISO data is missing
  const lower = (raw || "").trim().toLowerCase();
  if (lower === "germany") return "DEU";
  if (lower === "austria") return "AUT";
  if (lower === "switzerland") return "CHE";
  return v || "";
}

// office_addresses look like "Street, City, Region?, Postcode?, CC".
// First token may be empty (no street known). Last token is ISO2 country.
// Postcode is a token containing digits OR alphanumerics with at least one
// digit (UK "RG2 0", DE "88085", JP "108-6028"). Region is everything else.
function parseOfficeAddress(s: string): Omit<Location, "lat" | "lon" | "employeesHint"> | null {
  if (!s || typeof s !== "string") return null;
  const parts = s.split(",").map((p) => p.trim());
  if (parts.length < 2) return null;
  const cc2 = parts[parts.length - 1];
  if (!cc2 || cc2.length !== 2) return null;
  const country = toISO3(cc2);
  if (!country) return null;
  // Strip trailing country
  const rest = parts.slice(0, -1);
  // Street: first token (may be empty)
  const streetRaw = rest[0] ?? "";
  const street = streetRaw.length > 0 ? streetRaw : null;
  // Walk remaining tokens (after the street) and identify postcode by digit
  // content. The first non-postcode-like, non-street token is the city; the
  // rest are region (ignored, but used to identify postcode).
  const middle = rest.slice(1);
  let city = "";
  let postcode: string | null = null;
  // Heuristic: a token containing digits and length ≤ 10 is a postcode.
  for (const tok of middle) {
    if (!tok) continue;
    const looksLikePostcode = /\d/.test(tok) && tok.length <= 12 && !/^\d{4,}\s/.test(tok);
    if (looksLikePostcode && postcode === null && /^[A-Z0-9 \-]+$/i.test(tok)) {
      postcode = tok;
    } else if (!city) {
      city = tok;
    }
  }
  if (!city) {
    // Office had only postcode + country (rare); fall back to first non-empty
    // middle token even if it looked like a postcode.
    for (const tok of middle) {
      if (tok) { city = tok; break; }
    }
  }
  if (!city) return null;
  return { role: "office", street, city, postcode, country };
}

// HQ extraction from hq_location + hq_street_address_and_city +
// hq_location_address_components + hq_country.
function parseHQ(c: Record<string, unknown>): Omit<Location, "lat" | "lon" | "employeesHint"> | null {
  const hqCountryRaw = (c.hq_country as string) || "";
  const country = toISO3(hqCountryRaw);
  if (!country) return null;

  const hqLoc = (c.hq_location as string) || "";
  const hqStreet = (c.hq_street_address_and_city as string) || "";
  const components = (c.hq_location_address_components as string[]) || [];

  // City = first token of hq_location ("Münchenstein, Basel-Country, Switzerland")
  let city = "";
  if (hqLoc) {
    city = hqLoc.split(",")[0]?.trim() ?? "";
  }
  if (!city && components.length > 0) {
    city = components[0] ?? "";
  }
  if (!city) return null;

  // Street: hq_street_address_and_city = "Street, City, Region, Country".
  // Strip the trailing parts (everything from city onwards).
  let street: string | null = null;
  if (hqStreet) {
    const idx = hqStreet.indexOf(city);
    if (idx > 0) {
      street = hqStreet.slice(0, idx).replace(/,\s*$/, "").trim() || null;
    } else if (hqStreet !== hqLoc) {
      // Take the first comma-separated token as street as a last resort.
      const first = hqStreet.split(",")[0]?.trim() ?? "";
      if (first && first !== city) street = first;
    }
  }

  // Postcode: components sometimes carry a 2-digit postcode prefix at the end
  // ("51" for Leverkusen, "88" for Ravensburg). Too coarse to be useful, but
  // we keep it if it looks like a real postcode (≥ 3 chars or contains a
  // digit + letter combo).
  let postcode: string | null = null;
  if (components.length > 0) {
    const last = components[components.length - 1];
    if (last && /^[A-Z0-9 \-]{3,}$/i.test(last) && /\d/.test(last)) {
      postcode = last;
    }
  }

  return { role: "HQ", street, city, postcode, country };
}

// Match an office's city to a `region_distribution` key. The map is keyed by
// region names like "Baden-Württemberg, Germany", "United States", "Greater
// Munich Metropolitan Area" — best-effort substring match (city in key OR
// key in city). Returns null when nothing plausible matches.
function findEmployeesHint(
  city: string,
  country: string,
  regionDist: Record<string, number> | null | undefined,
): number | null {
  if (!regionDist || !city) return null;
  const cityLower = city.toLowerCase();
  const countryName = ISO3_NAME[country] ?? "";
  for (const [region, count] of Object.entries(regionDist)) {
    const regionLower = region.toLowerCase();
    if (regionLower.includes(cityLower) || cityLower.includes(regionLower.split(",")[0]?.trim() ?? "")) {
      return typeof count === "number" ? count : null;
    }
    if (countryName && regionLower === countryName.toLowerCase()) {
      // Country-level hint is too coarse for an office — skip.
      continue;
    }
  }
  return null;
}

// Walk data/crustdata/ recursively for .json files.
function walkJsonFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...walkJsonFiles(p));
    else if (e.endsWith(".json")) out.push(p);
  }
  return out;
}

type CrustdataRecord = {
  locations: Location[];
  largestHeadcountCountry: string | null;
};

const crustdataByName = new Map<string, CrustdataRecord>();
{
  if (!existsSync(CRUSTDATA_ROOT)) {
    console.log(`crustdata ingest: ${CRUSTDATA_ROOT} not found, skipping multi-location`);
  } else {
    const files = walkJsonFiles(CRUSTDATA_ROOT);
    let totalEntries = 0;
    let withOffices = 0;
    for (const f of files) {
      let d: unknown;
      try { d = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
      let companies: unknown[] = [];
      if (Array.isArray(d)) companies = d;
      else if (d && typeof d === "object" && Array.isArray((d as { companies?: unknown[] }).companies)) {
        companies = (d as { companies: unknown[] }).companies;
      }
      for (const cRaw of companies) {
        if (!cRaw || typeof cRaw !== "object") continue;
        const c = cRaw as Record<string, unknown>;
        const name = ((c.company_name as string) || (c.name as string) || "").trim();
        if (!name) continue;
        totalEntries++;
        const hq = parseHQ(c);
        if (!hq) continue;
        const regionDist = c.region_distribution as Record<string, number> | undefined;
        const hqLocation: Location = {
          ...hq,
          lat: null,
          lon: null,
          employeesHint: findEmployeesHint(hq.city, hq.country, regionDist) ?? null,
        };
        const officeRaw = (c.office_addresses as string[]) || [];
        const officeLocations: Location[] = [];
        const seenOfficeKeys = new Set<string>();
        // Dedupe HQ from offices (e.g. Vetter Ravensburg appears in both lists).
        seenOfficeKeys.add(`${hqLocation.city.toLowerCase()}|${hqLocation.country}`);
        for (const o of officeRaw) {
          const parsed = parseOfficeAddress(o);
          if (!parsed) continue;
          const key = `${parsed.city.toLowerCase()}|${parsed.country}`;
          if (seenOfficeKeys.has(key)) continue;
          seenOfficeKeys.add(key);
          officeLocations.push({
            ...parsed,
            lat: null,
            lon: null,
            employeesHint: findEmployeesHint(parsed.city, parsed.country, regionDist) ?? null,
          });
        }
        if (officeLocations.length > 0) withOffices++;
        const rec: CrustdataRecord = {
          locations: [hqLocation, ...officeLocations],
          largestHeadcountCountry: ((c.largest_headcount_country as string) || null),
        };
        const nameKey = normalizeCompanyName(name);
        // Last-write-wins per name: page_01.json (broad dump) is read after
        // the bucket dumps, but they all describe the same companies — newer
        // entries with more office data should win. We prefer the entry with
        // more locations.
        const existing = crustdataByName.get(nameKey);
        if (!existing || existing.locations.length < rec.locations.length) {
          crustdataByName.set(nameKey, rec);
        }
        // Also index by exact lowercased name for direct hits.
        const directKey = name.toLowerCase();
        const direct = crustdataByName.get(directKey);
        if (!direct || direct.locations.length < rec.locations.length) {
          crustdataByName.set(directKey, rec);
        }
      }
    }
    console.log(`crustdata ingest: ${files.length} files, ${totalEntries} company entries, ${withOffices} with offices, ${crustdataByName.size} keys indexed`);
  }
}

function findCrustdataLocations(companyName: string): { rec: CrustdataRecord; matchedKey: string } | null {
  if (!companyName) return null;
  // Use the NORMALIZED name as the canonical matchedKey so the dedupe guard
  // can compare via startsWith — direct lowercase keys ("vetter pharma" with
  // space) confuse the startsWith check below.
  const norm = normalizeCompanyName(companyName);
  const lower = companyName.toLowerCase();
  const direct = crustdataByName.get(lower);
  if (direct) return { rec: direct, matchedKey: norm || lower };
  if (!norm || norm.length < 4) return null;
  const hit = crustdataByName.get(norm);
  if (hit) return { rec: hit, matchedKey: norm };
  // Try substring against all normalised keys (longest first).
  const keys = [...crustdataByName.keys()].sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (k.length < 4) continue;
    // Skip space-containing direct keys; only normalized keys are valid
    // canonical anchors (they're the ones the dedupe startsWith uses).
    if (k.includes(" ")) continue;
    if (k === norm) return { rec: crustdataByName.get(k)!, matchedKey: k };
    if (norm.includes(k) || k.includes(norm)) {
      const shorter = Math.min(k.length, norm.length);
      const longer = Math.max(k.length, norm.length);
      if (shorter / longer >= 0.6) return { rec: crustdataByName.get(k)!, matchedKey: k };
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// Address geocoder (Step 3). Replaces the city,country-only Nominatim lookup
// with a full-address query. Centroid responses are rejected. Cache lives in
// scripts/.address-geocode-cache.json (separate from the legacy
// .geocode-cache.json so the old behaviour stays intact for unjoined rows).
// ----------------------------------------------------------------------------
type AddrCacheEntry = { lat: number; lon: number } | null;
const addressCache: Record<string, AddrCacheEntry> = existsSync(ADDRESS_CACHE_PATH)
  ? JSON.parse(readFileSync(ADDRESS_CACHE_PATH, "utf8"))
  : {};
// Strip stale centroid entries on load (mirrors the city-cache guard above).
for (const k of Object.keys(addressCache)) {
  const v = addressCache[k];
  if (v && isCountryCentroidCoord(v.lat, v.lon)) addressCache[k] = null;
}

function addrKey(loc: Location): string {
  return [loc.street ?? "", loc.city, loc.postcode ?? "", loc.country].join("|").toLowerCase();
}

async function geocodeAddress(loc: Location): Promise<AddrCacheEntry> {
  const k = addrKey(loc);
  if (k in addressCache) return addressCache[k];
  const countryName = ISO3_NAME[loc.country] ?? loc.country;
  // Build query: prefer full address, fall back to city + country.
  const parts: string[] = [];
  if (loc.street) parts.push(loc.street);
  parts.push(loc.city);
  if (loc.postcode) parts.push(loc.postcode);
  parts.push(countryName);
  const q = encodeURIComponent(parts.join(", "));
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "node42-pharma-map/0.2 (multi-location)" },
    });
    if (!r.ok) { addressCache[k] = null; return null; }
    const arr = (await r.json()) as Array<{ lat: string; lon: string }>;
    if (!arr?.length) { addressCache[k] = null; return null; }
    const lat = Number(arr[0].lat);
    const lon = Number(arr[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { addressCache[k] = null; return null; }
    if (isCountryCentroidCoord(lat, lon)) { addressCache[k] = null; return null; }
    addressCache[k] = { lat, lon };
    return addressCache[k];
  } catch {
    addressCache[k] = null;
    return null;
  }
}

function saveAddressCache() {
  writeFileSync(ADDRESS_CACHE_PATH, JSON.stringify(addressCache, null, 2));
}

// Newer authoritative tier/exclusion list. Index it by (name|city|country) so we
// can override the older `enriched.csv` rows below.
type TieredRow = Pick<EnrichedRow,
  "name" | "country" | "city" | "tier" | "score" | "score_breakdown" | "exclusion_reason"
>;
const tieredCsv = existsSync(TIERED) ? readFileSync(TIERED, "utf8") : "";
const tieredParsed = tieredCsv
  ? Papa.parse<TieredRow>(tieredCsv, { header: true, skipEmptyLines: true })
  : { data: [] as TieredRow[] };

function rowKey(name: string, city: string, country: string) {
  return `${(name || "").trim().toLowerCase()}|${(city || "").trim().toLowerCase()}|${(country || "").trim().toUpperCase()}`;
}

const tieredByKey = new Map<string, TieredRow>();
for (const t of tieredParsed.data) {
  if (!t.name) continue;
  tieredByKey.set(rowKey(t.name, t.city, t.country), t);
}
console.log(`tiered file: ${tieredParsed.data.length} rows indexed`);

const mgmtCsv = readFileSync(MGMT, "utf8");
const mgmtParsed = Papa.parse<MgmtRow>(mgmtCsv, { header: true, skipEmptyLines: true });

// Optional supplement from targeted Crustdata enrichment of missing Tier-1 companies.
let supplementRows: MgmtRow[] = [];
if (existsSync(MGMT_SUPPLEMENT)) {
  const csv = readFileSync(MGMT_SUPPLEMENT, "utf8");
  const parsed = Papa.parse<MgmtRow>(csv, { header: true, skipEmptyLines: true });
  // Backfill missing company names: first index linkedin_id → company from rows that have it
  const byLinkedInId = new Map<string, string>();
  for (const r of parsed.data) {
    const cn = (r.company || "").trim();
    const cid = (r.company_linkedin_id || "").trim();
    if (cn && cid && !byLinkedInId.has(cid)) byLinkedInId.set(cid, cn);
  }
  supplementRows = parsed.data.map((r) => {
    let company = (r.company || "").trim();
    if (!company && r.company_linkedin_id && byLinkedInId.has(r.company_linkedin_id.trim())) {
      company = byLinkedInId.get(r.company_linkedin_id.trim()) ?? "";
    }
    if (!company) company = parseHeadlineCompany(r.headline || "");
    return { ...r, company };
  }).filter((r) => (r.company || "").trim());
  console.log(`supplement: ${parsed.data.length} raw → ${supplementRows.length} with company resolved`);
}

// Second supplement from broader Crustdata pull (drops title-keyword filter).
let supplementRows2: MgmtRow[] = [];
if (existsSync(MGMT_SUPPLEMENT2)) {
  const csv = readFileSync(MGMT_SUPPLEMENT2, "utf8");
  const parsed = Papa.parse<MgmtRow>(csv, { header: true, skipEmptyLines: true });
  const byLinkedInId = new Map<string, string>();
  for (const r of parsed.data) {
    const cn = (r.company || "").trim();
    const cid = (r.company_linkedin_id || "").trim();
    if (cn && cid && !byLinkedInId.has(cid)) byLinkedInId.set(cid, cn);
  }
  supplementRows2 = parsed.data.map((r) => {
    let company = (r.company || "").trim();
    if (!company && r.company_linkedin_id && byLinkedInId.has(r.company_linkedin_id.trim())) {
      company = byLinkedInId.get(r.company_linkedin_id.trim()) ?? "";
    }
    if (!company) company = parseHeadlineCompany(r.headline || "");
    return { ...r, company };
  }).filter((r) => (r.company || "").trim());
  console.log(`supplement2 (broad): ${parsed.data.length} raw → ${supplementRows2.length} with company resolved`);
}

// Person photos lookup (linkedin_url → profile_picture_url).
const personPhotos = new Map<string, string>();
if (existsSync(PERSON_PHOTOS)) {
  const csv = readFileSync(PERSON_PHOTOS, "utf8");
  const parsed = Papa.parse<{ person_linkedin_url: string; profile_picture_url: string }>(csv, { header: true, skipEmptyLines: true });
  for (const r of parsed.data) {
    const url = (r.person_linkedin_url || "").trim();
    const pic = (r.profile_picture_url || "").trim();
    if (url && pic) personPhotos.set(url, pic);
  }
  console.log(`person_photos: ${personPhotos.size} URL→photo mappings`);
}

const allMgmt: MgmtRow[] = [...mgmtParsed.data, ...supplementRows, ...supplementRows2];

// Build a per-company lookup of management profiles by normalized company name.
function normalizeCompanyName(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    // Strip common legal suffixes & connectors
    .replace(/\s*\b(gmbh|kgaa|kgaag|ag|sa|spa|s\.p\.a\.?|co\.?\s*kg|co\.?|kg|ltd|llc|inc|s\.a\.?|s\.r\.l\.?|srl|nv|bv|plc|holding|group|gruppe|pharma)\b/g, "")
    .replace(/\s*&\s*(co|partner)\b.*$/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const mgmtByCompany = new Map<string, MgmtRow[]>();
for (const m of allMgmt) {
  if (!m.person_name || !m.company) continue;
  const k = normalizeCompanyName(m.company);
  if (!k) continue;
  if (!mgmtByCompany.has(k)) mgmtByCompany.set(k, []);
  mgmtByCompany.get(k)!.push(m);
}

// Build all mgmt keys ordered by length (longest first) for substring matching
const mgmtKeysByLen = [...mgmtByCompany.keys()].sort((a, b) => b.length - a.length);

function findMgmtMatch(companyKey: string): MgmtRow[] {
  if (!companyKey) return [];
  // Exact
  const exact = mgmtByCompany.get(companyKey);
  if (exact) return exact;
  // Substring: prefer longer-key match
  for (const k of mgmtKeysByLen) {
    if (k.length < 4) continue; // avoid "abc" matching everything
    if (companyKey.includes(k) || k.includes(companyKey)) {
      return mgmtByCompany.get(k) ?? [];
    }
  }
  return [];
}

// Rank seniority for ordering: CXO > VP > Director > Owner/Partner > others
function seniorityRank(s: string): number {
  const t = (s || "").toLowerCase();
  if (t.includes("cxo") || /^c[a-z]o/i.test(s) || t.includes("chief")) return 0;
  if (t.includes("vice president") || t === "vp") return 1;
  if (t.includes("director")) return 2;
  if (t.includes("owner") || t.includes("partner")) return 3;
  return 9;
}

// Merge: any company present in tiered_targets.csv but NOT in enriched.csv
// should also be considered (newer additions). Build a unified iteration set.
const enrichedKeys = new Set(
  enrichedParsed.data.filter((r) => r.name).map((r) => rowKey(r.name, r.city, r.country))
);
const extraFromTiered: EnrichedRow[] = [];
for (const t of tieredParsed.data) {
  if (!t.name) continue;
  if (!enrichedKeys.has(rowKey(t.name, t.city, t.country))) {
    extraFromTiered.push({ ...(t as unknown as EnrichedRow), specialty: "", bucket: "", source: "", build_signal: "", source_url: "", oncology_tags: "", employees: "", rev_lower_usd: "", rev_higher_usd: "" });
  }
}
const unifiedRows: EnrichedRow[] = [...enrichedParsed.data, ...extraFromTiered];
console.log(`unified input: ${enrichedParsed.data.length} enriched + ${extraFromTiered.length} extra from tiered = ${unifiedRows.length}`);

// Reorder so that rows whose normalized name directly matches a Crustdata
// key are processed FIRST. This ensures the canonical Crustdata-joined entry
// gets emitted before manual-split duplicates ("Vetter Pharma" before
// "Vetter Pharma-Fertigung") so the duplicate-drop guard fires.
// We can't call findCrustdataLocations() here because the crustdataByName
// index isn't built yet at this point — the sort happens just below the
// crustdata index build (which is hoisted to module-load time above).
function crustdataMatchScore(name: string): number {
  if (!name) return 0;
  const direct = crustdataByName.get(name.toLowerCase()) ? 100 : 0;
  if (direct) return direct;
  const norm = normalizeCompanyName(name);
  if (!norm) return 0;
  return crustdataByName.has(norm) ? 50 : 0;
}
unifiedRows.sort((a, b) => crustdataMatchScore(b.name) - crustdataMatchScore(a.name));

// --- Non-pharma false-positive guardrail ---------------------------------
// Crustdata's `industry` field bled through unfiltered and dragged hundreds
// of non-pharma companies into the map. Original wave was machinery /
// manufacturing (welding shops, hydraulics, railway track machinery,
// compressors, grinding, etc.). Follow-up audit found ~65 more in the
// `vaccines` bucket (and likely also `bioprocess_vendors` /
// `originator_pharma`) carrying Software / IT / Industrial Automation /
// Metal Fabrication industries.
// Auto-drop any row whose industry matches the non-pharma list AND whose
// specialty/industry text contains no pharma signal. Applies to ALL buckets.
// Word-boundary patterns. Plain substring matching previously matched
// "fill" inside "filament" (INVENT GmbH — composite engineering) and "api"
// inside "application/capability", letting non-pharma rows through.
const PHARMA_KEYWORD_PATTERNS: RegExp[] = [
  /\bpharma/i,            // pharma, pharmaceutical
  /\bbiolog/i,            // biological, biologics, biology
  /\bbiotech/i,
  /\bsterile\b/i,
  /\bfill[-\s]?finish\b/i,
  /\baseptic\b/i,
  /\bgmp\b/i,
  /\bvaccin/i,            // vaccine, vaccinology
  /\bAPI(s)?\b/,          // active pharmaceutical ingredient (case-sensitive acronym)
  /\bactive pharmaceutical ingredient/i,
  /\bexcipient/i,
  /\bcdmo\b/i,
  /\bcmo\b/i,
  /\bcell therapy\b/i,
  /\bgene therapy\b/i,
  /\bmRNA\b/i,
  /\bmonoclonal antibod/i,
  /\bGLP-1\b/i,
  /\bclinical trial/i,
  /\bdrug substance\b/i,
  /\bdrug product\b/i,
  /\bdosage form/i,
  /\binjectable/i,
  /\bbiosimilar/i,
  /\borphan drug/i,
  /\bplasma\s+(fractionation|protein)/i,
  // Pharma-equipment vendor names we explicitly accept
  /\bglatt\b/i,
  /\bcoperion\b/i,
  /\bpester\b/i,
  /\bhosokawa\b/i,
];
// Legacy plain-string export (kept so any external consumer or test that
// imports PHARMA_KEYWORDS doesn't crash); not used by the guardrail anymore.
const PHARMA_KEYWORDS = PHARMA_KEYWORD_PATTERNS.map((re) => re.source);
void PHARMA_KEYWORDS;
// Industry strings (case-insensitive substring) that are definitionally
// non-pharma. Match must be permissive — Crustdata varies casing/spelling
// (notably "Mechanical Or Industrial Engineering" with OR, not "and").
const NON_PHARMA_INDUSTRY_PATTERNS: RegExp[] = [
  /Machinery/i,
  /Manufacturing/i,
  /Software Development/i,
  /IT Services and IT Consulting/i,
  /Information Technology\s*&\s*Services/i,
  /Industrial Automation/i,
  /Services for Renewable Energy/i,
  /Fabricated Metal Products/i,
  /Business Consulting and Services/i,
  /Mechanical Or Industrial Engineering/i,
  /Mechanical and Industrial Engineering/i, // alt casing safety net
  // 2026-05-12 audit follow-up: a second-wave of Crustdata false positives
  // surfaced after the first sweep — eg. Automotive (SCHERDEL), Mining
  // (BETEK), Construction (Pfefferlé), Robotics, Food & Beverage Services
  // (Schaerer coffee machines), Public Safety (SGS-TÜV testing labs),
  // Building Materials, Wholesale Import/Export, Environmental Services
  // (industrial filtration), Publishing (Axel Springer). None of these
  // belong in pharma buckets regardless of source.
  /Automotive/i,
  /Mining/i,
  /Construction/i,
  /Robotics/i,
  /Food and Beverage/i,
  /Public Safety/i,
  /Building Materials/i,
  /Wholesale Import and Export/i,
  /Environmental Services/i,
  /Book and Periodical Publishing/i,
  /Technology, Information and Internet/i,
  /Technology, Information and Media/i,
  /Motor Vehicle Manufacturing/i,
  /Transportation Equipment Manufacturing/i,
  /Computers and Electronics Manufacturing/i,
  /Appliances, Electrical, and Electronics Manufacturing/i,
  // 2026-05-12 round 3: another batch of clearly-non-pharma industries that
  // Crustdata's bucket fetch returned (Hunter International — pet
  // accessories; LAYERTEC — optics; Baobab — cyber insurance; Diction —
  // translation services; HighTec EDV — embedded compilers; Speedmaster —
  // furniture; LOOPING GROUP — advertising; Söhner — plastic packaging;
  // TECH5 — biometrics).
  /^Wholesale$/i,
  /Wholesale\b/i, // catches Wholesale Import and Export already listed
  /\bIT System Operations and Maintenance\b/i,
  /\bGovernment Administration\b/i,
  /\bInsurance\b/i,
  /\bEducation\b/i,
  /\bHigher Education\b/i,
  /\bPackaging\s*&\s*Containers\b/i,
  /\bTranslation and Localization\b/i,
  /\bEmbedded Software Products\b/i,
  /\bFurniture\b/i,
  /\bAdvertising Services\b/i,
  /\bNanotechnology Research\b/i, // ambiguous but LAYERTEC etc. are optics
  /\bWellness and Fitness Services\b/i, // EMS studios, supplement DTC brands
];
// Whitelist of legit pharma-equipment vendors that Crustdata mislabels as
// generic Machinery. We OVERWRITE their industry value so downstream
// classification recognises them.
const PHARMA_EQUIPMENT_WHITELIST = [
  "bilfinger life science", "pester pac", "coperion", "gea pharma",
  "hosokawa alpine", "glatt group", "syntegon", "ima ", "optima pharma",
  "fette compacting", "romaco", "körber pharma", "bosch packaging", "groninger",
];
const PHARMA_EQUIPMENT_INDUSTRY = "Pharmaceutical Equipment Manufacturing";
function isNonPharmaIndustry(industry: string): boolean {
  const v = industry || "";
  if (!v) return false;
  return NON_PHARMA_INDUSTRY_PATTERNS.some((re) => re.test(v));
}
// Back-compat alias (older name); not used externally but kept for clarity.
function isGenericMachineryIndustry(industry: string): boolean {
  return isNonPharmaIndustry(industry);
}
function hasPharmaSignal(...fields: string[]): boolean {
  const blob = fields.filter(Boolean).join(" ");
  return PHARMA_KEYWORD_PATTERNS.some((re) => re.test(blob));
}
function matchesPharmaEquipmentWhitelist(name: string): boolean {
  const n = (name || "").toLowerCase();
  return PHARMA_EQUIPMENT_WHITELIST.some((w) => n.includes(w));
}

// ----------------------------------------------------------------------------
// Step 5: legacy manual-split duplicates.
// The CSV master lists were authored before the multi-location model existed
// and manually exploded a few companies into multiple rows ("Vetter Pharma",
// "Vetter Pharma-Fertigung", "Vetter Pharma Ravensburg (small site)"). With
// the Crustdata-driven HQ+offices model, ONE row + N locations replaces N
// rows × 1 location. Drop the legacy splits — the surviving Crustdata-joined
// row covers them all.
//
// Strategy: for each company that resolves against Crustdata, keep at most one
// row (the canonical Crustdata one). Other CSV rows whose normalized name
// matches the same Crustdata record are dropped as "duplicate_manual_split".
// ----------------------------------------------------------------------------
const droppedManualSplits: { name: string; reason: string }[] = [];
// Track which Crustdata-keyed company has already been emitted, so a second
// CSV row with the same canonical Crustdata identity gets dropped.
const seenCrustdataKey = new Set<string>();

const seen = new Set<string>();
const out: Array<Record<string, unknown>> = [];
let droppedExcluded = 0;
let droppedIndustrialFalsePositive = 0;
let reclassifiedPharmaEquipment = 0;
let joinedCrustdata = 0;

for (const r of unifiedRows) {
  if (!r.name) continue;
  const id = slug(`${r.name}-${r.city}-${r.country}`);
  if (seen.has(id)) continue;
  seen.add(id);

  // Apply newer tier + exclusion data from companies_tiered.csv if present.
  const tieredHit = tieredByKey.get(rowKey(r.name, r.city, r.country));
  const effectiveTier = ((tieredHit?.tier ?? r.tier) || "").trim();
  let effectiveExclusion = (tieredHit?.exclusion_reason ?? r.exclusion_reason) || "";
  const effectiveScore = tieredHit?.score ?? r.score;
  const effectiveScoreBreakdown = tieredHit?.score_breakdown ?? r.score_breakdown;

  // DROP excluded companies entirely from the shipped JSON.
  if (effectiveTier === "Excluded" || effectiveExclusion.trim().length > 0) {
    droppedExcluded++;
    continue;
  }

  const split = splitSpecialty(r.specialty);
  let industry = split.industry;

  // Reclassify legit pharma-equipment vendors before the industrial guardrail
  // runs so they survive the drop.
  if (matchesPharmaEquipmentWhitelist(r.name)) {
    if (industry !== PHARMA_EQUIPMENT_INDUSTRY) {
      industry = PHARMA_EQUIPMENT_INDUSTRY;
      reclassifiedPharmaEquipment++;
    }
  } else if (
    isNonPharmaIndustry(industry) &&
    !hasPharmaSignal(industry, split.description, r.specialty)
  ) {
    // Non-pharma false-positive: drop entirely (applies to ALL buckets).
    droppedIndustrialFalsePositive++;
    effectiveExclusion = "non_pharma_false_positive";
    continue;
  } else if (
    !industry &&
    (r.source || "").trim().toLowerCase() === "crustdata" &&
    !hasPharmaSignal(split.description, r.specialty, r.build_signal)
  ) {
    // Empty-industry + pure-crustdata + no pharma signal anywhere = the
    // industry-leak guard stripped a non-pharma prose label (eg. Bender's
    // electrical-safety blurb, RAFI HMI components). Drop these too;
    // legitimate research-validated rows are exempt because their source
    // string includes "research".
    droppedIndustrialFalsePositive++;
    effectiveExclusion = "non_pharma_false_positive";
    continue;
  }
  // If the CSV description is truncated mid-sentence (truncated at 85 chars
  // upstream), swap in the full Crustdata LinkedIn description when we have it.
  let description = split.description;
  if (isTruncatedDescription(description)) {
    const fuller = findFullDescription(r.name);
    if (fuller && fuller.length > description.length) description = fuller;
  }
  const coord = cache[key(r.city, r.country)] ?? null;
  const logoUrl = findLogoUrl(r.name);

  const companyKey = normalizeCompanyName(r.name);
  const matched = findMgmtMatch(companyKey);
  // Sort by seniority then years; cap at 8 contacts
  const contacts = [...matched]
    .sort((a, b) => seniorityRank(a.seniority) - seniorityRank(b.seniority) || (Number(b.years_at_company) || 0) - (Number(a.years_at_company) || 0))
    .slice(0, 8)
    .map((m) => ({
      name: m.person_name?.trim() ?? "",
      title: m.title?.trim() ?? "",
      seniority: m.seniority?.trim() ?? "",
      yearsAtCompany: parseNum(m.years_at_company),
      linkedinUrl: m.person_linkedin_url?.trim() ?? "",
      location: m.location?.trim() ?? "",
      headline: m.headline?.trim() ?? "",
      photoUrl: personPhotos.get((m.person_linkedin_url || "").trim()) ?? null,
    }));

  const tier = effectiveTier;

  // Bug 2 fix: recover empty industry from oncologyTags / buckets / source.
  const bucketsList = listSplit(r.bucket);
  const oncologyTagsList = listSplit(r.oncology_tags);
  if (!industry || !industry.trim()) {
    const recovered = recoverIndustry(oncologyTagsList, bucketsList, r.source);
    if (recovered) industry = recovered;
  }

  // Bug 1 fix: strip parens annotation off the displayed name; keep context
  // in description for the About panel.
  const stripped = stripNameParens(r.name, description);
  const cleanName = stripped.name;
  description = stripped.description;

  let employeesParsed = parseEmployees(r.employees);
  let { revLowerUsd, revHigherUsd } = resolveRevenue(
    r.rev_lower_usd,
    r.rev_higher_usd,
    employeesParsed,
  );

  // MANUAL_OVERRIDES: patch mega-pharma rows whose source data is division- or
  // subsidiary-scoped (see manual_overrides.json — written by tier_scoring.py).
  // Match against the RAW source-CSV name (`r.name`) BEFORE paren-stripping,
  // since override keys include the parenthetical (e.g. "bayer ag
  // (pharmaceuticals division)"). Fall back to cleanName for rows whose source
  // name is already canonical.
  const mo = findManualOverride(r.name) ?? findManualOverride(cleanName);
  if (mo) {
    if (typeof mo.employees === "number") employeesParsed = mo.employees;
    if (typeof mo.rev_lower_usd === "number") revLowerUsd = mo.rev_lower_usd;
    if (typeof mo.rev_higher_usd === "number") revHigherUsd = mo.rev_higher_usd;
  }

  // Multi-location join: look up the company in the Crustdata HQ+offices
  // index. When found, locations[0] = HQ replaces the row's flat city/country,
  // and the full Location[] is stamped onto the company. Geocoding happens
  // in a second pass below (async, rate-limited).
  const crustdataHit = findCrustdataLocations(cleanName);
  let rowCity = r.city;
  let rowCountry = r.country;
  let locations: Location[] = [];
  if (crustdataHit) {
    const matchedKey = crustdataHit.matchedKey;
    if (seenCrustdataKey.has(matchedKey)) {
      // Manual-split duplicate of an already-emitted row (eg. "Vetter Pharma"
      // was emitted first; "Vetter Pharma-Fertigung" hits the same Crustdata
      // record via fuzzy substring match → matchedKey collides → dropped).
      droppedManualSplits.push({ name: cleanName, reason: `duplicate_of:${matchedKey}` });
      continue;
    }
    seenCrustdataKey.add(matchedKey);
    locations = crustdataHit.rec.locations;
    rowCity = locations[0].city;
    rowCountry = locations[0].country;
    joinedCrustdata++;
  } else {
    // No Crustdata hit on the cleanName. But the row may still be a manual
    // split of an already-emitted Crustdata-joined row (eg. "Vetter Pharma
    // Ravensburg (small site)" → norm "vetterravensburgsmallsite" — fails
    // the 60% substring threshold but starts with "vetter"). Drop when the
    // current row's normalized name STARTS WITH a key already emitted via
    // Crustdata.
    const norm = normalizeCompanyName(cleanName);
    let matchedKey: string | null = null;
    if (norm.length >= 4) {
      for (const ck of seenCrustdataKey) {
        if (ck.length < 4 || ck === norm) continue;
        // Strict: norm starts with the canonical Crustdata key (Vetter Pharma
        // Ravensburg → vetterravensburg → startswith vetter).
        if (norm.startsWith(ck) && norm.length > ck.length) {
          matchedKey = ck;
          break;
        }
        // Looser: norm CONTAINS the canonical key as a substring AND the
        // Crustdata key is "substantial" (≥ 5 chars) — catches "F. Hoffmann-La
        // Roche AG" → "fhoffmannlaroche" containing "roche". Guarded against
        // trivial 4-char-suffix collisions.
        if (ck.length >= 5 && norm.includes(ck)) {
          matchedKey = ck;
          break;
        }
      }
    }
    if (matchedKey) {
      droppedManualSplits.push({ name: cleanName, reason: `manual_split:${matchedKey}` });
      continue;
    }
  }

  out.push({
    id,
    name: cleanName,
    country: rowCountry,
    city: rowCity,
    employees: employeesParsed,
    revLowerUsd,
    revHigherUsd,
    buckets: bucketsList,
    source: r.source,
    industry,
    description,
    buildSignal: cleanBuildSignal(r.build_signal),
    url: r.source_url,
    oncologyTags: oncologyTagsList,
    status: "PROSPECT",
    // When we have a Crustdata join, defer lat/lon to the address geocoder
    // (the HQ's geocoded coords overwrite the legacy city-centroid lookup).
    lat: locations.length > 0 ? null : (coord?.lat ?? null),
    lon: locations.length > 0 ? null : (coord?.lon ?? null),
    tier,
    score: parseNum(effectiveScore),
    scoreBreakdown: effectiveScoreBreakdown ?? "",
    exclusionReason: effectiveExclusion ?? "",
    logoUrl,
    growth12mPct: parseNum(r.growth_12m_pct),
    growth3mPct: parseNum(r.growth_3m_pct),
    followerGrowth12mPct: parseNum(r.follower_growth_12m_pct),
    lastFundingRound: r.last_funding_round ?? "",
    lastFundingDate: r.last_funding_date ?? "",
    totalInvestmentUsd: parseNum(r.total_investment_usd),
    roleEngPct: parseNum(r.role_eng_pct),
    roleOpsPct: parseNum(r.role_ops_pct),
    roleResearchPct: parseNum(r.role_research_pct),
    roleQaPct: parseNum(r.role_qa_pct),
    contacts,
    locations,
  });
}

// ----------------------------------------------------------------------------
// Step 3 continued: address-level geocoding pass.
// Walk every company's locations[], geocode each unique address, fill lat/lon.
// Then set the top-level company.lat/lon to the HQ's geocoded values.
// Cache is persisted on the way (1 save per 25 lookups).
// ----------------------------------------------------------------------------
async function geocodePass() {
  // Collect every distinct address (street|city|postcode|country) across all
  // companies' locations to dedupe HTTP traffic.
  const unique = new Map<string, Location>();
  for (const c of out) {
    const locs = c.locations as Location[];
    if (!Array.isArray(locs)) continue;
    for (const loc of locs) {
      const k = addrKey(loc);
      if (!unique.has(k)) unique.set(k, loc);
    }
  }
  const todo: Location[] = [];
  for (const [k, loc] of unique) {
    if (!(k in addressCache)) todo.push(loc);
  }
  // Per-run budget so we can ship partial progress on a slow Nominatim day.
  // GEOCODE_BUDGET=0 (default) = no cap → run to completion.
  const budgetRaw = process.env.GEOCODE_BUDGET;
  const budget = budgetRaw ? Number(budgetRaw) : 0;
  const effectiveTodo = budget > 0 ? todo.slice(0, budget) : todo;
  console.log(`geocode: ${unique.size} unique addresses, ${todo.length} to fetch, ${unique.size - todo.length} cached${budget > 0 ? `, budget=${budget}` : ""}`);
  let i = 0;
  for (const loc of effectiveTodo) {
    await geocodeAddress(loc);
    i++;
    if (i % 10 === 0) {
      saveAddressCache();
      console.log(`  geocode progress: ${i}/${effectiveTodo.length}`);
    }
    // Nominatim ToS: max 1 req/sec.
    await new Promise((res) => setTimeout(res, 1100));
  }
  saveAddressCache();

  // Stamp coords back onto every location, and lift HQ → company.lat/lon.
  let hqHits = 0;
  let officeHits = 0;
  for (const c of out) {
    const locs = c.locations as Location[];
    if (!Array.isArray(locs) || locs.length === 0) continue;
    for (const loc of locs) {
      const hit = addressCache[addrKey(loc)];
      if (hit) {
        loc.lat = hit.lat;
        loc.lon = hit.lon;
      }
    }
    const hq = locs[0];
    if (hq && hq.lat != null && hq.lon != null) {
      c.lat = hq.lat;
      c.lon = hq.lon;
      hqHits++;
    } else if (c.lat == null) {
      // Fallback to the legacy city,country cache so we don't regress companies
      // whose HQ address Nominatim couldn't resolve.
      const fallback = cache[key((c.city as string) || "", (c.country as string) || "")] ?? null;
      if (fallback) {
        c.lat = fallback.lat;
        c.lon = fallback.lon;
      }
    }
    officeHits += locs.slice(1).filter((l) => l.lat != null).length;
  }
  console.log(`geocode results: ${hqHits} HQs with coords, ${officeHits} offices with coords`);
}

// ----------------------------------------------------------------------------
// Step 6: DACH filter.
// Keep companies with HQ in DEU/AUT/CHE OR ≥1 office in DEU/AUT/CHE.
// (Non-DACH companies were already filtered upstream in most cases, but the
// Crustdata join can bring in fresh non-DACH headquarters via the office_addresses
// match. We re-apply the filter here as a safety net.)
// ----------------------------------------------------------------------------
function isDachCountry(iso3: string): boolean {
  return iso3 === "DEU" || iso3 === "AUT" || iso3 === "CHE";
}
function applyDachFilter() {
  let dropped = 0;
  const kept: Array<Record<string, unknown>> = [];
  for (const c of out) {
    const countryIso3 = toISO3((c.country as string) || "");
    const locs = (c.locations as Location[]) || [];
    const hqDach = isDachCountry(countryIso3);
    const officeDach = locs.some((l) => l.role === "office" && isDachCountry(l.country));
    if (hqDach || officeDach) {
      kept.push(c);
    } else {
      dropped++;
    }
  }
  out.length = 0;
  out.push(...kept);
  console.log(`DACH filter: dropped ${dropped} non-DACH companies, kept ${out.length}`);
}

type CoverageStat = {
  total: number;
  withContacts: number;
  withFullDescription: number;
  withGrowthData: number;
};
type ShippedCompany = {
  tier: string;
  description: string;
  contacts: unknown[];
  growth12mPct: number | null;
};

async function finalize() {
  await geocodePass();
  applyDachFilter();
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`wrote ${out.length} companies → ${OUT}`);
  console.log(`  dropped excluded: ${droppedExcluded}`);
  console.log(`  dropped industrial false positives: ${droppedIndustrialFalsePositive}`);
  console.log(`  dropped manual splits (covered by Crustdata): ${droppedManualSplits.length}`);
  if (droppedManualSplits.length > 0) {
    console.log(`    examples:`, droppedManualSplits.slice(0, 10));
  }
  console.log(`  reclassified as pharma equipment: ${reclassifiedPharmaEquipment}`);
  console.log(`  joined to crustdata multi-location: ${joinedCrustdata}`);
  let totalLocations = 0;
  let totalOffices = 0;
  for (const c of out) {
    const locs = (c.locations as Location[]) || [];
    totalLocations += locs.length;
    totalOffices += locs.filter((l) => l.role === "office").length;
  }
  console.log(`  total locations: ${totalLocations} (offices: ${totalOffices})`);
  const tierCounts: Record<string, number> = {};
  let withCoords = 0, withContacts = 0;
  for (const c of out as unknown as Array<{ tier: string; lat: number | null; contacts: unknown[] }>) {
    tierCounts[c.tier || "(none)"] = (tierCounts[c.tier || "(none)"] ?? 0) + 1;
    if (c.lat != null) withCoords++;
    if (c.contacts.length > 0) withContacts++;
  }
  console.log(`  with coords: ${withCoords}`);
  console.log(`  with real contacts: ${withContacts}`);
  console.log(`  by tier:`, tierCounts);

  const coverageTiers: Record<string, CoverageStat> = {};
  for (const c of out as unknown as ShippedCompany[]) {
    const tier = c.tier || "(none)";
    if (!coverageTiers[tier]) {
      coverageTiers[tier] = { total: 0, withContacts: 0, withFullDescription: 0, withGrowthData: 0 };
    }
    const s = coverageTiers[tier];
    s.total++;
    if (Array.isArray(c.contacts) && c.contacts.length > 0) s.withContacts++;
    if ((c.description || "").trim().length >= 80) s.withFullDescription++;
    if (c.growth12mPct != null) s.withGrowthData++;
  }
  const COVERAGE_OUT = join(ROOT, "public/coverage-report.json");
  writeFileSync(
    COVERAGE_OUT,
    JSON.stringify({ generatedAt: new Date().toISOString(), tiers: coverageTiers }, null, 2)
  );
  console.log(`wrote coverage report → ${COVERAGE_OUT}`);
  console.log(`  coverage:`, coverageTiers);

  // Take a startup snapshot of the freshly-built companies.json so a future
  // bad patch can always be rolled back to the last full build. Backup
  // failures here are non-fatal — the build itself already succeeded.
  try {
    const backupPath = await backupCompaniesJson();
    console.log(`wrote backup snapshot → ${backupPath}`);
  } catch (e) {
    console.warn(
      `backup snapshot failed (non-fatal):`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

finalize().catch((e) => {
  console.error(e);
  process.exit(1);
});
