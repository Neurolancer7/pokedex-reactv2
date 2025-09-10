import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

// Upsert a single form row (moved from forms.ts)
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
    // Build categories array from boolean flags to satisfy schema
    const categories: string[] = [];
    if (args.isMega) categories.push("mega");
    if (args.isGigantamax) categories.push("gigantamax");
    if (args.isRegional) categories.push("regional");
    if (args.isGender) categories.push("gender");
    if (args.isCosmetic) categories.push("cosmetic");
    if (args.isAlternate) categories.push("alternate");

    const doc = {
      formId: args.formId,
      pokemonId: args.pokemonId,
      pokemonName: args.pokemonName,
      speciesId: args.speciesId,
      formName: args.formName,
      isDefault: args.isDefault,
      isBattleOnly: args.isBattleOnly,
      formOrder: args.formOrder,
      versionGroup: args.versionGroup,
      sprites: args.sprites,
      generation: args.generation,
      isMega: args.isMega,
      isGigantamax: args.isGigantamax,
      isRegional: args.isRegional,
      isGender: args.isGender,
      isCosmetic: args.isCosmetic,
      isAlternate: args.isAlternate,
      // Add categories required by schema
      categories,
    };

    // Scan instead of relying on missing indexes
    const allForms = await ctx.db.query("pokemonForms").collect();
    const existing = allForms.find((f: any) => f.formId === args.formId);

    if (existing) {
      await ctx.db.patch(existing._id, doc);
    } else {
      await ctx.db.insert("pokemonForms", doc);
    }

    // Merge category tags into base pokemon (scan by pokemonId)
    const allPokemon = await ctx.db.query("pokemon").collect();
    const p = allPokemon.find((pk: any) => pk.pokemonId === args.pokemonId);
    if (p) {
      const tags = new Set<string>(Array.isArray((p as any).formTags) ? (p as any).formTags : []);
      if (args.isMega) tags.add("mega");
      if (args.isGigantamax) tags.add("gigantamax");
      if (args.isRegional) tags.add("regional");
      if (args.isGender) tags.add("gender");
      if (args.isCosmetic) tags.add("cosmetic");
      if (args.isAlternate) tags.add("alternate");
      await ctx.db.patch(p._id, { formTags: Array.from(tags) });
    }
  },
});

// Query: list forms with filters (moved from forms.ts)
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

    // Load all once (small dataset), then filter in memory for resilience
    const rows: any[] = await ctx.db.query("pokemonForms").collect();

    const normalizeCat = (s?: string) => (s || "").toLowerCase();

    let results = rows;

    // Optional filters
    if (typeof args.pokemonId === "number") {
      results = results.filter((r) => r.pokemonId === args.pokemonId);
    }
    if (typeof args.generation === "number" && args.generation >= 1 && args.generation <= 9) {
      results = results.filter((r) => r.generation === args.generation);
    }
    if (args.category) {
      const cat = normalizeCat(args.category);
      results = results.filter((r) => {
        const cats: string[] = Array.isArray(r.categories) ? r.categories.map(normalizeCat) : [];
        const hasCat = cats.includes(cat);
        // Also honor boolean flags if present
        const flags = {
          mega: r.isMega === true,
          gigantamax: r.isGigantamax === true,
          regional: r.isRegional === true,
          gender: r.isGender === true,
          cosmetic: r.isCosmetic === true,
          alternate: r.isAlternate === true,
        } as const;
        return hasCat || (cat in flags && (flags as any)[cat] === true);
      });
    }

    if (search) {
      results = results.filter((r) => {
        const pn = String(r.pokemonName || "").toLowerCase();
        const fn = String(r.formName || "").toLowerCase();
        return pn.includes(search) || fn.includes(search);
      });
    }

    results.sort(
      (a, b) =>
        a.pokemonId - b.pokemonId || (a.formOrder ?? 0) - (b.formOrder ?? 0)
    );

    const page = results.slice(offset, offset + limit);
    return {
      results: page,
      count: results.length,
      hasMore: offset + limit < results.length,
    };
  },
});