"use client";
import {
  ArrowSquareOut,
  Buildings,
  Calendar,
  CurrencyDollar,
  Factory,
  Flask,
  HardHat,
  Info,
  Lightbulb,
  TrendUp,
  Warehouse,
  WarningCircle,
  Wrench,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";
import type {
  Block,
  CalloutIconName,
  Field,
  SiteIconName,
  SourceLink,
} from "@/lib/chat-blocks";

// ---------------------------------------------------------------------------
// Block renderers — monochrome, Phosphor-only, theme-token-only. Designed to
// look like the rest of the Node42 app (glass panel, mono-icon rail, tight
// 10/12/13 px type scale). No emoji codepoints — the schema funnels the model
// through a fixed `iconName` enum mapped to icons below.
// ---------------------------------------------------------------------------

type IconType = ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill"; className?: string }>;

const SITE_ICON_MAP: Record<SiteIconName, IconType> = {
  construction: HardHat,
  factory: Factory,
  wrench: Wrench,
  flask: Flask,
  office: Buildings,
  warehouse: Warehouse,
};

const CALLOUT_ICON_MAP: Record<CalloutIconName, IconType> = {
  info: Info,
  win: TrendUp,
  warn: WarningCircle,
  insight: Lightbulb,
  calendar: Calendar,
  money: CurrencyDollar,
};

function HeadlineBlock({ text }: { text: string }) {
  return (
    <div className="text-[14px] font-semibold leading-snug mt-1 mb-3 text-[var(--ink)]">
      {text}
    </div>
  );
}

function SiteBlock({
  iconName,
  title,
  subtitle,
  fields,
  sources,
}: {
  iconName: SiteIconName;
  title: string;
  subtitle?: string;
  fields: Field[];
  sources?: SourceLink[];
}) {
  const Icon = SITE_ICON_MAP[iconName] ?? Buildings;
  return (
    <div className="my-2 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] overflow-hidden">
      <div className="px-3 py-2.5 flex items-center gap-2.5 border-b border-[var(--line)]">
        <span className="size-7 grid place-items-center rounded-lg bg-[var(--bg-panel-2)] border border-[var(--line)] text-[var(--muted)] shrink-0">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[var(--ink)] truncate leading-tight">
            {title}
          </div>
          {subtitle && (
            <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--muted)] mt-0.5">
              {subtitle}
            </div>
          )}
        </div>
      </div>
      {fields.length > 0 && (
        <div className="px-3 py-2.5 space-y-2">
          {fields.map((f, i) => (
            <div key={i}>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]">
                {f.label}
              </div>
              <div
                className={
                  f.emphasis
                    ? "text-[13px] font-semibold text-[var(--ink)] leading-snug"
                    : "text-[13px] text-[var(--ink)] leading-snug"
                }
              >
                {f.value}
              </div>
            </div>
          ))}
        </div>
      )}
      {sources && sources.length > 0 && (
        <div className="px-3 py-2 border-t border-[var(--line)] flex flex-wrap gap-1">
          {sources.map((s, i) => (
            <a
              key={`${s.url}-${i}`}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              title={s.url}
              className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--bg-panel-2)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)] transition"
            >
              <ArrowSquareOut size={10} /> {s.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function FactsBlock({
  title,
  items,
}: {
  title?: string;
  items: { label: string; value: string }[];
}) {
  return (
    <div className="my-2 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-3">
      {title && (
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] mb-2">
          {title}
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {items.map((it, i) => (
          <div key={i}>
            <div className="text-[10px] text-[var(--muted)] font-mono uppercase tracking-wider">
              {it.label}
            </div>
            <div className="text-[13px] font-semibold text-[var(--ink)] leading-snug">
              {it.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalloutBlock({
  iconName,
  tone,
  text,
}: {
  iconName?: CalloutIconName;
  tone: "info" | "win" | "warn";
  text: string;
}) {
  // Default the icon by tone if not specified.
  const resolvedIconName: CalloutIconName =
    iconName ?? (tone === "win" ? "win" : tone === "warn" ? "warn" : "info");
  const Icon = CALLOUT_ICON_MAP[resolvedIconName] ?? Info;

  const toneClass =
    tone === "win"
      ? "border-[var(--accent)] bg-[var(--bg-panel)]"
      : tone === "warn"
        ? "border-amber-500 bg-[var(--bg-panel)]"
        : "border-[var(--line)] bg-[var(--bg-panel)]";

  const iconClass =
    tone === "win"
      ? "text-[var(--accent)]"
      : tone === "warn"
        ? "text-amber-500"
        : "text-[var(--muted)]";

  return (
    <div
      className={`my-2 rounded-2xl border border-[var(--line)] border-l-2 ${toneClass} px-3 py-2.5 flex gap-2.5 text-[13px] leading-snug text-[var(--ink)]`}
    >
      <span className={`shrink-0 pt-[1px] ${iconClass}`}>
        <Icon size={16} />
      </span>
      <span>{text}</span>
    </div>
  );
}

function SourcesBlock({ items }: { items: SourceLink[] }) {
  if (!items.length) return null;
  return (
    <div className="my-2 pt-2 border-t border-[var(--line)]">
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--muted)] mb-1.5">
        Sources
      </div>
      <ul className="space-y-0.5">
        {items.map((s, i) => (
          <li key={`${s.url}-${i}`} className="flex">
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              title={s.url}
              className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)]/80 hover:text-[var(--accent)] hover:underline truncate max-w-full"
            >
              <ArrowSquareOut size={10} className="shrink-0" />
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ParagraphBlock({ text }: { text: string }) {
  return (
    <p className="text-[12.5px] leading-snug my-1 text-[var(--ink)]">{text}</p>
  );
}

export function BlockList({ blocks }: { blocks: Block[] }) {
  return (
    <div>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "headline":
            return <HeadlineBlock key={i} text={b.text} />;
          case "site":
            return (
              <SiteBlock
                key={i}
                iconName={b.iconName}
                title={b.title}
                subtitle={b.subtitle}
                fields={b.fields}
                sources={b.sources}
              />
            );
          case "facts":
            return <FactsBlock key={i} title={b.title} items={b.items} />;
          case "callout":
            return (
              <CalloutBlock
                key={i}
                iconName={b.iconName}
                tone={b.tone}
                text={b.text}
              />
            );
          case "sources":
            return <SourcesBlock key={i} items={b.items} />;
          case "paragraph":
            return <ParagraphBlock key={i} text={b.text} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
