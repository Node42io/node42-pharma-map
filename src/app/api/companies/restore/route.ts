import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import {
  listBackups,
  restoreBackup,
  BACKUP_FILENAME_RE,
} from "@/lib/backup";

// Force Node runtime — we need fs.
export const runtime = "nodejs";
// Never cache restore responses.
export const dynamic = "force-dynamic";

type AuditEntry = {
  at: string;
  source: "restore";
  filename: string;
};

const PUBLIC_DIR = path.join(process.cwd(), "public");
const AUDIT_LOG_PATH = path.join(PUBLIC_DIR, "enrichment-log.json");
const AUDIT_LOG_TMP_PATH = path.join(PUBLIC_DIR, "enrichment-log.json.tmp");

async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  let log: unknown[] = [];
  try {
    const raw = await fs.readFile(AUDIT_LOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) log = parsed;
  } catch {
    log = [];
  }
  log.push(entry);
  const json = JSON.stringify(log, null, 2);
  await fs.writeFile(AUDIT_LOG_TMP_PATH, json, { flag: "w" });
  await fs.rename(AUDIT_LOG_TMP_PATH, AUDIT_LOG_PATH);
}

export async function GET() {
  try {
    const items = await listBackups();
    return NextResponse.json({ backups: items });
  } catch (e) {
    return NextResponse.json(
      {
        error: "list_backups_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: { filename?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const filename = typeof body?.filename === "string" ? body.filename : "";
  if (!filename) {
    return NextResponse.json({ error: "missing_filename" }, { status: 400 });
  }
  // Strict whitelist — blocks any path traversal (`..`, `/`, etc.) at the door.
  if (!BACKUP_FILENAME_RE.test(filename)) {
    return NextResponse.json(
      {
        error: "invalid_filename",
        message:
          "Filename must match companies-<ISO timestamp>.json (colons replaced with dashes).",
      },
      { status: 400 },
    );
  }

  try {
    await restoreBackup(filename);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Distinguish "not found" from other failures for nicer DX.
    if (msg.includes("ENOENT")) {
      return NextResponse.json(
        { error: "backup_not_found", filename },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "restore_failed", message: msg },
      { status: 500 },
    );
  }

  const at = new Date().toISOString();
  let auditWarning: string | undefined;
  try {
    await appendAuditEntry({ at, source: "restore", filename });
  } catch (e) {
    auditWarning = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    restored: true,
    filename,
    at,
    ...(auditWarning ? { auditWarning } : {}),
  });
}
