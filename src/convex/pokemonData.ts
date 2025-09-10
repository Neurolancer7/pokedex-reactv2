"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Add: Internal action to process a chunk of Pokémon IDs in the background
export const processChunk = internalAction({
  args: {
    ids: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const ids = args.ids.filter((id) => Number.isFinite(id) && id > 0 && id <= 1025);
    if (ids.length === 0) return;

    const CONCURRENCY = 4;

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

            const [pokemonResponse, speciesResponse, formResponse] = await Promise.all([
              fetch(pokemonUrl),
              fetch(speciesUrl),
              fetch(formUrl),
            ]);

            if (!pokemonResponse.ok) {
              throw new Error(`PokéAPI pokemon request failed (id ${pokemonId}): ${pokemonResponse.status} ${pokemonResponse.statusText}`);
            }
            if (!speciesResponse.ok) {
              throw new Error(`PokéAPI species request failed (id ${pokemonId}): ${speciesResponse.status} ${speciesResponse.statusText}`);
            }

            let formData: any | undefined = undefined;
            if (formResponse.ok) {
              try {
                formData = await formResponse.json();
              } catch {
                formData = undefined;
              }
            }

            const [pokemonData, speciesData] = await Promise.all([
              pokemonResponse.json(),
              speciesResponse.json(),
            ]);

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

    const CHUNK_SIZE = 20;
    const schedules: Array<Promise<any>> = [];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      schedules.push(ctx.scheduler.runAfter(0, internal.pokemonData.processChunk, { ids: chunk }));
    }
    await Promise.allSettled(schedules);
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

// Internal action: process a single page of /pokemon-form list
export const crawlFormsProcessPage = internalAction({
  args: { offset: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    const { offset, limit } = args;
    const listUrl = `https://pokeapi.co/api/v2/pokemon-form?limit=${limit}&offset=${offset}`;
    try {
      const res = await fetch(listUrl);
      if (!res.ok) {
        throw new Error(`pokemon-form list failed ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      const items: Array<{ name: string; url: string }> = Array.isArray(data?.results) ? data.results : [];

      const CONCURRENCY = 4;
      for (let i = 0; i < items.length; i += CONCURRENCY) {
        const batch = items.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (it) => {
            try {
              const formDetailRes = await fetch(it.url);
              if (!formDetailRes.ok) {
                throw new Error(`pokemon-form details failed ${formDetailRes.status} ${formDetailRes.statusText}`);
              }
              const form = await formDetailRes.json();

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
      const headRes = await fetch("https://pokeapi.co/api/v2/pokemon-form?limit=1&offset=0");
      if (!headRes.ok) throw new Error(`pokemon-form head failed ${headRes.status} ${headRes.statusText}`);
      const head = await headRes.json();
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
      const ids: number[] = Array.from({ length: limit }, (_, i) => offset + i + 1).filter((id) => id <= 1025);
      if (ids.length === 0) {
        // Still schedule forms + types to keep cache healthy
        await ctx.scheduler.runAfter(0, internal.pokemonData.processTypes, {});
        await ctx.scheduler.runAfter(0, internal.pokemonData.crawlForms, {});
        return { success: true, scheduled: 0, cached: 0 };
      }

      // Schedule types caching & full processing in the background to avoid client timeouts
      await ctx.scheduler.runAfter(0, internal.pokemonData.processTypes, {});
      await ctx.scheduler.runAfter(0, internal.pokemonData.processAll, { ids });
      // New: schedule a full forms crawl in the background
      await ctx.scheduler.runAfter(0, internal.pokemonData.crawlForms, {});

      // Return immediately; background jobs will complete shortly
      return { success: true, scheduled: ids.length, cached: ids.length };
    } catch (error) {
      console.error("Error scheduling Pokemon data fetch:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to schedule Pokemon data fetch: ${message}`);
    }
  },
});

async function cacheTypes(ctx: any) {
  try {
    const typesResponse = await fetch("https://pokeapi.co/api/v2/type");
    // Add response.ok check for types endpoint
    if (!typesResponse.ok) {
      throw new Error(
        `PokéAPI types request failed: ${typesResponse.status} ${typesResponse.statusText}`
      );
    }
    const typesData = await typesResponse.json();

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
    throw new Error(message);
  }
}