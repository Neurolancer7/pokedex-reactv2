import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getCurrentUser } from "./users";
import type { Doc } from "./_generated/dataModel";

// Add: Canonical species IDs with regional variants (Alolan, Galarian, Hisuian, Paldean)
const REGIONAL_SPECIES: ReadonlySet<number> = new Set<number>([
  19, 20, 26, 27, 28, 37, 38, 50, 51, 52, 53, 58, 59, 74, 75, 76, 77, 78, 79,
  80, 83, 88, 89, 100, 101, 103, 105, 110, 122, 128, 144, 145, 146, 157, 194,
  199, 211, 215, 222, 263, 264, 503, 549, 554, 555, 562, 570, 571, 618, 628,
  705, 706, 713, 724,
]);

// Add: Canonical species IDs that have Gigantamax forms
const GMAX_SPECIES: ReadonlySet<number> = new Set<number>([
  // Kanto
  3, 6, 9, 12, 25, 52, 68, 94, 99, 131, 133, 143,
  // Unova
  569,
  // Mythical
  809,
  // Galar starters and others
  812, 815, 818, 823, 826, 834, 839, 841, 842, 844, 849, 851, 858, 861, 869, 879, 884,
]);

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

const ERROR_CODE_REGEX = /^[A-Z_]+:/;
function apiError(
  code: "E_INVALID_ARG" | "E_NOT_AUTH" | "E_NOT_FOUND" | "E_CONFLICT" | "E_INTERNAL",
  message: string,
) {
  const err = new Error(`${code}:${message}`);
  (err as any).code = code;
  return err;
}

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
        throw apiError("E_INVALID_ARG", "Invalid 'limit' provided. It must be between 0 and 1025.");
      }
      if (!Number.isFinite(offset) || offset < 0) {
        throw apiError("E_INVALID_ARG", "Invalid 'offset' provided. It must be a non-negative number.");
      }

      // Normalize filters
      const search = args.search?.trim();
      const types = (args.types ?? []).map((t) => t.toLowerCase());
      // Normalize common aliases used by the UI
      let forms = (args.forms ?? []).map((f) => f.toLowerCase());
      forms = forms.map((f) => {
        if (
          f === "gender-diff" ||
          f === "gender-diffs" ||
          f === "gender-difference" ||
          f === "gender-differences"
        ) return "gender";
        if (f === "gmax" || f === "g-max" || f === "gigantmax") return "gigantamax";
        return f;
      });

      const hasValidNumber =
        typeof args.generation === "number" &&
        Number.isFinite(args.generation);
      const inAllowedRange =
        hasValidNumber && (args.generation as number) >= 1 && (args.generation as number) <= 9;
      const hasValidGeneration = hasValidNumber && inAllowedRange;

      if (hasValidNumber && !inAllowedRange) {
        throw apiError("E_INVALID_ARG", "Invalid 'generation' provided. It must be between 1 and 9.");
      }

      let results: any[] = [];

      // Fast path: use search index when a search term is present
      if (search) {
        const searchTerm = search.toLowerCase();
        if (hasValidGeneration) {
          results = await ctx.db
            .query("pokemon")
            .withSearchIndex("search_name", (q) =>
              q.search("name", searchTerm).eq("generation", args.generation as number),
            )
            .collect();
        } else {
          results = await ctx.db
            .query("pokemon")
            .withSearchIndex("search_name", (q) => q.search("name", searchTerm))
            .collect();
        }
      } else if (hasValidGeneration) {
        // Use generation index when provided
        if (types.length === 0 && forms.length === 0) {
          // Pagination directly from index when no extra filters
          results = await ctx.db
            .query("pokemon")
            .withIndex("by_generation", (q) =>
              q.eq("generation", args.generation as number),
            )
            .order("asc")
            .take(offset + limit);
        } else {
          results = await ctx.db
            .query("pokemon")
            .withIndex("by_generation", (q) =>
              q.eq("generation", args.generation as number),
            )
            .collect();

          // Fallback range if needed
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
        }
      } else {
        // Default: no search, no generation
        if (types.length === 0 && forms.length === 0) {
          // Fast pagination via primary index without scanning entire table
          results = await ctx.db
            .query("pokemon")
            .withIndex("by_pokemon_id")
            .order("asc")
            .take(offset + limit);
        } else {
          // When filters are present, load all (dataset ~1025) then filter in-memory
          results = await ctx.db.query("pokemon").collect();
        }
      }

      // De-duplicate by pokemonId (keep first by creation/order)
      const unique = new Map<number, any>();
      for (const row of results) {
        if (!unique.has(row.pokemonId)) unique.set(row.pokemonId, row);
      }
      results = Array.from(unique.values());

      // Apply type filter (case-insensitive)
      if (types.length > 0) {
        results = results.filter((pokemon) =>
          pokemon.types.some((t: string) => types.includes(t.toLowerCase())),
        );
      }

      // Apply forms filter (checks stored formTags) + fallback to forms cache
      if (forms.length > 0) {
        const normalized = forms.map((f) => f.toLowerCase());

        // Preload forms cache once to ensure accurate filtering even if base tags aren't merged yet
        const formRows = await ctx.db.query("pokemonForms").collect();
        const anyFormsIds = new Set<number>(formRows.map((r) => r.pokemonId));

        const matchesCategory = (r: any, wanted: Set<string>) => {
          const cats: string[] = Array.isArray(r.categories)
            ? r.categories.map((c: any) => String(c).toLowerCase())
            : [];
          if (cats.some((c: string) => wanted.has(c))) return true;
          return (
            (wanted.has("regional") && r.isRegional === true) ||
            (wanted.has("mega") && r.isMega === true) ||
            (wanted.has("gigantamax") && r.isGigantamax === true) ||
            (wanted.has("gender") && r.isGender === true) ||
            (wanted.has("cosmetic") && r.isCosmetic === true) ||
            (wanted.has("alternate") && r.isAlternate === true)
          );
        };

        if (normalized.includes("any") || normalized.includes("all-forms")) {
          results = results.filter((pokemon) => {
            const tags: string[] = Array.isArray(pokemon.formTags) ? pokemon.formTags : [];
            return tags.length > 0 || anyFormsIds.has(pokemon.pokemonId);
          });
        } else {
          const wanted = new Set<string>(normalized);
          const specificIds = new Set<number>();
          for (const r of formRows) {
            if (matchesCategory(r, wanted)) specificIds.add(r.pokemonId);
          }

          if (wanted.has("regional")) {
            for (const id of REGIONAL_SPECIES) specificIds.add(id);
          }

          // Add: fallback include for Gigantamax-capable species so results show even if forms cache isn't ready
          if (wanted.has("gigantamax")) {
            for (const id of GMAX_SPECIES) specificIds.add(id);
          }

          // NEW: include Pokémon with known gender differences from Bulbapedia cache
          if (wanted.has("gender")) {
            const genderRows = await ctx.db.query("genderDifferences").collect();
            for (const g of genderRows) {
              if (Number.isFinite(g.pokemonId)) {
                specificIds.add(g.pokemonId as number);
              }
            }
          }

          results = results.filter((pokemon) => {
            const tags: string[] = Array.isArray(pokemon.formTags) ? pokemon.formTags : [];
            const lowerTags = tags.map((t) => t.toLowerCase());
            return lowerTags.some((t) => wanted.has(t)) || specificIds.has(pokemon.pokemonId);
          });

          // NEW: If Gigantamax filter is active, swap sprites to the Gigantamax form sprites (game forms only).
          if (wanted.has("gigantamax") && results.length > 0) {
            // Prefer entries explicitly flagged as Gigantamax and battle-only from the forms cache.
            const gmaxBySpecies: Map<number, { frontDefault?: string; officialArtwork?: string; frontShiny?: string }> = new Map();
            for (const r of formRows) {
              if (r?.isGigantamax === true) {
                // Only game forms: PokeAPI forms marked for games (pokemon-form endpoint) already represent in-game forms.
                // Use form sprites; official artwork for Gmax often not available, so rely on frontDefault.
                const fd = r?.sprites?.frontDefault;
                const oa = r?.sprites?.officialArtwork;
                const fs = r?.sprites?.frontShiny;
                if (!gmaxBySpecies.has(r.pokemonId) && (fd || oa)) {
                  gmaxBySpecies.set(r.pokemonId, {
                    frontDefault: fd,
                    officialArtwork: oa || fd,
                    frontShiny: fs,
                  });
                }
              }
            }

            // Override sprites for matched results so UI shows Gigantamax appearance.
            for (const p of results) {
              const g = gmaxBySpecies.get(p.pokemonId);
              if (g) {
                p.sprites = {
                  frontDefault: g.frontDefault ?? p.sprites?.frontDefault,
                  frontShiny: g.frontShiny ?? p.sprites?.frontShiny,
                  officialArtwork: g.officialArtwork ?? g.frontDefault ?? p.sprites?.officialArtwork,
                };
              }
            }
          }
        }
      }

      // Sort by Pokemon ID
      results.sort((a, b) => a.pokemonId - b.pokemonId);

      // Pagination with safe offset
      const safeOffset = offset >= results.length ? 0 : offset;
      const paginatedResults = results.slice(safeOffset, safeOffset + limit);

      // Return only lightweight fields to reduce payload size
      const light = paginatedResults.map((p) => ({
        pokemonId: p.pokemonId,
        name: p.name,
        sprites: p.sprites,
        types: p.types,
        generation: p.generation,
        formTags: p.formTags,
      }));

      return {
        pokemon: light,
        total: results.length,
        hasMore: safeOffset + limit < results.length,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error in pokemon.list";
      const coded = ERROR_CODE_REGEX.test(message) ? message : `E_INTERNAL:${message}`;
      console.error("pokemon.list error:", err);
      throw new Error(coded);
    }
  },
});

// Get single Pokemon by ID with validation and error handling
export const getById = query({
  args: { pokemonId: v.number() },
  handler: async (ctx, args) => {
    try {
      if (!Number.isFinite(args.pokemonId) || args.pokemonId <= 0) {
        throw apiError("E_INVALID_ARG", "Invalid 'pokemonId'. It must be a positive number.");
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
      const coded = ERROR_CODE_REGEX.test(message) ? message : `E_INTERNAL:${message}`;
      console.error("pokemon.getById error:", err);
      throw new Error(coded);
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
      const coded = ERROR_CODE_REGEX.test(message) ? message : `E_INTERNAL:${message}`;
      console.error("pokemon.getTypes error:", err);
      throw new Error(coded);
    }
  },
});

// Add Pokemon to favorites with validation and error handling
export const addToFavorites = mutation({
  args: { pokemonId: v.number() },
  handler: async (ctx, args) => {
    try {
      if (!Number.isFinite(args.pokemonId) || args.pokemonId <= 0) {
        throw apiError("E_INVALID_ARG", "Invalid 'pokemonId'. It must be a positive number.");
      }

      // Ensure the Pokémon exists
      const pokemonExists = await ctx.db
        .query("pokemon")
        .withIndex("by_pokemon_id", (q) => q.eq("pokemonId", args.pokemonId))
        .collect();

      if (pokemonExists.length === 0) {
        throw apiError("E_NOT_FOUND", "Pokemon not found");
      }

      const user = await getCurrentUser(ctx);
      if (!user) {
        throw apiError("E_NOT_AUTH", "Must be authenticated to add favorites");
      }

      const existing = await ctx.db
        .query("favorites")
        .withIndex("by_user_and_pokemon", (q) =>
          q.eq("userId", user._id).eq("pokemonId", args.pokemonId),
        )
        .unique();

      if (existing) {
        throw apiError("E_CONFLICT", "Pokemon already in favorites");
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
      const coded = ERROR_CODE_REGEX.test(message) ? message : `E_INTERNAL:${message}`;
      console.error("pokemon.addToFavorites error:", err);
      throw new Error(coded);
    }
  },
});

// Remove Pokemon from favorites with validation and error handling
export const removeFromFavorites = mutation({
  args: { pokemonId: v.number() },
  handler: async (ctx, args) => {
    try {
      if (!Number.isFinite(args.pokemonId) || args.pokemonId <= 0) {
        throw apiError("E_INVALID_ARG", "Invalid 'pokemonId'. It must be a positive number.");
      }

      const user = await getCurrentUser(ctx);
      if (!user) {
        throw apiError("E_NOT_AUTH", "Must be authenticated to remove favorites");
      }

      const favorite = await ctx.db
        .query("favorites")
        .withIndex("by_user_and_pokemon", (q) =>
          q.eq("userId", user._id).eq("pokemonId", args.pokemonId),
        )
        .unique();

      if (!favorite) {
        throw apiError("E_NOT_FOUND", "Pokemon not in favorites");
      }

      return await ctx.db.delete(favorite._id);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unknown error in pokemon.removeFromFavorites";
      const coded = ERROR_CODE_REGEX.test(message) ? message : `E_INTERNAL:${message}`;
      console.error("pokemon.removeFromFavorites error:", err);
      throw new Error(coded);
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
      const coded = ERROR_CODE_REGEX.test(message) ? message : `E_INTERNAL:${message}`;
      console.error("pokemon.getFavorites error:", err);
      throw new Error(coded);
    }
  },
});

// Clear cached Pokemon-related data (excluding user favorites)
export const clearCache = mutation({
  args: {
    // optional subset: ["pokemon","species","forms","regional","gender"]
    scopes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const wanted = new Set(
      (args.scopes ?? ["pokemon", "species", "forms", "regional", "gender"]).map((s) => s.toLowerCase())
    );

    const tasks: Array<{
      key: string;
      table: "pokemon" | "pokemonSpecies" | "pokemonForms" | "regionalDex" | "genderDifferences";
    }> = [];

    if (wanted.has("pokemon")) tasks.push({ key: "pokemon", table: "pokemon" });
    if (wanted.has("species")) tasks.push({ key: "species", table: "pokemonSpecies" });
    if (wanted.has("forms")) tasks.push({ key: "forms", table: "pokemonForms" });
    if (wanted.has("regional")) tasks.push({ key: "regional", table: "regionalDex" });
    if (wanted.has("gender")) tasks.push({ key: "gender", table: "genderDifferences" });

    const deleted: Record<string, number> = Object.create(null);

    for (const t of tasks) {
      let count = 0;
      // Use async iteration to avoid loading everything into memory
      // Note: order doesn't matter; we just wipe the cache tables
      // Favorites are intentionally not touched
      for await (const row of ctx.db.query(t.table)) {
        await ctx.db.delete(row._id);
        count++;
      }
      deleted[t.key] = count;
    }

    return { deleted };
  },
});