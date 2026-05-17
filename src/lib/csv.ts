import type { Company } from "./types";

export function downloadCsv(rows: Company[], filename = "companies.csv") {
  const cols: (keyof Company)[] = [
    "name", "country", "city", "employees", "industry", "description",
    "buildSignal", "status", "buckets", "oncologyTags", "url", "lat", "lon",
  ];
  const header = cols.join(",");
  const lines = rows.map((r) =>
    cols
      .map((c) => {
        const v = r[c];
        if (v == null) return "";
        if (Array.isArray(v)) return JSON.stringify(v.join(";"));
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(",")
  );
  const blob = new Blob([header + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}
