import { useEffect, useMemo, useState } from "react";
import type { Pokemon } from "@/lib/pokemon-api";

/**
 * Normalizes a search query:
 * - trims
 * - lowercases
 * - collapses whitespace
 * - removes leading '#' for dex searches
 */
function normalizeQuery(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/\s+/g, " ");
}

type UsePokemonSearchOptions = {
  allPokemon: ReadonlyArray<Pokemon>;
  query: string;
  selectedTypes?: ReadonlyArray<string>;
  // optional: restrict to a specific category label if present in your data
  categoryPredicate?: (p: Pokemon) => boolean;
  debounceMs?: number; // default 250ms
};

export function usePokemonSearch({
  allPokemon,
  query,
  selectedTypes = [],
  categoryPredicate,
  debounceMs = 250,
}: UsePokemonSearchOptions) {
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), Math.max(0, debounceMs));
    return () => clearTimeout(id);
  }, [query, debounceMs]);

  const normalized = useMemo(() => normalizeQuery(debounced), [debounced]);

  const filtered = useMemo(() => {
    const q = normalized;

    // fast path: nothing selected
    if (!q && selectedTypes.length === 0 && !categoryPredicate) {
      return allPokemon as Pokemon[];
    }

    const typeSet = new Set(selectedTypes.map((t) => String(t).toLowerCase()));

    const matchesQuery = (p: Pokemon) => {
      if (!q) return true;
      const nameHit = p.name?.toLowerCase().includes(q);
      const idHit = String(p.pokemonId || "").includes(q);
      return nameHit || idHit;
    };

    const matchesTypes = (p: Pokemon) => {
      if (typeSet.size === 0) return true;
      return (p.types || []).some((t) => typeSet.has(String(t).toLowerCase()));
    };

    const matchesCategory = (p: Pokemon) => {
      return categoryPredicate ? categoryPredicate(p) : true;
    };

    // filter once
    return (allPokemon as Pokemon[]).filter(
      (p) => matchesQuery(p) && matchesTypes(p) && matchesCategory(p),
    );
  }, [allPokemon, normalized, selectedTypes, categoryPredicate]);

  return {
    results: filtered,
    normalizedQuery: normalized,
  };
}
