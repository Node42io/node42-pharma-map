#!/usr/bin/env python3
"""
Resumable WORLDWIDE office + HQ geocoder.

Generalizes scripts/geocode_dach_offices.py to every country in our dataset.

- Reads public/companies.json
- Finds ALL locations (HQ or office, any country) where lat == null AND city != null
- Reuses scripts/.address-geocode-cache.json (same key format as build-companies.ts)
- Geocodes via Photon. Filters Photon results to:
    * country bbox (so "Manhattan, USA" doesn't snap to Manhattan, Kansas, etc.)
    * Photon properties.country matches our expected country name (when known)
    * not a country-centroid
- Falls back to "city, country" query when full address fails
- Saves cache after every response so a kill loses nothing
- Writes coords back into companies.json in-place

Re-run to continue if MAX_PER_RUN halts a long run.
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

# ISO3 → (full name, Photon country code/name match, bbox).
# bbox is (lat_min, lat_max, lon_min, lon_max), generous (we'd rather accept a
# slightly outside-the-border result than reject a legit address near a frontier).
# Photon reports `properties.country` as the localized name; we keep a list of
# accepted names per ISO3 for the match check.
COUNTRIES: dict[str, dict] = {
    "DEU": {"name": "Germany",        "names": ["Germany", "Deutschland"],                 "bbox": (47.0, 55.5, 5.5, 15.5)},
    "AUT": {"name": "Austria",        "names": ["Austria", "Österreich"],                  "bbox": (46.3, 49.1, 9.4, 17.2)},
    "CHE": {"name": "Switzerland",    "names": ["Switzerland", "Schweiz", "Suisse"],       "bbox": (45.7, 47.9, 5.9, 10.6)},
    "USA": {"name": "United States",  "names": ["United States", "USA", "United States of America"], "bbox": (24.0, 49.5, -125.0, -66.5)},
    "GBR": {"name": "United Kingdom", "names": ["United Kingdom", "UK", "Great Britain", "England", "Scotland", "Wales", "Northern Ireland"], "bbox": (49.5, 61.0, -8.5, 2.0)},
    "FRA": {"name": "France",         "names": ["France"],                                  "bbox": (41.0, 51.5, -5.5, 9.8)},
    "ITA": {"name": "Italy",          "names": ["Italy", "Italia"],                         "bbox": (35.0, 47.5, 6.5, 19.0)},
    "ESP": {"name": "Spain",          "names": ["Spain", "España"],                         "bbox": (35.5, 44.0, -10.0, 4.5)},
    "NLD": {"name": "Netherlands",    "names": ["Netherlands", "Nederland"],                "bbox": (50.6, 53.7, 3.2, 7.3)},
    "BEL": {"name": "Belgium",        "names": ["Belgium", "België", "Belgique"],           "bbox": (49.4, 51.6, 2.5, 6.5)},
    "DNK": {"name": "Denmark",        "names": ["Denmark", "Danmark"],                      "bbox": (54.5, 57.8, 7.5, 15.5)},
    "SWE": {"name": "Sweden",         "names": ["Sweden", "Sverige"],                       "bbox": (55.0, 69.1, 10.5, 24.5)},
    "NOR": {"name": "Norway",         "names": ["Norway", "Norge"],                         "bbox": (57.8, 71.5, 4.0, 31.5)},
    "FIN": {"name": "Finland",        "names": ["Finland", "Suomi"],                        "bbox": (59.5, 70.1, 19.0, 31.6)},
    "POL": {"name": "Poland",         "names": ["Poland", "Polska"],                        "bbox": (49.0, 54.9, 14.0, 24.2)},
    "CZE": {"name": "Czechia",        "names": ["Czechia", "Czech Republic", "Česko"],      "bbox": (48.5, 51.1, 12.0, 18.9)},
    "HUN": {"name": "Hungary",        "names": ["Hungary", "Magyarország"],                 "bbox": (45.7, 48.6, 16.0, 22.9)},
    "IRL": {"name": "Ireland",        "names": ["Ireland", "Éire"],                         "bbox": (51.4, 55.5, -10.7, -5.4)},
    "PRT": {"name": "Portugal",       "names": ["Portugal"],                                "bbox": (32.3, 42.2, -31.5, -6.0)},
    "GRC": {"name": "Greece",         "names": ["Greece", "Ελλάδα"],                         "bbox": (34.5, 41.8, 19.3, 28.3)},
    "TUR": {"name": "Turkey",         "names": ["Turkey", "Türkiye"],                       "bbox": (35.8, 42.2, 25.6, 44.9)},
    "CAN": {"name": "Canada",         "names": ["Canada"],                                  "bbox": (41.6, 83.2, -141.0, -52.6)},
    "JPN": {"name": "Japan",          "names": ["Japan", "日本"],                            "bbox": (24.0, 45.6, 122.9, 145.9)},
    "CHN": {"name": "China",          "names": ["China", "中国"],                            "bbox": (17.5, 53.6, 73.5, 135.0)},
    "IND": {"name": "India",          "names": ["India", "भारत"],                            "bbox": (6.0, 35.7, 67.5, 97.5)},
    "AUS": {"name": "Australia",      "names": ["Australia"],                               "bbox": (-44.0, -9.5, 112.0, 154.5)},
    "NZL": {"name": "New Zealand",    "names": ["New Zealand", "Aotearoa"],                 "bbox": (-47.5, -34.0, 166.0, 179.0)},
    "BRA": {"name": "Brazil",         "names": ["Brazil", "Brasil"],                        "bbox": (-34.0, 5.5, -74.0, -34.0)},
    "MEX": {"name": "Mexico",         "names": ["Mexico", "México"],                        "bbox": (14.3, 32.8, -118.5, -86.5)},
    "ARG": {"name": "Argentina",      "names": ["Argentina"],                               "bbox": (-55.2, -21.7, -73.6, -53.5)},
    "COL": {"name": "Colombia",       "names": ["Colombia"],                                "bbox": (-4.3, 13.5, -79.0, -66.8)},
    "PER": {"name": "Peru",           "names": ["Peru", "Perú"],                            "bbox": (-18.5, 0.0, -81.4, -68.6)},
    "CHL": {"name": "Chile",          "names": ["Chile"],                                   "bbox": (-56.0, -17.5, -75.6, -66.4)},
    "VEN": {"name": "Venezuela",      "names": ["Venezuela"],                               "bbox": (0.6, 12.2, -73.4, -59.8)},
    "ECU": {"name": "Ecuador",        "names": ["Ecuador"],                                 "bbox": (-5.0, 1.5, -81.1, -75.2)},
    "URY": {"name": "Uruguay",        "names": ["Uruguay"],                                 "bbox": (-35.0, -30.0, -58.4, -53.0)},
    "PAN": {"name": "Panama",         "names": ["Panama", "Panamá"],                        "bbox": (7.2, 9.7, -83.0, -77.1)},
    "CRI": {"name": "Costa Rica",     "names": ["Costa Rica"],                              "bbox": (8.0, 11.3, -85.9, -82.5)},
    "PRI": {"name": "Puerto Rico",    "names": ["Puerto Rico"],                             "bbox": (17.8, 18.6, -67.3, -65.2)},
    "KOR": {"name": "South Korea",    "names": ["South Korea", "Korea", "대한민국"],         "bbox": (33.0, 38.7, 124.5, 132.0)},
    "SGP": {"name": "Singapore",      "names": ["Singapore"],                               "bbox": (1.15, 1.5, 103.5, 104.1)},
    "HKG": {"name": "Hong Kong",      "names": ["Hong Kong", "中国香港"],                    "bbox": (22.1, 22.6, 113.8, 114.5)},
    "TWN": {"name": "Taiwan",         "names": ["Taiwan", "中華民國"],                       "bbox": (21.8, 25.4, 119.3, 122.1)},
    "THA": {"name": "Thailand",       "names": ["Thailand", "ประเทศไทย"],                   "bbox": (5.6, 20.5, 97.3, 105.7)},
    "MYS": {"name": "Malaysia",       "names": ["Malaysia"],                                "bbox": (0.8, 7.4, 99.6, 119.3)},
    "IDN": {"name": "Indonesia",      "names": ["Indonesia"],                               "bbox": (-11.0, 6.1, 95.0, 141.1)},
    "PHL": {"name": "Philippines",    "names": ["Philippines", "Pilipinas"],                "bbox": (4.6, 21.2, 116.9, 126.6)},
    "VNM": {"name": "Vietnam",        "names": ["Vietnam", "Việt Nam"],                      "bbox": (8.4, 23.4, 102.1, 109.5)},
    "PAK": {"name": "Pakistan",       "names": ["Pakistan"],                                "bbox": (23.6, 37.1, 60.9, 77.0)},
    "BGD": {"name": "Bangladesh",     "names": ["Bangladesh"],                              "bbox": (20.5, 26.7, 88.0, 92.7)},
    "LKA": {"name": "Sri Lanka",      "names": ["Sri Lanka"],                               "bbox": (5.8, 9.9, 79.5, 81.9)},
    "ARE": {"name": "United Arab Emirates", "names": ["United Arab Emirates", "UAE"],       "bbox": (22.5, 26.1, 51.5, 56.4)},
    "SAU": {"name": "Saudi Arabia",   "names": ["Saudi Arabia"],                            "bbox": (16.3, 32.2, 34.5, 55.7)},
    "QAT": {"name": "Qatar",          "names": ["Qatar"],                                   "bbox": (24.4, 26.2, 50.7, 51.7)},
    "OMN": {"name": "Oman",           "names": ["Oman"],                                    "bbox": (16.6, 26.5, 51.9, 60.0)},
    "JOR": {"name": "Jordan",         "names": ["Jordan"],                                  "bbox": (29.1, 33.4, 34.9, 39.4)},
    "EGY": {"name": "Egypt",          "names": ["Egypt", "مصر"],                             "bbox": (21.7, 31.7, 24.7, 36.9)},
    "MAR": {"name": "Morocco",        "names": ["Morocco", "Maroc"],                        "bbox": (21.0, 36.0, -17.1, -1.0)},
    "TUN": {"name": "Tunisia",        "names": ["Tunisia"],                                 "bbox": (30.2, 37.6, 7.5, 11.6)},
    "DZA": {"name": "Algeria",        "names": ["Algeria"],                                 "bbox": (18.9, 37.1, -8.7, 12.0)},
    "ZAF": {"name": "South Africa",   "names": ["South Africa"],                            "bbox": (-34.9, -22.1, 16.4, 32.9)},
    "NGA": {"name": "Nigeria",        "names": ["Nigeria"],                                 "bbox": (4.2, 13.9, 2.7, 14.7)},
    "KEN": {"name": "Kenya",          "names": ["Kenya"],                                   "bbox": (-4.7, 5.0, 33.9, 41.9)},
    "ETH": {"name": "Ethiopia",       "names": ["Ethiopia"],                                "bbox": (3.4, 14.9, 33.0, 48.0)},
    "CIV": {"name": "Côte d’Ivoire",  "names": ["Côte d'Ivoire", "Ivory Coast", "Cote d'Ivoire"], "bbox": (4.3, 10.7, -8.6, -2.5)},
    "SEN": {"name": "Senegal",        "names": ["Senegal"],                                 "bbox": (12.3, 16.7, -17.6, -11.3)},
    "CMR": {"name": "Cameroon",       "names": ["Cameroon", "Cameroun"],                    "bbox": (1.6, 13.1, 8.4, 16.2)},
    "ZMB": {"name": "Zambia",         "names": ["Zambia"],                                  "bbox": (-18.1, -8.2, 21.9, 33.7)},
    "RUS": {"name": "Russia",         "names": ["Russia", "Россия"],                         "bbox": (41.1, 81.9, 19.6, 180.0)},
    "UKR": {"name": "Ukraine",        "names": ["Ukraine", "Україна"],                       "bbox": (44.4, 52.4, 22.1, 40.2)},
    "BLR": {"name": "Belarus",        "names": ["Belarus", "Беларусь"],                      "bbox": (51.3, 56.2, 23.2, 32.8)},
    "KAZ": {"name": "Kazakhstan",     "names": ["Kazakhstan", "Қазақстан"],                  "bbox": (40.6, 55.5, 46.5, 87.4)},
    "UZB": {"name": "Uzbekistan",     "names": ["Uzbekistan", "Oʻzbekiston"],                "bbox": (37.2, 45.6, 55.9, 73.2)},
    "AZE": {"name": "Azerbaijan",     "names": ["Azerbaijan", "Azərbaycan"],                 "bbox": (38.4, 41.9, 44.8, 50.4)},
    "ARM": {"name": "Armenia",        "names": ["Armenia", "Հայաստան"],                       "bbox": (38.8, 41.3, 43.4, 46.7)},
    "GEO": {"name": "Georgia",        "names": ["Georgia", "საქართველო"],                     "bbox": (41.0, 43.6, 39.9, 46.7)},
    "MDA": {"name": "Moldova",        "names": ["Moldova"],                                 "bbox": (45.4, 48.5, 26.6, 30.2)},
    "ROU": {"name": "Romania",        "names": ["Romania", "România"],                       "bbox": (43.6, 48.3, 20.2, 29.7)},
    "BGR": {"name": "Bulgaria",       "names": ["Bulgaria", "България"],                     "bbox": (41.2, 44.3, 22.3, 28.7)},
    "SRB": {"name": "Serbia",         "names": ["Serbia", "Србија"],                         "bbox": (42.2, 46.2, 18.8, 23.0)},
    "HRV": {"name": "Croatia",        "names": ["Croatia", "Hrvatska"],                     "bbox": (42.3, 46.6, 13.4, 19.5)},
    "SVN": {"name": "Slovenia",       "names": ["Slovenia", "Slovenija"],                   "bbox": (45.4, 46.9, 13.3, 16.7)},
    "SVK": {"name": "Slovakia",       "names": ["Slovakia", "Slovensko"],                   "bbox": (47.7, 49.7, 16.8, 22.6)},
    "BIH": {"name": "Bosnia and Herzegovina", "names": ["Bosnia and Herzegovina", "Bosna i Hercegovina"], "bbox": (42.5, 45.3, 15.7, 19.7)},
    "ALB": {"name": "Albania",        "names": ["Albania", "Shqipëria"],                     "bbox": (39.6, 42.7, 19.2, 21.1)},
    "MKD": {"name": "North Macedonia","names": ["North Macedonia", "Macedonia", "Северна Македонија"], "bbox": (40.8, 42.4, 20.4, 23.1)},
    "EST": {"name": "Estonia",        "names": ["Estonia", "Eesti"],                        "bbox": (57.5, 59.7, 21.7, 28.2)},
    "LVA": {"name": "Latvia",         "names": ["Latvia", "Latvija"],                       "bbox": (55.6, 58.1, 20.9, 28.3)},
    "LTU": {"name": "Lithuania",      "names": ["Lithuania", "Lietuva"],                    "bbox": (53.8, 56.5, 20.9, 26.9)},
    "LUX": {"name": "Luxembourg",     "names": ["Luxembourg"],                              "bbox": (49.4, 50.2, 5.7, 6.6)},
    "ISL": {"name": "Iceland",        "names": ["Iceland", "Ísland"],                       "bbox": (63.3, 66.6, -24.6, -13.5)},
    "MLT": {"name": "Malta",          "names": ["Malta"],                                   "bbox": (35.7, 36.1, 14.1, 14.6)},
    "CYP": {"name": "Cyprus",         "names": ["Cyprus", "Κύπρος"],                         "bbox": (34.5, 35.8, 32.2, 34.7)},
    "LBN": {"name": "Lebanon",        "names": ["Lebanon", "لبنان"],                          "bbox": (33.0, 34.7, 35.1, 36.7)},
    "ISR": {"name": "Israel",         "names": ["Israel", "ישראל"],                          "bbox": (29.4, 33.4, 34.2, 35.9)},
    "IRN": {"name": "Iran",           "names": ["Iran", "ایران"],                            "bbox": (25.0, 39.8, 44.0, 63.3)},
    "IRQ": {"name": "Iraq",           "names": ["Iraq", "العراق"],                            "bbox": (29.0, 37.4, 38.8, 48.6)},
    "BRB": {"name": "Barbados",       "names": ["Barbados"],                                "bbox": (13.0, 13.4, -59.7, -59.4)},
    "BHS": {"name": "Bahamas",        "names": ["Bahamas"],                                 "bbox": (20.9, 27.3, -80.5, -72.7)},
    "JAM": {"name": "Jamaica",        "names": ["Jamaica"],                                 "bbox": (17.7, 18.6, -78.4, -76.2)},
    "TTO": {"name": "Trinidad and Tobago", "names": ["Trinidad and Tobago"],                "bbox": (10.0, 11.4, -61.9, -60.5)},
    "DOM": {"name": "Dominican Republic", "names": ["Dominican Republic", "República Dominicana"], "bbox": (17.4, 19.9, -72.0, -68.3)},
    "GTM": {"name": "Guatemala",      "names": ["Guatemala"],                               "bbox": (13.7, 17.8, -92.3, -88.2)},
    "HND": {"name": "Honduras",       "names": ["Honduras"],                                "bbox": (12.9, 16.5, -89.4, -83.1)},
    "SLV": {"name": "El Salvador",    "names": ["El Salvador"],                             "bbox": (13.1, 14.5, -90.2, -87.7)},
    "NIC": {"name": "Nicaragua",      "names": ["Nicaragua"],                               "bbox": (10.7, 15.0, -87.7, -82.6)},
    "BOL": {"name": "Bolivia",        "names": ["Bolivia"],                                 "bbox": (-22.9, -9.7, -69.7, -57.5)},
    "PRY": {"name": "Paraguay",       "names": ["Paraguay"],                                "bbox": (-27.6, -19.3, -62.7, -54.3)},
    "ZWE": {"name": "Zimbabwe",       "names": ["Zimbabwe"],                                "bbox": (-22.4, -15.6, 25.2, 33.1)},
    "MOZ": {"name": "Mozambique",     "names": ["Mozambique", "Moçambique"],                "bbox": (-26.9, -10.5, 30.2, 40.9)},
    "AGO": {"name": "Angola",         "names": ["Angola"],                                  "bbox": (-18.0, -4.4, 11.7, 24.1)},
    "AFG": {"name": "Afghanistan",    "names": ["Afghanistan"],                             "bbox": (29.4, 38.5, 60.5, 74.9)},
    "NPL": {"name": "Nepal",          "names": ["Nepal", "नेपाल"],                            "bbox": (26.3, 30.5, 80.0, 88.2)},
    "KWT": {"name": "Kuwait",         "names": ["Kuwait", "الكويت"],                          "bbox": (28.5, 30.1, 46.5, 48.4)},
    "BHR": {"name": "Bahrain",        "names": ["Bahrain", "البحرين"],                        "bbox": (25.6, 26.4, 50.3, 50.8)},
    # Two-letter codes that surfaced in the dataset (CW, MO, SD, SS) — map them too.
    "CW":  {"name": "Curaçao",        "names": ["Curaçao", "Curacao"],                       "bbox": (12.0, 12.4, -69.2, -68.7)},
    "MO":  {"name": "Macao",          "names": ["Macao", "Macau"],                          "bbox": (22.1, 22.3, 113.5, 113.7)},
    "SD":  {"name": "Sudan",          "names": ["Sudan"],                                   "bbox": (8.7, 23.2, 21.8, 38.6)},
    "SS":  {"name": "South Sudan",    "names": ["South Sudan"],                             "bbox": (3.5, 12.3, 23.4, 35.9)},
}

# Country centroids — reject Photon results that snap to country level.
# Matches the build-companies.ts guard list, extended for the new countries.
COUNTRY_CENTROIDS: list[tuple[float, float]] = [
    (51.1657, 10.4515),  # DEU
    (46.8182, 8.2275),   # CHE
    (47.5162, 14.5501),  # AUT
    (39.8283, -98.5795), # USA
    (55.3781, -3.4360),  # GBR
    (46.2276, 2.2137),   # FRA
    (41.8719, 12.5674),  # ITA
    (40.4637, -3.7492),  # ESP
    (52.1326, 5.2913),   # NLD
    (50.5039, 4.4699),   # BEL
    (56.2639, 9.5018),   # DNK
    (60.1282, 18.6435),  # SWE
    (35.8617, 104.1954), # CHN
    (20.5937, 78.9629),  # IND
    (-25.2744, 133.7751),# AUS
    (-14.2350, -51.9253),# BRA
    (23.6345, -102.5528),# MEX
    (61.5240, 105.3188), # RUS
]

MAX_PER_RUN = int(os.environ.get("MAX_PER_RUN", "1500"))
PHOTON_URL = "https://photon.komoot.io/api"
SLEEP = float(os.environ.get("PHOTON_SLEEP", "0.15"))
# When 1, ignore cached "None" misses and retry them (so older DACH-only runs
# that gave up on out-of-bbox results get re-attempted under the relaxed query).
RETRY_CACHED_MISSES = os.environ.get("RETRY_CACHED_MISSES", "1") == "1"


def addr_key(loc: dict) -> str:
    return "|".join(
        [loc.get("street") or "", loc.get("city") or "", loc.get("postcode") or "", loc.get("country") or ""]
    ).lower()


def is_country_centroid(lat: float, lon: float) -> bool:
    for clat, clon in COUNTRY_CENTROIDS:
        if abs(lat - clat) < 0.01 and abs(lon - clon) < 0.01:
            return True
    return False


def in_bbox(country: str, lat: float, lon: float) -> bool:
    info = COUNTRIES.get(country)
    if not info:
        return True  # unknown country — don't reject by bbox we don't have
    lat_min, lat_max, lon_min, lon_max = info["bbox"]
    return lat_min <= lat <= lat_max and lon_min <= lon <= lon_max


def country_name_matches(country: str, photon_country: str | None) -> bool:
    if not photon_country:
        return True  # photon didn't tell us — fall back to bbox check
    info = COUNTRIES.get(country)
    if not info:
        return True
    pc = photon_country.strip().lower()
    return any(n.lower() == pc for n in info["names"])


def load_cache() -> dict:
    if CACHE.exists():
        with open(CACHE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache: dict) -> None:
    # Per-PID tmp file to avoid races with sibling processes / file watchers.
    tmp = CACHE.with_suffix(f".json.tmp.{os.getpid()}")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)
    try:
        tmp.replace(CACHE)
    except FileNotFoundError:
        # Tmp got moved out from under us — fall back to a direct write.
        with open(CACHE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)


def photon_query(q: str) -> list[dict]:
    """Single Photon call. Returns the features list (possibly empty)."""
    url = f"{PHOTON_URL}?q={urllib.parse.quote(q)}&limit=10"
    req = urllib.request.Request(
        url, headers={"User-Agent": "node42-pharma-map/0.4 (worldwide office geocoder)"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except Exception as e:
        print(f"  ERR photon: {e}", file=sys.stderr)
        return []
    return data.get("features") or []


def pick_feature(country: str, feats: list[dict]) -> tuple[float, float] | None:
    """Iterate Photon features; pick the first one inside the country bbox AND
    whose properties.country matches (when known). Reject country centroids."""
    for f in feats:
        coords = f.get("geometry", {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        if is_country_centroid(lat, lon):
            continue
        if not in_bbox(country, lat, lon):
            continue
        props = f.get("properties") or {}
        photon_country = props.get("country")
        if not country_name_matches(country, photon_country):
            continue
        return lat, lon
    return None


def photon_geocode(loc: dict) -> tuple[float, float] | None:
    country = loc.get("country") or ""
    info = COUNTRIES.get(country)
    country_name = info["name"] if info else country

    # Attempt 1: full address.
    parts = []
    if loc.get("street"):
        parts.append(loc["street"])
    if loc.get("postcode"):
        parts.append(loc["postcode"])
    if loc.get("city"):
        parts.append(loc["city"])
    if country_name:
        parts.append(country_name)
    q1 = ", ".join(p for p in parts if p)
    feats = photon_query(q1)
    picked = pick_feature(country, feats)
    if picked is not None:
        return picked

    # Attempt 2: city + country only (the requested fallback).
    if loc.get("city") and country_name:
        q2 = f"{loc['city']}, {country_name}"
        feats = photon_query(q2)
        picked = pick_feature(country, feats)
        if picked is not None:
            return picked

    return None


def main():
    with open(COMPANIES, "r", encoding="utf-8") as f:
        companies = json.load(f)
    cache = load_cache()

    # Pass 1: collect every location that needs coords (any role, any country).
    targets: list[tuple[dict, dict, str]] = []
    for c in companies:
        for loc in c.get("locations") or []:
            if loc.get("lat") is not None:
                continue
            if not loc.get("city") or not loc.get("country"):
                continue
            targets.append((c, loc, addr_key(loc)))

    if not targets:
        print("nothing to do — all locations already have coords.")
        return

    # Pass 2: stamp from cache.
    stamped_from_cache = 0
    needs_fetch: list[tuple[dict, dict, str]] = []
    cached_misses = 0
    for company, loc, k in targets:
        hit = cache.get(k, "__MISSING__")
        if hit == "__MISSING__":
            needs_fetch.append((company, loc, k))
        elif hit is None:
            if RETRY_CACHED_MISSES:
                needs_fetch.append((company, loc, k))
            else:
                cached_misses += 1
        else:
            loc["lat"] = hit["lat"]
            loc["lon"] = hit["lon"]
            stamped_from_cache += 1

    print(f"locations needing coords: {len(targets)}")
    print(f"  stamped from cache: {stamped_from_cache}")
    print(f"  cached as unresolved (skip): {cached_misses}")
    print(f"  need fresh Photon geocode: {len(needs_fetch)}")

    # Pass 3: Photon fetch.
    fetched_hit = 0
    fetched_miss = 0
    processed = 0
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
        save_cache(cache)
        if processed % 50 == 0:
            print(f"  progress {processed}/{min(len(needs_fetch), MAX_PER_RUN)}  hits={fetched_hit} miss={fetched_miss}")
        time.sleep(SLEEP)

    # Write companies.json back out.
    with open(COMPANIES, "w", encoding="utf-8") as f:
        json.dump(companies, f, ensure_ascii=False)

    # Final coverage report.
    total = 0
    mapped = 0
    for c in companies:
        for loc in c.get("locations") or []:
            total += 1
            if loc.get("lat") is not None:
                mapped += 1
    print()
    print("=== run summary ===")
    print(f"photon hits this run: {fetched_hit}")
    print(f"photon misses this run: {fetched_miss}")
    print(f"stamped from cache: {stamped_from_cache}")
    print(f"final coverage: {mapped}/{total}  ({100*mapped/max(total,1):.1f}%)")
    if unresolved_samples:
        print(f"unresolved samples ({len(unresolved_samples)}):")
        for s in unresolved_samples:
            print(f"  - {s}")


if __name__ == "__main__":
    main()
