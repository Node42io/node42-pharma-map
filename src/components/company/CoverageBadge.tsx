"use client";
import { CheckCircle, CircleHalf, Circle } from "@phosphor-icons/react";
import type { Company } from "@/lib/types";

/**
 * Tiny coverage indicator for the top-right of a company card.
 *
 *   full    — contacts AND description ≥80 chars AND (growth12mPct != null OR buildSignal)
 *   partial — missing one of the above
 *   sparse  — missing two or more
 */
export function CoverageBadge({ company }: { company: Company }) {
  const hasContacts = (company.contacts?.length ?? 0) > 0;
  const hasFullDescription = (company.description ?? "").trim().length >= 80;
  const hasGrowth = company.growth12mPct != null;
  const hasBuildSignal = !!company.buildSignal?.trim();
  const hasSignal = hasGrowth || hasBuildSignal;

  const missing: string[] = [];
  if (!hasContacts) missing.push("contacts");
  if (!hasFullDescription) missing.push("full description");
  if (!hasSignal) missing.push("growth/build signal");

  const level: "full" | "partial" | "sparse" =
    missing.length === 0 ? "full" : missing.length === 1 ? "partial" : "sparse";

  const title =
    level === "full"
      ? "Full coverage"
      : `Missing: ${missing.join(", ")}`;

  const color =
    level === "full"
      ? "var(--accent)"
      : level === "partial"
        ? "var(--muted)"
        : "var(--dim)";

  const ringClass =
    level === "full"
      ? "rounded-full shadow-[0_0_0_2px_rgba(253,255,152,0.18)]"
      : "";

  return (
    <span
      aria-label={title}
      title={title}
      data-coverage={level}
      className={`absolute top-2 right-2 grid place-items-center pointer-events-none ${ringClass}`}
      style={{ color }}
    >
      {level === "full" ? (
        <CheckCircle size={14} weight="fill" />
      ) : level === "partial" ? (
        <CircleHalf size={14} weight="fill" />
      ) : (
        <Circle size={14} />
      )}
    </span>
  );
}
