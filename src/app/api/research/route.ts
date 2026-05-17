import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BLOCK_JSON_SCHEMA, sanitizeBlocks } from "@/lib/chat-blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildSystemPrompt(): string {
  const today = new Date().toISOString().split("T")[0];
  const todayHuman = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `Today's date: ${todayHuman} (${today}).
When the user asks about "latest", "recent", or "current" events, ALWAYS treat this as the actual current date. Do NOT default to your training cutoff. Cite news from 2025 and 2026 as appropriate. If a search result is from before this date, it is historical; after this date, it is future-dated and may be a press-release roadmap.

${SYSTEM_PROMPT_BODY}`;
}

const SYSTEM_PROMPT_BODY = `You are a Node42 research agent supporting a pharma sales-target database (Waldner PAS targets DACH pharma manufacturers — they sell pharmaceutical aseptic filling systems).

You handle TWO query types:

A) RESEARCH / NEWS / MARKET-CONTEXT queries — the user is asking for information about the company, a person, or the market. They are NOT asking to mutate the database.
   - Examples: "What's the latest news about Vetter?", "Tell me about Cerbios' oncology pipeline", "What does this company do?"
   - Workflow: optionally call read_company for context, then web_search as needed, then call respond_with_blocks with the structured payload.
   - DO NOT call propose_patch in this branch.

B) ENRICHMENT queries — the user explicitly asks to add, update, mark, or fix a field on the row.
   - Examples: "Add Aldo Marfurt as COO", "Update the description", "Mark this as a build signal", "Find a decision-maker contact at Cerbios".
   - Workflow:
     1. Call read_company to get the current row.
     2. Use web_search to verify the fact and find a citable source.
     3. Call propose_patch with the minimal set of fields. Acceptable fields: name, description, industry, buildSignal, oncologyTags, contacts (array of {name, title, seniority, linkedinUrl, location}), growth12mPct, lastFundingRound, lastFundingDate.
   - If after searching you CANNOT verify the requested enrichment (e.g. "Find Florian Knautz at Vetter" → no such person found), respond with prose summarising the searches and false positives, then call propose_patch with an EMPTY patch ({}) and a short summary explaining why nothing is being proposed.

In both branches: be concise, cite URLs for every fact, and never invent contacts or signals.

OUTPUT FORMAT — STRUCTURED BLOCKS (strongly preferred):
- For ANY response that has multiple distinct facts, structured comparisons, news roundups, or multi-site descriptions: call \`respond_with_blocks\` with the structured payload. Reserve plain prose for short single-fact answers (under 40 words).
- When you call \`respond_with_blocks\`, the UI replaces any prose with the rendered blocks — so do NOT also stream the same content as markdown. Just call the tool and end the turn.
- NEVER include emoji unicode codepoints (🏗️ 🏭 💊 etc.) in ANY text field. Use the structured \`iconName\` field instead — this is the only way the UI renders an icon.
- Block types:
  • \`headline\` — one-line lead finding. Use first. No icon.
  • \`site\` — a card for a facility, project, partnership, or named entity. Required: \`iconName\`, \`title\`. Optional: \`subtitle\` (short role pill), \`fields\` (key/value rows), \`sources\` (chips with {label,url}).
  • \`facts\` — 2-column grid of label/value KPIs (revenue, headcount, founded, etc.).
  • \`callout\` — one highlighted line with a tone. \`info\` (neutral fact), \`win\` (sales opportunity / Waldner match), \`warn\` (risk / concern). Optional \`iconName\`.
  • \`sources\` — cross-cutting source list at the bottom (only when sources aren't already attached to individual site cards).
  • \`paragraph\` — short prose fallback.
- Site \`iconName\` enum: \`construction\` (new build), \`factory\` (existing manufacturing), \`wrench\` (upgrade/retrofit), \`flask\` (R&D / pipeline / product launch), \`office\` (commercial / HQ), \`warehouse\` (logistics).
- Callout \`iconName\` enum (optional, defaults from tone): \`info\`, \`win\`, \`warn\`, \`insight\`, \`calendar\`, \`money\`.
- Site card example: \`{type:'site', iconName:'construction', title:'Saarlouis, Germany', subtitle:'Commercial fill-finish', fields:[{label:'Investment', value:'€480M Phase 1 + €47M EU state aid'}, {label:'Timeline', value:'Construction Q2 2026 → ops 2031'}, {label:'Jobs', value:'1,200–2,000'}], sources:[{label:'Vetter PR', url:'https://...'}]}\`.
- Win-callout example: \`{type:'callout', tone:'win', iconName:'win', text:'Saarlouis greenfield aseptic fill-finish is prime Waldner PAS territory — engage before equipment specs are frozen.'}\`.
- Keep individual block text tight — site fields one short line each, callouts one sentence, headlines under 14 words. No markdown syntax inside block text (no **, no [text](url), no \\\`code\\\`).

RESPONSE STYLE FALLBACK (markdown — ONLY for short single-fact replies under 40 words):
- Lead with a bold headline, one or two short sentences. Inline \`[label](url)\` links allowed. NO horizontal rules. NO emoji.`;

const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 8;
// 1024 was tight for prose-only replies; structured `respond_with_blocks`
// payloads with multiple site cards routinely exceed it (the JSON encoding of
// 3 site cards + fields + sources is ~1.2–1.6k tokens). Bumping to 4096
// removes truncation as the failure mode while staying well under the
// per-request budget for the chat panel.
const MAX_TOKENS = 4096;

// Cast to Tool[] — BLOCK_JSON_SCHEMA is a `readonly`/`as const` object and
// Anthropic's Tool type wants a writable JSON Schema shape. The actual runtime
// payload is fine; this just placates the type checker.
const TOOLS: Tool[] = ([
  {
    name: "read_company",
    description:
      "Read the current authoritative row for a company from the local companies.json database. Returns the full record (description, industry, contacts, signals, etc.).",
    input_schema: {
      type: "object",
      properties: {
        companyId: {
          type: "string",
          description: "The unique companyId (slug) of the row to read.",
        },
      },
      required: ["companyId"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web via Perplexity for factual information (decision-makers, news, capex announcements, etc.). Returns the assistant's answer plus a list of source URL citations.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The natural-language web search query.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "propose_patch",
    description:
      "Propose a minimal JSON patch of fields to update on the company row. This ends the research session — the client surfaces the patch for human review. Only include fields you have a cited source for.",
    input_schema: {
      type: "object",
      properties: {
        patch: {
          type: "object",
          description:
            "Object containing only the fields to update. Acceptable keys: name, description, industry, buildSignal, oncologyTags, contacts, growth12mPct, lastFundingRound, lastFundingDate.",
        },
        summary: {
          type: "string",
          description:
            "Short human-readable summary of what is being proposed and why (cite URLs).",
        },
      },
      required: ["patch", "summary"],
    },
  },
  {
    name: "respond_with_blocks",
    description:
      "Render a structured response in the chat UI as designed React cards (site cards, facts grids, callouts). Use this for any non-trivial response — news digests, multi-site summaries, comparison tables, etc. Prefer this over plain prose when you have ≥2 distinct facts to convey. NEVER include emoji codepoints in text fields — use the iconName field instead. Calling this tool ends the turn; the UI will replace any streamed prose with the rendered blocks.",
    input_schema: {
      type: "object",
      properties: {
        blocks: BLOCK_JSON_SCHEMA,
      },
      required: ["blocks"],
    },
  },
] as unknown) as Tool[];

type ResearchRequestBody = {
  prompt?: string;
  companyId?: string;
  companyContext?: Record<string, unknown>;
};

function sseEvent(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

// --- Tool handlers ---

async function handleReadCompany(input: {
  companyId?: string;
}): Promise<unknown> {
  if (!input?.companyId || typeof input.companyId !== "string") {
    return { error: "Missing companyId" };
  }
  try {
    const filePath = path.join(process.cwd(), "public", "companies.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const rows = JSON.parse(raw) as Array<Record<string, unknown>>;
    const row = rows.find((r) => r?.id === input.companyId);
    if (!row) {
      return { error: `Company not found: ${input.companyId}` };
    }
    return row;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to read companies.json",
    };
  }
}

async function handleWebSearch(input: { query?: string }): Promise<unknown> {
  if (!input?.query || typeof input.query !== "string") {
    return { error: "Missing query" };
  }
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) {
    return { error: "PERPLEXITY_API_KEY not configured" };
  }
  try {
    const today = new Date().toISOString().split("T")[0];
    const datedQuery = `${input.query} as of ${today}`;
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: datedQuery }],
        search_recency_filter: "month",
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        error: `Perplexity ${resp.status}`,
        detail: text.slice(0, 500),
      };
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      citations?: string[];
    };
    const answer = json.choices?.[0]?.message?.content ?? "";
    const citations = Array.isArray(json.citations) ? json.citations : [];
    return { answer, citations };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Perplexity request failed",
    };
  }
}

function handleProposePatch(input: {
  patch?: unknown;
  summary?: unknown;
}): unknown {
  const patch =
    input && typeof input.patch === "object" && input.patch !== null
      ? (input.patch as Record<string, unknown>)
      : {};
  const summary = typeof input?.summary === "string" ? input.summary : "";
  return { ok: true, patch, summary };
}

async function runTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "read_company":
      return handleReadCompany(input as { companyId?: string });
    case "web_search":
      return handleWebSearch(input as { query?: string });
    case "propose_patch":
      return handleProposePatch(input as { patch?: unknown; summary?: unknown });
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export async function POST(req: NextRequest) {
  let body: ResearchRequestBody;
  try {
    body = (await req.json()) as ResearchRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { prompt, companyId, companyContext } = body;

  if (!prompt || typeof prompt !== "string") {
    return new Response(JSON.stringify({ error: "Missing 'prompt' string" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const client = new Anthropic({ apiKey });

  const userContent = JSON.stringify({
    prompt,
    companyId: companyId ?? null,
    companyContext: companyContext ?? null,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(sseEvent(payload));
        } catch {
          // already closed
        }
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const messages: MessageParam[] = [
        { role: "user", content: userContent },
      ];

      try {
        let proposed = false;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          // Stream the next assistant turn
          const messageStream = client.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: buildSystemPrompt(),
            tools: TOOLS,
            messages,
          });

          messageStream.on("text", (delta: string) => {
            safeEnqueue({ type: "text", delta });
          });

          let final;
          try {
            final = await messageStream.finalMessage();
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Anthropic stream error";
            safeEnqueue({ type: "error", error: message });
            break;
          }

          // Append assistant message to history
          messages.push({ role: "assistant", content: final.content });

          const toolUses: ToolUseBlock[] = final.content.filter(
            (b): b is ToolUseBlock => b.type === "tool_use",
          );

          if (toolUses.length === 0) {
            // No tool calls; model is done.
            break;
          }

          const toolResults: ToolResultBlockParam[] = [];

          for (const tu of toolUses) {
            const input =
              tu.input && typeof tu.input === "object"
                ? (tu.input as Record<string, unknown>)
                : {};

            safeEnqueue({ type: "tool_use", name: tu.name, input });

            if (tu.name === "respond_with_blocks") {
              // Validate / clean the model's payload, then push a `blocks` SSE
              // event so the chat UI can render structured cards in place of
              // the streamed markdown prose.
              const blocks = sanitizeBlocks(
                (input as { blocks?: unknown }).blocks,
              );
              safeEnqueue({ type: "blocks", blocks });
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify({ ok: true, count: blocks.length }),
              });
              continue;
            }

            if (tu.name === "propose_patch") {
              const patch =
                input.patch && typeof input.patch === "object"
                  ? (input.patch as Record<string, unknown>)
                  : {};
              const summary =
                typeof input.summary === "string" ? input.summary : "";
              safeEnqueue({ type: "propose_patch", patch, summary });
              proposed = true;
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify({ ok: true, patch }),
              });
              continue;
            }

            const result = await runTool(tu.name, input);

            // Surface citations from web_search to the client so the UI can
            // render a "Sources" mini-list under the assistant message.
            if (tu.name === "web_search" && result && typeof result === "object") {
              const r = result as { citations?: unknown };
              const citations = Array.isArray(r.citations)
                ? (r.citations as unknown[]).filter(
                    (u): u is string => typeof u === "string",
                  )
                : [];
              if (citations.length > 0) {
                safeEnqueue({
                  type: "tool_result",
                  name: "web_search",
                  citations,
                });
              }
            }

            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(result),
            });
          }

          if (proposed) break;

          // Feed tool results back as the next user turn
          messages.push({ role: "user", content: toolResults });

          if (final.stop_reason !== "tool_use") {
            // Defensive: model didn't actually request more turns
            break;
          }
        }

        safeEnqueue({ type: "done" });
        safeClose();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown server error";
        safeEnqueue({ type: "error", error: message });
        safeEnqueue({ type: "done" });
        safeClose();
      }
    },
    cancel() {
      // client disconnected; nothing to clean up explicitly
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
