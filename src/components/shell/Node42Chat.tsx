"use client";
import {
  X,
  PaperPlaneTilt,
  MagnifyingGlass,
  BookOpen,
  PencilSimple,
  CheckCircle,
  XCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Company } from "@/lib/types";
import type { Block } from "@/lib/chat-blocks";
import { sanitizeBlocks } from "@/lib/chat-blocks";
import { BlockList } from "./ChatBlocks";

// Compact, theme-token markdown styling tuned for the 420px chat panel.
// Designed to render an at-a-glance digest: short h3 section labels, tight
// bullets, accent-colored inline links, and minimal vertical rhythm so the
// typical news-query response fits without scrolling.
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children, ...props }) => (
    <h2
      className="text-[12px] font-semibold uppercase tracking-wider mt-3 mb-1 text-[var(--muted)]"
      {...props}
    >
      {children}
    </h2>
  ),
  h2: ({ children, ...props }) => (
    <h3
      className="text-[12px] font-semibold uppercase tracking-wider mt-3 mb-1 text-[var(--muted)]"
      {...props}
    >
      {children}
    </h3>
  ),
  h3: ({ children, ...props }) => (
    <h4
      className="text-[13px] font-semibold mt-2 mb-1 text-[var(--ink)]"
      {...props}
    >
      {children}
    </h4>
  ),
  h4: ({ children, ...props }) => (
    <h5
      className="text-[13px] font-semibold mt-2 mb-1 text-[var(--ink)]"
      {...props}
    >
      {children}
    </h5>
  ),
  p: ({ children, ...props }) => (
    <p
      className="text-[12.5px] leading-snug my-1 text-[var(--ink)]"
      {...props}
    >
      {children}
    </p>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-[var(--ink)]" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic text-[var(--muted)]" {...props}>
      {children}
    </em>
  ),
  ul: ({ children, ...props }) => (
    <ul
      className="list-disc list-outside ml-4 my-1 space-y-0.5 text-[12.5px]"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol
      className="list-decimal list-outside ml-4 my-1 space-y-0.5 text-[12.5px]"
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li
      className="text-[12.5px] text-[var(--ink)] leading-snug marker:text-[var(--muted)]"
      {...props}
    >
      {children}
    </li>
  ),
  a: ({ children, href, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--accent)]/90 hover:text-[var(--accent)] underline underline-offset-2 break-words"
      {...props}
    >
      {children}
    </a>
  ),
  code: ({ children, ...props }) => (
    <code
      className="font-mono text-[11px] bg-[var(--bg-panel-2)] px-1 py-0.5 rounded"
      {...props}
    >
      {children}
    </code>
  ),
  pre: ({ children, ...props }) => (
    <pre
      className="font-mono text-[11px] bg-[var(--bg-panel-2)] p-2 rounded-md my-2 overflow-x-auto"
      {...props}
    >
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="border-l-2 border-[var(--accent)]/50 pl-3 italic text-[var(--muted)] my-2"
      {...props}
    >
      {children}
    </blockquote>
  ),
  table: ({ children, ...props }) => (
    <table className="w-full text-[12px] my-2 border-collapse" {...props}>
      {children}
    </table>
  ),
  th: ({ children, ...props }) => (
    <th
      className="text-left text-[var(--muted)] font-mono uppercase text-[10px] tracking-wider border-b border-[var(--line)] py-1 pr-3"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td
      className="border-b border-[var(--line)]/40 py-1 pr-3 align-top text-[var(--ink)]"
      {...props}
    >
      {children}
    </td>
  ),
  hr: (props) => (
    <hr className="border-t border-[var(--line)]/30 my-2" {...props} />
  ),
};

function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="break-words">
      <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </Markdown>
    </div>
  );
}

type ToolCall = { name: string; input: Record<string, unknown> };

type AssistantMessage = {
  id: string;
  role: "assistant";
  text: string;
  toolCalls: ToolCall[];
  citations: string[];
  blocks?: Block[];
  proposedPatch?: { patch: Record<string, unknown>; summary: string };
  emptyPatch?: { summary: string; dismissed: boolean };
  error?: string;
  done: boolean;
};

type UserMessage = { id: string; role: "user"; text: string };
type SystemMessage = { id: string; role: "system"; text: string; tone?: "info" | "error" | "success" };
type ChatMessage = UserMessage | AssistantMessage | SystemMessage;

type ProposedPatchState = {
  messageId: string;
  patch: Record<string, unknown>;
  summary: string;
  companyId: string;
  status: "pending" | "applying" | "applied" | "rejected" | "error";
  errorText?: string;
};

export interface Node42ChatProps {
  open: boolean;
  onClose: () => void;
  selected: Company | null;
  onPatchApplied?: (updatedCompany: Company) => void;
}

const INITIAL_SYSTEM: SystemMessage = {
  id: "sys-welcome",
  role: "system",
  text: "Node42 Chat — ask the research agent to enrich a company row. Select a company first, then describe what to find (e.g. “Find a decision-maker contact”).",
};

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function Node42Chat({ open, onClose, selected, onPatchApplied }: Node42ChatProps) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_SYSTEM]);
  const [proposedPatch, setProposedPatch] = useState<ProposedPatchState | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputId = useId();

  // Auto-scroll on any new event.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, proposedPatch]);

  // Abort in-flight requests when the panel closes / component unmounts.
  useEffect(() => {
    if (!open && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [open]);

  const updateAssistant = useCallback(
    (id: string, updater: (m: AssistantMessage) => AssistantMessage) => {
      setMessages((prev) =>
        prev.map((m) => (m.role === "assistant" && m.id === id ? updater(m) : m)),
      );
    },
    [],
  );

  const sendPrompt = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;

    if (!selected) {
      setMessages((prev) => [
        ...prev,
        {
          id: genId("sys"),
          role: "system",
          tone: "error",
          text: "Select a company from the list or map first.",
        },
      ]);
      return;
    }

    setDraft("");
    const userMsg: UserMessage = { id: genId("u"), role: "user", text };
    const assistantId = genId("a");
    const assistantMsg: AssistantMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      toolCalls: [],
      citations: [],
      done: false,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Lean company context — anything more is in the file the agent reads via tool.
    const companyContext = {
      id: selected.id,
      name: selected.name,
      country: selected.country,
      city: selected.city,
      industry: selected.industry,
      buckets: selected.buckets,
      tier: selected.tier,
      contactsCount: selected.contacts?.length ?? 0,
    };

    try {
      const resp = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          companyId: selected.id,
          companyContext,
        }),
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) {
        const detail = await resp.text().catch(() => "");
        updateAssistant(assistantId, (m) => ({
          ...m,
          error: `Request failed: ${resp.status} ${detail.slice(0, 200)}`.trim(),
          done: true,
        }));
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by a blank line.
        let sepIdx = buffer.indexOf("\n\n");
        while (sepIdx !== -1) {
          const rawEvent = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          sepIdx = buffer.indexOf("\n\n");

          // Each event may have multiple `data:` lines; we only emit one per event.
          const dataLines = rawEvent
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart());
          if (dataLines.length === 0) continue;
          const payloadStr = dataLines.join("\n");
          let payload: unknown;
          try {
            payload = JSON.parse(payloadStr);
          } catch {
            continue;
          }
          if (!payload || typeof payload !== "object") continue;
          const evt = payload as { type?: string } & Record<string, unknown>;
          switch (evt.type) {
            case "text": {
              const delta = typeof evt.delta === "string" ? evt.delta : "";
              updateAssistant(assistantId, (m) => ({ ...m, text: m.text + delta }));
              break;
            }
            case "tool_use": {
              const name = typeof evt.name === "string" ? evt.name : "tool";
              const input =
                evt.input && typeof evt.input === "object"
                  ? (evt.input as Record<string, unknown>)
                  : {};
              updateAssistant(assistantId, (m) => ({
                ...m,
                toolCalls: [...m.toolCalls, { name, input }],
              }));
              break;
            }
            case "blocks": {
              // The agent called `respond_with_blocks` — replace the streamed
              // markdown body with the structured block payload for rendering.
              const blocks = sanitizeBlocks(evt.blocks);
              if (blocks.length > 0) {
                updateAssistant(assistantId, (m) => ({ ...m, blocks }));
              }
              break;
            }
            case "propose_patch": {
              const patch =
                evt.patch && typeof evt.patch === "object"
                  ? (evt.patch as Record<string, unknown>)
                  : {};
              const summary = typeof evt.summary === "string" ? evt.summary : "";
              // Filter forbidden / meta keys before deciding "empty".
              const meaningfulKeys = Object.keys(patch).filter(
                (k) => k !== "__replace",
              );
              if (meaningfulKeys.length === 0) {
                // Empty patch → render an inline "no enrichment found" card
                // instead of the full Apply/Reject preview.
                updateAssistant(assistantId, (m) => ({
                  ...m,
                  emptyPatch: { summary, dismissed: false },
                }));
              } else {
                updateAssistant(assistantId, (m) => ({
                  ...m,
                  proposedPatch: { patch, summary },
                }));
                setProposedPatch({
                  messageId: assistantId,
                  patch,
                  summary,
                  companyId: selected.id,
                  status: "pending",
                });
              }
              break;
            }
            case "tool_result": {
              const name = typeof evt.name === "string" ? evt.name : "";
              if (name === "web_search" && Array.isArray(evt.citations)) {
                const incoming = (evt.citations as unknown[]).filter(
                  (u): u is string => typeof u === "string",
                );
                if (incoming.length > 0) {
                  updateAssistant(assistantId, (m) => {
                    const seen = new Set(m.citations);
                    const merged = [...m.citations];
                    for (const url of incoming) {
                      if (!seen.has(url)) {
                        seen.add(url);
                        merged.push(url);
                      }
                    }
                    return { ...m, citations: merged };
                  });
                }
              }
              break;
            }
            case "error": {
              const errText =
                typeof evt.error === "string" ? evt.error : "Unknown error";
              updateAssistant(assistantId, (m) => ({ ...m, error: errText }));
              break;
            }
            case "done": {
              updateAssistant(assistantId, (m) => ({ ...m, done: true }));
              break;
            }
            default:
              break;
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        // expected on close — leave message as-is
      } else {
        const message = err instanceof Error ? err.message : "Stream failed";
        updateAssistant(assistantId, (m) => ({ ...m, error: message, done: true }));
      }
    } finally {
      updateAssistant(assistantId, (m) => ({ ...m, done: true }));
      setBusy(false);
      abortRef.current = null;
    }
  }, [draft, busy, selected, updateAssistant]);

  const applyPatch = useCallback(async () => {
    if (!proposedPatch || proposedPatch.status !== "pending") return;
    setProposedPatch((p) => (p ? { ...p, status: "applying" } : p));
    try {
      const resp = await fetch("/api/companies/patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: proposedPatch.companyId,
          patch: proposedPatch.patch,
        }),
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        setProposedPatch((p) =>
          p ? { ...p, status: "error", errorText: `${resp.status} ${detail.slice(0, 200)}` } : p,
        );
        setMessages((prev) => [
          ...prev,
          {
            id: genId("sys"),
            role: "system",
            tone: "error",
            text: `Patch failed: ${resp.status}`,
          },
        ]);
        return;
      }
      // Parse the response body — server returns `{ row, audit }`. Bubble
      // `row` up to the page so the drawer/list/map can re-render without a
      // manual reload.
      try {
        const body = (await resp.json()) as {
          row?: Record<string, unknown>;
          // Tolerate older/alternate shapes: flat row with `audit` sibling.
          audit?: unknown;
          id?: unknown;
        };
        let row: Record<string, unknown> | null = null;
        if (body && typeof body === "object") {
          if (body.row && typeof body.row === "object") {
            row = body.row as Record<string, unknown>;
          } else if (typeof body.id === "string") {
            const { audit: _a, ...rest } = body as Record<string, unknown>;
            void _a;
            row = rest;
          }
        }
        if (row && typeof row.id === "string") {
          onPatchApplied?.(row as unknown as Company);
        }
      } catch {
        // If the response is not JSON, fall through — state still flips to
        // "applied" so the user sees confirmation in the chat.
      }
      setProposedPatch((p) => (p ? { ...p, status: "applied" } : p));
      setMessages((prev) => [
        ...prev,
        {
          id: genId("sys"),
          role: "system",
          tone: "success",
          text: "Patch applied. Drawer updated with the new values.",
        },
      ]);
      // Clear the proposed patch shortly after success so it stops occupying the
      // bottom of the panel — the assistant message still shows the inline card
      // with its "applied" badge.
      window.setTimeout(() => {
        setProposedPatch((p) => (p && p.status === "applied" ? null : p));
      }, 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setProposedPatch((p) => (p ? { ...p, status: "error", errorText: message } : p));
    }
  }, [proposedPatch, onPatchApplied]);

  const dismissEmptyPatch = useCallback((messageId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "assistant" && m.id === messageId && m.emptyPatch
          ? { ...m, emptyPatch: { ...m.emptyPatch, dismissed: true } }
          : m,
      ),
    );
  }, []);

  const rejectPatch = useCallback(() => {
    setProposedPatch((p) => (p ? { ...p, status: "rejected" } : p));
    setMessages((prev) => [
      ...prev,
      {
        id: genId("sys"),
        role: "system",
        text: "Patch rejected.",
      },
    ]);
    window.setTimeout(() => setProposedPatch(null), 600);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendPrompt();
    }
  };

  return (
    <aside
      aria-hidden={!open}
      aria-label="Node42 Chat"
      className={[
        "fixed top-12 right-3 bottom-3 w-[420px] z-[1100]",
        "bg-[var(--bg-panel)]/80 backdrop-blur-xl",
        "border border-[var(--line)]/60 rounded-2xl shadow-2xl",
        "flex flex-col overflow-hidden",
        "transition-transform duration-300 ease-out",
        open ? "translate-x-0" : "translate-x-[110%]",
      ].join(" ")}
    >
      {/* Header */}
      <header className="h-10 px-4 flex items-center justify-between border-b border-[var(--line)]/60 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] tracking-[0.18em] uppercase font-mono text-[var(--muted)]">
            NODE42 CHAT
          </span>
          {selected ? (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--bg-panel-2)] border border-[var(--line)] text-[var(--ink)] max-w-[160px] truncate"
              title={selected.name}
            >
              {selected.name}
            </span>
          ) : (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--bg-panel-2)] border border-[var(--line)] text-[var(--muted)]">
              no company
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="Close Node42 Chat"
          onClick={onClose}
          className="size-6 grid place-items-center rounded-full bg-[var(--bg-panel-2)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)] transition"
        >
          <X size={12} />
        </button>
      </header>

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            patchState={
              msg.role === "assistant" &&
              proposedPatch &&
              proposedPatch.messageId === msg.id
                ? proposedPatch
                : null
            }
            onApply={applyPatch}
            onReject={rejectPatch}
            onDismissEmpty={dismissEmptyPatch}
          />
        ))}
        {busy && (
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--muted)] flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
            researching…
          </div>
        )}
      </div>

      {/* Input footer */}
      <footer className="border-t border-[var(--line)]/60 p-3 shrink-0">
        {!selected && (
          <div className="mb-2 text-[11px] font-mono text-[var(--muted)] px-2 py-1 rounded border border-dashed border-[var(--line)]">
            Select a company from the list or map first.
          </div>
        )}
        <label htmlFor={inputId} className="sr-only">
          Message Node42
        </label>
        <div className="flex items-end gap-2 rounded-xl bg-[var(--bg-panel-2)] border border-[var(--line)] px-3 py-2 focus-within:border-[var(--accent)]/50 transition">
          <textarea
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={selected ? `Ask Node42 about ${selected.name}…` : "Ask Node42…"}
            disabled={busy}
            className="flex-1 resize-none bg-transparent text-[13px] text-[var(--ink)] placeholder:text-[var(--muted)] outline-none leading-5 max-h-32 disabled:opacity-60"
          />
          <button
            type="button"
            aria-label="Send message"
            onClick={() => void sendPrompt()}
            disabled={busy || !draft.trim()}
            className="size-7 grid place-items-center rounded-full bg-[var(--accent)]/20 border border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/30 transition shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PaperPlaneTilt size={13} weight="fill" />
          </button>
        </div>
      </footer>
    </aside>
  );
}

function MessageBubble({
  message,
  patchState,
  onApply,
  onReject,
  onDismissEmpty,
}: {
  message: ChatMessage;
  patchState: ProposedPatchState | null;
  onApply: () => void;
  onReject: () => void;
  onDismissEmpty: (messageId: string) => void;
}) {
  if (message.role === "system") {
    const tone = message.tone ?? "info";
    const cls =
      tone === "error"
        ? "bg-[var(--bg-panel-2)]/60 border-red-500/40 text-red-400"
        : tone === "success"
        ? "bg-[var(--bg-panel-2)]/60 border-[var(--accent)]/40 text-[var(--accent)]"
        : "bg-[var(--bg-panel-2)]/60 border-[var(--line)]/40 text-[var(--muted)]";
    return (
      <div
        className={`text-[11px] leading-relaxed font-mono px-3 py-2 rounded-lg border ${cls}`}
      >
        {message.text}
      </div>
    );
  }
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] text-[12.5px] leading-relaxed px-3 py-2 rounded-xl border bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--ink)] rounded-br-sm whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }
  // assistant
  // When the agent calls `respond_with_blocks`, render the structured cards
  // instead of the streamed markdown prose — the prose is the working draft,
  // the blocks are the designed output.
  const hasBlocks = !!message.blocks && message.blocks.length > 0;
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] w-full text-[12.5px] leading-relaxed px-3 py-2 rounded-xl border bg-[var(--bg-panel-2)] border-[var(--line)] text-[var(--ink)] rounded-bl-sm space-y-2">
        {hasBlocks ? (
          <BlockList blocks={message.blocks as Block[]} />
        ) : (
          message.text && <MarkdownBody text={message.text} />
        )}
        {message.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.toolCalls.map((tc, i) => (
              <ToolChip key={i} call={tc} />
            ))}
          </div>
        )}
        {message.error && (
          <div className="text-[11px] font-mono px-2 py-1 rounded border border-red-500/40 text-red-400 bg-red-500/5">
            {message.error}
          </div>
        )}
        {message.citations.length > 0 && (
          <SourcesList urls={message.citations} />
        )}
        {message.proposedPatch && patchState && (
          <PatchPreview state={patchState} onApply={onApply} onReject={onReject} />
        )}
        {message.proposedPatch && !patchState && (
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--muted)] flex items-center gap-1.5">
            <CheckCircle size={12} /> patch resolved
          </div>
        )}
        {message.emptyPatch && !message.emptyPatch.dismissed && (
          <EmptyPatchCard
            summary={message.emptyPatch.summary}
            onDismiss={() => onDismissEmpty(message.id)}
          />
        )}
      </div>
    </div>
  );
}

function formatSourceLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const segs = u.pathname.split("/").filter(Boolean);
    const first = segs[0];
    if (!first) return host;
    const truncatedSeg = first.length > 24 ? `${first.slice(0, 24)}…` : first;
    return `${host}/${truncatedSeg}${segs.length > 1 ? "…" : ""}`;
  } catch {
    return url.length > 48 ? `${url.slice(0, 48)}…` : url;
  }
}

function SourcesList({ urls }: { urls: string[] }) {
  const items = urls.slice(0, 5);
  return (
    <div className="pt-1 mt-1 border-t border-[var(--line)]/30">
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--muted)] mb-1">
        📎 Sources
      </div>
      <ul className="space-y-0.5">
        {items.map((url, i) => (
          <li key={`${url}-${i}`} className="flex">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={url}
              className="text-[11px] text-[var(--accent)]/80 hover:text-[var(--accent)] hover:underline truncate max-w-full"
            >
              {formatSourceLabel(url)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyPatchCard({
  summary,
  onDismiss,
}: {
  summary: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-1 rounded-lg border border-[var(--line)]/60 bg-[var(--bg-panel)]/40 overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-[var(--line)]/40">
        <MagnifyingGlass size={12} className="text-[var(--muted)]" />
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--muted)]">
          No enrichment found
        </span>
      </div>
      {summary && (
        <div className="px-3 py-2 text-[var(--muted)]">
          <MarkdownBody text={summary} />
        </div>
      )}
      <div className="px-3 py-2 border-t border-[var(--line)]/40">
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] font-mono uppercase tracking-wider px-3 py-1 rounded-md bg-[var(--bg-panel-2)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)] transition"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function ToolChip({ call }: { call: ToolCall }) {
  let Icon = MagnifyingGlass;
  let label = call.name;
  let detail = "";
  if (call.name === "web_search") {
    Icon = MagnifyingGlass;
    label = "web_search";
    detail = typeof call.input.query === "string" ? (call.input.query as string) : "";
  } else if (call.name === "read_company") {
    Icon = BookOpen;
    label = "read_company";
    detail =
      typeof call.input.companyId === "string"
        ? `id=${call.input.companyId as string}`
        : "";
  } else if (call.name === "propose_patch") {
    Icon = PencilSimple;
    label = "propose_patch";
    const patch = call.input.patch;
    if (patch && typeof patch === "object") {
      detail = Object.keys(patch as Record<string, unknown>).join(", ");
    }
  } else if (call.name === "respond_with_blocks") {
    Icon = PencilSimple;
    label = "respond_with_blocks";
    const blocks = call.input.blocks;
    detail = Array.isArray(blocks) ? `${blocks.length} blocks` : "";
  }
  return (
    <span
      title={detail}
      className="inline-flex items-center gap-1.5 max-w-full text-[10.5px] font-mono px-2 py-0.5 rounded border border-[var(--line)] bg-[var(--bg-panel)]/60 text-[var(--muted)]"
    >
      <Icon size={11} className="text-[var(--accent)] shrink-0" />
      <span className="text-[var(--ink)] shrink-0">{label}</span>
      {detail && (
        <span className="truncate max-w-[220px] opacity-80">{detail}</span>
      )}
    </span>
  );
}

function PatchPreview({
  state,
  onApply,
  onReject,
}: {
  state: ProposedPatchState;
  onApply: () => void;
  onReject: () => void;
}) {
  const entries = Object.entries(state.patch).filter(([k]) => k !== "__replace");
  const statusBadge =
    state.status === "applied" ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--accent)]">
        <CheckCircle size={11} /> applied
      </span>
    ) : state.status === "rejected" ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]">
        <XCircle size={11} /> rejected
      </span>
    ) : state.status === "applying" ? (
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]">
        applying…
      </span>
    ) : state.status === "error" ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-red-400">
        <XCircle size={11} /> error
      </span>
    ) : (
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]">
        review
      </span>
    );

  return (
    <div className="mt-1 rounded-lg border border-[var(--accent)]/40 bg-[var(--bg-panel)]/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--line)]/60 flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--accent)]">
          PROPOSED PATCH
        </span>
        {statusBadge}
      </div>
      {state.summary && (
        <div className="px-3 py-2 text-[11.5px] leading-relaxed text-[var(--ink)] border-b border-[var(--line)]/40">
          {state.summary}
        </div>
      )}
      <div className="px-3 py-2 text-[11px] font-mono">
        {entries.length === 0 ? (
          <div className="text-[var(--muted)]">No fields changed.</div>
        ) : (
          <table className="w-full">
            <tbody>
              {entries.map(([key, value]) => (
                <tr key={key} className="border-b border-[var(--line)]/30 last:border-b-0">
                  <td className="align-top py-1 pr-2 text-[var(--muted)] whitespace-nowrap">
                    {key}
                  </td>
                  <td className="align-top py-1 text-[var(--ink)] break-words">
                    <PatchValue value={value} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {state.errorText && (
        <div className="px-3 py-2 text-[11px] font-mono text-red-400 border-t border-red-500/30 bg-red-500/5">
          {state.errorText}
        </div>
      )}
      {state.status === "pending" && (
        <div className="px-3 py-2 flex items-center gap-2 border-t border-[var(--line)]/40">
          <button
            type="button"
            onClick={onApply}
            className="text-[11px] font-mono uppercase tracking-wider px-3 py-1 rounded-md bg-[var(--accent)]/20 border border-[var(--accent)]/50 text-[var(--accent)] hover:bg-[var(--accent)]/30 transition"
          >
            Apply patch
          </button>
          <button
            type="button"
            onClick={onReject}
            className="text-[11px] font-mono uppercase tracking-wider px-3 py-1 rounded-md bg-[var(--bg-panel-2)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)] transition"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function PatchValue({ value }: { value: unknown }) {
  if (value == null) return <span className="text-[var(--muted)]">null</span>;
  if (typeof value === "string") return <span>{value}</span>;
  if (typeof value === "number" || typeof value === "boolean")
    return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-[var(--muted)]">[]</span>;
    // For contacts (array of objects) show a compact list of names.
    if (typeof value[0] === "object" && value[0] !== null) {
      return (
        <ul className="space-y-0.5">
          {value.map((item, i) => {
            const obj = item as Record<string, unknown>;
            const name = typeof obj.name === "string" ? obj.name : null;
            const title = typeof obj.title === "string" ? obj.title : null;
            return (
              <li key={i} className="text-[10.5px]">
                {name ? (
                  <>
                    <span className="text-[var(--ink)]">{name}</span>
                    {title && (
                      <span className="text-[var(--muted)]"> — {title}</span>
                    )}
                  </>
                ) : (
                  <span className="text-[var(--muted)]">
                    {JSON.stringify(obj).slice(0, 120)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      );
    }
    return <span>{value.map((v) => String(v)).join(", ")}</span>;
  }
  return (
    <pre className="text-[10.5px] whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
