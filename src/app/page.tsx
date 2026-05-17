"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { ArrowUp, ArrowDown, ArrowsDownUp as ArrowUpDown, X, MagnifyingGlass } from "@phosphor-icons/react";
import { TopNav, type View } from "@/components/shell/TopNav";
import { Node42Chat } from "@/components/shell/Node42Chat";
import { MapControls } from "@/components/shell/MapControls";
import { FilterPanel } from "@/components/filters/FilterPanel";
import { CompanyDrawer } from "@/components/company/CompanyDrawer";
import { CompaniesTable } from "@/components/list/CompaniesTable";
import { ClientCardExpanded } from "@/components/company/ClientCard";
import { applyFilters } from "@/lib/filters";
import { downloadCsv } from "@/lib/csv";
import { revenueOrder } from "@/lib/revenue";
import type { Company, Filters, Status, Tier } from "@/lib/types";
import { EMPTY_FILTERS } from "@/lib/types";
import { assetPath } from "@/lib/asset-path";

type SortKey = "employees" | "revenue" | null;
type SortDir = "asc" | "desc";

const MapCanvas = dynamic(() => import("@/components/map/MapCanvas"), { ssr: false });

type MapHint = { lat: number; lon: number; nonce: number };

const STATUS_CYCLE: Record<Status, Status> = { PROSPECT: "LEAD", LEAD: "ACTIVE", ACTIVE: "PROSPECT" };

export default function Home() {
  const [rows, setRows] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [view, setView] = useState<View>("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, Status>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [chatOpen, setChatOpen] = useState(false);
  const [mapHint, setMapHint] = useState<MapHint | null>(null);

  const handleShowLocation = useCallback((lat: number, lon: number) => {
    setMapHint({ lat, lon, nonce: Date.now() });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(assetPath("/companies.json"))
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Company[]) => {
        if (cancelled) return;
        // hydrate stored status overrides from localStorage
        let stored: Record<string, Status> = {};
        try { stored = JSON.parse(localStorage.getItem("status-overrides") || "{}"); } catch {}
        setStatusOverrides(stored);
        setRows(data);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setRows([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const merged = useMemo(
    () => rows.map((r) => (statusOverrides[r.id] ? { ...r, status: statusOverrides[r.id] } : r)),
    [rows, statusOverrides]
  );
  const filtered = useMemo(() => applyFilters(merged, filters), [merged, filters]);
  const sortedFiltered = useMemo(() => {
    if (!sortKey) return filtered;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      const va = sortKey === "employees" ? (a.employees ?? 0) : revenueOrder(a.employees, a.revLowerUsd, a.revHigherUsd);
      const vb = sortKey === "employees" ? (b.employees ?? 0) : revenueOrder(b.employees, b.revLowerUsd, b.revHigherUsd);
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return sorted;
  }, [filtered, sortKey, sortDir]);
  const selected = useMemo(() => merged.find((r) => r.id === selectedId) ?? null, [merged, selectedId]);

  const cycleSort = useCallback((key: Exclude<SortKey, null>) => {
    setSortKey((prevKey) => {
      if (prevKey !== key) {
        setSortDir("desc");
        return key;
      }
      // same key: toggle direction; clear if cycling back from asc
      setSortDir((prevDir) => (prevDir === "desc" ? "asc" : "desc"));
      return key;
    });
  }, []);

  const handlePatchApplied = useCallback((updated: Company) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }, []);

  const cycleStatus = useCallback((id: string) => {
    setStatusOverrides((prev) => {
      const cur = prev[id] ?? merged.find((r) => r.id === id)?.status ?? "PROSPECT";
      const next = { ...prev, [id]: STATUS_CYCLE[cur] };
      try { localStorage.setItem("status-overrides", JSON.stringify(next)); } catch {}
      return next;
    });
  }, [merged]);

  const handleDownload = useCallback(() => {
    downloadCsv(filtered, "node42-companies.csv");
  }, [filtered]);

  // Tier-mix counts derived from the same filtered list the TOTAL pill uses.
  // Counts honor every active filter EXCEPT the tier filter itself, so the
  // CEO can see how the pipeline splits and toggle a tier in/out from here.
  const tierCounts = useMemo(() => {
    const base = applyFilters(merged, { ...filters, tiers: [] });
    const counts: Record<Tier, number> = { "Tier 1": 0, "Tier 2": 0, "Tier 3": 0, "Tier 4": 0, "": 0 };
    for (const r of base) counts[r.tier] = (counts[r.tier] ?? 0) + 1;
    return counts;
  }, [merged, filters]);

  const toggleTier = useCallback((tier: Tier) => {
    setFilters((prev) => {
      const has = prev.tiers.includes(tier);
      return { ...prev, tiers: has ? prev.tiers.filter((t) => t !== tier) : [...prev.tiers, tier] };
    });
  }, []);

  const activeFilterCount =
    (filters.q ? 1 : 0) +
    filters.buckets.length +
    filters.oncologyTags.length +
    filters.countries.length +
    filters.status.length +
    (filters.employeesMin != null ? 1 : 0) +
    (filters.employeesMax != null ? 1 : 0);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TopNav chatOpen={chatOpen} onToggleChat={() => setChatOpen((v) => !v)} />
      <Node42Chat
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        selected={selected}
        onPatchApplied={handlePatchApplied}
      />
      <div className="flex flex-1 overflow-hidden">
        {filtersOpen && <FilterPanel rows={merged} filters={filters} onChange={setFilters} />}

        <main className="flex-1 relative bg-[var(--bg-page)] flex min-w-0">
          {view === "map" ? (
            <>
              {/* Full-bleed map */}
              <div className="absolute inset-0">
                <MapCanvas rows={filtered} selectedId={selectedId} onSelect={(c) => setSelectedId(c.id)} hint={mapHint} />
              </div>

              <MapControls
                view={view}
                onView={setView}
                onDownload={handleDownload}
                filtersOpen={filtersOpen}
                onToggleFilters={() => setFiltersOpen((v) => !v)}
                activeFilterCount={activeFilterCount}
              />

              {/* Customer List sidebar — floating glass panel (Figma 4398:20769 v2 / 4398:25542 v2)
                  Body opacity bumped to /80 so map pin tooltips don't bleed through and
                  read like a watermark behind drawer content; edges keep the lighter
                  glass tint via the bottom fade gradient. */}
              <aside
                className="absolute top-3 left-3 bottom-3 w-[340px] z-[900] pointer-events-auto bg-[var(--bg-panel)]/80 backdrop-blur-xl backdrop-saturate-150 border border-[var(--line)]/55 rounded-2xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.04)_inset] flex flex-col overflow-hidden"
              >
                <div className="px-5 pt-5 pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-2xl font-medium tracking-tight">Customer List</h2>
                    <span className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-[var(--bg-panel-2)] text-[var(--ink)] border border-[var(--line)]">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--muted)]">TOTAL</span>
                      <span className="text-xs font-semibold font-mono">{filtered.length.toLocaleString("en-US")}</span>
                    </span>
                  </div>

                  {/* Tier-mix strip — at-a-glance pipeline breakdown. Each chip
                      toggles filters.tiers so the CEO can drill in/out. */}
                  <div className="mt-2 flex items-center gap-1" role="group" aria-label="Tier breakdown">
                    {(["Tier 1", "Tier 2", "Tier 3", "Tier 4"] as const).map((tier) => {
                      const short = tier.replace("Tier ", "T");
                      const count = tierCounts[tier] ?? 0;
                      const active = filters.tiers.includes(tier);
                      // Per-tier left-border tone via theme tokens
                      const borderTone =
                        tier === "Tier 1"
                          ? "border-l-[var(--accent)]"
                          : tier === "Tier 2"
                          ? "border-l-[var(--accent)]/40"
                          : tier === "Tier 3"
                          ? "border-l-[var(--line)]"
                          : "border-l-[var(--dim)]";
                      return (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => toggleTier(tier)}
                          aria-pressed={active}
                          title={`${tier}: ${count.toLocaleString("en-US")}`}
                          className={`inline-flex items-center gap-1 pl-1.5 pr-1.5 py-0.5 rounded-md border border-l-2 text-[10px] font-mono transition ${borderTone} ${
                            active
                              ? "bg-[var(--bg-panel-2)] border-[var(--line)] text-[var(--ink)]"
                              : "bg-[var(--bg-panel-2)]/50 border-[var(--line)]/60 text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-panel-2)]/80"
                          }`}
                        >
                          <span className="uppercase tracking-wider text-[var(--muted)]">{short}</span>
                          <span className={`font-semibold text-[var(--ink)]`}>
                            {count.toLocaleString("en-US")}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Search input — matches Figma 4398:20769 v2 */}
                  <div className="mt-3 relative">
                    <MagnifyingGlass
                      size={14}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
                    />
                    <input
                      type="search"
                      value={filters.q}
                      onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                      placeholder="Search for a specific customer…"
                      className="w-full bg-[var(--bg-panel-2)]/60 border border-[var(--line)]/60 rounded-md pl-7 pr-2.5 py-1.5 text-[12px] placeholder:text-[var(--dim)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-[var(--bg-panel-2)]/80 transition"
                    />
                  </div>

                  {/* Sort chips */}
                  <div className="mt-3 flex items-center gap-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] mr-0.5">Filtered by:</span>
                    {(["employees", "revenue"] as const).map((key) => {
                      const active = sortKey === key;
                      const label = key === "employees" ? "Employees" : "Revenue";
                      const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => cycleSort(key)}
                          aria-pressed={active}
                          className={`text-[11px] px-2 py-1 rounded-full border flex items-center gap-1 transition ${
                            active
                              ? "bg-[var(--bg-panel-2)] border-[var(--accent)] text-[var(--ink)]"
                              : "bg-[var(--bg-panel-2)]/50 border-[var(--line)]/60 text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--line)]"
                          }`}
                        >
                          {label} <Icon size={16} />
                        </button>
                      );
                    })}
                  </div>

                  {/* Active sort detail */}
                  {sortKey && (
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-[var(--line)] text-[var(--ink)] bg-[var(--bg-panel-2)]">
                        {sortKey === "employees" ? "Employees" : "Revenue"}: {sortDir === "asc" ? "Low to High" : "High to Low"}
                        <button
                          type="button"
                          onClick={() => setSortKey(null)}
                          aria-label="Clear sort"
                          className="ml-0.5 hover:text-[var(--ink)]"
                        >
                          <X size={14} />
                        </button>
                      </span>
                    </div>
                  )}
                </div>
                <div className="relative flex-1 min-h-0">
                  <div className="overflow-y-auto h-full p-3 space-y-2.5" data-testid="card-list">
                    {loading && <div className="text-sm text-[var(--muted)] p-4">Loading…</div>}
                    {!loading && filtered.length === 0 && (
                      <div className="text-sm text-center p-6">
                        <div className="text-2xl font-mono text-[var(--accent)]">no leads</div>
                        <div className="mt-1 text-[var(--muted)]">No matches for current filters.</div>
                      </div>
                    )}
                    {sortedFiltered.slice(0, 250).map((c) => (
                      <ClientCardExpanded
                        key={c.id}
                        company={c}
                        selected={c.id === selectedId}
                        onClick={() => setSelectedId(c.id)}
                      />
                    ))}
                    {filtered.length > 250 && (
                      <div className="text-[11px] text-center text-[var(--dim)] pt-2">
                        Showing 250 of {filtered.length}. Refine filters to narrow.
                      </div>
                    )}
                  </div>
                  {/* Bottom fade — softens the list edge against the map */}
                  <div className="pointer-events-none absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-[var(--bg-panel)]/60 to-transparent" />
                </div>
              </aside>

              {/* Floating glass detail drawer */}
              {selected && (
                <CompanyDrawer
                  company={selected}
                  onClose={() => setSelectedId(null)}
                  onCycleStatus={cycleStatus}
                  floating
                  onShowLocation={handleShowLocation}
                />
              )}
            </>
          ) : (
            <>
              <div className="flex-1 min-w-0 overflow-hidden relative">
                <CompaniesTable
                  rows={filtered}
                  onRow={(c) => setSelectedId(c.id)}
                  selectedId={selectedId}
                  searchQuery={filters.q}
                  onSearchQuery={(q) => setFilters({ ...filters, q })}
                />
                <MapControls
                  view={view}
                  onView={setView}
                  onDownload={handleDownload}
                  filtersOpen={filtersOpen}
                  onToggleFilters={() => setFiltersOpen((v) => !v)}
                  activeFilterCount={activeFilterCount}
                />
              </div>
              {selected && (
                <CompanyDrawer
                  company={selected}
                  onClose={() => setSelectedId(null)}
                  onCycleStatus={cycleStatus}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
