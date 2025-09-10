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
    const existing = await ctx.db
      .query("pokemonForms")
      .withIndex("by_form_id", (q) => q.eq("formId", args.formId))
      .collect();

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

    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, doc);
    } else {
      await ctx.db.insert("pokemonForms", doc);
    }

    // Merge category tags into base pokemon
    const poke = await ctx.db
      .query("pokemon")
      .withIndex("by_pokemon_id", (q) => q.eq("pokemonId", args.pokemonId))
      .collect();

    if (poke.length > 0) {
      const p = poke[0];
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

    let rows: any[] = [];
    if (typeof args.pokemonId === "number") {
      rows = await ctx.db
        .query("pokemonForms")
        .withIndex("by_pokemon_id", (ii) => ii.eq("pokemonId", args.pokemonId!))
        .collect();
    } else if (
      typeof args.generation === "number" &&
      args.generation >= 1 &&
      args.generation <= 9
    ) {
      rows = await ctx.db
        .query("pokemonForms")
        .withIndex("by_generation", (ii) => ii.eq("generation", args.generation!))
        .collect();
    } else if (args.category) {
      const cat = args.category.toLowerCase();
      if (cat === "mega") {
        rows = await ctx.db
          .query("pokemonForms")
          .withIndex("by_isMega", (ii) => ii.eq("isMega", true))
          .collect();
      } else if (cat === "gigantamax") {
        rows = await ctx.db
          .query("pokemonForms")
          .withIndex("by_isGigantamax", (ii) => ii.eq("isGigantamax", true))
          .collect();
      } else if (cat === "regional") {
        rows = await ctx.db
          .query("pokemonForms")
          .withIndex("by_isRegional", (ii) => ii.eq("isRegional", true))
          .collect();
      } else if (cat === "gender") {
        rows = await ctx.db
          .query("pokemonForms")
          .withIndex("by_isGender", (ii) => ii.eq("isGender", true))
          .collect();
      } else if (cat === "cosmetic") {
        rows = await ctx.db
          .query("pokemonForms")
          .withIndex("by_isCosmetic", (ii) => ii.eq("isCosmetic", true))
          .collect();
      } else if (cat === "alternate") {
        rows = await ctx.db
          .query("pokemonForms")
          .withIndex("by_isAlternate", (ii) => ii.eq("isAlternate", true))
          .collect();
      } else {
        rows = await ctx.db.query("pokemonForms").collect();
      }
    } else {
      rows = await ctx.db.query("pokemonForms").collect();
    }

    let results = rows;

    if (search) {
      results = results.filter((r) => {
        const pn = String(r.pokemonName || "").toLowerCase();
        const fn = String(r.formName || "").toLowerCase();
        return pn.includes(search) || fn.includes(search);
      });
    }

    results.sort((a, b) => (a.pokemonId - b.pokemonId) || ((a.formOrder ?? 0) - (b.formOrder ?? 0)));

    const page = results.slice(offset, offset + limit);
    return {
      results: page,
      count: results.length,
      hasMore: offset + limit < results.length,
    };
  },
});