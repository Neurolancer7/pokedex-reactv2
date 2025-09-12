import { useEffect, useMemo, useRef, useState } from "react";

export interface GenderDiffPokemon {
  name: string;
  dexId: number;
  forms: { name: string; url: string }[];
}

type HookResult = {
  data: GenderDiffPokemon[] | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Add: small helpers
async function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchJsonWithRetry<T>(url: string, signal?: AbortSignal, attempts = 4, baseDelayMs = 250): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: signal ?? controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        // Retry on 5xx or 429
        if ((res.status >= 500 || res.status === 429) && i < attempts - 1) {
          await delay(baseDelayMs * Math.pow(2, i));
          continue;
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retriable =
        /NetworkError/i.test(msg) ||
        /Failed to fetch/i.test(msg) ||
        /AbortError/i.test(msg) ||
        /fetch failed/i.test(msg) ||
        /ETIMEDOUT/i.test(msg);
      if (!retriable || i === attempts - 1) throw err;
      await delay(baseDelayMs * Math.pow(2, i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to fetch");
}

// Add: simple concurrency pool mapper
async function poolMap<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let idx = 0;

  const workers: Array<Promise<void>> = new Array(Math.min(concurrency, items.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const current = idx++;
        if (current >= items.length) break;
        try {
          const out = await mapper(items[current], current);
          results[current] = { status: "fulfilled", value: out } as PromiseFulfilledResult<R>;
        } catch (e) {
          results[current] = { status: "rejected", reason: e } as PromiseRejectedResult;
        }
      }
    });

  await Promise.all(workers);
  return results;
}

function stableKey(names: string[]): string {
  const sorted = [...names].map((n) => n.toLowerCase().trim()).sort();
  return `genderDiff:${sorted.join(",")}`;
}

function officialArtworkById(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

export function useGenderDiffPokemon(speciesNames: string[]): HookResult {
  const [data, setData] = useState<GenderDiffPokemon[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cacheKey = useMemo(() => stableKey(speciesNames), [speciesNames]);

  const load = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setIsLoading(true);
    setError(null);

    // Helper: fetch a pokemon by name with a species fallback to default variety on 404
    const fetchPokemonWithFallback = async (name: string, signal?: AbortSignal) => {
      try {
        // Try direct
        return await fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokemon/${name}`, signal, 4, 250);
      } catch (err) {
        // If direct fails (commonly 404 for species like "toxtricity"), resolve default variety via species
        const msg = err instanceof Error ? err.message : String(err);
        const is404 = /HTTP\s*404/i.test(msg);
        if (!is404) throw err;

        // Fetch species to find default variety name
        const species = await fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokemon-species/${name}`, signal, 4, 250);
        const varieties: any[] = Array.isArray(species?.varieties) ? species.varieties : [];
        const def = varieties.find(v => v?.is_default && v?.pokemon?.name)?.pokemon?.name
          || varieties[0]?.pokemon?.name;

        if (!def || typeof def !== "string") {
          throw new Error(`HTTP 404 for ${name} and no default variety`);
        }

        // Fetch the default variety pokemon
        return await fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokemon/${def}`, signal, 4, 250);
      }
    };

    try {
      // Try cache first
      const cachedRaw = localStorage.getItem(cacheKey);
      if (cachedRaw) {
        try {
          const { at, payload } = JSON.parse(cachedRaw) as { at: number; payload: GenderDiffPokemon[] };
          if (Date.now() - at < CACHE_TTL_MS && Array.isArray(payload)) {
            setData(payload);
            setIsLoading(false);
            return;
          }
        } catch {
          // ignore cache parse errors
        }
      }

      // Fetch all species with bounded concurrency and retries
      const settled = await poolMap(
        speciesNames.map((n) => n.toLowerCase().trim()),
        6, // concurrency limit
        async (name) => {
          const p = await fetchPokemonWithFallback(name, ctrl.signal);
          return p;
        }
      );

      const list: GenderDiffPokemon[] = [];
      let failures = 0;

      for (const r of settled) {
        if (r.status === "fulfilled") {
          const p = r.value as any;
          const dexId: number = Number(p?.id ?? 0);
          const name: string = String(p?.name ?? "");
          const forms: { name: string; url: string }[] = Array.isArray(p?.forms)
            ? p.forms
                .map((f: any) => ({
                  name: String(f?.name ?? ""),
                  url: String(f?.url ?? ""),
                }))
                .filter((f: { name: string; url: string }) => f.name && f.url)
            : [];

          if (dexId > 0 && name) {
            list.push({ name, dexId, forms });
          }
        } else {
          failures += 1;
        }
      }

      // Sort by National Dex
      list.sort((a, b) => a.dexId - b.dexId);

      // Cache result
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), payload: list }));
      } catch {
        // ignore storage errors
      }

      // Partial success: still show data but surface a warning error
      if (failures > 0 && failures < speciesNames.length) {
        setError(new Error(`Some entries failed to load (${failures}).`));
      } else if (failures === speciesNames.length) {
        throw new Error("Failed to fetch any entries.");
      }

      setData(list);
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Failed to fetch"));
      setData(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return {
    data,
    isLoading,
    error,
    refetch: load,
  };
}

// Helper to compute a sprite URL without changing the typed interface
export function spriteFromDexId(dexId: number): string {
  return officialArtworkById(dexId);
}