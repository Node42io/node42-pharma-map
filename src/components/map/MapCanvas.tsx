"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster";
import { MapContainer, TileLayer, useMap, ZoomControl } from "react-leaflet";
import type { Company, Status, Tier } from "@/lib/types";
import { useTheme } from "@/components/shell/ThemeToggle";

// Fix default marker URLs (Next.js bundler quirk)
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const LABEL_ZOOM_THRESHOLD = 11;

// Icon factory: base64 SVG L.Icon — Figma 4398:25542 spec, uniform across tiers.
// Default (unselected): navy fill (#3F507D) + yellow MapPin glyph (#FDFF98), size 28.
// Selected: solid yellow fill (#fdff98) + dark glyph (#15171a), size 34.
// Tier info is ignored for rendering — surfaced via sidebar tier-mix chips instead.
function buildIcon(_status: Status, selected: boolean, _tier: Tier = "Tier 2") {
  if (selected) {
    const size = 34;
    const fill = "#fdff98";
    const stroke = "#15171a";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="16" fill="${fill}"/><path d="M16 16.75C17.6569 16.75 19 15.4069 19 13.75C19 12.0931 17.6569 10.75 16 10.75C14.3431 10.75 13 12.0931 13 13.75C13 15.4069 14.3431 16.75 16 16.75Z" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.5 13.75C23.5 20.5 16 25.75 16 25.75C16 25.75 8.5 20.5 8.5 13.75C8.5 11.7609 9.29018 9.85322 10.6967 8.4467C12.1032 7.04018 14.0109 6.25 16 6.25C17.9891 6.25 19.8968 7.04018 21.3033 8.4467C22.7098 9.85322 23.5 11.7609 23.5 13.75Z" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return svgIcon(svg, size, "n42-pin n42-pin-selected");
  }

  const size = 28;
  const fill = "#3F507D";
  const stroke = "#FDFF98";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none"><rect x="0.75" y="0.75" width="30.5" height="30.5" rx="15.25" fill="${fill}"/><path d="M16 16.75C17.6569 16.75 19 15.4069 19 13.75C19 12.0931 17.6569 10.75 16 10.75C14.3431 10.75 13 12.0931 13 13.75C13 15.4069 14.3431 16.75 16 16.75Z" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.5 13.75C23.5 20.5 16 25.75 16 25.75C16 25.75 8.5 20.5 8.5 13.75C8.5 11.7609 9.29018 9.85322 10.6967 8.4467C12.1032 7.04018 14.0109 6.25 16 6.25C17.9891 6.25 19.8968 7.04018 21.3033 8.4467C22.7098 9.85322 23.5 11.7609 23.5 13.75Z" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return svgIcon(svg, size, "n42-pin");
}

// Secondary office-site icon used when a company is SELECTED. Subordinate
// to the HQ pin (smaller, 24px outlined rounded rect + MapPin glyph). YELLOW
// is reserved for the SELECTED HQ pin, so offices use a contrasting hue: a
// medium-light blue (#5B7BC4) that pairs with the navy HQ default fill while
// remaining clearly distinct from the yellow accent. Non-DACH offices use a
// muted slate grey for a subordinate read.
function buildOfficeIcon(opts: { dimmed?: boolean } = {}) {
  const size = 24;
  // Default: medium-light blue. Reads on both cream (light theme) and dark
  // tiles; cohesive with the navy HQ pin; cannot be confused with yellow HQ
  // selection. Dimmed (non-DACH): muted slate grey.
  const stroke = opts.dimmed ? "#5b6470" : "#5B7BC4";
  const dot = opts.dimmed ? "#5b6470" : "#5B7BC4";
  const ringOpacity = opts.dimmed ? 0.7 : 1;
  const dotOpacity = opts.dimmed ? 0.7 : 1;
  // 24px outlined rounded rect + MapPin glyph + 4px filled inner dot.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"><rect x="1" y="1" width="22" height="22" rx="6" stroke="${stroke}" stroke-width="1.75" fill="transparent" opacity="${ringOpacity}"/><path d="M12 11.5C12.9665 11.5 13.75 10.7165 13.75 9.75C13.75 8.7835 12.9665 8 12 8C11.0335 8 10.25 8.7835 10.25 9.75C10.25 10.7165 11.0335 11.5 12 11.5Z" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity="${ringOpacity}"/><path d="M16.5 9.75C16.5 13.5 12 16.75 12 16.75C12 16.75 7.5 13.5 7.5 9.75C7.5 8.55653 7.97411 7.41193 8.81802 6.56802C9.66193 5.72411 10.8065 5.25 12 5.25C13.1935 5.25 14.3381 5.72411 15.182 6.56802C16.0259 7.41193 16.5 8.55653 16.5 9.75Z" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity="${ringOpacity}"/><circle cx="12" cy="19.5" r="2" fill="${dot}" opacity="${dotOpacity}"/></svg>`;
  return svgIcon(svg, size, "n42-pin n42-pin-office" + (opts.dimmed ? " n42-pin-office-dimmed" : ""));
}

// Helper: wrap an inline SVG string into a Leaflet Icon.
function svgIcon(svg: string, size: number, className: string) {
  const url = "data:image/svg+xml;base64," + (typeof window !== "undefined" ? btoa(svg) : Buffer.from(svg).toString("base64"));
  return new L.Icon({
    iconUrl: url,
    iconSize: [size, size],
    iconAnchor: [Math.round(size / 2), Math.round(size / 2)],
    popupAnchor: [0, -Math.round(size / 2)],
    tooltipAnchor: [Math.round(size / 2) + 2, 0],
    className,
  });
}

// Filter outliers and fit to the dense central cluster instead of including
// the whole world (a few US/Asia outliers stretch the bounds otherwise).
function denseBounds(points: Company[]): L.LatLngBounds | null {
  if (!points.length) return null;
  // Tight percentile band keeps the dense DACH cluster centered, dropping
  // far-out outliers (US/Asia) so the default view matches the Figma zoom.
  const lats = points.map((p) => p.lat as number).sort((a, b) => a - b);
  const lons = points.map((p) => p.lon as number).sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.max(0, Math.min(arr.length - 1, Math.floor(arr.length * p)))];
  const latLo = q(lats, 0.15), latHi = q(lats, 0.85);
  const lonLo = q(lons, 0.15), lonHi = q(lons, 0.85);
  return L.latLngBounds([latLo, lonLo], [latHi, lonHi]);
}

// Measure the right-edge (in container-local pixels) of any floating glass
// chrome (sidebar + drawer) that sits over the map. Works at any viewport
// size because it reads the live DOM. Returns 0 if the map element is
// missing or no floating panels are present (e.g. list view).
function measureLeftChromeRight(map: L.Map): number {
  try {
    const container = map.getContainer();
    const containerRect = container.getBoundingClientRect();
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('main aside, [data-testid="company-drawer"]')
    );
    let maxRight = 0;
    for (const el of candidates) {
      const cs = window.getComputedStyle(el);
      if (cs.position !== "absolute" && cs.position !== "fixed") continue;
      const r = el.getBoundingClientRect();
      // Only count panels that visually overlap the map container on the LEFT.
      if (r.right <= containerRect.left) continue;
      if (r.left >= containerRect.right) continue;
      // Convert to container-local space.
      const localRight = r.right - containerRect.left;
      if (localRight < containerRect.width * 0.75) {
        // Heuristic: only panels rooted on the left half are "left chrome".
        // The MapControls top-right cluster sits in the right portion and
        // shouldn't influence centering.
        if (localRight > maxRight) maxRight = localRight;
      }
    }
    return Math.max(0, maxRight);
  } catch {
    return 0;
  }
}

function FitToBounds({ rows, selectedId }: { rows: Company[]; selectedId: string | null }) {
  const map = useMap();
  // State machine refs — survive across renders without causing re-runs.
  // `didInitialFitRef` flips to true once the first fit-overview has run
  // (after rows are loaded). `prevSelectedIdRef` tracks the previous
  // selection so we can distinguish:
  //   - new selection → flyTo
  //   - selection cleared (drawer close) → DO NOTHING (preserve view)
  //   - selection unchanged → no-op
  const didInitialFitRef = useRef(false);
  const prevSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const points = rows.filter((r) => r.lat != null && r.lon != null);
    if (!points.length) return;

    const recentreSelected = (sel: Company) => {
      try { map.invalidateSize(); } catch {}
      const containerSize = map.getSize();
      const leftChromeRight = measureLeftChromeRight(map);

      // Collect coords for the selected company: the flat HQ coord PLUS
      // every location (HQ + offices) with role HQ/office that has lat/lon.
      // For bounds-fitting we constrain to DACH (CHE/DEU/AUT) — the
      // customer's target geo — so a single overseas office doesn't drag
      // the view out to the world. Non-DACH office pins still render
      // (dimmed) via SelectedOfficePins; they're just excluded from bounds.
      const DACH = new Set(["CHE", "DEU", "AUT"]);
      const allLatLngs: L.LatLng[] = [];
      const hqCountry = sel.country ?? null;
      if (sel.lat != null && sel.lon != null && (!hqCountry || DACH.has(hqCountry))) {
        allLatLngs.push(L.latLng(sel.lat as number, sel.lon as number));
      }
      for (const loc of sel.locations ?? []) {
        const role = (loc as { role?: string }).role;
        if (role && role !== "HQ" && role !== "office") continue;
        if (loc.lat == null || loc.lon == null) continue;
        if (loc.country && !DACH.has(loc.country)) continue;
        allLatLngs.push(L.latLng(loc.lat as number, loc.lon as number));
      }
      // Safety: if filtering wiped everything (e.g. non-DACH HQ), fall
      // back to the flat HQ coord so we still recentre on the company.
      if (allLatLngs.length === 0 && sel.lat != null && sel.lon != null) {
        allLatLngs.push(L.latLng(sel.lat as number, sel.lon as number));
      }

      // De-dupe identical coords (HQ often duplicated in locations[0]).
      const seen = new Set<string>();
      const uniquePoints = allLatLngs.filter((p) => {
        const k = `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      // 2+ points → fit bounds across the whole footprint, respecting left chrome.
      if (uniquePoints.length >= 2) {
        const bounds = L.latLngBounds(uniquePoints);
        const visibleWidth = containerSize.x - leftChromeRight;
        const usableChrome =
          leftChromeRight > 0 && visibleWidth >= containerSize.x * 0.25
            ? leftChromeRight
            : 0;
        try {
          map.fitBounds(bounds, {
            paddingTopLeft: [usableChrome + 32, 32],
            paddingBottomRight: [32, 32],
            maxZoom: 11,
            animate: true,
            duration: 0.6,
          });
        } catch {}
        return;
      }

      // Single-point fallback — preserve the original flyTo behaviour.
      const target = uniquePoints[0] ?? L.latLng(sel.lat as number, sel.lon as number);
      const targetZoom = Math.max(map.getZoom(), 9);
      // If chrome covers ≥75% of the viewport (mobile-ish narrow screens),
      // skip the offset and just center normally — the panels would
      // overlap the map regardless and shifting further makes it worse.
      const visibleWidth = containerSize.x - leftChromeRight;
      if (leftChromeRight === 0 || visibleWidth < containerSize.x * 0.25) {
        map.flyTo(target, targetZoom, { duration: 0.5 });
        return;
      }
      // Visible map area runs from leftChromeRight → containerSize.x.
      // Centre the pin within that area.
      const visibleCenterX = (leftChromeRight + containerSize.x) / 2;
      const offsetX = visibleCenterX - containerSize.x / 2;
      const targetPoint = map.project(target, targetZoom).subtract([offsetX, 0]);
      const shifted = map.unproject(targetPoint, targetZoom);
      map.flyTo(shifted, targetZoom, { duration: 0.5 });
    };

    const fitOverview = () => {
      try { map.invalidateSize(); } catch {}
      const bounds = denseBounds(points);
      if (!bounds) return;
      const containerSize = map.getSize();
      const leftChromeRight = measureLeftChromeRight(map);
      // Pad on the left by chrome width (+ small gutter); if it would
      // crowd the viewport (>75%), drop back to a small symmetric pad.
      const leftPad =
        leftChromeRight > 0 && leftChromeRight < containerSize.x * 0.75
          ? leftChromeRight + 16
          : 20;
      try {
        map.fitBounds(bounds, {
          paddingTopLeft: [leftPad, 20],
          paddingBottomRight: [20, 20],
          maxZoom: 8,
        });
      } catch {}
    };

    // State-machine dispatch:
    // 1) Initial mount with data → fit overview ONCE, then mark done.
    // 2) New selection (differs from prev) → flyTo / fitBounds via recentre.
    // 3) Drawer close (selected → null) → preserve the user's view; just
    //    update the prev-selected ref so a future re-select still flies.
    // 4) No-op when selection is unchanged (e.g. rows reference changed).
    if (!didInitialFitRef.current) {
      didInitialFitRef.current = true;
      prevSelectedIdRef.current = selectedId;
      if (selectedId) {
        const sel = points.find((p) => p.id === selectedId);
        if (sel) {
          requestAnimationFrame(() => recentreSelected(sel));
          return;
        }
      }
      requestAnimationFrame(fitOverview);
      return;
    }

    if (selectedId && selectedId !== prevSelectedIdRef.current) {
      const sel = points.find((p) => p.id === selectedId);
      prevSelectedIdRef.current = selectedId;
      if (sel) {
        requestAnimationFrame(() => recentreSelected(sel));
      }
      return;
    }

    if (!selectedId && prevSelectedIdRef.current !== null) {
      // Drawer closed — KEEP the current camera. Just clear the ref.
      prevSelectedIdRef.current = null;
      return;
    }

    // selectedId === prevSelectedIdRef.current → nothing to do.
  }, [rows, selectedId, map]);

  // Re-fit when the window resizes so panel offsets stay correct on any
  // screen size (laptop → external monitor, browser-resize, devtools open).
  useEffect(() => {
    const handle = () => {
      try { map.invalidateSize(); } catch {}
    };
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, [map]);
  return null;
}

// Subscribes to map zoom and reports whether labels should be shown.
function ZoomWatcher({ onChange }: { onChange: (showLabels: boolean) => void }) {
  const map = useMap();
  useEffect(() => {
    const update = () => onChange(map.getZoom() >= LABEL_ZOOM_THRESHOLD);
    update();
    map.on("zoomend", update);
    return () => {
      map.off("zoomend", update);
    };
  }, [map, onChange]);
  return null;
}

// Custom cluster icon — dark navy bubble with yellow border, pin glyph + count
const CLUSTER_PIN_SVG = `<svg class="n42-cluster-pin" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 22 28" aria-hidden="true"><path d="M11 0C4.9 0 0 4.9 0 11c0 11 11 17 11 17s11-6 11-17C22 4.9 17.1 0 11 0z" fill="#d4d680"/><circle cx="11" cy="11" r="3.4" fill="#0d0f12"/></svg>`;
function clusterIconCreate(cluster: L.MarkerCluster) {
  const count = cluster.getChildCount();
  // Approximate width per char count; height fixed.
  const width = 36 + (String(count).length - 1) * 6;
  const height = 24;
  return L.divIcon({
    html: `<div class="n42-cluster">${CLUSTER_PIN_SVG}<span>${count}</span></div>`,
    className: "n42-cluster-wrapper",
    iconSize: L.point(width, height),
  });
}

// Imperative marker-cluster layer driven from inside <MapContainer>.
// Idempotent under React 19 strict-mode double-mount via useRef.
function ClusteredMarkers({
  rows,
  selectedId,
  showLabels,
  onSelect,
}: {
  rows: Company[];
  selectedId: string | null;
  showLabels: boolean;
  onSelect: (c: Company) => void;
}) {
  const map = useMap();
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const selectedMarkerRef = useRef<L.Marker | null>(null);

  // Lazily create the cluster group once.
  if (clusterRef.current === null) {
    clusterRef.current = (L as unknown as { markerClusterGroup: (opts: unknown) => L.MarkerClusterGroup })
      .markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        // Tight radius — only literally-overlapping coords merge. Same-city
        // pharma companies (which sit several blocks apart) remain visible
        // as distinct pins at city-level zoom.
        maxClusterRadius: 30,
        chunkedLoading: true,
        iconCreateFunction: clusterIconCreate,
      });
  }

  // Attach to map; on unmount just remove (don't dispose — keeps strict-mode safe).
  useEffect(() => {
    const cluster = clusterRef.current!;
    map.addLayer(cluster);
    return () => {
      map.removeLayer(cluster);
    };
  }, [map]);

  // Rebuild markers whenever rows/selectedId/showLabels change. The selected
  // marker is rendered DIRECTLY on the map (outside the cluster) so its
  // permanent label is always visible, even when its neighbours are clustered.
  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;
    cluster.clearLayers();
    // Remove any prior standalone selected marker.
    if (selectedMarkerRef.current) {
      try { map.removeLayer(selectedMarkerRef.current); } catch {}
      selectedMarkerRef.current = null;
    }
    const coordCounts = buildCoordCounts(rows);
    const markers: L.Marker[] = [];
    for (const c of rows) {
      if (c.lat == null || c.lon == null) continue;
      const isSelected = c.id === selectedId;
      const [lat, lon] = jitterCoords(c, coordCounts);
      const m = L.marker([lat, lon], {
        icon: buildIcon(c.status, isSelected, c.tier),
        riseOnHover: true,
        zIndexOffset: isSelected ? 1000 : 0,
      });
      m.on("click", () => onSelect(c));
      if (showLabels || isSelected) {
        // Selected pin always gets a permanent label regardless of zoom so the
        // user can always read what they have selected. Other pins only get
        // permanent labels at high zoom (LABEL_ZOOM_THRESHOLD).
        m.bindTooltip(c.name, {
          permanent: true,
          direction: "right",
          offset: [6, -12],
          opacity: 1,
          className: "n42-pin-label" + (isSelected ? " n42-pin-label-selected" : ""),
        });
      } else {
        m.bindTooltip(
          `<div class="n42-tooltip"><div class="n42-tooltip-name">${escapeHtml(c.name)}</div><div class="n42-tooltip-meta">${escapeHtml(c.city ?? "")}, ${escapeHtml(c.country ?? "")}</div></div>`,
          { direction: "top", offset: [0, -8], opacity: 1, sticky: true },
        );
      }
      if (isSelected) {
        // Render the selected marker outside the cluster so its label is
        // always visible (clusters hide their child markers from the DOM).
        m.addTo(map);
        selectedMarkerRef.current = m;
      } else {
        markers.push(m);
      }
    }
    cluster.addLayers(markers);
  }, [rows, selectedId, showLabels, onSelect, map]);

  // Cleanup standalone selected marker on unmount.
  useEffect(() => {
    return () => {
      if (selectedMarkerRef.current) {
        try { map.removeLayer(selectedMarkerRef.current); } catch {}
        selectedMarkerRef.current = null;
      }
    };
  }, [map]);

  return null;
}

// Selection-driven office pin layer. Renders ONLY the office locations of the
// currently-selected company (HQ already rendered via `ClusteredMarkers` from
// the flat company.lat/lon). Pins use the secondary `buildOfficeIcon` style
// and link to the SAME drawer record when clicked. Cleared on selection
// change or unmount.
function SelectedOfficePins({
  rows,
  selectedId,
  onSelect,
}: {
  rows: Company[];
  selectedId: string | null;
  onSelect: (c: Company) => void;
}) {
  const map = useMap();
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    // Clear previous office pins on any change (selection swap or unselect).
    for (const m of markersRef.current) {
      try { map.removeLayer(m); } catch {}
    }
    markersRef.current = [];

    if (!selectedId) return;
    const sel = rows.find((r) => r.id === selectedId);
    if (!sel) return;
    const locs = sel.locations ?? [];
    if (locs.length <= 1) return;
    // Skip the HQ at locations[0]; render the rest.
    for (const loc of locs.slice(1)) {
      if (loc.lat == null || loc.lon == null) continue;
      // Visually mark non-DACH offices as dimmed — present but subordinate.
      const dimmed = !(loc.country === "DEU" || loc.country === "AUT" || loc.country === "CHE");
      const m = L.marker([loc.lat, loc.lon], {
        icon: buildOfficeIcon({ dimmed }),
        riseOnHover: true,
        zIndexOffset: 500,
      });
      m.bindTooltip(
        `<div class="n42-tooltip"><div class="n42-tooltip-name">${escapeHtml(sel.name)}</div><div class="n42-tooltip-meta">${escapeHtml(loc.city)}, ${escapeHtml(loc.country)} · office</div></div>`,
        { direction: "top", offset: [0, -6], opacity: 1, sticky: true },
      );
      // Clicking an office pin selects the SAME company — keeps the drawer
      // record stable so secondary-site clicks don't open a different record.
      m.on("click", () => onSelect(sel));
      m.addTo(map);
      markersRef.current.push(m);
    }

    return () => {
      for (const m of markersRef.current) {
        try { map.removeLayer(m); } catch {}
      }
      markersRef.current = [];
    };
  }, [rows, selectedId, map, onSelect]);

  return null;
}

// Deterministic 32-bit hash (FNV-1a) — stable across reloads.
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

// Build a coord-collision lookup: "lat,lon" → count. Used to decide whether
// a given company needs jitter (only when a sibling shares its exact coords,
// e.g. multiple companies geocoded to the same city centroid).
function buildCoordCounts(rows: Company[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of rows) {
    if (c.lat == null || c.lon == null) continue;
    const k = `${c.lat},${c.lon}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

// Returns the company's coords unchanged when unique, else applies a small
// deterministic jitter (~±0.008° ≈ ±900m) keyed by the company id so loads
// are stable. Keeps same-city duplicates visibly separate without merging
// them into a cluster bubble.
function jitterCoords(c: Company, counts: Map<string, number>): [number, number] {
  const lat = c.lat as number;
  const lon = c.lon as number;
  const key = `${lat},${lon}`;
  if ((counts.get(key) ?? 0) <= 1) return [lat, lon];
  const dLat = ((hash32(c.id) % 200) - 100) * 0.00008;
  const dLon = ((hash32(c.id + ":lon") % 200) - 100) * 0.00008;
  return [lat + dLat, lon + dLon];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Coordinate hint used by the drawer's "Show on map" affordance. Each call
// gets a fresh `nonce` so a second click on the SAME location still triggers
// a flyTo (since the lat/lon tuple is reference-equal across renders).
export type MapHint = { lat: number; lon: number; nonce: number };

// Imperative flyTo driven by an external coordinate hint (e.g. the drawer's
// "Show on map" button). Mounted inside <MapContainer> so it has access to
// the live map instance.
//
// Chrome-aware: shifts the target horizontally so the pin lands in the
// VISIBLE map area (right of the drawer + sidebar), not behind them. Same
// pattern as `FitToBounds.recentreSelected`.
//
// Zoom heuristic: defaults to city-level (z=11) so the pin is recognizable.
// But if the user is currently zoomed out AND the target is far from the
// current center (>~200km), keeps the current zoom — otherwise a click on
// a faraway office (e.g. Bayer Bogota) would violently zoom in past
// continents.
function FlyToHint({ hint }: { hint: MapHint | null }) {
  const map = useMap();
  useEffect(() => {
    if (!hint) return;
    try {
      const target = L.latLng(hint.lat, hint.lon);
      try { map.invalidateSize(); } catch {}
      const containerSize = map.getSize();
      const leftChromeRight = measureLeftChromeRight(map);

      // Pick a sensible zoom: city-level by default, but back off when the
      // user is wide-zoomed and the target is far from the current center.
      const currentZoom = map.getZoom();
      let targetZoom = Math.max(currentZoom, 11);
      if (currentZoom < 11) {
        const distKm = map.getCenter().distanceTo(target) / 1000;
        if (distKm > 200) {
          // Keep the current zoom so we don't punch in across continents.
          targetZoom = currentZoom;
        }
      }

      const visibleWidth = containerSize.x - leftChromeRight;
      if (leftChromeRight === 0 || visibleWidth < containerSize.x * 0.25) {
        // No left chrome (or it covers ≥75% of viewport) → plain flyTo.
        map.flyTo(target, targetZoom, { duration: 0.5 });
        return;
      }
      // Visible map area runs from leftChromeRight → containerSize.x.
      // Centre the pin within that area by shifting the projected target left
      // by half the chrome width (so unprojecting yields a coord that, when
      // centered, leaves the pin in the visible band).
      const visibleCenterX = (leftChromeRight + containerSize.x) / 2;
      const offsetX = visibleCenterX - containerSize.x / 2;
      const targetPoint = map.project(target, targetZoom).subtract([offsetX, 0]);
      const shifted = map.unproject(targetPoint, targetZoom);
      map.flyTo(shifted, targetZoom, { duration: 0.5 });
    } catch {}
  }, [hint, map]);
  return null;
}

export default function MapCanvas({
  rows,
  selectedId,
  onSelect,
  hint,
}: {
  rows: Company[];
  selectedId: string | null;
  onSelect: (c: Company) => void;
  hint?: MapHint | null;
}) {
  const center = useMemo<[number, number]>(() => [49.5, 9.5], []);
  const points = useMemo(() => rows.filter((r) => r.lat != null && r.lon != null), [rows]);
  const [showLabels, setShowLabels] = useState(false);
  const theme = useTheme();
  const isLight = theme === "light";

  return (
    <div className="absolute inset-0" data-testid="map-canvas" style={{ minHeight: 300 }}>
      <MapContainer
        center={center}
        zoom={5}
        style={{ width: "100%", height: "100%" }}
        scrollWheelZoom
        zoomControl={false}
        attributionControl
      >
        {isLight ? (
          <TileLayer
            key="light-voyager"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}.png"
            subdomains="abcd"
          />
        ) : (
          <>
            <TileLayer
              key="dark-base"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png"
              subdomains="abcd"
            />
            <TileLayer
              key="dark-labels"
              url="https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png"
              subdomains="abcd"
            />
          </>
        )}
        <ZoomControl position="bottomright" />
        <FitToBounds rows={points} selectedId={selectedId} />
        <ZoomWatcher onChange={setShowLabels} />
        <ClusteredMarkers
          rows={points}
          selectedId={selectedId}
          showLabels={showLabels}
          onSelect={onSelect}
        />
        <SelectedOfficePins rows={rows} selectedId={selectedId} onSelect={onSelect} />
        <FlyToHint hint={hint ?? null} />
      </MapContainer>
    </div>
  );
}
