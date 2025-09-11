import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Internal: get by pokemonId
export const getByPokemonId = internalQuery({
  args: { pokemonId: v.number() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("genderDifferences")
      .withIndex("by_pokemon_id", (q) => q.eq("pokemonId", args.pokemonId))
      .unique();
    return doc ?? null;
  },
});

// Internal: get by species name (lowercase)
export const getByName = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("genderDifferences")
      .withIndex("by_name", (q) => q.eq("name", args.name.toLowerCase()))
      .unique();
    return doc ?? null;
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
    const existing = await ctx.db
      .query("genderDifferences")
      .withIndex("by_pokemon_id", (q) => q.eq("pokemonId", args.pokemonId))
      .unique();
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
