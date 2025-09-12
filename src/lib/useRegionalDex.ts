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

const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;

// Internal: Fetch JSON with timeout + retries (429/5xx) and better errors
async function fetchJsonWithRetry(url: string, signal?: AbortSignal) {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      // Prefer external signal (to cancel across calls), fall back to local controller
      const res = await fetch(url, { signal: signal ?? controller.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        // Retry on transient errors (429, 5xx)
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
          continue;
        }
        let detail = "";
        try {
          const body = await res.text();
          detail = body?.slice(0, 256) || "";
        } catch {
          // ignore
        }
        throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` - ${detail}` : ""}`);
      }
      try {
        return await res.json();
      } catch {
        throw new Error("Invalid JSON response from server");
      }
    } catch (e) {
      clearTimeout(timeout);
      lastErr = e;
      // Abort errors or final attempt -> throw
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error("Request aborted or timed out");
      }
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
        continue;
      }
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Unknown fetch error");
}

export function useRegionalDex(regionName: string) {
  const [items, setItems] = useState<RegionDexEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const limitRef = useRef(40);
  const region = String(regionName || "").toLowerCase();
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    // Cancel any in-flight request
    try {
      abortRef.current?.abort();
    } catch {
      // ignore
    }
    setItems([]);
    setTotalCount(0);
    setOffset(0);
    setError(null);
  }, []);

  const fetchPage = useCallback(
    async (nextOffset: number) => {
      if (!region) return;
      // Cancel any previous page fetch before starting a new one
      try {
        abortRef.current?.abort();
      } catch {
        // ignore
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      try {
        const url = `/api/regional-pokedex?region=${encodeURIComponent(region)}&limit=${limitRef.current}&offset=${nextOffset}`;
        const json: ApiResponse = await fetchJsonWithRetry(url, controller.signal);

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
        // If aborted due to region change/unmount, do not set an error
        if (!(e instanceof Error && (e.message.includes("aborted") || e.message.includes("timed out")))) {
          setError(msg);
        }
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
    // Cleanup on unmount: abort in-flight
    return () => {
      try {
        abortRef.current?.abort();
      } catch {
        // ignore
      }
    };
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