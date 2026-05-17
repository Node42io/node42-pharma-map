import { promises as fs } from "fs";
import path from "path";

// Backups live under `data/backups/` — NOT in `public/`. Next.js serves
// everything under `public/` (including dot-prefixed dirs), so the only safe
// place is a non-public path. Server-side routes can read/write here freely.
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const COMPANIES_PATH = path.join(PUBLIC_DIR, "companies.json");
export const BACKUPS_DIR = path.join(ROOT, "data", "backups");

const FILENAME_RE = /^companies-[\d\-T.Z]+\.json$/;

async function ensureBackupsDir(): Promise<void> {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
}

function timestampForFilename(d: Date = new Date()): string {
  // ISO with `:` swapped for `-` to be cross-platform-safe.
  return d.toISOString().replace(/:/g, "-");
}

/**
 * Read public/companies.json and write a snapshot to
 * data/backups/companies-<timestamp>.json using atomic write (tmp + rename).
 * After writing, prune to keep the most recent 50.
 *
 * Returns the absolute path of the backup file written.
 */
export async function backupCompaniesJson(): Promise<string> {
  await ensureBackupsDir();
  const raw = await fs.readFile(COMPANIES_PATH, "utf8");
  const filename = `companies-${timestampForFilename()}.json`;
  const finalPath = path.join(BACKUPS_DIR, filename);
  const tmpPath = `${finalPath}.tmp`;
  await fs.writeFile(tmpPath, raw, { flag: "w" });
  await fs.rename(tmpPath, finalPath);
  await pruneBackups(50);
  return finalPath;
}

export type BackupInfo = {
  filename: string;
  mtime: string;
  sizeBytes: number;
};

export async function listBackups(): Promise<BackupInfo[]> {
  await ensureBackupsDir();
  const entries = await fs.readdir(BACKUPS_DIR);
  const infos: BackupInfo[] = [];
  for (const name of entries) {
    if (!FILENAME_RE.test(name)) continue;
    const full = path.join(BACKUPS_DIR, name);
    try {
      const st = await fs.stat(full);
      if (!st.isFile()) continue;
      infos.push({
        filename: name,
        mtime: st.mtime.toISOString(),
        sizeBytes: st.size,
      });
    } catch {
      // ignore stat failures
    }
  }
  // Newest first.
  infos.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
  return infos;
}

/**
 * Copy `data/backups/<filename>` over `public/companies.json` atomically.
 * `filename` MUST already be validated against the strict pattern by callers,
 * but we re-validate here as defense-in-depth against path traversal.
 */
export async function restoreBackup(filename: string): Promise<void> {
  if (!FILENAME_RE.test(filename)) {
    throw new Error("invalid_backup_filename");
  }
  const src = path.join(BACKUPS_DIR, filename);
  // Confirm the resolved path is still inside BACKUPS_DIR.
  const resolved = path.resolve(src);
  if (!resolved.startsWith(path.resolve(BACKUPS_DIR) + path.sep)) {
    throw new Error("invalid_backup_path");
  }
  const raw = await fs.readFile(resolved, "utf8");
  // Sanity-check that this parses as a JSON array before we replace the live
  // file — refusing to restore an obviously corrupt backup.
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("backup_not_an_array");
  }
  const tmp = `${COMPANIES_PATH}.restore.tmp`;
  await fs.writeFile(tmp, raw, { flag: "w" });
  await fs.rename(tmp, COMPANIES_PATH);
}

/**
 * Keep the `keep` most recent backups, delete the rest. Returns number deleted.
 */
export async function pruneBackups(keep: number = 50): Promise<number> {
  const all = await listBackups(); // newest first
  if (all.length <= keep) return 0;
  const toDelete = all.slice(keep);
  let deleted = 0;
  for (const b of toDelete) {
    try {
      await fs.unlink(path.join(BACKUPS_DIR, b.filename));
      deleted++;
    } catch {
      // ignore
    }
  }
  return deleted;
}

export const BACKUP_FILENAME_RE = FILENAME_RE;
