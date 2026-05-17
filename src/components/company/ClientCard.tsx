"use client";
import { MapPin, Globe } from "@phosphor-icons/react";
import { LinkedInIcon } from "@/components/icons";
import { CompanyLogo } from "@/components/company/CompanyLogo";
import { CoverageBadge } from "@/components/company/CoverageBadge";
import { revenueBand } from "@/lib/revenue";
import type { Company, Tier } from "@/lib/types";

export const STATUS_STYLES: Record<string, string> = {
  PROSPECT: "bg-[var(--prospect)] text-black",
  LEAD: "bg-[var(--lead)] text-black",
  ACTIVE: "bg-[var(--active)] text-black",
};

export const TIER_STYLES: Record<Exclude<Tier, "">, string> = {
  "Tier 1": "bg-[var(--bg-panel-2)] text-[var(--ink)] border border-[var(--accent)]",
  "Tier 2": "bg-[var(--bg-panel-2)] text-[var(--ink)] border border-[var(--accent)]/50",
  "Tier 3": "border border-[var(--line)] text-[var(--muted)]",
  "Tier 4": "border border-[var(--line)] text-[var(--dim)]",
};

function tierShort(tier: Tier): string {
  if (tier === "") return "";
  return "T" + tier.slice(-1);
}

export function TierBadge({ tier, score }: { tier: Tier; score: number | null }) {
  if (tier === "") return null;
  const label = score != null ? `${tierShort(tier)} · ${score}` : tierShort(tier);
  return (
    <span
      className={`text-[10px] font-mono font-semibold tracking-wider px-1.5 py-[2px] rounded-md ${TIER_STYLES[tier]}`}
      title={`${tier}${score != null ? ` (score ${score})` : ""}`}
    >
      {label}
    </span>
  );
}

function formatEmployees(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString();
}

function fullAddress(city: string, country: string) {
  return `${city}, ${country}`;
}

function linkedInUrl(name: string) {
  return `https://www.linkedin.com/company/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/** Compact card — Figma frame 4265:29662 */
export function ClientCard({
  company,
  onClick,
  selected = false,
}: {
  company: Company;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="client-card"
      data-company-id={company.id}
      className={`group relative w-full text-left bg-[var(--bg-panel)] hover:bg-[var(--bg-panel-2)] border rounded-2xl p-4 transition ${
        selected ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[var(--line)]"
      }`}
    >
      <CoverageBadge company={company} />
      {/* 1. Company name */}
      <div className="text-base font-medium leading-tight tracking-tight truncate pr-5">
        {company.name}
      </div>

      {/* 2. LinkedIn · Globe (status pill removed per Figma 4398:20769) */}
      <div className="mt-2 flex items-center gap-2 text-[11px]">
        <a
          href={linkedInUrl(company.name)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[var(--muted)] hover:text-[var(--ink)]"
          aria-label="LinkedIn"
        >
          <LinkedInIcon size={14} />
        </a>
        {company.url && (
          <a
            href={company.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[var(--muted)] hover:text-[var(--ink)]"
            aria-label="Website"
          >
            <Globe size={14} />
          </a>
        )}
      </div>

      {/* 3. Map-pin + multi-line address */}
      <div className="mt-2 flex items-start gap-1.5 text-xs text-[var(--muted)]">
        <MapPin size={14} className="shrink-0 mt-[2px]" />
        <span className="leading-snug">
          {fullAddress(company.city, company.country)}
        </span>
      </div>

      {/* 4. Employees · Revenue */}
      <div className="mt-3 flex items-center text-xs leading-none">
        <span className="font-mono text-[var(--ink)]">{formatEmployees(company.employees)}</span>
        <span className="text-[var(--muted)] ml-1">Employees</span>
        <span className="text-[var(--dim)] mx-2">·</span>
        <span className="font-mono text-[var(--ink)]">{revenueBand(company.employees, company.revLowerUsd, company.revHigherUsd)} $</span>
        <span className="text-[var(--muted)] ml-1">Revenue</span>
      </div>
    </button>
  );
}

/** Expanded card with industry tag — Figma frame 4398:20769 */
export function ClientCardExpanded({
  company,
  onClick,
  selected = false,
}: {
  company: Company;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="client-card-expanded"
      data-company-id={company.id}
      className={`group relative w-full text-left bg-[var(--bg-panel)] hover:bg-[var(--bg-panel-2)] border rounded-2xl p-4 transition ${
        selected ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[var(--line)]"
      }`}
    >
      <CoverageBadge company={company} />
      {/* 1. Logo + company name */}
      <div className="flex items-start gap-2.5 pr-5">
        <CompanyLogo logoUrl={company.logoUrl} name={company.name} size={32} />
        <div className="text-base font-medium leading-tight tracking-tight text-[var(--ink)] min-w-0 flex-1">
          {company.name}
        </div>
      </div>

      {/* 2. Map-pin + address */}
      <div className="mt-2 flex items-start gap-1.5 text-xs text-[var(--muted)]">
        <MapPin size={14} className="shrink-0 mt-[2px]" />
        <span className="leading-snug">
          {fullAddress(company.city, company.country)}
        </span>
      </div>

      {/* 3. Inline row: LinkedIn · Globe · industry  (status pill removed per Figma 4398:20769) */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <a
          href={linkedInUrl(company.name)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[var(--muted)] hover:text-[var(--ink)]"
          aria-label="LinkedIn"
        >
          <LinkedInIcon size={14} />
        </a>
        {company.url && (
          <a
            href={company.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[var(--muted)] hover:text-[var(--ink)]"
            aria-label="Website"
          >
            <Globe size={14} />
          </a>
        )}
        {company.industry && (
          <span className="inline-block text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] border border-[var(--line)] px-1.5 py-[2px] rounded-md">
            {company.industry}
          </span>
        )}
      </div>

      {/* 4. Employees · Revenue */}
      <div className="mt-3 flex items-center text-xs leading-none">
        <span className="font-mono text-[var(--ink)]">{formatEmployees(company.employees)}</span>
        <span className="text-[var(--muted)] ml-1">Employees</span>
        <span className="text-[var(--dim)] mx-2">·</span>
        <span className="font-mono text-[var(--ink)]">{revenueBand(company.employees, company.revLowerUsd, company.revHigherUsd)} $</span>
        <span className="text-[var(--muted)] ml-1">Revenue</span>
      </div>
    </button>
  );
}
