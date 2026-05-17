"use client";
import { useMemo, useState } from "react";
import { MagnifyingGlass as Search, X, CaretDown as ChevronDown, Sparkle, Check } from "@phosphor-icons/react";
import type { Filters, Company, Status, Tier } from "@/lib/types";
import { EMPTY_FILTERS } from "@/lib/types";
import { countByValue } from "@/lib/filters";
import { NAICS_GROUPS, coreNaics } from "@/lib/naics";
import { prettifyTag } from "@/lib/format";

const STATUSES: Status[] = ["PROSPECT", "LEAD", "ACTIVE"];
const TIERS: Tier[] = ["Tier 1", "Tier 2", "Tier 3", "Tier 4"];

type Props = {
  rows: Company[];
  filters: Filters;
  onChange: (next: Filters) => void;
};

function SectionCard({
  title,
  count,
  children,
  defaultOpen = true,
  leadingIcon,
}: {
  title: string;
  count?: number;
  children?: React.ReactNode;
  defaultOpen?: boolean;
  leadingIcon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-[var(--bg-panel)] border border-[var(--line)] rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-[13px] hover:bg-[var(--bg-panel-2)]/40 transition-colors"
      >
        <span className="flex items-center gap-2 font-medium text-[var(--ink)]">
          {leadingIcon}
          {title}
          {count != null && count > 0 && (
            <span className="text-[10px] font-mono text-[var(--ink)] px-1.5 py-0.5 rounded-full bg-[var(--bg-panel-2)] border border-[var(--line)]">
              {count}
            </span>
          )}
        </span>
        <ChevronDown
          size={14}
          weight="bold"
          className={`text-[var(--muted)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && children && <div className="px-4 pb-4 pt-1">{children}</div>}
    </section>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-[var(--bg-elev)] border border-[var(--line)] text-[11px] text-[var(--ink)]">
      <span className="truncate max-w-[140px]">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="size-3.5 grid place-items-center rounded-full text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-panel-2)]"
      >
        <X size={11} weight="bold" />
      </button>
    </span>
  );
}

function YellowCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`size-[18px] rounded-[5px] grid place-items-center shrink-0 transition border ${
        checked
          ? "bg-[var(--accent)] border-[var(--accent)] shadow-[0_0_0_2px_rgba(253,255,152,0.12)]"
          : "bg-transparent border-[var(--line)] group-hover:border-[var(--muted)]"
      }`}
      aria-checked={checked}
      role="checkbox"
    >
      {checked && <Check size={12} weight="bold" className="text-black" />}
    </span>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  testId?: string;
}) {
  return (
    <div className="relative group">
      <Search
        size={14}
        weight="bold"
        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
      />
      <input
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[var(--bg-elev)] border border-[var(--line)] rounded-full pl-9 pr-8 py-2 text-[13px] text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]/60 focus:ring-2 focus:ring-[var(--accent)]/15 transition"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded-full text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-panel-2)]"
        >
          <X size={14} weight="bold" />
        </button>
      )}
    </div>
  );
}

function ListItem({
  label,
  count,
  checked,
  onToggle,
}: {
  label: string;
  count?: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      className={`group w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] text-left cursor-pointer transition-colors ${
        checked ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"
      } hover:bg-[var(--bg-panel-2)]/40`}
    >
      <YellowCheckbox checked={checked} />
      <span className="flex-1 truncate">{label}</span>
      {count != null && (
        <span className="text-[10px] font-mono text-[var(--dim)] group-hover:text-[var(--muted)]">{count}</span>
      )}
    </div>
  );
}

export function FilterPanel({ rows, filters, onChange }: Props) {
  const bucketCounts = useMemo(() => countByValue(rows, "buckets"), [rows]);
  const tagCounts = useMemo(() => countByValue(rows, "oncologyTags"), [rows]);
  const countryCounts = useMemo(() => countByValue(rows, "country"), [rows]);
  const tierCounts = useMemo(() => countByValue(rows, "tier"), [rows]);
  const statusCounts = useMemo(() => countByValue(rows, "status"), [rows]);
  const naicsCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of rows) {
      const code = coreNaics(r).code;
      out[code] = (out[code] ?? 0) + 1;
    }
    return out;
  }, [rows]);

  const coverage = useMemo(() => {
    const total = rows.length;
    let nWithContacts = 0;
    let nWithDescription = 0;
    let nWithGrowth = 0;
    let nWithCoords = 0;
    for (const r of rows) {
      if ((r.contacts?.length ?? 0) > 0) nWithContacts += 1;
      if ((r.description ?? "").trim().length >= 80) nWithDescription += 1;
      if (r.growth12mPct != null || !!r.buildSignal?.trim()) nWithGrowth += 1;
      if (r.lat != null && r.lon != null) nWithCoords += 1;
    }
    return { total, nWithContacts, nWithDescription, nWithGrowth, nWithCoords };
  }, [rows]);

  const buckets = useMemo(
    () => Object.entries(bucketCounts).sort((a, b) => b[1] - a[1]),
    [bucketCounts]
  );
  const tags = useMemo(
    () => Object.entries(tagCounts).sort((a, b) => b[1] - a[1]),
    [tagCounts]
  );
  const countries = useMemo(
    () => Object.entries(countryCounts).sort((a, b) => b[1] - a[1]),
    [countryCounts]
  );

  const [marketSearch, setMarketSearch] = useState("");
  const filteredBuckets = useMemo(() => {
    const q = marketSearch.trim().toLowerCase();
    if (!q) return buckets;
    return buckets.filter(
      ([b]) => b.toLowerCase().includes(q) || prettifyTag(b).toLowerCase().includes(q)
    );
  }, [buckets, marketSearch]);

  const activeCount =
    (filters.q ? 1 : 0) +
    filters.buckets.length +
    filters.oncologyTags.length +
    filters.countries.length +
    (filters.employeesMin != null ? 1 : 0) +
    (filters.employeesMax != null ? 1 : 0) +
    filters.status.length +
    filters.tiers.length +
    filters.naicsGroups.length +
    (filters.hasBuildSignal ? 1 : 0);

  const hasActive = activeCount > 0;

  function toggle<T extends string>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  return (
    <aside className="filter-panel w-[342px] shrink-0 bg-[var(--bg-page)] border-r border-[var(--line)] flex flex-col">
      {/* Panel header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-mono uppercase tracking-[0.14em] text-[var(--muted)]">
          Filters
          {hasActive && (
            <span className="ml-2 text-[10px] font-mono text-[var(--ink)] px-1.5 py-0.5 rounded-full bg-[var(--bg-panel-2)] border border-[var(--line)] normal-case tracking-normal">
              {activeCount}
            </span>
          )}
        </h2>
        {hasActive && (
          <button
            data-testid="clear-filters"
            onClick={() => onChange({ ...EMPTY_FILTERS })}
            className="text-[11px] text-[var(--muted)] hover:text-[var(--ink)] flex items-center gap-1 transition-colors"
          >
            <X size={14} weight="bold" /> Clear all
          </button>
        )}
      </div>

      <div className="overflow-y-auto filter-scroll flex-1 px-3 pb-4 pt-1 space-y-2.5">
        {/* Build Signal toggle — top of panel, above Markets */}
        <section className="bg-[var(--bg-panel)] border border-[var(--line)] rounded-2xl px-4 py-3">
          <button
            type="button"
            data-testid="toggle-build-signal"
            onClick={() => onChange({ ...filters, hasBuildSignal: !filters.hasBuildSignal })}
            className="w-full flex items-center justify-between gap-3 text-left"
            aria-pressed={filters.hasBuildSignal}
          >
            <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--ink)]">
              <span aria-hidden>🚀</span>
              Active build signals only
            </span>
            <span
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
                filters.hasBuildSignal
                  ? "bg-[var(--accent)] border-[var(--accent)]"
                  : "bg-[var(--bg-elev)] border-[var(--line)]"
              }`}
            >
              <span
                className={`absolute top-0.5 size-3.5 rounded-full bg-black transition-transform ${
                  filters.hasBuildSignal ? "translate-x-[18px]" : "translate-x-0.5"
                }`}
                style={{
                  backgroundColor: filters.hasBuildSignal ? "#000" : "var(--muted)",
                }}
              />
            </span>
          </button>
          <p className="mt-1.5 text-[11px] leading-snug text-[var(--muted)]">
            Show only companies with growth, recent funding, or a public build signal.
          </p>
        </section>

        {/* Semantic Search section */}
        <SectionCard
          title="Semantic Search"
          defaultOpen
          leadingIcon={<Sparkle size={14} weight="fill" className="text-[var(--accent)]" />}
        >
          <SearchInput
            testId="search"
            value={filters.q}
            onChange={(v) => onChange({ ...filters, q: v })}
            placeholder="Search a specific company…"
          />
          {hasActive && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {filters.status.map((s) => (
                <FilterChip key={s} label={s} onRemove={() => onChange({ ...filters, status: filters.status.filter((x) => x !== s) })} />
              ))}
              {filters.tiers.map((t) => (
                <FilterChip key={t} label={t} onRemove={() => onChange({ ...filters, tiers: filters.tiers.filter((x) => x !== t) })} />
              ))}
              {filters.buckets.map((b) => (
                <FilterChip key={b} label={prettifyTag(b)} onRemove={() => onChange({ ...filters, buckets: filters.buckets.filter((x) => x !== b) })} />
              ))}
              {filters.oncologyTags.map((t) => (
                <FilterChip key={t} label={prettifyTag(t)} onRemove={() => onChange({ ...filters, oncologyTags: filters.oncologyTags.filter((x) => x !== t) })} />
              ))}
              {filters.countries.map((c) => (
                <FilterChip key={c} label={c} onRemove={() => onChange({ ...filters, countries: filters.countries.filter((x) => x !== c) })} />
              ))}
            </div>
          )}
        </SectionCard>

        {/* Markets / Buckets — main NAICS-style hierarchical filter */}
        <SectionCard title="Markets NAICS code" count={filters.buckets.length} defaultOpen>
          <SearchInput
            value={marketSearch}
            onChange={setMarketSearch}
            placeholder="Search Markets…"
          />

          {filters.buckets.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {filters.buckets.map((b) => (
                <FilterChip key={b} label={prettifyTag(b)} onRemove={() => onChange({ ...filters, buckets: filters.buckets.filter((x) => x !== b) })} />
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2 px-1">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)] font-mono">Markets</span>
            <span className="text-[10px] font-mono text-[var(--ink)] px-1.5 py-0.5 rounded-full bg-[var(--bg-elev)] border border-[var(--line)]">
              {filteredBuckets.length}
            </span>
          </div>

          <div className="mt-1.5 max-h-72 overflow-y-auto filter-scroll pr-1 -mr-1">
            {filteredBuckets.length === 0 ? (
              <div className="text-[12px] text-[var(--dim)] py-3 px-2">No markets match “{marketSearch}”.</div>
            ) : (
              filteredBuckets.map(([b, c]) => (
                <ListItem
                  key={b}
                  label={prettifyTag(b)}
                  count={c}
                  checked={filters.buckets.includes(b)}
                  onToggle={() => onChange({ ...filters, buckets: toggle(filters.buckets, b) })}
                />
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="Status" count={filters.status.length}>
          <div className="-mx-1">
            {STATUSES.map((s) => (
              <ListItem
                key={s}
                label={s}
                count={statusCounts[s]}
                checked={filters.status.includes(s)}
                onToggle={() => onChange({ ...filters, status: toggle(filters.status, s) })}
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Tier" count={filters.tiers.length}>
          <div className="-mx-1">
            {TIERS.map((t) => (
              <ListItem
                key={t}
                label={t}
                count={tierCounts[t]}
                checked={filters.tiers.includes(t)}
                onToggle={() => onChange({ ...filters, tiers: toggle(filters.tiers, t) })}
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Core NAICS Groups" count={filters.naicsGroups.length}>
          <div className="-mx-1">
            {NAICS_GROUPS.map((g) => {
              const n = naicsCounts[g.code] ?? 0;
              if (n === 0) return null;
              return (
                <ListItem
                  key={g.code}
                  label={g.group}
                  count={n}
                  checked={filters.naicsGroups.includes(g.code)}
                  onToggle={() =>
                    onChange({ ...filters, naicsGroups: toggle(filters.naicsGroups, g.code) })
                  }
                />
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="Oncology tags" count={filters.oncologyTags.length} defaultOpen={false}>
          <div className="max-h-72 overflow-y-auto filter-scroll pr-1 -mr-1 -mx-1">
            {tags.map(([t, c]) => (
              <ListItem
                key={t}
                label={prettifyTag(t)}
                count={c}
                checked={filters.oncologyTags.includes(t)}
                onToggle={() => onChange({ ...filters, oncologyTags: toggle(filters.oncologyTags, t) })}
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Countries" count={filters.countries.length} defaultOpen={false}>
          <div className="max-h-72 overflow-y-auto filter-scroll pr-1 -mr-1 -mx-1">
            {countries.map(([c, n]) => (
              <ListItem
                key={c}
                label={c}
                count={n}
                checked={filters.countries.includes(c)}
                onToggle={() => onChange({ ...filters, countries: toggle(filters.countries, c) })}
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Number of employees" defaultOpen={false}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Min"
              value={filters.employeesMin ?? ""}
              onChange={(e) => onChange({ ...filters, employeesMin: e.target.value === "" ? null : Number(e.target.value) })}
              className="w-full bg-[var(--bg-elev)] border border-[var(--line)] rounded-full px-3 py-2 text-[13px] text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]/60 focus:ring-2 focus:ring-[var(--accent)]/15 transition"
            />
            <span className="text-[var(--dim)] text-xs">–</span>
            <input
              type="number"
              placeholder="Max"
              value={filters.employeesMax ?? ""}
              onChange={(e) => onChange({ ...filters, employeesMax: e.target.value === "" ? null : Number(e.target.value) })}
              className="w-full bg-[var(--bg-elev)] border border-[var(--line)] rounded-full px-3 py-2 text-[13px] text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]/60 focus:ring-2 focus:ring-[var(--accent)]/15 transition"
            />
          </div>
        </SectionCard>

        <SectionCard title="Industry" defaultOpen={false}>
          <p className="text-[12px] leading-relaxed text-[var(--muted)]">
            Industry derived from <code className="text-[var(--accent)] font-mono text-[11px] px-1 py-0.5 rounded-md bg-[var(--bg-elev)]">specialty</code> column. Use Markets filter above for primary categorization.
          </p>
        </SectionCard>

        {/* Data coverage snapshot */}
        <section
          data-testid="data-coverage"
          className="bg-[var(--bg-panel)] border border-[var(--line)] rounded-2xl px-4 py-3"
        >
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)] font-mono mb-2">
            Data coverage
          </div>
          <ul className="space-y-1.5">
            {[
              { n: coverage.nWithContacts, label: "companies have decision-maker contacts" },
              { n: coverage.nWithDescription, label: "have a full description (≥80 chars)" },
              { n: coverage.nWithGrowth, label: "have growth or funding signals" },
              { n: coverage.nWithCoords, label: "appear on the map" },
            ].map((row, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-[11px] text-[var(--muted)] font-mono leading-snug"
              >
                <span
                  aria-hidden
                  className="mt-[5px] size-[5px] rounded-full bg-[var(--accent)] shrink-0"
                />
                <span>
                  <span className="text-[var(--ink)]">{row.n}</span>
                  <span className="text-[var(--dim)]"> / {coverage.total}</span>{" "}
                  {row.label}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}
