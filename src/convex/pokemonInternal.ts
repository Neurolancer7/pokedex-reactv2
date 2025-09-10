import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";

// Internal query to check if Pokemon exists
export const getByIdInternal = internalQuery({
  args: { pokemonId: v.number() },
  handler: async (ctx, args) => {
    try {
      const results = await ctx.db
        .query("pokemon")
        .withIndex("by_pokemon_id", (q) => q.eq("pokemonId", args.pokemonId))
        .collect();
      return results[0] ?? null;
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

// Internal mutation to cache Pokemon data
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
      const existingPokemonArr = await ctx.db
        .query("pokemon")
        .withIndex("by_pokemon_id", (q) => q.eq("pokemonId", pokemonData.id))
        .collect();
      const existingPokemon = existingPokemonArr[0] ?? null;

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

      const existingSpeciesArr = await ctx.db
        .query("pokemonSpecies")
        .withIndex("by_pokemon_id", (q) => q.eq("pokemonId", pokemonData.id))
        .collect();
      const existingSpecies = existingSpeciesArr[0] ?? null;

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

// Internal mutation to cache Pokemon types
export const cacheType = internalMutation({
  args: {
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const name = args.name.toLowerCase().trim();
      const existing = await ctx.db
        .query("pokemonTypes")
        .withIndex("by_name", (q) => q.eq("name", name))
        .collect();

      if (existing.length === 0) {
        await ctx.db.insert("pokemonTypes", {
          name,
          color: args.color,
        });
      } else {
        // Keep color fresh for the first matching doc; avoid unique() crashes if multiple exist
        const first = existing[0];
        if (first.color !== args.color) {
          await ctx.db.patch(first._id, { color: args.color });
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

// Add: explicit regional form species IDs to improve tag accuracy
const REGIONAL_FORM_SPECIES: Set<number> = new Set([
  19, 20, 26, 27, 28, 37, 38, 50, 51, 52, 53, 58, 59, 74, 75, 76, 77, 78, 79,
  80, 83, 88, 89, 100, 101, 103, 105, 110, 122, 128, 144, 145, 146, 157, 194,
  199, 211, 215, 222, 263, 264, 503, 549, 554, 555, 562, 570, 571, 618, 628,
  705, 706, 713, 724,
]);

// Add: helper to derive form tags from PokeAPI data
function getFormTags(pokemonData: any, speciesData: any, formData?: any): string[] {
  try {
    const tags: Set<string> = new Set();
    const name: string = String(pokemonData?.name ?? "").toLowerCase();

    const idNum = Number(pokemonData?.id);
    if (Number.isFinite(idNum) && REGIONAL_FORM_SPECIES.has(idNum)) {
      tags.add("regional");
    }

    // Use formData for precise flags
    if (formData && typeof formData === "object") {
      if (formData.is_mega === true) {
        tags.add("mega");
      }
      const formName = String(formData.form_name ?? "").toLowerCase();
      if (formName.includes("gmax") || formName.includes("gigantamax")) {
        tags.add("gigantamax");
      }
      // Sometimes regional forms have region hints in the form_name
      const regionalHints = ["alola", "alolan", "galar", "galarian", "hisui", "hisuian", "paldea", "paldean"];
      if (regionalHints.some((r) => formName.includes(r))) {
        tags.add("regional");
      }
    }

    // Name-based fallbacks
    if (name.includes("mega")) {
      tags.add("mega");
    }
    if (name.includes("gmax") || name.includes("gigantamax")) {
      tags.add("gigantamax");
    }
    const regionalHints = ["alola", "alolan", "galar", "galarian", "hisui", "hisuian", "paldea", "paldean"];
    if (regionalHints.some((r) => name.includes(r))) {
      tags.add("regional");
    }

    if (speciesData?.has_gender_differences) {
      tags.add("gender");
    }

    if (speciesData?.forms_switchable && !tags.has("mega") && !tags.has("gigantamax")) {
      tags.add("cosmetic");
    }

    const varieties: Array<any> = Array.isArray(speciesData?.varieties) ? speciesData.varieties : [];
    const altCount = varieties.filter((v) => !v?.is_default).length;
    if (altCount > 0 && !tags.has("mega") && !tags.has("gigantamax") && !tags.has("regional")) {
      tags.add("alternate");
    }

    return Array.from(tags);
  } catch {
    return [];
  }
}

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