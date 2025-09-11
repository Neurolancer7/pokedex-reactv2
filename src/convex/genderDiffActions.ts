"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

// Minimal helpers (copied locally to avoid cross-file deps)
async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function toBulbapediaTitleCase(name: string): string {
  const segments = name.split(/[-_ ]+/g).filter(Boolean);
  return segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("_");
}

function possibleBulbaUrls(baseName: string): string[] {
  const title = toBulbapediaTitleCase(baseName);
  return [
    `https://bulbapedia.bulbagarden.net/wiki/${title}_(Pokémon)`,
    `https://bulbapedia.bulbagarden.net/wiki/${title}`,
  ];
}

function extractGenderDifferences(html: string): string | null {
  const anchorRegex = /<span[^>]+id=["']Gender_differences["'][^>]*>.*?<\/span>/i;
  const headingRegex = /<h[23][^>]*>\s*(?:<span[^>]*>)?\s*Gender differences\s*(?:<\/span>)?\s*<\/h[23]>/i;

  let startIdx = -1;
  let match: RegExpExecArray | null = null;

  match = anchorRegex.exec(html) || headingRegex.exec(html);
  if (match) {
    startIdx = match.index + match[0].length;
  } else {
    return null;
  }

  const rest = html.slice(startIdx);
  const nextHeading = rest.search(/<h[23][^>]*>/i);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  const paragraphs = Array.from(section.matchAll(/<p[\s\S]*?<\/p>/gi)).map((m) => m[0]);
  if (paragraphs.length === 0) return null;

  const combined = paragraphs.join("\n\n");
  const text = decodeEntities(stripTags(combined));
  const clean = text.replace(/\[\d+\]/g, "").trim();
  return clean || null;
}

// Public action for fetching and caching gender-difference description
export const fetchGenderDifference = action({
  args: { name: v.string(), dexId: v.number() },
  handler: async (ctx, args) => {
    const baseName = args.name.toLowerCase();

    // Try cache by pokemonId first (30 days TTL)
    try {
      const cached: any = await ctx.runQuery(internal.genderDiff.getByPokemonId, {
        pokemonId: args.dexId,
      });
      const now = Date.now();
      const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;
      if (cached && now - (cached.fetchedAt ?? 0) < THIRTY_DAYS) {
        return {
          name: cached.name,
          dexId: args.dexId,
          description: cached.description,
          sourceUrl: cached.sourceUrl,
          cached: true,
        };
      }
    } catch {
      // Ignore cache read issues
    }

    const urls = possibleBulbaUrls(baseName);
    for (const url of urls) {
      try {
        const res = await fetchWithTimeout(url, { method: "GET" }, 20000);
        if (!res.ok) {
          if (res.status === 404 || res.status >= 500) {
            continue;
          }
          continue;
        }
        const html = await res.text();
        const desc = extractGenderDifferences(html);
        const description = desc && desc.length > 0 ? desc : "No known visual gender differences.";

        try {
          await ctx.runMutation(internal.genderDiff.upsert, {
            pokemonId: args.dexId,
            name: baseName,
            description,
            fetchedAt: Date.now(),
            sourceUrl: url,
          });
        } catch {
          // ignore cache write issues
        }

        return {
          name: baseName,
          dexId: args.dexId,
          description,
          sourceUrl: url,
          cached: false,
        };
      } catch {
        // try next URL
      }
    }

    // Fallback
    return {
      name: baseName,
      dexId: args.dexId,
      description: "No known visual gender differences.",
      sourceUrl: urls[0],
      cached: false,
    };
  },
});
