// Block schema for structured chat responses. The research agent emits these
// via the `respond_with_blocks` tool — the chat UI renders each block as a
// dedicated React card (site card, facts grid, callout, etc.) instead of the
// default markdown prose, giving us a designed, glanceable response surface.
//
// Visual treatment: monochrome Phosphor icons only. Emoji codepoints are
// stripped from any text content the model emits — this UI is meant to look
// like the rest of the Node42 app (mono-iconic, glass panel, tight grid),
// not like a generic chat app.

export type Field = {
  label: string;
  value: string;
  emphasis?: boolean;
};

export type SourceLink = {
  label: string;
  url: string;
};

export type CalloutTone = "info" | "win" | "warn";

// Constrained icon vocabulary the model can pick from. Mapped to Phosphor
// components in `ChatBlocks.tsx`. Keeping it a small enum (rather than letting
// the model emit free-form icon names) prevents unknown-icon fallback states.
export type SiteIconName =
  | "construction"
  | "factory"
  | "wrench"
  | "flask"
  | "office"
  | "warehouse";

export type CalloutIconName =
  | "info"
  | "win"
  | "warn"
  | "insight"
  | "calendar"
  | "money";

export const SITE_ICON_NAMES = [
  "construction",
  "factory",
  "wrench",
  "flask",
  "office",
  "warehouse",
] as const;

export const CALLOUT_ICON_NAMES = [
  "info",
  "win",
  "warn",
  "insight",
  "calendar",
  "money",
] as const;

export type Block =
  | { type: "headline"; text: string }
  | {
      type: "site";
      iconName: SiteIconName;
      title: string;
      subtitle?: string;
      fields: Field[];
      sources?: SourceLink[];
    }
  | {
      type: "facts";
      title?: string;
      items: { label: string; value: string }[];
    }
  | {
      type: "callout";
      iconName?: CalloutIconName;
      tone: CalloutTone;
      text: string;
    }
  | { type: "sources"; items: SourceLink[] }
  | { type: "paragraph"; text: string };

// JSON Schema fragment used by the Anthropic tool-use definition. Mirrors the
// discriminated union above. Kept here so the API route and the UI never drift.
export const BLOCK_JSON_SCHEMA = {
  type: "array",
  description:
    "Ordered list of structured content blocks. Render top-to-bottom in the chat UI.",
  items: {
    type: "object",
    description:
      "One discriminated-union block. `type` selects the variant; other keys depend on type.",
    properties: {
      type: {
        type: "string",
        enum: ["headline", "site", "facts", "callout", "sources", "paragraph"],
      },
      text: {
        type: "string",
        description:
          "For `headline`: the headline string. For `callout`: the callout body. For `paragraph`: the paragraph text. NEVER include emoji codepoints — use the iconName field instead.",
      },
      iconName: {
        type: "string",
        description:
          "For `site`: one of construction|factory|wrench|flask|office|warehouse. For `callout` (optional): one of info|win|warn|insight|calendar|money. Use this INSTEAD of emoji characters.",
        enum: [
          "construction",
          "factory",
          "wrench",
          "flask",
          "office",
          "warehouse",
          "info",
          "win",
          "warn",
          "insight",
          "calendar",
          "money",
        ],
      },
      title: {
        type: "string",
        description: "For `site`: card title (e.g. 'Saarlouis, Germany').",
      },
      subtitle: {
        type: "string",
        description:
          "For `site`: short role/pill text (e.g. 'Commercial fill-finish').",
      },
      fields: {
        type: "array",
        description:
          "For `site`: ordered list of key/value rows shown in the body.",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
            emphasis: { type: "boolean" },
          },
          required: ["label", "value"],
        },
      },
      sources: {
        type: "array",
        description: "For `site`: source chips shown at the bottom of the card.",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            url: { type: "string" },
          },
          required: ["label", "url"],
        },
      },
      items: {
        type: "array",
        description:
          "For `facts`: grid items {label,value}. For `sources`: list of {label,url} links.",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
            url: { type: "string" },
          },
        },
      },
      tone: {
        type: "string",
        enum: ["info", "win", "warn"],
        description:
          "For `callout`: visual tone — info (neutral), win (sales opportunity), warn (risk/concern).",
      },
    },
    required: ["type"],
  },
} as const;

// Crude emoji-stripper. The model is told never to emit emoji in text fields
// (it should use iconName instead), but we strip defensively in case it does
// so the rendered cards stay clean and professional.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F02F}\u{FE0F}]/gu;

function stripEmoji(s: string): string {
  return s.replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
}

function coerceSiteIcon(v: unknown): SiteIconName {
  if (typeof v === "string" && (SITE_ICON_NAMES as readonly string[]).includes(v)) {
    return v as SiteIconName;
  }
  return "office";
}

function coerceCalloutIcon(v: unknown): CalloutIconName | undefined {
  if (typeof v === "string" && (CALLOUT_ICON_NAMES as readonly string[]).includes(v)) {
    return v as CalloutIconName;
  }
  return undefined;
}

// Runtime guard: validates an untrusted payload coming back from the model
// into a clean `Block[]`. Drops malformed entries instead of throwing — we'd
// rather render a partial response than break the whole chat turn.
export function sanitizeBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  const out: Block[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const type = b.type;
    if (typeof type !== "string") continue;
    switch (type) {
      case "headline": {
        if (typeof b.text === "string")
          out.push({ type, text: stripEmoji(b.text) });
        break;
      }
      case "paragraph": {
        if (typeof b.text === "string")
          out.push({ type, text: stripEmoji(b.text) });
        break;
      }
      case "callout": {
        const tone = b.tone === "win" || b.tone === "warn" ? b.tone : "info";
        if (typeof b.text === "string") {
          out.push({
            type,
            tone,
            text: stripEmoji(b.text),
            iconName: coerceCalloutIcon(b.iconName),
          });
        }
        break;
      }
      case "site": {
        if (typeof b.title !== "string") break;
        const fields: Field[] = Array.isArray(b.fields)
          ? (b.fields as unknown[])
              .map((f): Field | null => {
                if (!f || typeof f !== "object") return null;
                const fo = f as Record<string, unknown>;
                if (typeof fo.label !== "string" || typeof fo.value !== "string")
                  return null;
                const out: Field = {
                  label: stripEmoji(fo.label),
                  value: stripEmoji(fo.value),
                };
                if (typeof fo.emphasis === "boolean") out.emphasis = fo.emphasis;
                return out;
              })
              .filter((x): x is Field => x !== null)
          : [];
        const sources: SourceLink[] | undefined = Array.isArray(b.sources)
          ? ((b.sources as unknown[])
              .map((s) => {
                if (!s || typeof s !== "object") return null;
                const so = s as Record<string, unknown>;
                if (typeof so.label !== "string" || typeof so.url !== "string")
                  return null;
                return {
                  label: stripEmoji(so.label),
                  url: so.url,
                } satisfies SourceLink;
              })
              .filter((x): x is SourceLink => x !== null) as SourceLink[])
          : undefined;
        out.push({
          type,
          iconName: coerceSiteIcon(b.iconName),
          title: stripEmoji(b.title),
          subtitle:
            typeof b.subtitle === "string" ? stripEmoji(b.subtitle) : undefined,
          fields,
          sources,
        });
        break;
      }
      case "facts": {
        const items = Array.isArray(b.items)
          ? (b.items as unknown[])
              .map((it) => {
                if (!it || typeof it !== "object") return null;
                const io = it as Record<string, unknown>;
                if (typeof io.label !== "string" || typeof io.value !== "string")
                  return null;
                return {
                  label: stripEmoji(io.label),
                  value: stripEmoji(io.value),
                };
              })
              .filter((x): x is { label: string; value: string } => x !== null)
          : [];
        out.push({
          type,
          title:
            typeof b.title === "string" ? stripEmoji(b.title) : undefined,
          items,
        });
        break;
      }
      case "sources": {
        const items = Array.isArray(b.items)
          ? (b.items as unknown[])
              .map((it) => {
                if (!it || typeof it !== "object") return null;
                const io = it as Record<string, unknown>;
                if (typeof io.label !== "string" || typeof io.url !== "string")
                  return null;
                return { label: stripEmoji(io.label), url: io.url };
              })
              .filter((x): x is SourceLink => x !== null)
          : [];
        out.push({ type, items });
        break;
      }
      default:
        break;
    }
  }
  return out;
}
