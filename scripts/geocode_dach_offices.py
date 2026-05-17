#!/usr/bin/env python3
"""
Resumable DACH office geocoder.

- Reads public/companies.json
- Finds office locations in DEU/AUT/CHE with lat == null
- Reuses scripts/.address-geocode-cache.json (same key format as build-companies.ts)
- Geocodes missing addresses via Photon (https://photon.komoot.io/api)
- Writes coords back into companies.json in-place
- Saves cache after every successful response

Exit-clean after MAX_PER_RUN geocodes so an external watchdog can't kill mid-write.
Re-run to continue.
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
    "AUT": "Austria",
    "CHE": "Switzerland",
}

# Country centroids — reject Photon results that snap to country level.
COUNTRY_CENTROIDS = {
    "DEU": (51.1657, 10.4515),
    "CHE": (46.8182, 8.2275),
    "AUT": (47.5162, 14.5501),
}

# Bounding boxes per country to reject coords clearly outside the country.
# (lat_min, lat_max, lon_min, lon_max), generous.
BBOX = {
    "DEU": (47.0, 55.5, 5.5, 15.5),
    "AUT": (46.3, 49.1, 9.4, 17.2),
    "CHE": (45.7, 47.9, 5.9, 10.6),
}

MAX_PER_RUN = int(os.environ.get("MAX_PER_RUN", "400"))
PHOTON_URL = "https://photon.komoot.io/api"
SLEEP = float(os.environ.get("PHOTON_SLEEP", "0.15"))  # be polite to a free service

DACH = {"DEU", "AUT", "CHE"}


def addr_key(loc: dict) -> str:
    return "|".join(
        [loc.get("street") or "", loc.get("city") or "", loc.get("postcode") or "", loc.get("country") or ""]
    ).lower()


def is_country_centroid(lat: float, lon: float) -> bool:
    for clat, clon in COUNTRY_CENTROIDS.values():
        if abs(lat - clat) < 0.01 and abs(lon - clon) < 0.01:
            return True
    return False


def in_bbox(country: str, lat: float, lon: float) -> bool:
    box = BBOX.get(country)
    if not box:
        return True
    lat_min, lat_max, lon_min, lon_max = box
    return lat_min <= lat <= lat_max and lon_min <= lon <= lon_max


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


def photon_geocode(loc: dict) -> tuple[float, float] | None:
    country = loc.get("country", "")
    country_name = ISO3_NAME.get(country, country)
    parts = []
    if loc.get("street"):
        parts.append(loc["street"])
    if loc.get("city"):
        parts.append(loc["city"])
    if loc.get("postcode"):
        parts.append(loc["postcode"])
    parts.append(country_name)
    q = ", ".join(p for p in parts if p)
    cc = {"DEU": "de", "AUT": "at", "CHE": "ch"}.get(country)

    # First attempt: full query + country code restriction.
    url = f"{PHOTON_URL}?q={urllib.parse.quote(q)}&limit=1"
    if cc:
        url += f"&lang=de&osm_tag=!boundary"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "node42-pharma-map/0.3 (dach office geocoder)"},
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
    if is_country_centroid(lat, lon):
        return None
    if not in_bbox(country, lat, lon):
        return None
    return lat, lon


def main():
    with open(COMPANIES, "r", encoding="utf-8") as f:
        companies = json.load(f)
    cache = load_cache()

    # Pass 1: collect work
    targets: list[tuple[dict, dict, str]] = []  # (company, loc, key)
    for c in companies:
        for loc in c.get("locations") or []:
            if loc.get("role") != "office":
                continue
            if loc.get("country") not in DACH:
                continue
            if loc.get("lat") is not None:
                continue
            targets.append((c, loc, addr_key(loc)))

    if not targets:
        print("nothing to do — all DACH offices already have coords.")
        return

    # Pass 2: stamp anything already in the cache (free).
    stamped_from_cache = 0
    needs_fetch: list[tuple[dict, dict, str]] = []
    cached_misses = 0
    for company, loc, k in targets:
        hit = cache.get(k, "__MISSING__")
        if hit == "__MISSING__":
            needs_fetch.append((company, loc, k))
        elif hit is None:
            cached_misses += 1
        else:
            loc["lat"] = hit["lat"]
            loc["lon"] = hit["lon"]
            stamped_from_cache += 1

    print(f"DACH offices needing coords: {len(targets)}")
    print(f"  stamped from existing cache: {stamped_from_cache}")
    print(f"  cached as unresolved (skipping): {cached_misses}")
    print(f"  need fresh Photon geocode: {len(needs_fetch)}")

    # Pass 3: geocode in chunks via Photon.
    fetched_hit = 0
    fetched_miss = 0
    processed = 0
    cache_dirty = stamped_from_cache > 0  # we changed companies.json but not cache yet
    unresolved_samples: list[str] = []

    for company, loc, k in needs_fetch:
        if processed >= MAX_PER_RUN:
            print(f"  hit MAX_PER_RUN={MAX_PER_RUN}, stopping cleanly.")
            break
        result = photon_geocode(loc)
        processed += 1
        if result is None:
            cache[k] = None
            fetched_miss += 1
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
        # Persist cache every iteration so a kill loses nothing.
        save_cache(cache)
        if processed % 25 == 0:
            print(f"  progress {processed}/{min(len(needs_fetch), MAX_PER_RUN)}  hits={fetched_hit} miss={fetched_miss}")
        time.sleep(SLEEP)

    # Write companies.json back out (in-place: only lat/lon mutated).
    with open(COMPANIES, "w", encoding="utf-8") as f:
        json.dump(companies, f, ensure_ascii=False)

    # Summary
    dach_with_coords = 0
    dach_total = 0
    for c in companies:
        for loc in c.get("locations") or []:
            if loc.get("role") == "office" and loc.get("country") in DACH:
                dach_total += 1
                if loc.get("lat") is not None:
                    dach_with_coords += 1
    print()
    print(f"=== run summary ===")
    print(f"photon hits this run: {fetched_hit}")
    print(f"photon misses this run: {fetched_miss}")
    print(f"stamped from existing cache: {stamped_from_cache}")
    print(f"DACH offices total: {dach_total}")
    print(f"DACH offices with coords now: {dach_with_coords}  ({100*dach_with_coords/max(dach_total,1):.1f}%)")
    if unresolved_samples:
        print(f"unresolved samples ({len(unresolved_samples)}):")
        for s in unresolved_samples:
            print(f"  - {s}")


if __name__ == "__main__":
    main()
