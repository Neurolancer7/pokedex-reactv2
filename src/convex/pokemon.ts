import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getCurrentUser } from "./users";
import type { Doc } from "./_generated/dataModel";

// Get paginated list of Pokemon with validation and error handling
export const list = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    search: v.optional(v.string()),
    types: v.optional(v.array(v.string())),
    generation: v.optional(v.number()),
    // Add: forms filter (categories)
    forms: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    try {
      // Validate pagination args
      const limit = args.limit ?? 20;
      const offset = args.offset ?? 0;
      if (!Number.isFinite(limit) || limit < 0 || limit > 1025) {
        throw new Error("Invalid 'limit' provided. It must be between 0 and 1025.");
      }
      if (!Number.isFinite(offset) || offset < 0) {
        throw new Error("Invalid 'offset' provided. It must be a non-negative number.");
      }

      // Normalize filters
      const search = args.search?.trim();
      const types = (args.types ?? []).map((t) => t.toLowerCase());
      const forms = (args.forms ?? []).map((f) => f.toLowerCase());
      const hasValidNumber =
        typeof args.generation === "number" &&
        Number.isFinite(args.generation);
      const inAllowedRange =
        hasValidNumber && (args.generation as number) >= 1 && (args.generation as number) <= 9;
      const hasValidGeneration = hasValidNumber && inAllowedRange;

      if (hasValidNumber && !inAllowedRange) {
        throw new Error("Invalid 'generation' provided. It must be between 1 and 9.");
      }

      let results: any[] = [];

      if (hasValidGeneration) {
        // First try by_generation index
        results = await ctx.db
          .query("pokemon")
          .withIndex("by_generation", (q) =>
            q.eq("generation", args.generation as number),
          )
          .collect();

        // Fallback: if none found via generation index, use Pokédex ID ranges
        if (results.length === 0) {
          const range = GEN_RANGES[args.generation as number];
          if (range) {
            results = await ctx.db
              .query("pokemon")
              .withIndex("by_pokemon_id", (q) =>
                q.gte("pokemonId", range.start).lte("pokemonId", range.end),
              )
              .collect();
          }
        }
      } else {
        results = await ctx.db.query("pokemon").collect();
      }

      // De-duplicate by pokemonId (keep first by creation order)
      const unique = new Map<number, any>();
      for (const row of results) {
        if (!unique.has(row.pokemonId)) unique.set(row.pokemonId, row);
      }
      results = Array.from(unique.values());

      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase();
        results = results.filter(
          (pokemon) =>
            pokemon.name.toLowerCase().includes(searchLower) ||
            pokemon.pokemonId.toString().includes(searchLower),
        );
      }

      // Apply type filter (case-insensitive)
      if (types.length > 0) {
        results = results.filter((pokemon) =>
          pokemon.types.some((t: string) => types.includes(t.toLowerCase())),
        );
      }

      // Add: Apply forms filter (checks stored formTags)
      if (forms.length > 0) {
        results = results.filter((pokemon) => {
          const tags: string[] = Array.isArray(pokemon.formTags) ? pokemon.formTags : [];
          const lowerTags = tags.map((t) => t.toLowerCase());
          return forms.some((f) => lowerTags.includes(f));
        });
      }

      // Sort by Pokemon ID
      results.sort((a, b) => a.pokemonId - b.pokemonId);

      // Apply pagination with a safe offset to avoid empty results after filter changes
      const safeOffset = offset >= results.length ? 0 : offset;
      const paginatedResults = results.slice(safeOffset, safeOffset + limit);

      return {
        pokemon: paginatedResults,
        total: results.length,
        hasMore: safeOffset + limit < results.length,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error in pokemon.list";
      console.error("pokemon.list error:", err);
      throw new Error(message);
    }
  },
});

// Get single Pokemon by ID with validation and error handling
export const getById = query({
  args: { pokemonId: v.number() },
  handler: async (ctx, args) => {
    try {
      if (!Number.isFinite(args.pokemonId) || args.pokemonId <= 0) {
        throw new Error("Invalid 'pokemonId'. It must be a positive number.");
      }

      const pokemonResults = await ctx.db
        .query("pokemon")
        .withIndex("by_pokemon_id", (q) => q.eq("pokemonId", args.pokemonId))
        .collect();
      const pokemon = pokemonResults[0] ?? null;

      if (!pokemon) return null;

      const speciesResults = await ctx.db
        .query("pokemonSpecies")
        .withIndex("by_pokemon_id", (q) => q.eq("pokemonId", args.pokemonId))
        .collect();
      const species = speciesResults[0] ?? null;

      return {
        ...pokemon,
        species,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error in pokemon.getById";
      console.error("pokemon.getById error:", err);
      throw new Error(message);
    }
  },
});

// Get Pokemon types with error handling
export const getTypes = query({
  args: {},
  handler: async (ctx) => {
    try {
      return await ctx.db.query("pokemonTypes").collect();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error in pokemon.getTypes";
      console.error("pokemon.getTypes error:", err);
      throw new Error(message);
    }
  },
});

// Add Pokemon to favorites with validation and error handling
export const addToFavorites = mutation({
  args: { pokemonId: v.number() },
  handler: async (ctx, args) => {
    try {
      if (!Number.isFinite(args.pokemonId) || args.pokemonId <= 0) {
        throw new Error("Invalid 'pokemonId'. It must be a positive number.");
      }

      // Ensure the Pokémon exists
      const pokemonExists = await ctx.db
        .query("pokemon")
        .withIndex("by_pokemon_id", (q) => q.eq("pokemonId", args.pokemonId))
        .collect();

      if (pokemonExists.length === 0) {
        throw new Error("Pokemon not found");
      }

      const user = await getCurrentUser(ctx);
      if (!user) {
        throw new Error("Must be authenticated to add favorites");
      }

      const existing = await ctx.db
        .query("favorites")
        .withIndex("by_user_and_pokemon", (q) =>
          q.eq("userId", user._id).eq("pokemonId", args.pokemonId),
        )
        .unique();

      if (existing) {
        throw new Error("Pokemon already in favorites");
      }

      return await ctx.db.insert("favorites", {
        userId: user._id,
        pokemonId: args.pokemonId,
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unknown error in pokemon.addToFavorites";
      console.error("pokemon.addToFavorites error:", err);
      throw new Error(message);
    }
  },
});

// Remove Pokemon from favorites with validation and error handling
export const removeFromFavorites = mutation({
  args: { pokemonId: v.number() },
  handler: async (ctx, args) => {
    try {
      if (!Number.isFinite(args.pokemonId) || args.pokemonId <= 0) {
        throw new Error("Invalid 'pokemonId'. It must be a positive number.");
      }

      const user = await getCurrentUser(ctx);
      if (!user) {
        throw new Error("Must be authenticated to remove favorites");
      }

      const favorite = await ctx.db
        .query("favorites")
        .withIndex("by_user_and_pokemon", (q) =>
          q.eq("userId", user._id).eq("pokemonId", args.pokemonId),
        )
        .unique();

      if (!favorite) {
        throw new Error("Pokemon not in favorites");
      }

      return await ctx.db.delete(favorite._id);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unknown error in pokemon.removeFromFavorites";
      console.error("pokemon.removeFromFavorites error:", err);
      throw new Error(message);
    }
  },
});

// Get user's favorites with error handling
export const getFavorites = query({
  args: {},
  handler: async (ctx) => {
    try {
      const user = await getCurrentUser(ctx);
      if (!user) return [];

      const favorites = await ctx.db
        .query("favorites")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();

      const pokemonIds = favorites.map((f) => f.pokemonId);
      const pokemon = await Promise.all(
        pokemonIds.map(async (id) => {
          const results = await ctx.db
            .query("pokemon")
            .withIndex("by_pokemon_id", (q) => q.eq("pokemonId", id))
            .collect();
          return results[0] ?? null;
        }),
      );

      const pokemonDocs = pokemon.filter(
        (p): p is Doc<"pokemon"> => p !== null,
      );

      return pokemonDocs;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unknown error in pokemon.getFavorites";
      console.error("pokemon.getFavorites error:", err);
      throw new Error(message);
    }
  },
});

// Add generation ID ranges as a fallback when generation-indexed lookup returns no rows
const GEN_RANGES: Record<number, { start: number; end: number }> = {
  1: { start: 1, end: 151 },
  2: { start: 152, end: 251 },
  3: { start: 252, end: 386 },
  4: { start: 387, end: 493 },
  5: { start: 494, end: 649 },
  6: { start: 650, end: 721 },
  7: { start: 722, end: 809 },
  8: { start: 810, end: 905 },
  9: { start: 906, end: 1025 },
};