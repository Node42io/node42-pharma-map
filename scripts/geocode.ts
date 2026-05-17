import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Papa from "papaparse";

type Row = { name: string; country: string; city: string };
type Cache = Record<string, { lat: number; lon: number } | null>;

const ROOT = join(process.cwd());
const CSV = join(ROOT, "data/companies.csv");
const CACHE = join(ROOT, "scripts/.geocode-cache.json");

const COUNTRY_TO_NAME: Record<string, string> = {
  DEU: "Germany",
  CHE: "Switzerland",
  AUT: "Austria",
  USA: "United States",
  GBR: "United Kingdom",
  FRA: "France",
  ITA: "Italy",
  ESP: "Spain",
  NLD: "Netherlands",
  BEL: "Belgium",
  DNK: "Denmark",
  SWE: "Sweden",
  NOR: "Norway",
  FIN: "Finland",
  POL: "Poland",
  CZE: "Czechia",
  HUN: "Hungary",
  IRL: "Ireland",
  PRT: "Portugal",
  GRC: "Greece",
  TUR: "Turkey",
  CAN: "Canada",
  JPN: "Japan",
  CHN: "China",
  IND: "India",
  AUS: "Australia",
  BRA: "Brazil",
};

// Country centroids. Previously these were used as a FALLBACK when geocoding
// failed — but that quietly piled ~60 companies on top of one another in the
// dead centre of Germany and looked indistinguishable on the map from real
// hits. They are kept here only so we can DETECT a centroid-shaped response
// from Nominatim and reject it as "geocode failed". We never write a country
// centroid into the cache anymore.
const COUNTRY_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  DEU: { lat: 51.1657, lon: 10.4515 },
  CHE: { lat: 46.8182, lon: 8.2275 },
  AUT: { lat: 47.5162, lon: 14.5501 },
  USA: { lat: 39.8283, lon: -98.5795 },
  GBR: { lat: 55.3781, lon: -3.4360 },
  FRA: { lat: 46.2276, lon: 2.2137 },
  ITA: { lat: 41.8719, lon: 12.5674 },
  ESP: { lat: 40.4637, lon: -3.7492 },
  NLD: { lat: 52.1326, lon: 5.2913 },
  BEL: { lat: 50.5039, lon: 4.4699 },
  DNK: { lat: 56.2639, lon: 9.5018 },
  SWE: { lat: 60.1282, lon: 18.6435 },
};

// True if (lat, lon) sits on any well-known country centroid (±0.01° ≈ 1km).
// Used to reject Nominatim responses that fell back to the country centroid
// (which happens when the query string is unparseable — eg. a multi-city
// HQ blob like "Ravensburg, Langenargen" or "US HQ; DE").
export function isCountryCentroid(lat: number, lon: number): boolean {
  for (const { lat: clat, lon: clon } of Object.values(COUNTRY_CENTROIDS)) {
    if (Math.abs(lat - clat) < 0.01 && Math.abs(lon - clon) < 0.01) return true;
  }
  return false;
}

// Preprocess a `city` value before geocoding. Multi-city strings like
//   "Ravensburg, Langenargen"
//   "Heidelberg + Marburg"
//   "US HQ; DE"
//   "Bergkamen (HQ)"
//   "Bergisch Gladbach (HQ) + Teterow"
// cause Nominatim to silently fall back to the country centroid because it
// can't resolve the whole blob as a place. We take the first plausible city
// token: split on , ; / + & "and", drop parenthetical annotations, trim.
export function preprocessCity(city: string): string {
  if (!city) return "";
  // Split on common multi-city separators. Use a regex with " and " (word
  // boundaries) so we don't split inside city names that happen to contain
  // "and" as part of a single word.
  const parts = city.split(/[,;/+&]|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  let first = parts[0] ?? city.trim();
  // Drop parenthetical annotations: "Ravensburg (HQ)" → "Ravensburg",
  // "Reinbek (Hamburg)" → "Reinbek".
  first = first.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  // Strip trailing 2-letter country hints like "Neuss (DE)" → handled above,
  // but also handle bare "Neuss DE" form that some rows use.
  first = first.replace(/\s+(?:DE|AT|CH|US|UK|FR|IT|ES|NL|BE)$/i, "").trim();
  return first;
}

function loadCache(): Cache {
  if (!existsSync(CACHE)) return {};
  try { return JSON.parse(readFileSync(CACHE, "utf8")); } catch { return {}; }
}

function saveCache(c: Cache) {
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(c, null, 2));
}

// Cache key — uses the RAW city string. We deliberately don't normalise to
// the preprocessed city here so cache hits stay stable per CSV row; the
// preprocessing happens just-in-time before the Nominatim query.
export function key(city: string, country: string) {
  return `${city.trim().toLowerCase()}|${country.trim().toUpperCase()}`;
}

async function geocodeOne(city: string, country: string): Promise<{ lat: number; lon: number } | null> {
  const cc = country.trim().toUpperCase();
  const country2 = cc.length === 3 ? COUNTRY_TO_NAME[cc] ?? cc : cc;
  const cityForQuery = preprocessCity(city);
  if (!cityForQuery) return null;
  const q = encodeURIComponent(`${cityForQuery}, ${country2}`);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "node42-pharma-map/0.1 (local dev tool)" },
  });
  if (!r.ok) return null;
  const arr = (await r.json()) as Array<{ lat: string; lon: string }>;
  if (!arr?.length) return null;
  const lat = Number(arr[0].lat);
  const lon = Number(arr[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Reject country-centroid results — these mean Nominatim couldn't resolve
  // the query and silently fell back to the country geometry centre.
  if (isCountryCentroid(lat, lon)) return null;
  return { lat, lon };
}

async function main() {
  const csv = readFileSync(CSV, "utf8");
  const parsed = Papa.parse<Row>(csv, { header: true, skipEmptyLines: true });
  const rows = parsed.data;
  const pairs = new Map<string, Row>();
  for (const r of rows) {
    if (!r.city || !r.country) continue;
    pairs.set(key(r.city, r.country), r);
  }
  const cache = loadCache();

  // Cache invalidation: previous runs of this script wrote country-centroid
  // coordinates whenever Nominatim couldn't resolve a multi-city HQ blob
  // ("Ravensburg, Langenargen", "US HQ; DE", etc.). Those bogus entries pile
  // ~60 pins on top of one another in the dead centre of Germany. Drop them
  // so the loop below re-geocodes them with the new preprocessor.
  let invalidated = 0;
  for (const k of Object.keys(cache)) {
    const v = cache[k];
    if (v && isCountryCentroid(v.lat, v.lon)) {
      delete cache[k];
      invalidated++;
    }
  }
  if (invalidated > 0) console.log(`invalidated ${invalidated} centroid cache entries`);

  const todo = [...pairs.values()].filter((r) => !(key(r.city, r.country) in cache));
  console.log(`unique cities: ${pairs.size} | already cached: ${pairs.size - todo.length} | to fetch: ${todo.length}`);
  let i = 0;
  for (const r of todo) {
    const k = key(r.city, r.country);
    try {
      const hit = await geocodeOne(r.city, r.country);
      cache[k] = hit;
      i++;
      if (i % 10 === 0) {
        saveCache(cache);
        console.log(`  ${i}/${todo.length}  ${r.city}, ${r.country} → ${hit ? `${hit.lat.toFixed(2)},${hit.lon.toFixed(2)}` : "MISS"}`);
      }
    } catch (e) {
      console.warn(`  err ${r.city}, ${r.country}: ${(e as Error).message}`);
      cache[k] = null;
    }
    await new Promise((res) => setTimeout(res, 1100));
  }
  saveCache(cache);
  // NOTE: we intentionally do NOT fall back to country centroids for misses.
  // Unresolved cities stay null in the cache → build-companies.ts emits
  // lat/lon = null for those rows and the UI drops them from the map. This
  // is honest behaviour: better to be missing than to draw a fake pin in
  // the geographic middle of a country.
  const resolved = Object.values(cache).filter((v) => v != null).length;
  const unresolved = Object.values(cache).filter((v) => v == null).length;
  console.log(`done. cache size: ${Object.keys(cache).length} (resolved=${resolved}, unresolved=${unresolved})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
