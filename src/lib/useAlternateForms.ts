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

// Build a Pokemon from a pokemon-form name by following the linked pokemon url.
async function buildPokemonFromForm(
  apiBase: string,
  formName: string
): Promise<Built | null> {
  try {
    // 1) pokemon-form -> get linked pokemon url (guaranteed valid)
    const formJson = await fetch(`${apiBase}/pokemon-form/${formName}`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} @ pokemon-form/${formName}`);
      return r.json();
    });

    const pokemonUrl: string | undefined = formJson?.pokemon?.url;
    if (!pokemonUrl) throw new Error("Missing pokemon url on form");

    // 2) fetch the pokemon JSON
    const pJson = await fetch(pokemonUrl).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} @ ${pokemonUrl}`);
      return r.json();
    });

    const id: number = Number(pJson?.id ?? 0);
    const types: string[] = Array.isArray(pJson?.types)
      ? pJson.types.map((t: any) => String(t?.type?.name ?? "")).filter(Boolean)
      : [];

    const abilities: string[] = Array.isArray(pJson?.abilities)
      ? pJson.abilities.map((a: any) => String(a?.ability?.name ?? "")).filter(Boolean)
      : [];

    const height: number = typeof pJson?.height === "number" ? pJson.height : 0;
    const weight: number = typeof pJson?.weight === "number" ? pJson.weight : 0;

    const official =
      pJson?.sprites?.other?.["official-artwork"]?.front_default ??
      (id > 0
        ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`
        : undefined);

    const out: Built = {
      pokemonId: id || 0,
      name: String(pJson?.name ?? formName),
      height,
      weight,
      baseExperience: undefined,
      types,
      abilities: abilities.map((a) => ({ name: a, isHidden: false })),
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

      // Throttled parallelism
      const CONCURRENCY = 8;
      const out: Built[] = [];
      for (let i = 0; i < slice.length; i += CONCURRENCY) {
        const batch = slice.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (q) => {
            // small stagger to avoid burst
            await sleep(40);
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
