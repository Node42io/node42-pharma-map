"use client";
import { useEffect, useState } from "react";
import { Sun, Moon } from "@phosphor-icons/react";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const t = document.documentElement.dataset.theme;
  return t === "light" ? "light" : "dark";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    setTheme(readTheme());
  }, []);
  function set(next: Theme) {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
    window.dispatchEvent(new CustomEvent("theme-change", { detail: next }));
    setTheme(next);
  }
  return (
    <div
      data-testid="theme-toggle"
      className="flex items-center gap-1 bg-[var(--bg-panel-2)] border border-[var(--line)] rounded-lg p-0.5"
    >
      <button
        onClick={() => set("light")}
        aria-pressed={theme === "light"}
        className={`size-7 grid place-items-center rounded-md transition ${
          theme === "light"
            ? "bg-[var(--accent)] text-black"
            : "text-[var(--muted)] hover:text-[var(--ink)]"
        }`}
      >
        <Sun size={14} weight={theme === "light" ? "fill" : "regular"} />
      </button>
      <button
        onClick={() => set("dark")}
        aria-pressed={theme === "dark"}
        className={`size-7 grid place-items-center rounded-md transition ${
          theme === "dark"
            ? "bg-[var(--accent)] text-black"
            : "text-[var(--muted)] hover:text-[var(--ink)]"
        }`}
      >
        <Moon size={14} weight={theme === "dark" ? "fill" : "regular"} />
      </button>
    </div>
  );
}

// Tiny hook other components will use in Loop 23+
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const update = () => setTheme(readTheme());
    update();
    const onChange = () => update();
    window.addEventListener("theme-change", onChange);
    return () => window.removeEventListener("theme-change", onChange);
  }, []);
  return theme;
}
