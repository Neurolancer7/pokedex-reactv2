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

    const CONCURRENCY = 8;

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
        return { success: true, scheduled: 0, cached: 0 };
      }

      // Ensure types are cached once up front
      await cacheTypes(ctx);

      // Schedule background processing in small chunks to avoid client timeouts
      const CHUNK_SIZE = 40;
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        await ctx.scheduler.runAfter(0, internal.pokemonData.processChunk, { ids: chunk });
      }

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