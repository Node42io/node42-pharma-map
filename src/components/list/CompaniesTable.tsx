"use client";
import { useState, useMemo } from "react";
import {
  ArrowsDownUp as ArrowUpDown,
  ArrowDown,
  ArrowUp,
  Info,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import { revenueBand, revenueOrder } from "@/lib/revenue";
import { coreNaics } from "@/lib/naics";
import type { Company } from "@/lib/types";
import { TableRow } from "./TableRow";
import { ExpandedRow } from "./ExpandedRow";

type SortKey =
  | "name"
  | "address"
  | "employees"
  | "revenue"
  | "naics"
  | "linkedin"
  | "website";

type Col = {
  key: SortKey;
  label: string;
  align?: "left" | "right" | "center";
  width?: string;
  withInfo?: boolean;
};

const COLS: Col[] = [
  { key: "name", label: "Company Name", width: "min-w-[220px]" },
  { key: "address", label: "Address", width: "min-w-[220px]" },
  { key: "employees", label: "Employees", align: "right", width: "w-[120px]" },
  { key: "revenue", label: "Revenue", align: "right", width: "w-[120px]" },
  { key: "naics", label: "Core NAICS Code", align: "left", width: "w-[160px]", withInfo: true },
  { key: "linkedin", label: "LinkedIn", align: "center", width: "w-[100px]" },
  { key: "website", label: "Website", align: "center", width: "w-[100px]" },
];

function revenueOf(c: Company): { label: string; sortValue: number } {
  return {
    label: `${revenueBand(c.employees, c.revLowerUsd, c.revHigherUsd)} $`,
    sortValue: revenueOrder(c.employees, c.revLowerUsd, c.revHigherUsd),
  };
}

function naicsOf(c: Company): string {
  // Real derived NAICS code based on buckets/industry (see src/lib/naics.ts).
  return coreNaics(c).code;
}

function compare(a: Company, b: Company, key: SortKey): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "address":
      return `${a.country} ${a.city}`.localeCompare(`${b.country} ${b.city}`);
    case "employees":
      return (a.employees ?? -1) - (b.employees ?? -1);
    case "revenue":
      return revenueOf(a).sortValue - revenueOf(b).sortValue;
    case "naics":
      return naicsOf(a).localeCompare(naicsOf(b));
    case "linkedin":
    case "website":
      return a.name.localeCompare(b.name);
  }
}

function SortChip({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition
        ${active
          ? "bg-[var(--bg-panel-2)] border-[var(--line)] text-[var(--ink)]"
          : "bg-[var(--bg-panel)] border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]"
        }`}
    >
      {label}
      {active ? (
        dir === "asc" ? <ArrowUp size={16} /> : <ArrowDown size={16} />
      ) : (
        <ArrowUpDown size={16} className="opacity-60" />
      )}
    </button>
  );
}

export function CompaniesTable({
  rows,
  onRow,
  selectedId,
  searchQuery,
  onSearchQuery,
}: {
  rows: Company[];
  onRow: (c: Company) => void;
  selectedId: string | null;
  searchQuery: string;
  onSearchQuery: (v: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const v = compare(a, b, sortKey);
      return sortDir === "asc" ? v : -v;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const missingCoords = useMemo(
    () => rows.filter((r) => r.lat == null || r.lon == null).length,
    [rows]
  );

  function setSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  return (
    <div className="overflow-auto h-full bg-[var(--bg-page)]" data-testid="companies-table">
      {/* Page header */}
      <div className="px-6 pt-6 pb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-medium tracking-tight text-[var(--ink)]">Customer List</h1>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--bg-panel-2)] text-[var(--ink)] border border-[var(--line)]">
            <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--muted)]">TOTAL</span>
            <span className="text-[11px] font-semibold font-mono leading-none">{rows.length.toLocaleString("en-US")}</span>
          </span>
          {missingCoords > 0 && (
            <span
              data-testid="missing-coords-notice"
              className="text-[10px] font-mono text-[var(--dim)]"
            >
              ({missingCoords} missing coords — list-only)
            </span>
          )}
        </div>

        {/* Search input */}
        <div className="mt-5 relative max-w-[640px]">
          <MagnifyingGlass
            size={16}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQuery(e.target.value)}
            placeholder="Search for a specific customer..."
            aria-label="Search customers"
            className="w-full bg-[var(--bg-elev)] border border-[var(--line)] rounded-full pl-11 pr-11 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]/60"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 size-6 grid place-items-center rounded-full text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-panel-2)]"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Sort + Filtering chips row */}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <SortChip
              label="Employees"
              active={sortKey === "employees"}
              dir={sortDir}
              onClick={() => setSort("employees")}
            />
            <SortChip
              label="Revenue"
              active={sortKey === "revenue"}
              dir={sortDir}
              onClick={() => setSort("revenue")}
            />
          </div>

          {(sortKey === "employees" || sortKey === "revenue") && (
            <>
              <span aria-hidden className="h-5 w-px bg-[var(--line)]" />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]">
                  Filtering by:
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-0.5 rounded-full border border-[var(--line)] text-[var(--ink)] bg-[var(--bg-panel-2)]">
                  {sortKey === "employees" ? "Employees" : "Revenue"}:{" "}
                  {sortDir === "asc" ? "Low to High" : "High to Low"}
                  <button
                    type="button"
                    onClick={() => {
                      setSortKey("name");
                      setSortDir("asc");
                    }}
                    aria-label="Clear sort"
                    className="ml-0.5 hover:text-[var(--ink)]"
                  >
                    <X size={14} />
                  </button>
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Column header row (card-style grid, mirrors row layout) */}
      <div className="px-6 pt-3 pb-1">
        <div className="grid grid-cols-[24px_minmax(220px,1.4fr)_minmax(220px,1.4fr)_120px_120px_160px_100px_100px] gap-3 px-4 py-2 text-[11px] uppercase tracking-wider text-[var(--ink)]/80 font-mono font-semibold">
          <span />
          {COLS.map((c) => (
            <button
              key={c.key}
              onClick={() => setSort(c.key)}
              className={`inline-flex items-center gap-1 hover:text-[var(--ink)] ${
                c.align === "right"
                  ? "justify-end"
                  : c.align === "center"
                    ? "justify-center"
                    : "justify-start"
              }`}
            >
              <span>{c.label}</span>
              {c.withInfo && <Info size={14} className="opacity-60" />}
              {sortKey === c.key ? (
                sortDir === "asc" ? <ArrowUp size={16} /> : <ArrowDown size={16} />
              ) : (
                <ArrowUpDown size={16} className="opacity-40" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {rows.length === 0 && (
        <div className="px-6 py-16 text-center">
          <div className="text-3xl font-mono text-[var(--accent)]">no leads</div>
          <p className="mt-2 text-sm text-[var(--muted)]">
            No companies match your current filters. Try clearing them.
          </p>
        </div>
      )}

      {/* Rows */}
      <div className="px-6 pb-8 space-y-2">
        {sorted.map((r) => (
          <div key={r.id}>
            <TableRow
              company={r}
              isExpanded={expandedId === r.id}
              isSelected={selectedId === r.id}
              onToggleExpand={() =>
                setExpandedId((prev) => (prev === r.id ? null : r.id))
              }
              onSelect={() => onRow(r)}
            />
            {expandedId === r.id && <ExpandedRow company={r} />}
          </div>
        ))}
      </div>
    </div>
  );
}
