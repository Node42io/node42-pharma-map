import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { backupCompaniesJson } from "@/lib/backup";

// Force this route to run in the Node.js runtime (not edge) so we have fs access.
export const runtime = "nodejs";
// Never cache patch responses.
export const dynamic = "force-dynamic";

type Contact = {
  name: string;
  [k: string]: unknown;
};

type CompanyRow = {
  id: string;
  name?: string;
  description?: string;
  industry?: string;
  buildSignal?: string;
  oncologyTags?: string[];
  contacts?: Contact[];
  growth12mPct?: number | null;
  growth3mPct?: number | null;
  lastFundingRound?: string | null;
  lastFundingDate?: string | null;
  totalInvestmentUsd?: number | null;
  lat?: number | null;
  lon?: number | null;
  locations?: unknown;
  [k: string]: unknown;
};

type AuditEntry = {
  at: string;
  companyId: string;
  applied: string[];
  source: "chat";
};

// Keys the build pipeline owns — never accept these from a chat patch.
const FORBIDDEN_KEYS = new Set(["id", "lat", "lon", "locations"]);

// Keys this route will accept on a patch.
const ALLOWED_KEYS = new Set([
  "name",
  "description",
  "industry",
  "buildSignal",
  "oncologyTags",
  "contacts",
  "growth12mPct",
  "growth3mPct",
  "lastFundingRound",
  "lastFundingDate",
  "totalInvestmentUsd",
]);

const PUBLIC_DIR = path.join(process.cwd(), "public");
const COMPANIES_PATH = path.join(PUBLIC_DIR, "companies.json");
const COMPANIES_TMP_PATH = path.join(PUBLIC_DIR, "companies.json.tmp");
const AUDIT_LOG_PATH = path.join(PUBLIC_DIR, "enrichment-log.json");
const AUDIT_LOG_TMP_PATH = path.join(PUBLIC_DIR, "enrichment-log.json.tmp");

function mergeOncologyTags(existing: string[] = [], incoming: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...existing, ...incoming]) {
    if (typeof t !== "string") continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function mergeContacts(existing: Contact[] = [], incoming: Contact[]): Contact[] {
  const byName = new Map<string, Contact>();
  for (const c of existing) {
    if (c && typeof c.name === "string") byName.set(c.name, c);
  }
  for (const c of incoming) {
    if (!c || typeof c.name !== "string") continue;
    const prior = byName.get(c.name);
    // Merge field-by-field; incoming wins on overlap, prior preserved otherwise.
    byName.set(c.name, prior ? { ...prior, ...c } : c);
  }
  return Array.from(byName.values());
}

async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  let log: AuditEntry[] = [];
  try {
    const raw = await fs.readFile(AUDIT_LOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) log = parsed as AuditEntry[];
  } catch {
    log = [];
  }
  log.push(entry);
  const json = JSON.stringify(log, null, 2);
  await fs.writeFile(AUDIT_LOG_TMP_PATH, json, { flag: "w" });
  await fs.rename(AUDIT_LOG_TMP_PATH, AUDIT_LOG_PATH);
}

export async function POST(req: NextRequest) {
  let body: { companyId?: string; patch?: Record<string, unknown> } & {
    __replace?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const companyId = typeof body?.companyId === "string" ? body.companyId : null;
  const patch =
    body && typeof body.patch === "object" && body.patch !== null
      ? (body.patch as Record<string, unknown> & { __replace?: boolean })
      : null;
  if (!companyId || !patch) {
    return NextResponse.json(
      { error: "missing_company_id_or_patch" },
      { status: 400 },
    );
  }

  // Pull replace flag from either the body top-level or the patch (per spec it's "top level").
  const replaceMode = Boolean(body.__replace ?? patch.__replace);

  // Validate keys.
  const rejected: string[] = [];
  const unknownKeys: string[] = [];
  for (const k of Object.keys(patch)) {
    if (k === "__replace") continue;
    if (FORBIDDEN_KEYS.has(k)) {
      rejected.push(k);
      continue;
    }
    if (!ALLOWED_KEYS.has(k)) {
      unknownKeys.push(k);
    }
  }
  if (rejected.length > 0) {
    return NextResponse.json(
      {
        error: "forbidden_keys",
        keys: rejected,
        message:
          "Keys id/lat/lon/locations are owned by the build pipeline and cannot be patched.",
      },
      { status: 400 },
    );
  }
  if (unknownKeys.length > 0) {
    return NextResponse.json(
      {
        error: "unknown_keys",
        keys: unknownKeys,
        allowed: Array.from(ALLOWED_KEYS),
      },
      { status: 400 },
    );
  }

  // Load companies.
  let companies: CompanyRow[];
  try {
    const raw = await fs.readFile(COMPANIES_PATH, "utf8");
    companies = JSON.parse(raw);
    if (!Array.isArray(companies)) throw new Error("companies.json is not an array");
  } catch (e) {
    return NextResponse.json(
      {
        error: "companies_read_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  const idx = companies.findIndex((r) => r && r.id === companyId);
  if (idx < 0) {
    return NextResponse.json({ error: "company_not_found", companyId }, { status: 404 });
  }

  const existing = companies[idx];
  const next: CompanyRow = { ...existing };
  const applied: string[] = [];

  for (const [key, value] of Object.entries(patch)) {
    if (key === "__replace") continue;
    if (!ALLOWED_KEYS.has(key)) continue; // defensive; already filtered above.

    if (key === "oncologyTags") {
      if (!Array.isArray(value)) {
        return NextResponse.json(
          { error: "oncologyTags_must_be_array" },
          { status: 400 },
        );
      }
      const tags = value as unknown[];
      const strs = tags.filter((t): t is string => typeof t === "string");
      next.oncologyTags = replaceMode
        ? Array.from(new Set(strs))
        : mergeOncologyTags(existing.oncologyTags, strs);
      applied.push(key);
      continue;
    }

    if (key === "contacts") {
      if (!Array.isArray(value)) {
        return NextResponse.json(
          { error: "contacts_must_be_array" },
          { status: 400 },
        );
      }
      const incoming = (value as unknown[]).filter(
        (c): c is Contact =>
          c !== null &&
          typeof c === "object" &&
          typeof (c as { name?: unknown }).name === "string",
      );
      next.contacts = replaceMode
        ? incoming
        : mergeContacts(existing.contacts, incoming);
      applied.push(key);
      continue;
    }

    // Scalar fields — direct overwrite.
    (next as Record<string, unknown>)[key] = value;
    applied.push(key);
  }

  if (applied.length === 0) {
    return NextResponse.json(
      { error: "empty_patch", message: "No allowed keys present in patch." },
      { status: 400 },
    );
  }

  companies[idx] = next;

  // Snapshot the current public/companies.json before we overwrite it, so a
  // bad patch can be undone via the /api/companies/restore endpoint. We only
  // reach this point after validation passes and at least one allowed key is
  // being applied — empty/forbidden patches return earlier and never trigger
  // a backup. Backup failures are non-fatal but surfaced as a warning.
  let backupWarning: string | undefined;
  try {
    await backupCompaniesJson();
  } catch (e) {
    backupWarning = e instanceof Error ? e.message : String(e);
  }

  // Atomic write: tmp + rename. If two patches race, the later rename wins.
  const json = JSON.stringify(companies, null, 2);
  try {
    await fs.writeFile(COMPANIES_TMP_PATH, json, { flag: "w" });
    await fs.rename(COMPANIES_TMP_PATH, COMPANIES_PATH);
  } catch (e) {
    return NextResponse.json(
      {
        error: "companies_write_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  const at = new Date().toISOString();
  try {
    await appendAuditEntry({ at, companyId, applied, source: "chat" });
  } catch (e) {
    // Audit failure shouldn't fail the patch — but surface it in the response.
    return NextResponse.json({
      row: next,
      audit: { at, applied },
      warning: "audit_log_write_failed",
      auditError: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({
    row: next,
    audit: { at, applied },
    ...(backupWarning ? { backupWarning } : {}),
  });
}
