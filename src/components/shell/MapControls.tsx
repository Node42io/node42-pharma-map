"use client";
import { MapTrifold as MapIcon, List, DownloadSimple as Download, SlidersHorizontal } from "@phosphor-icons/react";
import type { View } from "./TopNav";

/**
 * Floating top-right control cluster overlaying the map.
 * Figma 4398:20775 — segmented map/list toggle + CSV button, plus our Filters control.
 */
export function MapControls({
  view,
  onView,
  onDownload,
  filtersOpen,
  onToggleFilters,
  activeFilterCount,
}: {
  view: View;
  onView: (v: View) => void;
  onDownload: () => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
}) {
  return (
    <div className="absolute top-3 right-3 z-[1000] flex items-center gap-2">
      <button
        data-testid="toggle-filters"
        onClick={onToggleFilters}
        aria-pressed={filtersOpen}
        className={`relative flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm transition border backdrop-blur-md shadow-md ${
          filtersOpen
            ? "bg-[var(--bg-panel)] border-[var(--accent)] text-[var(--ink)] ring-1 ring-[var(--accent)]/40"
            : "bg-[var(--bg-panel)] border-[var(--line)] text-[var(--ink)] hover:text-[var(--ink)] ring-1 ring-[var(--line)]"
        }`}
      >
        <SlidersHorizontal size={14} /> Filters
        {activeFilterCount > 0 && (
          <span
            aria-label={`${activeFilterCount} active filters`}
            className="ml-0.5 inline-block size-1.5 rounded-full bg-[var(--accent)]"
          />
        )}
      </button>

      <div className="flex items-center bg-[var(--bg-panel)] rounded-lg p-1 border border-[var(--line)] ring-1 ring-[var(--line)] shadow-md backdrop-blur-md">
        <button
          data-testid="view-map"
          onClick={() => onView("map")}
          aria-pressed={view === "map"}
          className={`flex items-center justify-center w-9 h-7 rounded-md transition ${
            view === "map" ? "bg-[var(--accent)] text-black" : "text-[var(--muted)] hover:text-[var(--ink)]"
          }`}
          aria-label="Map view"
        >
          <MapIcon size={16} />
        </button>
        <button
          data-testid="view-list"
          onClick={() => onView("list")}
          aria-pressed={view === "list"}
          className={`flex items-center justify-center w-9 h-7 rounded-md transition ${
            view === "list" ? "bg-[var(--accent)] text-black" : "text-[var(--muted)] hover:text-[var(--ink)]"
          }`}
          aria-label="List view"
        >
          <List size={16} />
        </button>
      </div>

      <button
        data-testid="download-csv"
        onClick={onDownload}
        className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm bg-[var(--bg-panel)] hover:bg-[var(--bg-panel-2)] border border-[var(--line)] ring-1 ring-[var(--line)] text-[var(--ink)] shadow-md backdrop-blur-md transition"
      >
        CSV <Download size={14} />
      </button>
    </div>
  );
}
