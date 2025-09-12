import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type RegionDexEntry = {
  dexId: number;
  name: string;
  types: string[];
  sprite?: string;
  region: string;
  forms: Array<{
    formName: string;
    formId?: number;
    types: string[];
    sprite?: string;
  }>;
};

type ApiResponse = {
  data: Array<Omit<RegionDexEntry, "region"> & { region?: string }>;
  totalCount: number;
  hasMore: boolean;
};

const FALLBACK_SPRITE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";

export function useRegionalDex(regionName: string) {
  const [items, setItems] = useState<RegionDexEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const limitRef = useRef(40);
  const region = String(regionName || "").toLowerCase();

  const reset = useCallback(() => {
    setItems([]);
    setTotalCount(0);
    setOffset(0);
    setError(null);
  }, []);

  const fetchPage = useCallback(
    async (nextOffset: number) => {
      if (!region) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/regional-pokedex?region=${encodeURIComponent(region)}&limit=${limitRef.current}&offset=${nextOffset}`
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const json: ApiResponse = await res.json();
        const normalized: RegionDexEntry[] = (json?.data ?? []).map((r) => ({
          dexId: Number(r.dexId),
          name: String(r.name),
          types: Array.isArray(r.types) ? r.types : [],
          sprite: r.sprite || FALLBACK_SPRITE,
          region,
          forms: Array.isArray(r.forms)
            ? r.forms.map((f) => ({
                formName: String(f?.formName ?? ""),
                formId: typeof f?.formId === "number" ? f.formId : undefined,
                types: Array.isArray(f?.types) ? f.types : [],
                sprite: f?.sprite || FALLBACK_SPRITE,
              }))
            : [],
        }));

        setTotalCount(Number(json?.totalCount || 0));

        // Append + dedupe by dexId + resort by dexId asc then name asc
        setItems((prev) => {
          const map = new Map<number, RegionDexEntry>();
          for (const p of prev) map.set(p.dexId, p);
          for (const n of normalized) map.set(n.dexId, n);
          const arr = Array.from(map.values());
          arr.sort((a, b) => a.dexId - b.dexId || a.name.localeCompare(b.name));
          return arr;
        });

        setOffset(nextOffset + limitRef.current);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load region";
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [region]
  );

  // load first page when region changes
  useEffect(() => {
    reset();
    if (region) {
      fetchPage(0);
    }
  }, [region, reset, fetchPage]);

  const loadMore = useCallback(async () => {
    if (loading) return;
    if (items.length >= totalCount && totalCount > 0) return;
    await fetchPage(offset);
  }, [fetchPage, loading, offset, items.length, totalCount]);

  const hasMore = useMemo(() => {
    return totalCount === 0 ? false : items.length < totalCount;
  }, [items.length, totalCount]);

  return {
    data: items,
    totalCount,
    loadMore,
    loading,
    error,
    hasMore,
    // helper to retry after error
    retry: () => fetchPage(items.length),
  };
}
