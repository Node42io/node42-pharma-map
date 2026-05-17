"use client";
import { useState } from "react";
import {
  X,
  MapPin,
  Globe,
  UsersThree as Users,
  CurrencyDollar as DollarSign,
  Buildings as Building2,
  Info,
  TrendUp as TrendingUp,
  TrendDown as TrendingDown,
  Calendar,
  Briefcase,
} from "@phosphor-icons/react";
import { LinkedInIcon } from "@/components/icons";
import { CompanyLogo } from "@/components/company/CompanyLogo";
import { revenueBand } from "@/lib/revenue";
import { coreNaics } from "@/lib/naics";
import { prettifyTag } from "@/lib/format";
import type { Company, Location, ManagementProfile } from "@/lib/types";

const DACH_COUNTRIES = new Set(["DEU", "AUT", "CHE"]);

function LocationsSection({
  company,
  onShowLocation,
}: {
  company: Company;
  onShowLocation?: (lat: number, lon: number) => void;
}) {
  const locations = company.locations ?? [];

  // Build display list. Prefer the `locations` array (HQ + offices). When
  // `locations` is empty fall back to the flat HQ-only row.
  type Row = Location & { _key: string };
  let rows: Row[] = [];
  if (locations.length > 0) {
    rows = locations.map((loc, i) => ({ ...loc, _key: `${loc.role}-${loc.city}-${i}` }));
  } else if (company.lat != null || company.city) {
    rows = [
      {
        role: "HQ",
        street: null,
        city: company.city,
        postcode: null,
        country: company.country,
        lat: company.lat,
        lon: company.lon,
        employeesHint: null,
        _key: "hq-flat",
      },
    ];
  }

  const hasOffices = rows.some((r) => r.role !== "HQ");

  return (
    <section className="px-5 pb-4">
      <h4 className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] font-mono mb-2">Locations</h4>
      {rows.length === 0 ? (
        <p className="text-sm italic text-[var(--dim)]">No location data available.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((loc) => {
            const isHQ = loc.role === "HQ";
            const hasCoords = loc.lat != null && loc.lon != null;
            const isDACH = loc.country ? DACH_COUNTRIES.has(loc.country) : true;
            const rowDim = !hasCoords || (!isHQ && !isDACH);
            const chipClass = isHQ
              ? "bg-[var(--bg-panel-2)] border border-[var(--accent)] text-[var(--ink)]"
              : "bg-[var(--bg-panel-2)] border border-[var(--line)] text-[var(--muted)]";
            return (
              <li
                key={loc._key}
                className={`flex items-start gap-2 px-2.5 py-2 rounded-md bg-[var(--bg-elev)] border border-[var(--line)] ${
                  rowDim ? "opacity-60" : ""
                }`}
              >
                <span
                  className={`shrink-0 mt-0.5 text-[9px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-md leading-none ${chipClass}`}
                >
                  {isHQ ? "HQ" : "Office"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-[var(--ink)] truncate leading-tight">
                    {loc.city}
                    {loc.country ? `, ${loc.country}` : ""}
                  </div>
                  {(loc.street || loc.postcode) && (
                    <div className="mt-0.5 text-[11px] font-mono text-[var(--dim)] truncate leading-tight">
                      {[loc.street, loc.postcode].filter(Boolean).join(", ")}
                    </div>
                  )}
                  {!hasCoords && (
                    <div className="mt-0.5 text-[10px] font-mono italic text-[var(--dim)]">(no coords)</div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!hasCoords || !onShowLocation}
                  onClick={() => {
                    if (hasCoords && onShowLocation) onShowLocation(loc.lat as number, loc.lon as number);
                  }}
                  className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.1em] px-1.5 py-1 rounded-md border leading-none transition ${
                    hasCoords && onShowLocation
                      ? "border-[var(--line)] bg-[var(--bg-panel-2)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--accent)]/60"
                      : "border-[var(--line)]/40 bg-[var(--bg-panel-2)]/40 text-[var(--dim)] cursor-not-allowed"
                  }`}
                  aria-label={`Show ${loc.city} on map`}
                  title={hasCoords ? `Show ${loc.city} on map` : "No coordinates"}
                >
                  <MapPin size={12} />
                  <span>Show on map</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!hasOffices && rows.length > 0 && (
        <p className="mt-2 text-[11px] italic text-[var(--dim)]">No additional office locations on file.</p>
      )}
    </section>
  );
}

const STATUS_STYLES: Record<string, string> = {
  PROSPECT: "bg-[var(--prospect)] text-black",
  LEAD: "bg-[var(--lead)] text-black",
  ACTIVE: "bg-[var(--active)] text-black",
};

function formatEmployees(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString();
}
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function initialsOf(name: string): string {
  return name
    .split(/[\s\-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function colorForPerson(name: string): string {
  const hue = hashStr(name) % 360;
  return `hsl(${hue} 30% 30%)`;
}

function isLeadership(seniority: string, title: string) {
  const s = seniority || "";
  const t = title || "";
  if (/cxo|chief|vice president|^c[a-z]o/i.test(s)) return true;
  if (/Vice President/.test(s) || /Vice President/.test(t)) return true;
  return false;
}

function compactUsd(n: number | null) {
  if (n == null || !isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function ContactAvatar({ profile }: { profile: ManagementProfile }) {
  const [errored, setErrored] = useState(false);
  const hasPhoto = !!profile.photoUrl && !errored;
  if (hasPhoto) {
    return (
      <img
        src={profile.photoUrl as string}
        alt={profile.name}
        onError={() => setErrored(true)}
        referrerPolicy="no-referrer"
        className="size-8 rounded-full object-cover bg-[var(--bg-panel)] shrink-0"
      />
    );
  }
  // Real photo not available — show deterministic initials disc (not a fake person).
  return (
    <div
      className="size-8 rounded-full shrink-0 grid place-items-center text-[10px] font-semibold text-white/85"
      style={{ backgroundColor: colorForPerson(profile.name) }}
      aria-label={profile.name}
      title="No public profile photo available"
    >
      {initialsOf(profile.name)}
    </div>
  );
}

function ContactCard({ profile, fallbackCity }: { profile: ManagementProfile; fallbackCity: string }) {
  const location = profile.location?.trim() || fallbackCity;
  const hasYears = profile.yearsAtCompany != null && profile.yearsAtCompany > 0;
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-[var(--bg-elev)] border border-[var(--line)]">
      <ContactAvatar profile={profile} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[8.5px] uppercase tracking-[0.14em] font-mono text-[var(--muted)] px-1.5 py-0.5 rounded-md bg-[var(--bg-panel)] border border-[var(--line)] leading-none">
            {profile.seniority || "—"}
          </span>
          {hasYears && (
            <span className="text-[9px] font-mono text-[var(--muted)] px-1.5 py-0.5 rounded-full bg-[var(--bg-panel)] border border-[var(--line)] leading-none">
              {profile.yearsAtCompany}y
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] uppercase tracking-[0.08em] font-mono text-[var(--muted)] truncate leading-tight">
          {profile.title}
        </div>
        <div className="mt-0.5 text-[13px] font-medium text-[var(--ink)] truncate leading-tight">{profile.name}</div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] font-mono text-[var(--muted)]">
          <MapPin size={14} className="shrink-0" />
          <span className="truncate">{location}</span>
        </div>
      </div>
      {profile.linkedinUrl && (
        <a
          href={profile.linkedinUrl}
          target="_blank"
          rel="noreferrer"
          className="size-7 grid place-items-center rounded-md bg-[var(--bg-panel)] hover:bg-[var(--bg-panel-2)] text-[var(--muted)] hover:text-[var(--ink)] shrink-0 border border-[var(--line)]"
          aria-label={`${profile.name} on LinkedIn`}
        >
          <LinkedInIcon size={14} />
        </a>
      )}
    </div>
  );
}

function BuyingCenter({ company }: { company: Company }) {
  const fallbackCity = `${company.city}, ${company.country}`.replace(/^,\s*|,\s*$/g, "");
  const contacts = company.contacts ?? [];

  if (contacts.length === 0) {
    return (
      <div className="px-3 py-3 rounded-lg border border-dashed border-[var(--line)] bg-[var(--bg-elev)] text-[12px] text-[var(--muted)]">
        No decision-maker profiles loaded yet — ask Node42 to enrich.
      </div>
    );
  }

  const leadership = contacts.filter((c) => isLeadership(c.seniority, c.title));
  const departmentLeads = contacts.filter((c) => !isLeadership(c.seniority, c.title));

  return (
    <div className="space-y-5">
      {leadership.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] font-mono mb-2">
            Leadership (CXO + VP)
          </h4>
          <div className="space-y-2">
            {leadership.map((p, i) => (
              <ContactCard key={`lead-${p.name}-${p.title}-${i}`} profile={p} fallbackCity={fallbackCity} />
            ))}
          </div>
        </div>
      )}
      {departmentLeads.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] font-mono mb-2">
            Department Leads (Director + below)
          </h4>
          <div className="space-y-2">
            {departmentLeads.map((p, i) => (
              <ContactCard key={`dept-${p.name}-${p.title}-${i}`} profile={p} fallbackCity={fallbackCity} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BuildSignals({ company }: { company: Company }) {
  const growth = company.growth12mPct;
  const hasGrowth = growth != null && isFinite(growth);
  const fundingRound = company.lastFundingRound?.trim();
  const fundingDate = company.lastFundingDate?.trim();
  const hasFunding = !!fundingRound || !!fundingDate;
  const totalRaised = compactUsd(company.totalInvestmentUsd);
  const buildSignal = company.buildSignal?.trim();

  const growth3m = company.growth3mPct;

  if (!hasGrowth && !hasFunding && !totalRaised && !buildSignal && growth3m == null) {
    return (
      <section className="px-5 pb-4">
        <h4 className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] font-mono mb-2">BUILD SIGNALS</h4>
        <div className="px-3 py-2.5 rounded-md border border-dashed border-[var(--line)] bg-[var(--bg-elev)] text-[12px] text-[var(--dim)] italic">
          No build signals yet
        </div>
      </section>
    );
  }

  return (
    <section className="px-5 pb-4">
      <h4 className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] font-mono mb-2">BUILD SIGNALS</h4>
      {(hasGrowth || hasFunding || totalRaised) && (
        <div className="flex flex-wrap gap-2">
          {hasGrowth && (
            <div
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-[var(--bg-elev)] border border-[var(--line)] font-mono ${
                growth! >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {growth! >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              <span className="font-semibold">
                {growth! >= 0 ? "+" : ""}
                {growth!.toFixed(1)}%
              </span>
              <span className="text-[var(--muted)]">/ yr</span>
            </div>
          )}
          {hasFunding && (
            <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-[var(--bg-elev)] border border-[var(--line)] font-mono text-[var(--ink)]">
              <Briefcase size={14} className="text-[var(--muted)]" />
              <span className="font-semibold">{fundingRound || "Funded"}</span>
              {fundingDate && (
                <>
                  <span className="text-[var(--dim)]">·</span>
                  <Calendar size={14} className="text-[var(--muted)]" />
                  <span className="text-[var(--muted)]">{fundingDate}</span>
                </>
              )}
            </div>
          )}
          {totalRaised && (
            <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-[var(--bg-elev)] border border-[var(--line)] font-mono text-[var(--ink)]">
              <DollarSign size={14} className="text-[var(--muted)]" />
              <span className="font-semibold">{totalRaised}</span>
              <span className="text-[var(--muted)]">raised</span>
            </div>
          )}
        </div>
      )}
      {buildSignal && (
        <blockquote
          className="mt-3 pl-3 border-l-2 border-[var(--line)] text-[12.5px] leading-relaxed text-[var(--muted)] italic"
          title="Why this lead? Public build signal detected — recent hiring, expansion, or strategic announcement."
        >
          <span
            className="not-italic inline-flex items-center gap-1 mr-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-mono font-semibold uppercase tracking-[0.12em] text-[var(--ink)] bg-[var(--bg-panel-2)] border border-[var(--line)] align-middle"
            aria-label="Active sales signal"
          >
            <span aria-hidden>🔥</span>
            Signal
          </span>
          {buildSignal}
        </blockquote>
      )}
    </section>
  );
}

export function CompanyDrawer({
  company,
  onClose,
  onCycleStatus,
  floating = false,
  onShowLocation,
}: {
  company: Company;
  onClose: () => void;
  onCycleStatus: (id: string) => void;
  floating?: boolean;
  onShowLocation?: (lat: number, lon: number) => void;
}) {
  const linkedinHref = `https://www.linkedin.com/company/${company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const oncologyTags = company.oncologyTags ?? [];
  const buckets = company.buckets ?? [];
  // Primary: real molecule/therapy names from oncologyTags. Fallback: bucket keys prettified.
  const specialties: string[] =
    oncologyTags.length > 0
      ? Array.from(new Set(oncologyTags.map(prettifyTag)))
      : Array.from(new Set(buckets.map(prettifyTag)));

  const description = company.description ?? "";
  const trimmedDescription = description.trim();
  const hasDescription = trimmedDescription.length > 0;
  const shouldShowTruncated = trimmedDescription.length >= 80 && !/[.!?…"')\]]$/.test(trimmedDescription);

  const naicsGroup = coreNaics(company);
  // group is "325412 — Pharmaceutical Preparation Manufacturing" (already prefixed with code)
  // Fallback to "code — label" if group is the literal "Other".
  const naicsDisplay = naicsGroup.group.startsWith(naicsGroup.code)
    ? naicsGroup.group
    : `${naicsGroup.code} — ${naicsGroup.label}`;

  // Floating mode: glass panel positioned to the right of the sidebar
  // (which is left:12 + w:340 = 352, plus a 16px gap → left:368). Width
  // shrinks on narrow viewports so the panel never overflows past the
  // right edge: w-[min(480px,calc(100vw-380px))] keeps a 12px gutter from
  // the right edge regardless of viewport width. On screens narrower than
  // ~720px (1 sidebar + reasonable drawer width) the panel is hidden via
  // the parent (page.tsx clamps below sm).
  // Body opacity bumped to /80 — at /55 map pin tooltips (e.g. the yellow
  // selected-pin chip) bled through the drawer body and read like a
  // watermark over the contact cards. /80 keeps the glass feel via the
  // backdrop blur + saturate but stops content collision.
  const className = floating
    ? "absolute top-3 left-[368px] bottom-3 w-[min(480px,calc(100vw-380px))] z-[900] pointer-events-auto bg-[var(--bg-panel)]/80 backdrop-blur-xl backdrop-saturate-150 border border-[var(--line)]/55 rounded-2xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.04)_inset] flex flex-col overflow-hidden"
    : "w-[520px] shrink-0 border-l border-r border-[var(--line)] bg-[var(--bg-panel)] flex flex-col h-full overflow-hidden";

  return (
    <aside
      data-testid="company-drawer"
      className={className}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <CompanyLogo logoUrl={company.logoUrl} name={company.name} size={44} />
          <h3 className="text-2xl font-semibold tracking-tight leading-tight text-[var(--ink)] min-w-0 flex-1 truncate">
            {company.name}
          </h3>
        </div>
        <button
          data-testid="drawer-close"
          onClick={onClose}
          className="size-7 grid place-items-center rounded-md text-[var(--muted)] hover:text-[var(--ink)] shrink-0 -mt-1"
          aria-label="Close drawer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Social row (status pill removed per Figma 4398:20769) */}
      <div className="px-5 flex items-center gap-2">
        <a
          href={linkedinHref}
          target="_blank"
          rel="noreferrer"
          className="size-6 grid place-items-center rounded-md text-[var(--muted)] hover:text-[var(--ink)]"
          aria-label="LinkedIn"
        >
          <LinkedInIcon size={14} />
        </a>
        {company.url && (
          <a
            href={company.url}
            target="_blank"
            rel="noreferrer"
            className="size-6 grid place-items-center rounded-md text-[var(--muted)] hover:text-[var(--ink)]"
            aria-label="Website"
          >
            <Globe size={14} />
          </a>
        )}
      </div>

      {/* Address */}
      <div className="px-5 mt-2 flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <MapPin size={14} className="shrink-0" />
        <span className="truncate">
          {company.city}, {company.country}
        </span>
      </div>

      <div className="overflow-y-auto flex-1 mt-4">
        {/* About — always render, even when description is empty (Bug 1 fix) */}
        <section className="px-5 pb-4">
          <h4 className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] font-mono mb-2">About</h4>
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            {hasDescription ? (
              <>
                {trimmedDescription}
                {shouldShowTruncated && (
                  <span className="ml-1 italic text-[var(--dim)] text-xs">[description truncated]</span>
                )}
              </>
            ) : (
              <span className="italic text-[var(--dim)]">No description available.</span>
            )}
          </p>
        </section>

        {/* Metric grid */}
        <section className="px-5 pb-4">
          <div className="grid grid-cols-3 rounded-lg bg-[var(--bg-panel-2)] border border-[var(--line)] overflow-hidden">
            <div className="p-2.5 border-r border-[var(--line)]">
              <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)] font-mono flex items-center gap-1">
                <Users size={14} /> Headcount
              </div>
              <div className="mt-1.5 text-lg font-semibold leading-tight text-[var(--ink)]">
                {formatEmployees(company.employees)}
                <span className="ml-1 text-xs font-normal text-[var(--muted)]">Employees</span>
              </div>
            </div>
            <div className="p-2.5 border-r border-[var(--line)]">
              <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)] font-mono flex items-center gap-1">
                <DollarSign size={14} /> Revenue
              </div>
              <div className="mt-1.5 text-lg font-semibold leading-tight text-[var(--ink)]">
                {revenueBand(company.employees, company.revLowerUsd, company.revHigherUsd)}
                <span className="ml-1 text-xs font-normal text-[var(--muted)]">$</span>
              </div>
            </div>
            <div className="p-2.5">
              <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)] font-mono flex items-center gap-1">
                <Building2 size={14} /> Core NAICS
                <Info size={14} className="ml-auto text-[var(--dim)]" />
              </div>
              <div className="mt-1.5 text-sm font-semibold leading-tight text-[var(--ink)]">
                {naicsDisplay}
              </div>
            </div>
          </div>
        </section>

        {/* Specialities */}
        <section className="px-5 pb-4">
          <h4 className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] font-mono mb-2">Specialities</h4>
          {specialties.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {specialties.map((t) => (
                <span
                  key={t}
                  className="text-xs px-2.5 py-1 rounded-full bg-[var(--bg-panel-2)] text-[var(--ink)] border border-[var(--accent)]/40 font-medium leading-none whitespace-nowrap"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm italic text-[var(--dim)]">No specialities listed.</p>
          )}
        </section>

        {/* Locations — HQ + offices, with per-row "Show on map" affordance */}
        <LocationsSection company={company} onShowLocation={onShowLocation} />

        {/* Build Signals */}
        <BuildSignals company={company} />

        {/* Buying Center */}
        <section className="px-5 pb-6">
          <h4 className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] font-mono mb-3">
            Buying Center
          </h4>
          <BuyingCenter company={company} />
        </section>
      </div>

      {/* Footer "Mark as Lead" removed per Figma 4398:20769 (status pills dropped). */}
    </aside>
  );
}
