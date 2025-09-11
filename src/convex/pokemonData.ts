"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Add: Utility fetch wrappers with timeout and retries for safer external calls
async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function withCode(code: string, msg: string) {
  const e = new Error(`${code}:${msg}`);
  (e as any).code = code;
  return e;
}

async function fetchJson(
  url: string,
  label: string,
  init?: RequestInit,
  timeoutMs = 15000,
  retries = 2
): Promise<any> {
  let lastErr: unknown = undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs);
      if (!res.ok) {
        const status = res.status;
        const text = res.statusText || "Unknown error";
        // Retry only on transient errors
        if ((status === 429 || status >= 500) && attempt < retries) {
          await delay(400 * (attempt + 1));
          continue;
        }
        throw withCode("E_EXTERNAL", `[${label}] HTTP ${status} ${text}`);
      }
      try {
        return await res.json();
      } catch {
        throw withCode("E_EXTERNAL", `[${label}] Invalid JSON response`);
      }
    } catch (e) {
      lastErr = e;
      // Retry on network/abort errors
      if (attempt < retries) {
        await delay(400 * (attempt + 1));
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw withCode("E_EXTERNAL", `[${label}] ${msg}`);
    }
  }
  // Fallback (should not reach)
  throw lastErr instanceof Error ? lastErr : withCode("E_EXTERNAL", `[${label}] Unknown error`);
}

// Add: resilient scheduler helper with exponential backoff for transient commit saturation
async function scheduleWithRetry(
  ctx: any,
  label: string,
  funcRef: any,
  args: any,
  attempts = 7,
  baseDelayMs = 200
) {
  let lastErr: unknown = undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      return await ctx.scheduler.runAfter(0, funcRef, args);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const code =
        (e as any)?.code ??
        (typeof (e as any) === "object" ? (e as any)?.data?.code : undefined);

      const isCommitterFull =
        code === "CommitterFullError" ||
        msg.includes("CommitterFullError") ||
        msg.includes("Too many concurrent commits");

      const isOCC =
        code === "OptimisticConcurrencyControlFailure" ||
        msg.includes("OptimisticConcurrencyControlFailure");

      const isTransientScheduleIssue =
        msg.includes("Transient error while running schedule") ||
        msg.toLowerCase().includes("transient") ||
        msg.toLowerCase().includes("schedule");

      const shouldRetry = isCommitterFull || isOCC || isTransientScheduleIssue;

      if (shouldRetry && i < attempts - 1) {
        const delayMs = baseDelayMs * Math.pow(2, i) + Math.floor(Math.random() * 120);
        await delay(delayMs);
        continue;
      }

      throw withCode("E_SCHEDULE", `[${label}] ${msg}`);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : withCode("E_SCHEDULE", `[${label}] Unknown scheduling error`);
}

// Add: Internal action to process a chunk of Pokémon IDs in the background
export const processChunk = internalAction({
  args: {
    ids: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const ids = args.ids.filter((id) => Number.isFinite(id) && id > 0 && id <= 1025);
    if (ids.length === 0) return;

    // Reduced from 4 -> 3 to avoid commit overload under heavy load
    const CONCURRENCY = 3;

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);

      await Promise.all(
        batch.map(async (pokemonId) => {
          try {
            const existing = await ctx.runQuery(internal.pokemonInternal.getByIdInternal, { pokemonId });
            if (existing && Array.isArray((existing as any).formTags) && (existing as any).formTags.length > 0) return;

            const pokemonUrl = `https://pokeapi.co/api/v2/pokemon/${pokemonId}`;
            const speciesUrl = `https://pokeapi.co/api/v2/pokemon-species/${pokemonId}`;
            const formUrl = `https://pokeapi.co/api/v2/pokemon-form/${pokemonId}`;

            // Use robust fetch with timeouts & retries
            const [pokemonData, speciesData] = await Promise.all([
              fetchJson(pokemonUrl, "PokéAPI pokemon"),
              fetchJson(speciesUrl, "PokéAPI species"),
            ]);

            // Form is best-effort; ignore failures
            let formData: any | undefined = undefined;
            try {
              formData = await fetchJson(formUrl, "PokéAPI form");
            } catch {
              formData = undefined;
            }

            await ctx.runMutation(internal.pokemonInternal.cachePokemon, {
              pokemonData,
              speciesData,
              formData,
            });
          } catch (e) {
            // Log and continue with other IDs instead of failing the whole chunk
            console.error(`processChunk error for id ${pokemonId}:`, e);
          }
        })
      );
    }
  },
});

// Add: background internal action to cache types without blocking the main action
export const processTypes = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      await cacheTypes(ctx);
    } catch (e) {
      console.error("processTypes error:", e);
    }
  },
});

// Add: background internal action to fan-out chunk processing so main action returns immediately
export const processAll = internalAction({
  args: { ids: v.array(v.number()) },
  handler: async (ctx, args) => {
    const ids = args.ids.filter((id) => Number.isFinite(id) && id > 0 && id <= 1025);
    if (ids.length === 0) return;

    // Larger chunk size -> fewer chunks overall
    const CHUNK_SIZE = 50;

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      try {
        // Run the chunk immediately (no scheduler), avoiding large bursts of scheduled commits
        await ctx.runAction(internal.pokemonData.processChunk, { ids: chunk });
      } catch (e) {
        console.error("processAll chunk error:", e);
      }

      // Gentle pacing to avoid overwhelming commit queue in bursts
      try {
        await delay(50);
      } catch {
        // ignore pacing errors
      }
    }
  },
});

// Helper: classification for forms
function classifyFormCategories(
  form: any,
  fallbackName?: string,
): string[] {
  try {
    const tags: Set<string> = new Set();
    const name = String(form?.name ?? fallbackName ?? "").toLowerCase();
    const formName = String(form?.form_name ?? "").toLowerCase();

    // Priority: mega > gigantamax > regional > gender > cosmetic > alternate
    if (form?.is_mega === true || name.includes("mega") || formName.includes("mega")) {
      tags.add("mega");
    }

    if (formName.includes("gmax") || formName.includes("gigantamax") || name.includes("gmax") || name.includes("gigantamax")) {
      tags.add("gigantamax");
    }

    const regionalHints = ["alola", "alolan", "galar", "galarian", "hisui", "hisuian", "paldea", "paldean"];
    if (regionalHints.some((t) => name.includes(t)) || regionalHints.some((t) => formName.includes(t))) {
      tags.add("regional");
    }

    if (
      name.includes("male") || name.includes("female") ||
      name.endsWith("-m") || name.endsWith("-f") ||
      formName.includes("male") || formName.includes("female")
    ) {
      tags.add("gender");
    }

    const hasPrimary = tags.has("mega") || tags.has("gigantamax") || tags.has("regional") || tags.has("gender");
    if (!hasPrimary) {
      // Cosmetic forms are non-battle-only forms that alter appearance/names
      const isCosmeticCandidate = Boolean(formName) && form?.is_battle_only === false;
      if (isCosmeticCandidate) {
        tags.add("cosmetic");
      }
    }

    if (tags.size === 0) {
      tags.add("alternate");
    }

    return Array.from(tags);
  } catch {
    return ["alternate"];
  }
}

// Add: Internal action to fetch and cache specific Gigantamax forms reliably
export const processGigantamaxForms = internalAction({
  args: {},
  handler: async (ctx) => {
    // Canonical species base names for Gmax forms
    const baseNames: string[] = [
      "venusaur",
      "charizard",
      "blastoise",
      "butterfree",
      "pikachu",
      "meowth",
      "machamp",
      "gengar",
      "kingler",
      "lapras",
      "eevee",
      "snorlax",
      "garbodor",
      "melmetal",
      "rillaboom",
      "cinderace",
      "inteleon",
      "corviknight",
      "orbeetle",
      "drednaw",
      "coalossal",
      "flapple",
      "appletun",
      "sandaconda",
      "toxtricity",
      "centiskorch",
      "hatterene",
      "grimmsnarl",
      "alcremie",
      "copperajah",
      "duraludon",
    ];

    // Reduced concurrency for stability
    const CONCURRENCY = 3;

    const names = baseNames.map((n) => `${n}-gmax`);

    for (let i = 0; i < names.length; i += CONCURRENCY) {
      const batch = names.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (formName) => {
          try {
            const formUrl = `https://pokeapi.co/api/v2/pokemon-form/${formName}`;
            const form = await fetchJson(formUrl, "PokéAPI pokemon-form Gmax details");

            const formId = Number(form?.id);
            const pokemonName = String(form?.pokemon?.name ?? "").toLowerCase();
            const pokemonUrl: string = String(form?.pokemon?.url ?? "");
            const pokemonId = Number(pokemonUrl.split("/").slice(-2, -1)[0]);

            if (!Number.isFinite(pokemonId) || pokemonId <= 0) return;

            // Build sprite URLs with known patterns to avoid extra fetches
            const sprites = {
              frontDefault:
                String(
                  form?.sprites?.front_default ??
                    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`,
                ),
              frontShiny: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${pokemonId}.png`,
              officialArtwork: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonId}.png`,
            };

            const categories = classifyFormCategories(form, formName);

            await ctx.runMutation(internal.pokemonInternal.upsertForm, {
              formId,
              formName,
              pokemonName,
              pokemonId,
              categories,
              isDefault: Boolean(form?.is_default),
              isBattleOnly: Boolean(form?.is_battle_only),
              formOrder: typeof form?.form_order === "number" ? form.form_order : undefined,
              sprites,
              versionGroup: String(form?.version_group?.name ?? ""),
            });

            await ctx.runMutation(internal.pokemonInternal.mergeFormTagsIntoPokemon, {
              pokemonId,
              categories,
            });
          } catch (e) {
            console.error("processGigantamaxForms error for form:", formName, e);
          }
        }),
      );

      try {
        await delay(30);
      } catch {
        // ignore pacing error
      }
    }
  },
});

// Add: Public action to trigger Gmax caching on-demand from the UI
export const ensureGigantamaxForms = action({
  args: {},
  handler: async (ctx) => {
    try {
      await scheduleWithRetry(
        ctx,
        "processGigantamaxForms",
        internal.pokemonData.processGigantamaxForms,
        {},
        5,
        200,
      );
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw withCode("E_SCHEDULE", `Failed to ensure Gigantamax forms: ${msg}`);
    }
  },
});

// Internal action: process a single page of /pokemon-form list
export const crawlFormsProcessPage = internalAction({
  args: { offset: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    const { offset, limit } = args;
    const listUrl = `https://pokeapi.co/api/v2/pokemon-form?limit=${limit}&offset=${offset}`;
    try {
      const data = await fetchJson(listUrl, "PokéAPI pokemon-form list");
      const items: Array<{ name: string; url: string }> = Array.isArray(data?.results) ? data.results : [];

      // Reduced concurrency to ease commit pressure
      const CONCURRENCY = 3;
      for (let i = 0; i < items.length; i += CONCURRENCY) {
        const batch = items.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (it) => {
            try {
              const form = await fetchJson(it.url, "PokéAPI pokemon-form details");

              const formId = Number(form?.id);
              const formName = String(form?.form_name ?? "");
              const pokemonName = String(form?.pokemon?.name ?? it.name);
              // Derive pokemonId from the URL reference
              const pokemonUrl: string = String(form?.pokemon?.url ?? "");
              const pokemonId = Number(pokemonUrl.split("/").slice(-2, -1)[0]);

              if (!Number.isFinite(pokemonId) || pokemonId <= 0) return;

              // Build sprite URLs with known patterns to avoid extra fetches
              const sprites = {
                frontDefault: String(form?.sprites?.front_default ?? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`),
                frontShiny: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${pokemonId}.png`,
                officialArtwork: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonId}.png`,
              };

              const categories = classifyFormCategories(form, it.name);

              await ctx.runMutation(internal.pokemonInternal.upsertForm, {
                formId,
                formName,
                pokemonName,
                pokemonId,
                categories,
                isDefault: Boolean(form?.is_default),
                isBattleOnly: Boolean(form?.is_battle_only),
                formOrder: typeof form?.form_order === "number" ? form.form_order : undefined,
                sprites,
                versionGroup: String(form?.version_group?.name ?? ""),
              });

              await ctx.runMutation(internal.pokemonInternal.mergeFormTagsIntoPokemon, {
                pokemonId,
                categories,
              });
            } catch (e) {
              console.error("crawlFormsProcessPage item error:", e);
            }
          }),
        );
        // small pacing between batches
        try {
          await delay(30);
        } catch {
          // ignore
        }
      }
    } catch (e) {
      console.error("crawlFormsProcessPage error:", e);
      // best-effort; do not throw to keep the background job resilient
    }
  },
});

// Internal action: enumerate all pages and fan out processing
export const crawlForms = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const head = await fetchJson("https://pokeapi.co/api/v2/pokemon-form?limit=1&offset=0", "PokéAPI pokemon-form head");
      const count = Number(head?.count ?? 0);
      if (!Number.isFinite(count) || count <= 0) return;

      const PAGE = 200;
      const schedules: Array<Promise<any>> = [];
      for (let offset = 0; offset < count; offset += PAGE) {
        schedules.push(
          ctx.scheduler.runAfter(0, internal.pokemonData.crawlFormsProcessPage, {
            offset,
            limit: Math.min(PAGE, count - offset),
          }),
        );
      }
      await Promise.allSettled(schedules);
    } catch (e) {
      console.error("crawlForms error:", e);
    }
  },
});

// Action to fetch and cache Pokemon data from PokeAPI
export const fetchAndCachePokemon = action({
  args: { 
    limit: v.optional(v.number()),
    offset: v.optional(v.number()) 
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 151;
    const offset = args.offset || 0;

    try {
      // NEW: check if types/forms already exist to avoid redundant scheduling that causes commit overload
      let hasTypes = false;
      let hasForms = false;
      try {
        [hasTypes, hasForms] = await Promise.all([
          ctx.runQuery(internal.pokemonInternal.hasTypes, {}),
          ctx.runQuery(internal.pokemonInternal.hasForms, {}),
        ]);
      } catch {
        // If checks fail, default to scheduling but the rest of the logic handles retries/pacing
        hasTypes = false;
        hasForms = false;
      }

      const ids: number[] = Array.from({ length: limit }, (_, i) => offset + i + 1).filter((id) => id <= 1025);
      if (ids.length === 0) {
        // Schedule best-effort background tasks with retry (guarded by presence checks)
        if (!hasTypes) {
          try {
            await scheduleWithRetry(ctx, "processTypes", internal.pokemonData.processTypes, {}, 5, 200);
          } catch (e) {
            console.error("schedule processTypes (empty ids) error:", e);
          }
        }
        if (!hasForms) {
          try {
            await scheduleWithRetry(ctx, "processGigantamaxForms", internal.pokemonData.processGigantamaxForms, {}, 5, 200);
          } catch (e) {
            console.error("schedule processGigantamaxForms (empty ids) error:", e);
          }
          try {
            await scheduleWithRetry(ctx, "crawlForms", internal.pokemonData.crawlForms, {}, 5, 200);
          } catch (e) {
            console.error("schedule crawlForms (empty ids) error:", e);
          }
        }

        // New: backfill formTags from forms so filters like "regional"/"gender" work
        try {
          await ctx.runMutation(internal.pokemonInternal.backfillFormTagsFromForms, {});
        } catch (e) {
          console.error("backfillFormTagsFromForms (empty ids) error:", e);
        }

        return { success: true, scheduled: 0, cached: 0 };
      }

      // Schedule in sequence with retry and gentle pacing to reduce burst load
      if (!hasTypes) {
        try {
          await scheduleWithRetry(ctx, "processTypes", internal.pokemonData.processTypes, {}, 5, 200);
          await delay(50);
        } catch (e) {
          console.error("schedule processTypes error:", e);
        }
      }

      await scheduleWithRetry(ctx, "processAll", internal.pokemonData.processAll, { ids }, 5, 200);
      await delay(50);

      if (!hasForms) {
        // Ensure specific Gmax forms quickly available for the filter
        try {
          await scheduleWithRetry(ctx, "processGigantamaxForms", internal.pokemonData.processGigantamaxForms, {}, 5, 200);
          await delay(50);
        } catch (e) {
          console.error("schedule processGigantamaxForms error:", e);
        }
        try {
          await scheduleWithRetry(ctx, "crawlForms", internal.pokemonData.crawlForms, {}, 5, 200);
        } catch (e) {
          console.error("schedule crawlForms error:", e);
        }
      }

      // New: backfill formTags from forms so "regional" and "gender" filters have data
      try {
        await ctx.runMutation(internal.pokemonInternal.backfillFormTagsFromForms, {});
      } catch (e) {
        console.error("backfillFormTagsFromForms error:", e);
      }

      return { success: true, scheduled: ids.length, cached: ids.length };
    } catch (error) {
      console.error("Error scheduling Pokemon data fetch:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw withCode("E_SCHEDULE", `Failed to schedule Pokemon data fetch: ${message}`);
    }
  },
});

async function cacheTypes(ctx: any) {
  try {
    const typesData = await fetchJson("https://pokeapi.co/api/v2/type", "PokéAPI types");
    const typeColors: Record<string, string> = {
      normal: "#A8A878",
      fire: "#F08030",
      water: "#6890F0",
      electric: "#F8D030",
      grass: "#78C850",
      ice: "#98D8D8",
      fighting: "#C03028",
      poison: "#A040A0",
      ground: "#E0C068",
      flying: "#A890F0",
      psychic: "#F85888",
      bug: "#A8B820",
      rock: "#B8A038",
      ghost: "#705898",
      dragon: "#7038F8",
      dark: "#705848",
      steel: "#B8B8D0",
      fairy: "#EE99AC",
    };

    for (const type of typesData.results) {
      await ctx.runMutation(internal.pokemonInternal.cacheType, {
        name: type.name,
        color: typeColors[type.name] || "#68A090",
      });
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error in cacheTypes";
    console.error("cacheTypes error:", err);
    throw withCode("E_EXTERNAL", message);
  }
}

// Add: Tiny HTML utilities for parsing without external deps
function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "")
             .replace(/<style[\s\S]*?<\/style>/gi, "")
             .replace(/<[^>]+>/g, "")
             .replace(/\s+\n/g, "\n")
             .replace(/\n{3,}/g, "\n\n")
             .trim();
}

function decodeEntities(text: string): string {
  // Minimal entities decoding
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function toBulbapediaTitleCase(name: string): string {
  // Handle hyphenated names by title-casing each segment and joining with "_"
  // e.g., "mr-mime" -> "Mr_Mime"
  const segments = name.split(/[-_ ]+/g).filter(Boolean);
  return segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("_");
}

function possibleBulbaUrls(baseName: string): string[] {
  const title = toBulbapediaTitleCase(baseName);
  // Try canonical first, then a fallback without "(Pokémon)" (some redirects)
  return [
    `https://bulbapedia.bulbagarden.net/wiki/${title}_(Pokémon)`,
    `https://bulbapedia.bulbagarden.net/wiki/${title}`,
  ];
}

function extractGenderDifferences(html: string): string | null {
  // Locate the "Gender differences" section by anchor/span id or heading text
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

  // From startIdx, collect consecutive <p>...</p> until the next heading
  const rest = html.slice(startIdx);
  const nextHeading = rest.search(/<h[23][^>]*>/i);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  const paragraphs = Array.from(section.matchAll(/<p[\s\S]*?<\/p>/gi)).map((m) => m[0]);
  if (paragraphs.length === 0) return null;

  const combined = paragraphs.join("\n\n");
  const text = decodeEntities(stripTags(combined));
  const clean = text.replace(/\[\d+\]/g, "").trim(); // remove citation markers like [1]
  return clean || null;
}

type GenderDiffResult = {
  name: string;
  dexId: number;
  description: string;
  sourceUrl: string;
  cached: boolean;
};

// Public Action: fetch gender-difference description for a species; cache result
export const fetchGenderDifference: any = action({
  args: { name: v.string(), dexId: v.number() },
  handler: async (ctx, args): Promise<GenderDiffResult> => {
    const baseName = args.name.toLowerCase();

    // Check cache (by pokemonId first)
    try {
      const cachedById: any = await ctx.runQuery(internal.genderDiff.getByPokemonId, {
        pokemonId: args.dexId,
      });
      const now = Date.now();
      const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;
      if (cachedById && now - (cachedById.fetchedAt ?? 0) < THIRTY_DAYS) {
        return {
          name: cachedById.name,
          dexId: args.dexId,
          description: cachedById.description,
          sourceUrl: cachedById.sourceUrl,
          cached: true,
        };
      }
    } catch {
      // ignore cache read errors; proceed to fetch
    }

    // Try multiple URL patterns
    const urls = possibleBulbaUrls(baseName);
    let lastErr: unknown = null;
    for (const url of urls) {
      try {
        const res = await fetchWithTimeout(url, { method: "GET" }, 20000);
        if (!res.ok) {
          // Try next URL on 404/5xx
          if (res.status === 404 || res.status >= 500) {
            lastErr = new Error(`HTTP ${res.status} ${res.statusText}`);
            continue;
          }
          // Non-retriable error
          throw withCode("E_EXTERNAL", `Bulbapedia responded with ${res.status} ${res.statusText}`);
        }
        const html = await res.text();
        const desc = extractGenderDifferences(html);

        const description =
          desc && desc.length > 0 ? desc : "No known visual gender differences.";
        // Cache
        try {
          await ctx.runMutation(internal.genderDiff.upsert, {
            pokemonId: args.dexId,
            name: baseName,
            description,
            fetchedAt: Date.now(),
            sourceUrl: url,
          });
        } catch {
          // ignore cache write failures
        }

        return {
          name: baseName,
          dexId: args.dexId,
          description,
          sourceUrl: url,
          cached: false,
        };
      } catch (e) {
        lastErr = e;
        // try next URL
      }
    }

    // If all attempts failed, return graceful fallback
    return {
      name: baseName,
      dexId: args.dexId,
      description: "No known visual gender differences.",
      sourceUrl: urls[0],
      cached: false,
      // expose minimal error info in description only through UI not needed; keep silent here
    };
  },
});