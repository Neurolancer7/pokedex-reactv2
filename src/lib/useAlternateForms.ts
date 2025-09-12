import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Pokemon } from "@/lib/pokemon-api";
import { fetchAlternateForms, type FormInfo } from "@/lib/alternateForms";

// Small helpers
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

type Built = Pokemon;

type QueueItem = {
  speciesId: number;
  speciesName: string;
  formName: string; // pokemon-form name
};

// Add: sessionStorage-backed cache for built Pokemon
const POKEMON_CACHE_KEY = "alternateForms:pokemonCache:v1";
type CachedBuilt = Built;

const pokemonCache: Map<string, CachedBuilt> = (() => {
  try {
    const raw = sessionStorage.getItem(POKEMON_CACHE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, CachedBuilt>;
    const map = new Map<string, CachedBuilt>();
    for (const [k, v] of Object.entries(obj)) {
      map.set(k, v);
    }
    return map;
  } catch {
    return new Map();
  }
})();

function savePokemonCache() {
  try {
    const obj: Record<string, CachedBuilt> = {};
    for (const [k, v] of pokemonCache.entries()) obj[k] = v;
    sessionStorage.setItem(POKEMON_CACHE_KEY, JSON.stringify(obj));
  } catch {
    // ignore storage errors
  }
}

// Build a Pokemon from a pokemon-form name by following the linked pokemon url.
// OPTIMIZED: Only fetch pokemon-form and parse linked pokemon id to build a minimal card.
// Full details (types/abilities/stats) are fetched on-demand in the modal for speed.
async function buildPokemonFromForm(
  apiBase: string,
  formName: string
): Promise<Built | null> {
  // Fast path: cache
  const key = String(formName).toLowerCase();
  const cached = pokemonCache.get(key);
  if (cached) return cached;

  try {
    // 1) pokemon-form -> get linked pokemon url (guaranteed valid)
    const formJson = await fetch(`${apiBase}/pokemon-form/${formName}`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} @ pokemon-form/${formName}`);
      return r.json();
    });

    const pokemonUrl: string | undefined = formJson?.pokemon?.url;
    if (!pokemonUrl) throw new Error("Missing pokemon url on form");

    // Parse numeric id directly from the linked pokemon URL (avoids a second fetch)
    const idMatch = String(pokemonUrl).match(/\/pokemon\/(\d+)\/?$/);
    const id = idMatch ? Number(idMatch[1]) : 0;

    const official =
      id > 0
        ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`
        : undefined;

    // Prefer form name for display (e.g., toxtricity-low-key)
    const out: Built = {
      pokemonId: id || 0,
      name: String(formJson?.name ?? formName),
      height: 0,
      weight: 0,
      baseExperience: undefined,
      // Leave types/abilities empty on grid for speed; modal enhances on demand
      types: [],
      abilities: [],
      stats: [],
      sprites: {
        frontDefault: undefined,
        frontShiny: undefined,
        officialArtwork: official,
      },
      moves: [],
      generation: 0,
      species: undefined,
    };

    // Save to cache
    pokemonCache.set(key, out);
    savePokemonCache();

    return out;
  } catch {
    return null;
  }
}

/**
 * useAlternateForms
 * - Client-only hook
 * - Loads alternate forms via species -> varieties -> pokemon-form -> pokemon
 * - Excludes default, Mega (-mega), and Gigantamax (-gmax/gigantamax)
 * - Sorted by parent speciesId asc, then formName
 * - Paginated via pageSize (default from VITE_DEFAULT_PAGE_SIZE)
 */
export function useAlternateForms() {
  const API_BASE: string =
    ((import.meta as any)?.env?.VITE_POKEAPI_URL as string) || "https://pokeapi.co/api/v2";
  const PAGE_SIZE: number =
    Number(((import.meta as any)?.env?.VITE_DEFAULT_PAGE_SIZE as string) || 40) || 40;

  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [items, setItems] = useState<Built[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const [primed, setPrimed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMore = useMemo(() => {
    if (!queue) return false;
    return cursor < queue.length;
  }, [queue, cursor]);

  // Prime the queue: use the existing light-weight species/forms indexer
  const prime = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const forms: FormInfo[] = await fetchAlternateForms();
      // Build queue of (speciesId, speciesName, formName) for non-default, non-mega, non-gmax
      const q: QueueItem[] = [];
      for (const row of forms) {
        const sid = Number(row.speciesId || 0);
        const sname = String(row.speciesName || "");
        for (const f of row.forms) {
          const fname = String(f.formName || "").toLowerCase();
          if (!fname) continue;
          // Safety: exclude megas/gmax just in case upstream didn't filter
          if (fname.includes("-mega") || fname.includes("-gmax") || fname.includes("gigantamax")) continue;
          q.push({ speciesId: sid, speciesName: sname, formName: fname });
        }
      }
      // Sort by speciesId asc then formName asc
      q.sort((a, b) => (a.speciesId - b.speciesId) || a.formName.localeCompare(b.formName));
      setQueue(q);
      setCursor(0);
      setItems([]);
      setPrimed(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load alternate forms index";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial prime
  useEffect(() => {
    if (!primed) void prime();
  }, [primed, prime]);

  // Fetch next page of detailed Pokemon cards
  const fetchNextPage = useCallback(async () => {
    if (loading) return;
    if (!queue) return;
    if (cursor >= queue.length) return;

    setLoading(true);
    setError(null);
    try {
      const start = cursor;
      const end = Math.min(queue.length, cursor + PAGE_SIZE);
      const slice = queue.slice(start, end);

      // Throttled parallelism - increase concurrency modestly
      const CONCURRENCY = 24; // increased from 16; still safe and faster due to single fetch per item now
      const out: Built[] = [];
      for (let i = 0; i < slice.length; i += CONCURRENCY) {
        const batch = slice.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (q) => {
            // small stagger to avoid burst
            await sleep(8);
            return await buildPokemonFromForm(API_BASE, q.formName);
          })
        );
        for (const r of results) if (r) out.push(r);
      }

      // Deduplicate by pokemonId:name
      const seen = new Set<string>();
      const deduped: Built[] = [];
      for (const p of [...items, ...out]) {
        const key = `${p.pokemonId}:${String(p.name).toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(p);
      }

      // Keep stable: sort by pokemonId asc then name asc
      deduped.sort((a, b) => a.pokemonId - b.pokemonId || a.name.localeCompare(b.name));

      setItems(deduped);
      setCursor(end);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch alternate forms";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [API_BASE, PAGE_SIZE, cursor, items, loading, queue]);

  // Auto-fetch the first page once primed and queue is ready
  useEffect(() => {
    if (primed && !loading && items.length === 0 && queue && queue.length > 0) {
      void fetchNextPage();
    }
  }, [primed, loading, items.length, queue, fetchNextPage]);

  const reset = useCallback(() => {
    setQueue(null);
    setItems([]);
    setCursor(0);
    setPrimed(false);
    setError(null);
  }, []);

  return {
    items,          // Built[] so it can directly render in PokemonGrid
    loading,        // boolean
    error,          // string | null
    hasMore,        // boolean
    fetchNextPage,  // () => Promise<void>
    reset,          // () => void
    pageSize: PAGE_SIZE,
  };
}