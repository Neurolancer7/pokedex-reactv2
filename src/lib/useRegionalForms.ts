import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AggregatedForm = {
  speciesId: number;
  speciesName: string;
  formId?: number;
  formName: string;
  isDefault: boolean;
  categories: string[];
  dexId: number;
  // Add alias used by UI components that expect `pokemonId`
  pokemonId: number;
  name: string;
  types: string[];
  sprite?: string;
  officialArtwork?: string;
  height?: number;
  weight?: number;
  stats?: Record<string, number>;
  abilities?: string[];
  source: { pokemonUrl: string; pokemonFormUrl?: string };
};

type AggregatedResponse = {
  count: number;
  hasMore: boolean;
  results: AggregatedForm[];
  failed?: Array<{ url: string; error: string }>;
};

const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;

async function fetchJsonWithRetry(url: string, signal?: AbortSignal) {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: signal ?? ctrl.signal });
      clearTimeout(to);
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 100 * Math.pow(3, attempt)));
          continue;
        }
        const detail = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` - ${detail.slice(0, 256)}` : ""}`);
      }
      return await res.json();
    } catch (e) {
      clearTimeout(to);
      lastErr = e;
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error("Request aborted or timed out");
      }
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 100 * Math.pow(3, attempt)));
        continue;
      }
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Unknown fetch error");
}

export function useRegionalForms(species?: string[]) {
  const [items, setItems] = useState<AggregatedForm[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const limitRef = useRef(40);

  const speciesParam = useMemo(() => {
    const s = (species || []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
    return s.join(",");
  }, [species]);

  const reset = useCallback(() => {
    try {
      abortRef.current?.abort();
    } catch {}
    setItems([]);
    setCount(0);
    setOffset(0);
    setError(null);
  }, []);

  const fetchPage = useCallback(async (nextOffset: number) => {
    if (!speciesParam) return;
    try {
      abortRef.current?.abort();
    } catch {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    try {
      const url = `/api/aggregated-forms?species=${encodeURIComponent(speciesParam)}&limit=${limitRef.current}&offset=${nextOffset}`;
      const json: AggregatedResponse = await fetchJsonWithRetry(url, ctrl.signal);

      // Normalize incoming and existing items to include `pokemonId` alias
      const normalize = (r: any): AggregatedForm => ({
        ...r,
        pokemonId: typeof r?.pokemonId === "number" ? r.pokemonId : r.dexId,
      });
      const merged = [...items.map(normalize), ...(json?.results ?? []).map(normalize)];

      // Dedupe by formId else dexId-formName
      const seen = new Set<string>();
      const deduped: AggregatedForm[] = [];
      for (const it of merged) {
        const key = it.formId ? `id:${it.formId}` : `nf:${it.dexId}-${(it.formName || "").toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(it);
      }

      // Sort by dexId asc then formName asc
      deduped.sort((a, b) => {
        if (a.dexId !== b.dexId) return a.dexId - b.dexId;
        const an = String(a.formName || "").toLowerCase();
        const bn = String(b.formName || "").toLowerCase();
        return an.localeCompare(bn);
      });

      setItems(deduped);
      setCount(Number(json?.count || 0));
      setOffset(nextOffset + limitRef.current);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load forms";
      if (!(e instanceof Error && (e.message.includes("aborted") || e.message.includes("timed out")))) {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [speciesParam, items]);

  useEffect(() => {
    reset();
    if (speciesParam) {
      fetchPage(0);
    }
    return () => {
      try {
        abortRef.current?.abort();
      } catch {}
    };
  }, [speciesParam, reset, fetchPage]);

  const loadMore = useCallback(async () => {
    if (loading) return;
    if (items.length >= count && count > 0) return;
    await fetchPage(offset);
  }, [loading, offset, items.length, count, fetchPage]);

  const hasMore = useMemo(() => (count === 0 ? false : items.length < count), [items.length, count]);

  // Retry current page (append) after an error
  const retry = useCallback(() => fetchPage(items.length), [fetchPage, items.length]);

  // Retry a specific item: minimal approach – reload current page slice to refresh cards
  const retryItem = useCallback(async (_key: string) => {
    await fetchPage(offset > 0 ? offset - limitRef.current : 0);
  }, [fetchPage, offset]);

  return {
    items,
    flatList: items, // alias for backward compatibility
    count,
    hasMore,
    loading,
    isLoading: loading, // alias for backward compatibility
    error,
    loadMore,
    retry,
    retryItem,
  };
}