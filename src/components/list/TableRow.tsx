"use client";
import {
  CaretDown as ChevronDown,
  Globe,
  MapPin,
} from "@phosphor-icons/react";
import { LinkedInIcon } from "@/components/icons";
import { revenueBand } from "@/lib/revenue";
import { coreNaics } from "@/lib/naics";
import type { Company } from "@/lib/types";

/**
 * Deterministic LinkedIn company URL derived from the company name.
 * Mirrors the convention used elsewhere in the app (ClientCard, CompaniesTable).
 * NOTE: This is a best-guess slug — LinkedIn doesn't guarantee any specific
 * pattern, so the link may 404 for some companies. Empty-state alternative
 * would be hiding the icon entirely; we keep it visible to match the Figma row.
 */
function linkedInUrl(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `https://www.linkedin.com/company/${slug}`;
}

/**
 * Single collapsed table row matching Figma 4398:24133.
 *
 * Honest empty-states (no mocked data):
 *  - city / country missing  → "—" placeholder
 *  - employees null          → "—"
 *  - revenueBand returns "—" if employees null (the " $" suffix is still appended,
 *    matching the table column format used in CompaniesTable)
 *  - url null                → dim em-dash instead of clickable globe icon
 *
 * The street address is NOT shown — the existing `streetOf()` helper in
 * CompaniesTable is fake mock data and is intentionally not used here.
 */
export function TableRow({
  company,
  isExpanded,
  isSelected,
  onToggleExpand,
  onSelect,
}: {
  company: Company;
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
}) {
  const city = company.city || "";
  const country = company.country || "";
  const hasAddress = !!(city || country);
  const naics = coreNaics(company).code;
  const revenueLabel = `${revenueBand(company.employees, company.revLowerUsd, company.revHigherUsd)} $`;

  return (
    <div
      data-company-id={company.id}
      onClick={onSelect}
      className={`group relative rounded-2xl bg-[var(--bg-panel)] hover:shadow-sm hover:bg-[var(--bg-panel-2)] transition cursor-pointer overflow-hidden ${
        isSelected ? "ring-2 ring-[var(--accent)] shadow-sm" : ""
      }`}
    >
      {isExpanded && (
        <span
          aria-hidden
          className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[var(--accent)]"
        />
      )}
      <div className="grid grid-cols-[24px_minmax(220px,1.4fr)_minmax(220px,1.4fr)_120px_120px_160px_100px_100px] gap-3 items-center px-4 py-2.5">
        {/* Chevron toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="size-6 grid place-items-center rounded-md text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-elev)]"
          aria-label={isExpanded ? "Collapse row" : "Expand row"}
          aria-expanded={isExpanded}
        >
          <ChevronDown
            size={16}
            className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
          />
        </button>

        {/* Company name */}
        <div className="font-medium text-[var(--ink)] truncate">{company.name}</div>

        {/* Address — city + country, no mock street */}
        <div className="text-[var(--muted)] text-sm leading-snug min-w-0">
          {hasAddress ? (
            <div className="flex items-start gap-1.5 min-w-0">
              <MapPin
                size={14}
                className="mt-0.5 shrink-0 text-[var(--dim)]"
                aria-hidden
              />
              <div className="min-w-0">
                <div className="truncate text-[var(--ink)]">{city || "—"}</div>
                <div className="truncate text-xs text-[var(--dim)]">{country || "—"}</div>
              </div>
            </div>
          ) : (
            <div className="text-[var(--dim)] text-xs">—</div>
          )}
        </div>

        {/* Employees */}
        <div className="text-right font-mono text-sm text-[var(--ink)]">
          {company.employees != null ? company.employees.toLocaleString() : "—"}
        </div>

        {/* Revenue band */}
        <div className="text-right font-mono text-sm text-[var(--ink)]">
          {revenueLabel}
        </div>

        {/* Core NAICS */}
        <div className="font-mono text-sm text-[var(--ink)]">{naics}</div>

        {/* LinkedIn */}
        <div className="grid place-items-center">
          <a
            href={linkedInUrl(company.name)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="size-7 grid place-items-center rounded-md bg-[var(--bg-elev)] hover:bg-[var(--bg-panel-2)] hover:ring-1 hover:ring-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]"
            aria-label={`LinkedIn page for ${company.name}`}
          >
            <LinkedInIcon size={14} />
          </a>
        </div>

        {/* Website (honest empty-state when url is null) */}
        <div className="grid place-items-center">
          {company.url ? (
            <a
              href={company.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="size-7 grid place-items-center rounded-md bg-[var(--bg-elev)] hover:bg-[var(--bg-panel-2)] hover:ring-1 hover:ring-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]"
              aria-label={`Website for ${company.name}`}
            >
              <Globe size={14} />
            </a>
          ) : (
            <span className="text-[var(--dim)] text-xs" aria-label="No website">
              —
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
