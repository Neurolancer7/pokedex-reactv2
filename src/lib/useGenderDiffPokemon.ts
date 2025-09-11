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

function stableKey(names: string[]): string {
  const sorted = [...names].map((n) => n.toLowerCase().trim()).sort();
  return `genderDiff:${sorted.join(",")}`;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
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

      // Fetch all species concurrently
      const settled = await Promise.allSettled(
        speciesNames.map((name) =>
          fetchJson<any>(`https://pokeapi.co/api/v2/pokemon/${name.toLowerCase().trim()}`, ctrl.signal)
        )
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
