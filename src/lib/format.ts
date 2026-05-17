/**
 * Shared display formatters.
 *
 * `prettifyTag` converts snake_case / kebab-case / space-separated keys into
 * Title Case for UI display while preserving common biotech/pharma acronyms in
 * all-caps. Underlying filter keys remain raw — only the displayed label
 * changes.
 */

const ACRONYMS = new Set([
  "adc",
  "hpapi",
  "api",
  "gmp",
  "mrna",
  "ivd",
  "naics",
  "rna",
  "dna",
  "crispr",
  "gnp",
  "ldn",
  "cdmo",
  "cmo",
  "jak",
  "aav",
  "mab",
  "mabs",
  "auds",
  "pcr",
  "qpcr",
  "sirna",
  "rnai",
  "cgt",
  "atmp",
]);

export function prettifyTag(s: string): string {
  return s
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) =>
      ACRONYMS.has(w.toLowerCase())
        ? w.toUpperCase()
        : (w[0]?.toUpperCase() ?? "") + w.slice(1).toLowerCase()
    )
    .join(" ");
}
