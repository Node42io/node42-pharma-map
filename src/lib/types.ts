export type Status = "PROSPECT" | "LEAD" | "ACTIVE";

export type Tier = "Tier 1" | "Tier 2" | "Tier 3" | "Tier 4" | "";

export type SiteRole = "HQ" | "office";

// One physical site of a company — HQ + each entry in Crustdata's
// `office_addresses[]`. The flat top-level `city`/`country`/`lat`/`lon` on
// Company always mirror the HQ values; offices live exclusively in
// `locations[]`.
export type Location = {
  role: SiteRole;
  street: string | null;
  city: string;
  postcode: string | null;
  country: string;        // ISO3
  lat: number | null;
  lon: number | null;
  // Best-effort headcount hint from Crustdata's `region_distribution` map.
  // Null when the office's city/region didn't match a region key.
  employeesHint: number | null;
};

export type ManagementProfile = {
  name: string;
  title: string;
  seniority: string; // CXO, Vice President, Director, etc.
  yearsAtCompany: number | null;
  linkedinUrl: string;
  location: string;
  headline: string;
  photoUrl: string | null; // Crustdata-hosted profile photo (LinkedIn-sourced)
};

export type Company = {
  id: string;
  name: string;
  country: string;
  city: string;
  employees: number | null;
  // Crustdata-reported revenue bracket (USD). Both may be null when Crustdata
  // doesn't have a real revenue figure — in that case the UI falls back to
  // employees-derived bands. `revHigherUsd >= 1e9` is treated as the "1B+"
  // uncapped sentinel (Crustdata returns 1e12 for that case).
  revLowerUsd: number | null;
  revHigherUsd: number | null;
  buckets: string[];
  source: string;
  industry: string;
  description: string;
  buildSignal: string;
  url: string;
  oncologyTags: string[];
  status: Status;
  lat: number | null;
  lon: number | null;
  // Tier scoring (from enriched CSV)
  tier: Tier;
  score: number | null;
  scoreBreakdown: string;
  exclusionReason: string;
  // Growth & funding (from Crustdata enrichment)
  growth12mPct: number | null;
  growth3mPct: number | null;
  followerGrowth12mPct: number | null;
  lastFundingRound: string;
  lastFundingDate: string;
  totalInvestmentUsd: number | null;
  // Role distribution
  roleEngPct: number | null;
  roleOpsPct: number | null;
  roleResearchPct: number | null;
  roleQaPct: number | null;
  // Crustdata-hosted company logo (S3 permalink). Null if not in bucket dumps.
  logoUrl: string | null;
  // Real management profiles (joined from management.csv)
  contacts: ManagementProfile[];
  // Multi-site model: HQ (locations[0]) + each Crustdata office_address as
  // its own pin. Top-level `city`/`country`/`lat`/`lon` mirror the HQ. When
  // the company wasn't joined against Crustdata's office data, `locations`
  // is an empty array (the HQ is then represented only by the flat fields).
  locations: Location[];
};

export type Filters = {
  q: string;
  buckets: string[];
  oncologyTags: string[];
  countries: string[];
  employeesMin: number | null;
  employeesMax: number | null;
  status: Status[];
  tiers: Tier[];
  naicsGroups: string[];
  hasBuildSignal: boolean;
};

export const EMPTY_FILTERS: Filters = {
  q: "",
  buckets: [],
  oncologyTags: [],
  countries: [],
  employeesMin: null,
  employeesMax: null,
  status: [],
  tiers: [],
  naicsGroups: [],
  hasBuildSignal: false,
};
