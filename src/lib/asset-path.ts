// Resolve an asset path so it works both locally (no basePath) and when hosted
// on GitHub Pages under a subpath (e.g. /node42-pharma-map). Next.js exposes the
// configured basePath via NEXT_PUBLIC_BASE_PATH (set by the Pages workflow).
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Prefix an absolute path with the configured basePath.
 * `assetPath("/companies.json")` →
 *   - local dev: "/companies.json"
 *   - on Pages:  "/node42-pharma-map/companies.json"
 */
export function assetPath(path: string): string {
  if (!path.startsWith("/")) return path;
  return `${BASE_PATH}${path}`;
}
