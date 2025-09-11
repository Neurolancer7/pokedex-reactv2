import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Internal: get by pokemonId
export const getByPokemonId = internalQuery({
  args: { pokemonId: v.number() },
  handler: async (ctx, args) => {
    // Replace unique() with safe lookup to avoid duplicate-row crashes
    const rows = await ctx.db
      .query("genderDifferences")
      .withIndex("by_pokemon_id", (q) => q.eq("pokemonId", args.pokemonId))
      .collect();
    return rows[0] ?? null;
  },
});

// Internal: get by species name (lowercase)
export const getByName = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    // Replace unique() with safe lookup to avoid duplicate-row crashes
    const rows = await ctx.db
      .query("genderDifferences")
      .withIndex("by_name", (q) => q.eq("name", args.name.toLowerCase()))
      .collect();
    return rows[0] ?? null;
  },
});

// Internal: upsert cache entry
export const upsert = internalMutation({
  args: {
    pokemonId: v.number(),
    name: v.string(),
    description: v.string(),
    fetchedAt: v.number(),
    sourceUrl: v.string(),
  },
  handler: async (ctx, args) => {
    // Avoid unique() to handle rare duplicate data gracefully; patch the first match
    const existingRows = await ctx.db
      .query("genderDifferences")
      .withIndex("by_pokemon_id", (q) => q.eq("pokemonId", args.pokemonId))
      .collect();

    const existing = existingRows[0];
    if (existing) {
      await ctx.db.patch(existing._id, {
        description: args.description,
        fetchedAt: args.fetchedAt,
        sourceUrl: args.sourceUrl,
        name: args.name.toLowerCase(),
      });
      return existing._id;
    }

    return await ctx.db.insert("genderDifferences", {
      pokemonId: args.pokemonId,
      name: args.name.toLowerCase(),
      description: args.description,
      fetchedAt: args.fetchedAt,
      sourceUrl: args.sourceUrl,
    });
  },
});