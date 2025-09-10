/* removed "use node" to allow defining internal mutations/queries in this file */

import { v } from "convex/values";
import { internalAction, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

// Helper to map national dex id to generation
function getGenerationFromId(id: number): number {
  if (id <= 151) return 1;
  if (id <= 251) return 2;
  if (id <= 386) return 3;
  if (id <= 493) return 4;
  if (id <= 649) return 5;
  if (id <= 721) return 6;
  if (id <= 809) return 7;
  if (id <= 905) return 8;
  return 9;
}

function classifyCategories(form: any): {
  isMega: boolean;
  isGigantamax: boolean;
  isRegional: boolean;
  isGender: boolean;
  isCosmetic: boolean;
  isAlternate: boolean;
} {
  const name = String(form?.name ?? "").toLowerCase();
  const formName = String(form?.form_name ?? "").toLowerCase();

  const mega =
    name.includes("mega") || formName.includes("mega") || form?.is_mega === true;
  const gmax =
    name.includes("gmax") ||
    formName.includes("gmax") ||
    name.includes("gigantamax") ||
    formName.includes("gigantamax") ||
    form?.is_gigantamax === true;

  const regionalHints = ["alola", "alolan", "galar", "galarian", "hisui", "hisuian", "paldea", "paldean"];
  const regional =
    regionalHints.some((r) => name.includes(r) || formName.includes(r));

  // Gender forms heuristics
  const gender =
    name.endsWith("-m") ||
    name.endsWith("-f") ||
    formName.includes("male") ||
    formName.includes("female") ||
    name.includes("male") ||
    name.includes("female");

  // Cosmetic: non-default named variations that aren't the above and not battle-only
  const cosmetic =
    Boolean(formName) &&
    !mega &&
    !gmax &&
    !regional &&
    !gender &&
    form?.is_battle_only === false;

  // Alternate: catch-all if it's not default and not any above
  const alternate =
    !form?.is_default &&
    !mega &&
    !gmax &&
    !regional &&
    !gender &&
    !cosmetic;

  return {
    isMega: mega,
    isGigantamax: gmax,
    isRegional: regional,
    isGender: gender,
    isCosmetic: cosmetic,
    isAlternate: alternate,
  };
}

// Replace the upsertForm implementation to delegate to pokemonInternal and match schema
export const upsertForm = internalMutation({
  args: {
    formId: v.number(),
    pokemonId: v.number(),
    pokemonName: v.string(),
    speciesId: v.number(),
    formName: v.optional(v.string()),
    isDefault: v.boolean(),
    isBattleOnly: v.boolean(),
    formOrder: v.optional(v.number()),
    versionGroup: v.optional(v.string()),
    sprites: v.object({
      frontDefault: v.optional(v.string()),
      officialArtwork: v.optional(v.string()),
    }),
    generation: v.number(),
    isMega: v.boolean(),
    isGigantamax: v.boolean(),
    isRegional: v.boolean(),
    isGender: v.boolean(),
    isCosmetic: v.boolean(),
    isAlternate: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Build categories array to align with schema and canonical upsert
    const categories: string[] = [];
    if (args.isMega) categories.push("mega");
    if (args.isGigantamax) categories.push("gigantamax");
    if (args.isRegional) categories.push("regional");
    if (args.isGender) categories.push("gender");
    if (args.isCosmetic) categories.push("cosmetic");
    if (args.isAlternate) categories.push("alternate");

    // Delegate to the canonical forms upsert
    await ctx.runMutation(internal.pokemonInternal.upsertForm, {
      formId: args.formId,
      formName: args.formName,
      pokemonName: args.pokemonName,
      pokemonId: args.pokemonId,
      categories,
      isDefault: args.isDefault,
      isBattleOnly: args.isBattleOnly,
      formOrder: args.formOrder,
      sprites: {
        frontDefault: args.sprites.frontDefault,
        frontShiny: undefined,
        officialArtwork: args.sprites.officialArtwork,
      },
      versionGroup: args.versionGroup,
    });

    // Merge categories into base pokemon.formTags for frontend filters
    await ctx.runMutation(internal.pokemonInternal.mergeFormTagsIntoPokemon, {
      pokemonId: args.pokemonId,
      categories,
    });
  },
});

// Process a single page of pokemon-form listing at a given offset
export const processFormPage = internalAction({
  args: { offset: v.number(), pageSize: v.number() },
  handler: async (ctx, args) => {
    const listUrl = `https://pokeapi.co/api/v2/pokemon-form/?limit=${args.pageSize}&offset=${args.offset}`;
    const listRes = await fetch(listUrl);
    if (!listRes.ok) return;
    const listData = await listRes.json();

    const entries: Array<{ name: string; url: string }> = Array.isArray(listData.results) ? listData.results : [];
    const CONCURRENCY = 8;

    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const batch = entries.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (item) => {
          try {
            const formRes = await fetch(item.url);
            if (!formRes.ok) return;
            const formData = await formRes.json();

            // Extract linked pokemon and species id
            const pokemonIdStr = String(formData?.pokemon?.url ?? "").split("/").filter(Boolean).pop();
            const pokemonId = Number(pokemonIdStr);
            if (!Number.isFinite(pokemonId)) return;

            // species id equals national dex id for standard cases
            const speciesId = pokemonId;

            // Sprites
            const frontDefault: string | undefined = formData?.sprites?.front_default ?? undefined;
            const officialArtwork: string | undefined =
              formData?.sprites?.other?.["official-artwork"]?.front_default ?? undefined;

            const cats = classifyCategories(formData);

            await ctx.runMutation(internal.forms.upsertForm, {
              formId: Number(formData.id),
              pokemonId,
              pokemonName: String(formData?.pokemon?.name ?? ""),
              speciesId,
              formName: formData?.form_name ? String(formData.form_name) : undefined,
              isDefault: Boolean(formData?.is_default),
              isBattleOnly: Boolean(formData?.is_battle_only),
              formOrder: typeof formData?.form_order === "number" ? formData.form_order : undefined,
              versionGroup: formData?.version_group?.name ? String(formData.version_group.name) : undefined,
              sprites: {
                frontDefault,
                officialArtwork,
              },
              generation: getGenerationFromId(pokemonId),
              isMega: cats.isMega,
              isGigantamax: cats.isGigantamax,
              isRegional: cats.isRegional,
              isGender: cats.isGender,
              isCosmetic: cats.isCosmetic,
              isAlternate: cats.isAlternate,
            });
          } catch (e) {
            console.error("processFormPage item error:", e);
          }
        })
      );
    }
  },
});

// Fan-out scheduler to process many pages without holding client open
export const processAll = internalAction({
  args: { pageSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const pageSize = args.pageSize ?? 200;

    // Probe first page to learn count
    const probeRes = await fetch(`https://pokeapi.co/api/v2/pokemon-form/?limit=${pageSize}&offset=0`);
    if (!probeRes.ok) return;
    const probe = await probeRes.json();
    const count = Number(probe?.count ?? 0);
    if (!Number.isFinite(count) || count <= 0) return;

    const schedules: Array<Promise<any>> = [];
    for (let offset = 0; offset < count; offset += pageSize) {
      schedules.push(ctx.scheduler.runAfter(0, internal.forms.processFormPage, { offset, pageSize }));
    }
    await Promise.allSettled(schedules);
  },
});

// Replace the list query to avoid non-existent boolean/generation indexes and use categories
export const list = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    category: v.optional(v.string()),
    pokemonId: v.optional(v.number()),
    generation: v.optional(v.number()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(0, Math.min(args.limit ?? 50, 200));
    const offset = Math.max(0, args.offset ?? 0);
    const search = args.search?.trim().toLowerCase();

    let rows;
    if (typeof args.pokemonId === "number") {
      rows = await ctx.db
        .query("pokemonForms")
        .withIndex("by_pokemon_id", (ii) => ii.eq("pokemonId", args.pokemonId!))
        .collect();
    } else {
      // Fallback: collect all; category/generation filtering will be applied in-memory
      rows = await ctx.db.query("pokemonForms").collect();
    }

    let results = rows;

    // Filter by generation derived from pokemonId (schema does not store generation on forms)
    if (
      typeof args.generation === "number" &&
      args.generation >= 1 &&
      args.generation <= 9
    ) {
      results = results.filter(
        (r) => getGenerationFromId(r.pokemonId) === args.generation,
      );
    }

    // Filter by category via categories array
    if (args.category) {
      const cat = args.category.toLowerCase();
      results = results.filter(
        (r) =>
          Array.isArray(r.categories) &&
          r.categories.map((c) => String(c).toLowerCase()).includes(cat),
      );
    }

    // Optional text search
    if (search) {
      results = results.filter((r) => {
        const pn = String(r.pokemonName || "").toLowerCase();
        const fn = String(r.formName || "").toLowerCase();
        return pn.includes(search) || fn.includes(search);
      });
    }

    // Sort by pokemonId then formOrder
    results.sort(
      (a, b) =>
        a.pokemonId - b.pokemonId ||
        (a.formOrder ?? 0) - (b.formOrder ?? 0),
    );

    const page = results.slice(offset, offset + limit);
    return {
      results: page,
      count: results.length,
      hasMore: offset + limit < results.length,
    };
  },
});