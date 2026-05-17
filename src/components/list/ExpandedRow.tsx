"use client";
import { useState } from "react";
import { MapPin } from "@phosphor-icons/react";
import { LinkedInIcon } from "@/components/icons";
import { prettifyTag } from "@/lib/format";
import type { Company, ManagementProfile } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Local helpers — mirrored from CompanyDrawer so this file is        */
/* self-contained. Same deterministic initials disc fallback when     */
/* no public photo is available — never a fake person.                */
/* ------------------------------------------------------------------ */

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
        className="size-9 rounded-full object-cover bg-[var(--bg-panel)] shrink-0"
      />
    );
  }
  return (
    <div
      className="size-9 rounded-full shrink-0 grid place-items-center text-[11px] font-semibold text-white/85"
      style={{ backgroundColor: colorForPerson(profile.name) }}
      aria-label={profile.name}
      title="No public profile photo available"
    >
      {initialsOf(profile.name)}
    </div>
  );
}

function ContactCard({
  profile,
  fallbackCity,
}: {
  profile: ManagementProfile;
  fallbackCity: string;
}) {
  const location = profile.location?.trim() || fallbackCity;
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-[var(--bg-elev)] border border-[var(--line)]">
      <ContactAvatar profile={profile} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[8.5px] uppercase tracking-[0.14em] font-mono text-[var(--muted)] px-1.5 py-0.5 rounded-md bg-[var(--bg-panel)] border border-[var(--line)] leading-none">
            {profile.seniority || "—"}
          </span>
        </div>
        <div className="mt-1 text-[11px] uppercase tracking-[0.08em] font-mono text-[var(--muted)] truncate leading-tight">
          {profile.title}
        </div>
        <div className="mt-0.5 text-[13px] font-medium text-[var(--ink)] truncate leading-tight">
          {profile.name}
        </div>
        {location && (
          <div className="mt-0.5 flex items-center gap-1 text-[11px] font-mono text-[var(--muted)]">
            <MapPin size={14} className="shrink-0" />
            <span className="truncate">{location}</span>
          </div>
        )}
      </div>
      {profile.linkedinUrl && (
        <a
          href={profile.linkedinUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="size-7 grid place-items-center rounded-md bg-[var(--bg-panel)] hover:bg-[var(--bg-panel-2)] text-[var(--muted)] hover:text-[var(--ink)] shrink-0 border border-[var(--line)]"
          aria-label={`${profile.name} on LinkedIn`}
        >
          <LinkedInIcon size={14} />
        </a>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ExpandedRow — inline content for an expanded company row.          */
/* Two-column grid: About | Specialities + Contacts.                  */
/* All data is honest — no mock contacts, no fake placeholders.       */
/* ------------------------------------------------------------------ */

export function ExpandedRow({ company }: { company: Company }) {
  const description = (company.description ?? "").trim();
  const hasDescription = description.length > 0;
  const looksTruncated = hasDescription && description.length >= 80 && !/[.!?…"')\]]$/.test(description);

  const allContacts: ManagementProfile[] = company.contacts ?? [];
  const tags = company.oncologyTags ?? [];

  // Cap visible contacts at 4 — same UX as before.
  const contacts: ManagementProfile[] = allContacts.slice(0, 4);

  const fallbackCity = `${company.city ?? ""}${
    company.city && company.country ? ", " : ""
  }${company.country ?? ""}`.trim();

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="border-t border-[var(--line)]/60 bg-[var(--bg-panel-2)] px-4 py-5"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.3fr] gap-6">
        {/* ───────────── About ───────────── */}
        <div>
          <h4 className="text-[11px] uppercase tracking-wider text-[var(--muted)] font-mono mb-2">
            About
          </h4>
          {hasDescription ? (
            <p className="text-sm text-[var(--ink)] leading-relaxed">
              {description}
              {looksTruncated && (
                <>
                  {" "}
                  <span className="italic text-[var(--dim)]">[description truncated]</span>
                </>
              )}
            </p>
          ) : (
            <p className="text-sm italic text-[var(--dim)] leading-relaxed">
              No description available.
            </p>
          )}
        </div>

        {/* ───────── Specialities + Contacts ───────── */}
        <div>
          <h4 className="text-[11px] uppercase tracking-wider text-[var(--muted)] font-mono mb-2">
            Specialities
          </h4>
          {tags.length ? (
            <div className="flex flex-wrap gap-1.5 mb-5">
              {tags.map((t) => (
                <span
                  key={t}
                  className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--bg-panel-2)] text-[var(--ink)] border border-[var(--accent)]/40"
                >
                  {prettifyTag(t)}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[var(--dim)] mb-5">No specialities listed.</div>
          )}

          <h4 className="text-[11px] uppercase tracking-wider text-[var(--muted)] font-mono mb-2">
            Contacts
          </h4>
          {allContacts.length === 0 ? (
            <div className="px-3 py-3 rounded-lg border border-dashed border-[var(--line)] bg-[var(--bg-elev)] text-[12px] text-[var(--muted)]">
              No decision-maker profiles loaded yet.
            </div>
          ) : (
            <div className="space-y-2">
              {contacts.map((p, i) => (
                <ContactCard
                  key={`expanded-${p.name}-${p.title}-${i}`}
                  profile={p}
                  fallbackCity={fallbackCity}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
