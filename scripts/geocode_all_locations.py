#!/usr/bin/env python3
"""
Resumable, country-agnostic location geocoder.

- Reads public/companies.json
- Finds ANY location (office, HQ, anything) with lat == null
- Reuses scripts/.address-geocode-cache.json
- Geocodes missing addresses via Photon (https://photon.komoot.io/api)
- Writes coords back into companies.json in-place
- Saves cache after every successful response
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPANIES = ROOT / "public" / "companies.json"
CACHE = ROOT / "scripts" / ".address-geocode-cache.json"

ISO3_NAME = {
    "DEU": "Germany",
    "CHE": "Switzerland",
    "AUT": "Austria",
    "USA": "United States",
    "GBR": "United Kingdom",
    "FRA": "France",
    "NLD": "Netherlands",
    "BEL": "Belgium",
    "ESP": "Spain",
    "ITA": "Italy",
    "POL": "Poland",
    "FIN": "Finland",
    "DNK": "Denmark",
    "SWE": "Sweden",
    "NOR": "Norway",
    "IRL": "Ireland",
    "CHN": "China",
    "JPN": "Japan",
    "IND": "India",
    "KOR": "South Korea",
    "SGP": "Singapore",
    "AUS": "Australia",
    "BRA": "Brazil",
    "MEX": "Mexico",
    "COL": "Colombia",
    "VEN": "Venezuela",
    "ARG": "Argentina",
    "CAN": "Canada",
    "ZAF": "South Africa",
    "ISR": "Israel",
    "TUR": "Turkey",
    "HUN": "Hungary",
    "CZE": "Czechia",
    "SVK": "Slovakia",
    "ROU": "Romania",
    # Common extras likely to appear in the dataset
    "PRT": "Portugal",
    "GRC": "Greece",
    "RUS": "Russia",
    "UKR": "Ukraine",
    "TWN": "Taiwan",
    "HKG": "Hong Kong",
    "MYS": "Malaysia",
    "THA": "Thailand",
    "IDN": "Indonesia",
    "VNM": "Vietnam",
    "PHL": "Philippines",
    "NZL": "New Zealand",
    "CHL": "Chile",
    "PER": "Peru",
    "URY": "Uruguay",
    "EGY": "Egypt",
    "ARE": "United Arab Emirates",
    "SAU": "Saudi Arabia",
    "KWT": "Kuwait",
    "QAT": "Qatar",
    "LUX": "Luxembourg",
    "ISL": "Iceland",
    "LIE": "Liechtenstein",
    "MCO": "Monaco",
    "SVN": "Slovenia",
    "HRV": "Croatia",
    "BGR": "Bulgaria",
    "SRB": "Serbia",
    "EST": "Estonia",
    "LTU": "Lithuania",
    "LVA": "Latvia",
    "BLR": "Belarus",
    "MAR": "Morocco",
    "TUN": "Tunisia",
    "DZA": "Algeria",
    "NGA": "Nigeria",
    "KEN": "Kenya",
    "ETH": "Ethiopia",
    "PAK": "Pakistan",
    "BGD": "Bangladesh",
    "LKA": "Sri Lanka",
    "KAZ": "Kazakhstan",
    "UZB": "Uzbekistan",
    "AZE": "Azerbaijan",
    "GEO": "Georgia",
    "ARM": "Armenia",
    "JOR": "Jordan",
    "LBN": "Lebanon",
    "IRN": "Iran",
    "IRQ": "Iraq",
    "MLT": "Malta",
    "CYP": "Cyprus",
    "ALB": "Albania",
    "MKD": "North Macedonia",
    "MNE": "Montenegro",
    "BIH": "Bosnia and Herzegovina",
    "MDA": "Moldova",
    "PAN": "Panama",
    "CIV": "Ivory Coast",
    "PRI": "Puerto Rico",
    "CRI": "Costa Rica",
    "OMN": "Oman",
    "BRB": "Barbados",
    "CMR": "Cameroon",
    "SEN": "Senegal",
    "ZMB": "Zambia",
    "ECU": "Ecuador",
    "GTM": "Guatemala",
    "HND": "Honduras",
    "SLV": "El Salvador",
    "DOM": "Dominican Republic",
    "JAM": "Jamaica",
    "BHS": "Bahamas",
    "TTO": "Trinidad and Tobago",
    "PRY": "Paraguay",
    "BOL": "Bolivia",
    "NIC": "Nicaragua",
    "GHA": "Ghana",
    "TZA": "Tanzania",
    "UGA": "Uganda",
    "MUS": "Mauritius",
    "MDG": "Madagascar",
    "BHR": "Bahrain",
    # 2-letter codes that appear by mistake
    "CW": "Curacao",
    "SD": "Sudan",
    "SS": "South Sudan",
    "MO": "Macau",
}

MAX_PER_RUN = int(os.environ.get("MAX_PER_RUN", "5000"))
PHOTON_URL = "https://photon.komoot.io/api"
SLEEP = float(os.environ.get("PHOTON_SLEEP", "0.1"))
RETRY_MISSES = os.environ.get("RETRY_MISSES", "0") == "1"


def addr_key(loc: dict) -> str:
    return "|".join(
        [
            loc.get("street") or "",
            loc.get("city") or "",
            loc.get("postcode") or "",
            loc.get("country") or "",
        ]
    ).lower()


def load_cache() -> dict:
    if CACHE.exists():
        with open(CACHE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache: dict) -> None:
    tmp = CACHE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)
    tmp.replace(CACHE)


def build_query(loc: dict, country_name: str) -> str | None:
    street = (loc.get("street") or "").strip()
    city = (loc.get("city") or "").strip()
    postcode = (loc.get("postcode") or "").strip()
    if street and city:
        if postcode:
            return f"{street}, {postcode} {city}, {country_name}"
        return f"{street}, {city}, {country_name}"
    if city:
        if postcode:
            return f"{postcode} {city}, {country_name}"
        return f"{city}, {country_name}"
    if street:
        return f"{street}, {country_name}"
    return None


def photon_geocode(query: str) -> tuple[float, float] | None:
    url = f"{PHOTON_URL}?q={urllib.parse.quote(query)}&limit=1"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "node42-pharma-map/0.4 (location geocoder)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except Exception as e:
        print(f"  ERR photon: {e}", file=sys.stderr)
        return None
    feats = data.get("features") or []
    if not feats:
        return None
    coords = feats[0].get("geometry", {}).get("coordinates")
    if not coords or len(coords) < 2:
        return None
    lon, lat = float(coords[0]), float(coords[1])
    # Basic sanity: valid lat/lon range
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon


def main():
    with open(COMPANIES, "r", encoding="utf-8") as f:
        companies = json.load(f)
    cache = load_cache()

    skipped_unknown_country: dict[str, int] = {}
    skipped_no_query = 0

    # Pass 1: collect work
    targets: list[tuple[dict, dict, str, str]] = []  # (company, loc, key, country_name)
    for c in companies:
        for loc in c.get("locations") or []:
            if loc.get("lat") is not None:
                continue
            country = loc.get("country") or ""
            country_name = ISO3_NAME.get(country)
            if not country_name:
                skipped_unknown_country[country] = skipped_unknown_country.get(country, 0) + 1
                continue
            targets.append((c, loc, addr_key(loc), country_name))

    if not targets:
        print("nothing to do — all locations already have coords.")
        return

    # Pass 2: stamp anything already in the cache (free).
    stamped_from_cache = 0
    needs_fetch: list[tuple[dict, dict, str, str]] = []
    cached_misses = 0
    for company, loc, k, cname in targets:
        hit = cache.get(k, "__MISSING__")
        if hit == "__MISSING__":
            needs_fetch.append((company, loc, k, cname))
        elif hit is None:
            if RETRY_MISSES:
                needs_fetch.append((company, loc, k, cname))
            else:
                cached_misses += 1
        else:
            loc["lat"] = hit["lat"]
            loc["lon"] = hit["lon"]
            stamped_from_cache += 1

    print(f"locations needing coords: {len(targets)}")
    print(f"  stamped from existing cache: {stamped_from_cache}")
    print(f"  cached as unresolved (skipping): {cached_misses}")
    print(f"  need fresh Photon geocode: {len(needs_fetch)}")
    if skipped_unknown_country:
        print(f"  skipped (unknown country code): {skipped_unknown_country}")

    # Pass 3: geocode in chunks via Photon.
    fetched_hit = 0
    fetched_miss = 0
    processed = 0
    unresolved_samples: list[str] = []
    unresolved_patterns: dict[str, int] = {}

    # Write companies.json early once if we stamped from cache.
    if stamped_from_cache:
        with open(COMPANIES, "w", encoding="utf-8") as f:
            json.dump(companies, f, ensure_ascii=False)

    for company, loc, k, cname in needs_fetch:
        if processed >= MAX_PER_RUN:
            print(f"  hit MAX_PER_RUN={MAX_PER_RUN}, stopping cleanly.")
            break
        q = build_query(loc, cname)
        if not q:
            skipped_no_query += 1
            cache[k] = None
            save_cache(cache)
            continue
        result = photon_geocode(q)
        processed += 1
        if result is None:
            cache[k] = None
            fetched_miss += 1
            patt = f"street={'Y' if loc.get('street') else 'N'} city={'Y' if loc.get('city') else 'N'} pc={'Y' if loc.get('postcode') else 'N'} country={loc.get('country','')}"
            unresolved_patterns[patt] = unresolved_patterns.get(patt, 0) + 1
            if len(unresolved_samples) < 10:
                unresolved_samples.append(
                    f"{company.get('name','?')} :: {loc.get('street','')}, {loc.get('postcode','')} {loc.get('city','')}, {loc.get('country','')}"
                )
        else:
            lat, lon = result
            cache[k] = {"lat": lat, "lon": lon}
            loc["lat"] = lat
            loc["lon"] = lon
            fetched_hit += 1
        save_cache(cache)
        if processed % 50 == 0:
            print(f"  progress {processed}/{min(len(needs_fetch), MAX_PER_RUN)}  hits={fetched_hit} miss={fetched_miss}")
            # Persist companies.json periodically so a kill doesn't lose progress
            with open(COMPANIES, "w", encoding="utf-8") as f:
                json.dump(companies, f, ensure_ascii=False)
        time.sleep(SLEEP)

    # Final write
    with open(COMPANIES, "w", encoding="utf-8") as f:
        json.dump(companies, f, ensure_ascii=False)

    # Summary
    total_locs = 0
    locs_with_coords = 0
    for c in companies:
        for loc in c.get("locations") or []:
            total_locs += 1
            if loc.get("lat") is not None:
                locs_with_coords += 1
    print()
    print(f"=== run summary ===")
    print(f"photon hits this run:   {fetched_hit}")
    print(f"photon misses this run: {fetched_miss}")
    print(f"stamped from existing cache: {stamped_from_cache}")
    print(f"skipped (no query):     {skipped_no_query}")
    print(f"skipped (unknown country): {sum(skipped_unknown_country.values())} → {skipped_unknown_country}")
    print(f"total locations: {total_locs}")
    print(f"with coords now: {locs_with_coords}  ({100*locs_with_coords/max(total_locs,1):.1f}%)")
    if unresolved_patterns:
        print(f"unresolved patterns (top 10):")
        for patt, cnt in sorted(unresolved_patterns.items(), key=lambda x: -x[1])[:10]:
            print(f"  {cnt:>4}  {patt}")
    if unresolved_samples:
        print(f"unresolved samples ({len(unresolved_samples)}):")
        for s in unresolved_samples:
            print(f"  - {s}")


if __name__ == "__main__":
    main()
