"use client";
import Image from "next/image";
import { Question, ChatCircle } from "@phosphor-icons/react";
import { ThemeToggle, useTheme } from "./ThemeToggle";
import { assetPath } from "@/lib/asset-path";

export type View = "map" | "list";

export interface TopNavProps {
  chatOpen: boolean;
  onToggleChat: () => void;
}

/**
 * Slim 44px-tall navbar matching Figma 4398:20945 — logo + theme toggle + chat + help.
 * All view/CSV/filters controls now live in the MapControls floating overlay.
 * Chat panel state is lifted to the page so the chat can know about the
 * currently-selected company without prop-drilling through here.
 */
export function TopNav({ chatOpen, onToggleChat }: TopNavProps) {
  const theme = useTheme();
  const logoSrc = assetPath(
    theme === "light" ? "/node42-logo-dark.png" : "/node42-logo.png",
  );
  return (
    <header className="h-11 px-6 flex items-center justify-between bg-[var(--bg-page)] border-b border-[var(--line)] shrink-0 z-30">
      <Image
        key={theme}
        src={logoSrc}
        alt="node42"
        width={103}
        height={16}
        priority
        unoptimized
        className="h-4 w-auto select-none"
      />
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <button
          type="button"
          aria-label="Open Node42 Chat"
          onClick={onToggleChat}
          className={[
            "size-7 grid place-items-center rounded-full border transition",
            chatOpen
              ? "bg-[var(--accent)]/20 border-[var(--accent)]/50 text-[var(--accent)]"
              : "bg-[var(--bg-panel-2)] border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]",
          ].join(" ")}
        >
          <ChatCircle size={14} />
        </button>
        <button
          aria-label="Help"
          className="size-7 grid place-items-center rounded-full bg-[var(--bg-panel-2)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)] transition"
        >
          <Question size={14} />
        </button>
      </div>
    </header>
  );
}
