import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";

// Internal query to check if Pokemon exists (scan instead of indexed query)
export const getByIdInternal = internalQuery({
  args: { pokemonId: v.number() },
  handler: async (ctx, args) => {
    try {
      const all = await ctx.db.query("pokemon").collect();
      const doc = all.find((p: any) => p.pokemonId === args.pokemonId) ?? null;
      return doc;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unknown error in pokemonInternal.getByIdInternal";
      console.error("getByIdInternal error:", err);
      throw new Error(message);
    }
  },
});

// Internal mutation to cache Pokemon data (remove index usage; scan & find)
export const cachePokemon = internalMutation({
  args: {
    pokemonData: v.any(),
    speciesData: v.any(),
    // Add: formData for better form detection
    formData: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    try {
      const { pokemonData, speciesData, formData } = args;

      // Upsert Pokemon (avoid creating duplicates)
      const allPokemon = await ctx.db.query("pokemon").collect();
      const existingPokemon = allPokemon.find((p: any) => p.pokemonId === pokemonData.id) ?? null;

      const pokemonDoc = {
        pokemonId: pokemonData.id,
        name: String(pokemonData.name ?? ""),
        height: Number(pokemonData.height ?? 0),
        weight: Number(pokemonData.weight ?? 0),
        baseExperience:
          typeof pokemonData.base_experience === "number"
            ? pokemonData.base_experience
            : undefined,
        types: Array.isArray(pokemonData.types)
          ? pokemonData.types
              .map((t: any) => t?.type?.name)
              .filter((x: unknown): x is string => typeof x === "string")
          : [],
        abilities: Array.isArray(pokemonData.abilities)
          ? pokemonData.abilities.map((a: any) => ({
              name: a?.ability?.name ?? "",
              isHidden: Boolean(a?.is_hidden),
            }))
          : [],
        stats: Array.isArray(pokemonData.stats)
          ? pokemonData.stats.map((s: any) => ({
              name: s?.stat?.name ?? "",
              baseStat: Number(s?.base_stat ?? 0),
              effort: Number(s?.effort ?? 0),
            }))
          : [],
        sprites: {
          frontDefault: pokemonData?.sprites?.front_default ?? undefined,
          frontShiny: pokemonData?.sprites?.front_shiny ?? undefined,
          officialArtwork:
            pokemonData?.sprites?.other?.["official-artwork"]
              ?.front_default ?? undefined,
        },
        moves: Array.isArray(pokemonData.moves)
          ? pokemonData.moves
              .slice(0, 20)
              .map((m: any) => m?.move?.name)
              .filter((x: unknown): x is string => typeof x === "string")
          : [],
        generation: getGenerationFromId(Number(pokemonData.id)),
        // Update: compute formTags using optional formData
        formTags: getFormTags(pokemonData, speciesData, formData),
      };

      if (existingPokemon) {
        await ctx.db.patch(existingPokemon._id, pokemonDoc);
      } else {
        await ctx.db.insert("pokemon", pokemonDoc);
      }

      // Upsert species data (avoid creating duplicates)
      const flavorText =
        speciesData?.flavor_text_entries
          ?.find((entry: any) => entry?.language?.name === "en")?.flavor_text
          ?.replace(/\f/g, " ") || "";

      const allSpecies = await ctx.db.query("pokemonSpecies").collect();
      const existingSpecies =
        allSpecies.find((s: any) => s.pokemonId === pokemonData.id) ?? null;

      const speciesDoc = {
        pokemonId: pokemonData.id,
        name: String(speciesData?.name ?? ""),
        flavorText,
        genus: speciesData?.genera?.find((g: any) => g?.language?.name === "en")
          ?.genus,
        captureRate:
          typeof speciesData?.capture_rate === "number"
            ? speciesData.capture_rate
            : undefined,
        baseHappiness:
          typeof speciesData?.base_happiness === "number"
            ? speciesData.base_happiness
            : undefined,
        growthRate: speciesData?.growth_rate?.name,
        habitat: speciesData?.habitat?.name,
        evolutionChainId: speciesData?.evolution_chain?.url
          ? parseInt(
              speciesData.evolution_chain.url.split("/").slice(-2, -1)[0],
            )
          : undefined,
        generation: getGenerationFromId(Number(pokemonData.id)),
      };

      if (existingSpecies) {
        await ctx.db.patch(existingSpecies._id, speciesDoc);
      } else {
        await ctx.db.insert("pokemonSpecies", speciesDoc);
      }

      return null;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unknown error in pokemonInternal.cachePokemon";
      console.error("cachePokemon error:", err);
      throw new Error(message);
    }
  },
});

// Internal mutation to cache Pokemon types (remove index usage; scan & find)
export const cacheType = internalMutation({
  args: {
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const name = args.name.toLowerCase().trim();
      const all = await ctx.db.query("pokemonTypes").collect();
      const existing = all.find((t: any) => t.name === name);

      if (!existing) {
        await ctx.db.insert("pokemonTypes", {
          name,
          color: args.color,
        });
      } else {
        if (existing.color !== args.color) {
          await ctx.db.patch(existing._id, { color: args.color });
        }
      }

      return null;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unknown error in pokemonInternal.cacheType";
      console.error("cacheType error:", err);
      throw new Error(message);
    }
  },
});

// Add: Upsert a canonical form row (remove index usage; scan & find)
export const upsertForm = internalMutation({
  args: {
    formId: v.number(),
    formName: v.optional(v.string()),
    pokemonName: v.string(),
    pokemonId: v.number(),
    categories: v.array(v.string()),
    isDefault: v.boolean(),
    isBattleOnly: v.boolean(),
    formOrder: v.optional(v.number()),
    sprites: v.object({
      frontDefault: v.optional(v.string()),
      frontShiny: v.optional(v.string()),
      officialArtwork: v.optional(v.string()),
    }),
    versionGroup: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const all = await ctx.db.query("pokemonForms").collect();
      const doc = all.find((f: any) => f.formId === args.formId);

      if (doc) {
        await ctx.db.patch(doc._id, {
          formName: args.formName,
          pokemonName: args.pokemonName,
          pokemonId: args.pokemonId,
          categories: args.categories,
          isDefault: args.isDefault,
          isBattleOnly: args.isBattleOnly,
          formOrder: args.formOrder,
          sprites: args.sprites,
          versionGroup: args.versionGroup,
        });
      } else {
        await ctx.db.insert("pokemonForms", {
          formId: args.formId,
          formName: args.formName,
          pokemonName: args.pokemonName,
          pokemonId: args.pokemonId,
          categories: args.categories,
          isDefault: args.isDefault,
          isBattleOnly: args.isBattleOnly,
          formOrder: args.formOrder,
          sprites: args.sprites,
          versionGroup: args.versionGroup,
        });
      }
      return null;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error in pokemonInternal.upsertForm";
      console.error("upsertForm error:", err);
      throw new Error(message);
    }
  },
});

// Add: Merge discovered form categories into the base Pokémon's formTags (scan & find)
export const mergeFormTagsIntoPokemon = internalMutation({
  args: {
    pokemonId: v.number(),
    categories: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const all = await ctx.db.query("pokemon").collect();
      const doc = all.find((p: any) => p.pokemonId === args.pokemonId);
      if (!doc) {
        // Base entry might not be cached yet; skip
        return null;
      }
      const existing: string[] = Array.isArray(doc.formTags) ? doc.formTags : [];
      const merged = Array.from(new Set([...existing, ...args.categories.map((c) => c.toLowerCase())]));
      if (merged.length !== existing.length) {
        await ctx.db.patch(doc._id, { formTags: merged });
      }
      return null;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unknown error in pokemonInternal.mergeFormTagsIntoPokemon";
      console.error("mergeFormTagsIntoPokemon error:", err);
      throw new Error(message);
    }
  },
});

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