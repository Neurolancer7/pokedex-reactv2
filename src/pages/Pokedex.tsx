import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
// removed unused @tanstack/react-query imports
import { AlertCircle, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { useQuery as useConvexQuery, useMutation as useConvexMutation, useAction } from "convex/react";
import { useAuth } from "@/hooks/use-auth";
import { useRegionalForms } from "@/lib/useRegionalForms";

import { PokemonHeader } from "@/components/PokemonHeader";
import { PokemonSearch } from "@/components/PokemonSearch";
import { PokemonGrid } from "@/components/PokemonGrid";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlternateForms } from "@/components/AlternateForms";
import { GenderDiffGrid } from "@/components/GenderDiffGrid";

import type { Pokemon } from "@/lib/pokemon-api";
import { fetchGigantamaxList, type GigantamaxPokemon } from "@/lib/gigantamax";

class ErrorBoundary extends React.Component<{ onRetry: () => void; children: React.ReactNode }, { hasError: boolean; errorMessage?: string }> {
  constructor(props: { onRetry: () => void; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: undefined };
  }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, errorMessage: error instanceof Error ? error.message : "An unexpected error occurred." };
  }

  componentDidCatch(error: unknown, errorInfo: unknown) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  reset = () => this.setState({ hasError: false, errorMessage: undefined });

  render() {
    if (this.state.hasError) {
      return (
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-md mx-auto">
            <div className="border rounded-md p-4 bg-card">
              <div className="text-sm font-medium mb-1">Something went wrong while loading Pokémon.</div>
              <div className="text-sm text-muted-foreground mb-4">
                {this.state.errorMessage || "Please try again."}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="px-4 h-9 rounded-md bg-primary text-primary-foreground hover:opacity-90"
                  onClick={() => {
                    try {
                      this.props.onRetry();
                    } finally {
                      this.reset();
                    }
                  }}
                  aria-label="Retry loading data"
                >
                  Retry
                </button>
                <button
                  className="px-4 h-9 rounded-md border hover:bg-accent/60"
                  onClick={this.reset}
                  aria-label="Dismiss error"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Pokedex() {
  const { isAuthenticated } = useAuth();
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("theme") === "dark" || 
        (!localStorage.getItem("theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
    return false;
  });
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedGeneration, setSelectedGeneration] = useState<number>();
  const [selectedFormCategory, setSelectedFormCategory] = useState<string | undefined>(undefined);
  const [showFavorites, setShowFavorites] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Infinite scroll state
  const BATCH_LIMIT = 30; // changed from 20 -> 30
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Add ref to ensure auto-fetch only triggers once
  const autoFetchRef = useRef(false);
  // Track generations we've already attempted to fetch to avoid repeated calls
  const fetchedGenRef = useRef<Set<number>>(new Set());
  // Track form categories we've attempted to fetch
  const fetchedFormCategoryRef = useRef<Set<string>>(new Set());

  // Gigantamax list state (client-side, uses lib/gigantamax.ts)
  const [gmaxList, setGmaxList] = useState<Pokemon[]>([]);
  const [gmaxLoading, setGmaxLoading] = useState(false);
  // Add: visible count for Gigantamax (default 30)
  const [gmaxVisibleCount, setGmaxVisibleCount] = useState(30);

  // Mega Evolutions list state (client-side only for the specific list)
  const [megaList, setMegaList] = useState<Pokemon[]>([]);
  const [megaLoading, setMegaLoading] = useState(false);
  // Add: visible count for Mega (default 30)
  const [megaVisibleCount, setMegaVisibleCount] = useState(30);

  // Generation ID ranges used to auto-fetch when a region is selected but uncached
  const GEN_RANGES: Record<number, { start: number; end: number }> = {
    1: { start: 1, end: 151 },
    2: { start: 152, end: 251 },
    3: { start: 252, end: 386 },
    4: { start: 387, end: 493 },
    5: { start: 494, end: 649 },
    6: { start: 650, end: 721 },
    7: { start: 722, end: 809 },
    8: { start: 810, end: 905 },
    9: { start: 906, end: 1025 },
  };

  const INITIAL_LIMIT = 1025; // Show all; removes need for pagination

  const computedLimit = INITIAL_LIMIT;
  const computedOffset = 0; // Always start at 0 since we load all

  // Alternate-forms mode local state
  const [altList, setAltList] = useState<Pokemon[]>([]);
  const [altHasMore, setAltHasMore] = useState(false);
  const altQueueRef = useRef<string[] | null>(null);
  const [altLoading, setAltLoading] = useState(false);

  // Small helpers (scoped here to avoid leaking across app)
  async function delay(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
  }
  async function fetchJsonWithRetry<T>(url: string, attempts = 3, baseDelayMs = 150): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const ctrl = new AbortController();
        const id = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(id);
        if (!res.ok) {
          if ((res.status >= 500 || res.status === 429) && i < attempts - 1) {
            await delay(baseDelayMs * Math.pow(2, i));
            continue;
          }
          throw new Error(`HTTP ${res.status} for ${url}`);
        }
        return (await res.json()) as T;
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) {
          await delay(baseDelayMs * Math.pow(2, i));
          continue;
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Failed to fetch");
  }

  // Token to invalidate stale alternate-forms fetches
  const altTokenRef = useRef(0);

  // Species buckets to derive alternate forms from (varieties -> pokemon entries)
  const ALT_SPECIES: string[] = [
    "tauros","pichu","unown","castform","kyogre","groudon","deoxys","burmy","wormadam",
    "cherrim","shellos","gastrodon","rotom","dialga","palkia","giratina","shaymin","arceus",
    "basculin","basculegion","darmanitan","deerling","sawsbuck","tornadus","thundurus","landorus","enamorus",
    "kyurem","keldeo","meloetta","genesect","greninja","vivillon","flabebe","floette","florges","furfrou",
    "meowstic","aegislash","pumpkaboo","gourgeist","xerneas","zygarde","hoopa","oricorio","lycanroc",
    "wishiwashi","silvally","minior","mimikyu","necrozma","magearna","cramorant","toxtricity",
    "sinistea","polteageist","alcremie","eiscue","indeedee","morpeko","zacian","zamazenta","eternatus",
    "urshifu","zarude","calyrex","ursaluna","oinkologne","maushold","squawkabilly","palafin","tatsugiri",
    "dudunsparce","gimmighoul","poltchageist","sinistcha","ogerpon","terapagos"
  ];

  // Build Pokemon from a pokemon/{name} entry (types, sprites, id, stats)
  const buildPokemonFromEntry = (p: any): Pokemon => ({
    pokemonId: Number(p?.id ?? 0),
    name: String(p?.name ?? ""),
    height: Number(p?.height ?? 0),
    weight: Number(p?.weight ?? 0),
    baseExperience: typeof p?.base_experience === "number" ? p.base_experience : undefined,
    types: Array.isArray(p?.types) ? p.types.map((t: any) => String(t?.type?.name ?? "")) : [],
    abilities: Array.isArray(p?.abilities) ? p.abilities.map((a: any) => String(a?.ability?.name ?? "")) : [],
    stats: Array.isArray(p?.stats)
      ? p.stats.map((s: any) => ({ name: String(s?.stat?.name ?? ""), value: Number(s?.base_stat ?? 0) }))
      : [],
    sprites: {
      frontDefault: p?.sprites?.front_default ?? undefined,
      frontShiny: p?.sprites?.front_shiny ?? undefined,
      officialArtwork: p?.sprites?.other?.["official-artwork"]?.front_default ?? undefined,
    },
    moves: Array.isArray(p?.moves) ? p.moves.map((m: any) => String(m?.move?.name ?? "")) : [],
    generation: 0,
    species: undefined,
  });

  // Fetch next batch of species -> varieties -> pokemon details; append to altList
  // - Returns the new total length after merge
  const fetchNextAltBatch = async (speciesCount = 16, token?: number): Promise<number> => {
    // If another run started, ignore this call
    if (typeof token === "number" && token !== altTokenRef.current) {
      return altList.length;
    }
    if (!altQueueRef.current || altQueueRef.current.length === 0) {
      setAltHasMore(false);
      return altList.length;
    }
    if (altLoading) return altList.length;

    setAltLoading(true);
    try {
      const batch = altQueueRef.current.splice(0, speciesCount);

      // Early exit if token invalidated during queue mutation
      if (typeof token === "number" && token !== altTokenRef.current) {
        return altList.length;
      }

      // Process species in parallel to speed up
      const settled = await Promise.allSettled(
        batch.map(async (speciesName) => {
          // species -> varieties
          const speciesData = await fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokemon-species/${speciesName}`);
          const varieties: Array<{ pokemon: { name: string; url: string } }> =
            Array.isArray(speciesData?.varieties) ? speciesData.varieties : [];

          // Fetch all variety pokemon in parallel (no per-item delay)
          const pokemonSettled = await Promise.allSettled(
            varieties
              .map((v) => v?.pokemon?.name)
              .filter((name): name is string => Boolean(name))
              .map(async (pokeName) => {
                const p = await fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokemon/${pokeName}`);
                return buildPokemonFromEntry(p);
              })
          );

          const speciesResults: Pokemon[] = [];
          for (const r of pokemonSettled) {
            if (r.status === "fulfilled") speciesResults.push(r.value);
          }
          return speciesResults;
        })
      );

      // If invalidated while fetching, stop
      if (typeof token === "number" && token !== altTokenRef.current) {
        return altList.length;
      }

      const results: Pokemon[] = [];
      for (const r of settled) {
        if (r.status === "fulfilled" && Array.isArray(r.value)) {
          results.push(...r.value);
        }
      }

      // Dedup by pokemonId and sort by id
      let newLen = altList.length;
      setAltList((prev) => {
        const map: Record<number, Pokemon> = Object.create(null);
        for (const p of prev) map[p.pokemonId] = p;
        for (const p of results) map[p.pokemonId] = p;
        const merged = Object.values(map).sort((a, b) => a.pokemonId - b.pokemonId);
        newLen = merged.length;
        return merged;
      });

      // Only update hasMore if token still valid
      if (typeof token !== "number" || token === altTokenRef.current) {
        setAltHasMore(Boolean(altQueueRef.current && altQueueRef.current.length > 0));
      }

      return newLen;
    } finally {
      // Only clear loading if token still valid
      if (typeof token !== "number" || token === altTokenRef.current) {
        setAltLoading(false);
      }
    }
  };

  // Load until at least `target` total items are present (or queue is exhausted)
  const loadAltUntil = async (targetTotal: number, token?: number) => {
    try {
      // Use a bigger species batch to speed up filling to the target quickly
      while (
        (typeof token !== "number" || token === altTokenRef.current) &&
        (altList.length < targetTotal) &&
        altQueueRef.current &&
        altQueueRef.current.length > 0
      ) {
        const newLen = await fetchNextAltBatch(24, token);
        if (typeof token === "number" && token !== altTokenRef.current) break;
        if (newLen >= targetTotal) break;
        // small pause to yield UI
        await delay(0);
      }
    } catch {
      toast.error("Failed to load alternate forms.");
    }
  };

  // Add: Species list for Mega Evolutions (normalized lowercase)
  const MEGA_SPECIES: string[] = [
    "venusaur","charizard","blastoise","beedrill","pidgeot","alakazam","slowbro","gengar","kangaskhan","pinsir",
    "gyarados","aerodactyl","mewtwo","ampharos","steelix","scizor","heracross","houndoom","tyranitar","sceptile",
    "blaziken","swampert","gardevoir","sableye","mawile","aggron","medicham","manectric","sharpedo","camerupt",
    "altaria","banette","absol","latias","latios","rayquaza","lopunny","gallade","audino","diancie"
  ];

  // Add: Fetch Mega evolutions for a species by scanning its varieties' pokemon that include "mega"
  const fetchMegasForSpecies = async (speciesName: string): Promise<Pokemon[]> => {
    try {
      const speciesData = await fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokemon-species/${speciesName}`);
      const varieties: Array<{ pokemon: { name: string; url: string } }> =
        Array.isArray(speciesData?.varieties) ? speciesData.varieties : [];

      const settled = await Promise.allSettled(
        varieties
          .map((v) => v?.pokemon?.name)
          .filter((n): n is string => !!n)
          // Only fetch varieties that look like Mega forms by name
          .filter((n) => n.includes("mega"))
          .map(async (pokeName) => {
            const p = await fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokemon/${pokeName}`);
            return buildPokemonFromEntry(p);
          })
      );

      const out: Pokemon[] = [];
      for (const r of settled) if (r.status === "fulfilled") out.push(r.value);
      return out;
    } catch {
      return [];
    }
  };

  // Add: When switching into Mega Evolutions filter, clear current list and load only the requested megas
  useEffect(() => {
    if (selectedFormCategory === "mega") {
      // Clear default/alt contexts so only megas show
      setItems([]);
      setOffset(0);
      setHasMore(false);
      setIsLoadingMore(false);

      // Clear alternate context too
      altQueueRef.current = null;
      setAltList([]);
      setAltHasMore(false);
      setAltLoading(false);

      // Load megas
      setMegaList([]);
      setMegaLoading(true);
      setMegaVisibleCount(30); // ensure default 30 on enter
      (async () => {
        try {
          const settled = await Promise.allSettled(MEGA_SPECIES.map((s) => fetchMegasForSpecies(s)));
          const merged: Record<number, Pokemon> = Object.create(null);
          for (const r of settled) {
            if (r.status === "fulfilled") {
              for (const p of r.value) merged[p.pokemonId] = p;
            }
          }
          const finalList = Object.values(merged).sort((a, b) => a.pokemonId - b.pokemonId);
          setMegaList(finalList);
        } finally {
          setMegaLoading(false);
        }
      })();
    } else {
      // Leaving mega mode: reset mega list
      setMegaList([]);
      setMegaLoading(false);
      setMegaVisibleCount(30); // reset on leave
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFormCategory]);

  // When switching into Alternate Forms filter, reset local queue and list, and load exactly 30 by default with token
  useEffect(() => {
    if (selectedFormCategory === "alternate") {
      // Invalidate any previous runs
      altTokenRef.current += 1;
      const token = altTokenRef.current;

      // clear default list & pagination context so only alt data shows
      setItems([]);
      setOffset(0);
      setHasMore(false);
      setIsLoadingMore(false);

      // seed queue and list
      altQueueRef.current = [...ALT_SPECIES];
      setAltList([]);
      setAltHasMore(altQueueRef.current.length > 0);

      // Load exactly 30 by default (or as close as possible)
      loadAltUntil(30, token);

      setInfiniteEnabled(false); // disable infinite until first manual load
    } else {
      // leaving alternate mode: invalidate and clean up
      altTokenRef.current += 1;
      altQueueRef.current = null;
      setAltList([]);
      setAltHasMore(false);
      setAltLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFormCategory]);

  // When switching into Gigantamax filter, load only the Gigantamax forms
  useEffect(() => {
    if (selectedFormCategory === "gigantamax") {
      // Clear default/alt/mega contexts so only Gmax data shows
      setItems([]);
      setOffset(0);
      setHasMore(false);
      setIsLoadingMore(false);

      altQueueRef.current = null;
      setAltList([]);
      setAltHasMore(false);
      setAltLoading(false);

      setMegaList([]);
      setMegaLoading(false);

      // Load Gmax list
      setGmaxList([]);
      setGmaxLoading(true);
      setGmaxVisibleCount(30); // ensure default 30 on enter
      (async () => {
        try {
          const list = await fetchGigantamaxList(5);
          // Map GigantamaxPokemon -> Pokemon minimal fields for display
          const mapped: Pokemon[] = list.map((g: GigantamaxPokemon) => ({
            pokemonId: g.id,
            // Use the actual gmax form name to drive UI formatting ("Gigantamax Charizard")
            name: g.gmaxFormName,
            height: g.height,
            weight: g.weight,
            baseExperience: undefined,
            types: g.types,
            abilities: g.abilities.map((a) => ({ name: a, isHidden: false })),
            stats: [],
            sprites: {
              officialArtwork: g.sprite,
              frontDefault: undefined,
              frontShiny: undefined,
            },
            moves: [],
            generation: 8,
            species: undefined,
          }));
          // Ensure stable order by national dex id
          setGmaxList(mapped.sort((a, b) => a.pokemonId - b.pokemonId));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Failed to load Gigantamax data";
          toast.error(msg);
        } finally {
          setGmaxLoading(false);
        }
      })();
    } else {
      // Leaving gigantaMax mode: reset gmax list
      setGmaxList([]);
      setGmaxLoading(false);
      setGmaxVisibleCount(30); // reset on leave
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFormCategory]);

  // Regional forms hook (base + official regionals)
  const { flatList: regionalFlatList, isLoading: regionalLoading } = useRegionalForms();

  const pokemonData = useConvexQuery(
    api.pokemon.list,
    selectedFormCategory === "gender-diff" || selectedFormCategory === "regional"
      ? "skip"
      : {
          limit: showFavorites ? 0 : BATCH_LIMIT,
          offset: showFavorites ? 0 : offset,
          search: searchQuery || undefined,
          types: selectedTypes.length > 0 ? selectedTypes : undefined,
          generation: selectedFormCategory === "regional" ? undefined : selectedGeneration,
          forms: selectedFormCategory ? [selectedFormCategory] : undefined,
        }
  );

  const nextPokemonData = useConvexQuery(
    api.pokemon.list,
    selectedFormCategory === "gender-diff" || selectedFormCategory === "regional"
      ? "skip"
      : {
          limit: showFavorites ? 0 : BATCH_LIMIT,
          offset: showFavorites ? 0 : offset + BATCH_LIMIT,
          search: searchQuery || undefined,
          types: selectedTypes.length > 0 ? selectedTypes : undefined,
          generation: selectedFormCategory === "regional" ? undefined : selectedGeneration,
          forms: selectedFormCategory ? [selectedFormCategory] : undefined,
        }
  );

  const favorites = useConvexQuery(
    api.pokemon.getFavorites,
    isAuthenticated ? {} : undefined
  );

  const addToFavorites = useConvexMutation(api.pokemon.addToFavorites);
  const removeFromFavorites = useConvexMutation(api.pokemon.removeFromFavorites);
  const fetchPokemonData = useAction(api.pokemonData.fetchAndCachePokemon);

  // Theme management
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [isDark]);

  const handleThemeToggle = () => {
    setIsDark(!isDark);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
  };

  const handleFilterChange = (filters: { types: string[]; generation?: number; formCategory?: string }) => {
    // Immediately reset pagination on filter changes to avoid race conditions
    setItems([]);
    setOffset(0);
    setHasMore(true);
    setIsLoadingMore(false);

    setSelectedTypes(filters.types);
    setSelectedGeneration(filters.generation);
    setSelectedFormCategory(filters.formCategory);
  };

  const handleFavoriteToggle = async (pokemonId: number) => {
    if (!isAuthenticated) {
      toast.error("Please sign in to manage favorites");
      return;
    }

    try {
      const favoriteIds = Array.isArray(favorites) ? favorites.map((f) => f.pokemonId) : [];
      const isFavorite = favoriteIds.includes(pokemonId);

      if (isFavorite) {
        await removeFromFavorites({ pokemonId });
        toast.success("Removed from favorites");
      } else {
        await addToFavorites({ pokemonId });
        toast.success("Added to favorites");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update favorites";
      toast.error(message);
    }
  };

  // Strengthen retry helper for transient Convex/Network hiccups
  const runWithRetries = async <T,>(
    fn: () => Promise<T>,
    attempts = 10,
    baseDelayMs = 600
  ): Promise<T> => {
    let lastErr: unknown;
    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);

        // Expanded list of retriable transient errors
        const retriable =
          /\bConnection lost while action was in flight\b/i.test(msg) ||
          /\[CONVEX A\(/i.test(msg) ||
          /\bNetworkError\b/i.test(msg) ||
          /\bFailed to fetch\b/i.test(msg) ||
          /\bAbortError\b/i.test(msg) ||
          /\bfetch failed\b/i.test(msg) ||
          /\bETIMEDOUT\b/i.test(msg) ||
          /\bECONNRESET\b/i.test(msg) ||
          /\bEAI_AGAIN\b/i.test(msg) ||
          /\bsocket hang up\b/i.test(msg) ||
          /\bClient network socket disconnected\b/i.test(msg);

        // If not retriable, or this was the final attempt, handle exit
        if (!retriable || i === attempts - 1) {
          // One last hedge retry for known transient transport issues
          if (retriable) {
            const extraWait = baseDelayMs * Math.pow(2, i) + 1000;
            await sleep(extraWait);
            return await fn();
          }
          throw err;
        }

        // Jittered exponential backoff
        const jitter = Math.floor(Math.random() * 200);
        const delayMs = baseDelayMs * Math.pow(2, i) + jitter;

        // Slight extra wait for Convex transport blips
        const extra = /\bConnection lost while action was in flight\b/i.test(msg) ? 350 : 0;

        await sleep(delayMs + extra);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Request failed");
  };

  const handleDataRefresh = async () => {
    try {
      setIsRefreshing(true);

      const promise = runWithRetries(() => fetchPokemonData({ limit: 1025, offset: 0 }));
      toast.promise(promise, {
        loading: "Fetching Pokémon data...",
        success: (data) => {
          const count = (data as any)?.cached ?? 0;
          return `Pokémon data updated successfully! Cached ${count} entries.`;
        },
        error: (err) => (err instanceof Error ? err.message : "Failed to fetch Pokémon data"),
      });

      await promise;
    } catch (error) {
      console.error("Error refreshing data:", error);
      const message = error instanceof Error ? error.message : "Unexpected error while refreshing data";
      toast.error(message);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Auto-fetch and cache Pokémon on first load if DB is empty
  useEffect(() => {
    if (showFavorites) return;
    if (!pokemonData) return; // wait for first response
    const total = pokemonData.total ?? 0;
    if (total > 0) return;
    if (autoFetchRef.current) return;

    autoFetchRef.current = true;
    setIsRefreshing(true);

    const promise = runWithRetries(() => fetchPokemonData({ limit: 1025, offset: 0 }));
    toast.promise(promise, {
      loading: "Preparing Pokédex…",
      success: (data) => {
        const count = (data as any)?.cached ?? 0;
        return `Pokémon data loaded! Cached ${count} entries.`;
      },
      error: (err) => (err instanceof Error ? err.message : "Failed to fetch Pokémon data"),
    });

    promise.finally(() => {
      setIsRefreshing(false);
    });
  }, [pokemonData, showFavorites, fetchPokemonData]);

  // Auto-fetch the selected generation if it's incomplete (ensures missing IDs like #180/#181/#195 are cached)
  useEffect(() => {
    if (showFavorites) return;                // skip in favorites view
    if (selectedFormCategory === "regional") return; // skip gen backfill in regional filter
    if (!selectedGeneration) return;          // only when a generation is chosen
    if (isRefreshing) return;                 // avoid overlapping fetches

    const range = GEN_RANGES[selectedGeneration];
    if (!range) return;

    const expectedCount = range.end - range.start + 1;
    const currentTotal = pokemonData?.total ?? 0;

    // If the current dataset for this filter is already complete, skip
    if (currentTotal >= expectedCount) return;

    setIsRefreshing(true);

    const promise = runWithRetries(() =>
      fetchPokemonData({
        limit: expectedCount,
        offset: range.start - 1,
      })
    );

    toast.promise(promise, {
      loading: `Fetching Generation ${selectedGeneration} Pokémon...`,
      success: (data) => {
        const count = (data as any)?.cached ?? 0;
        return `Loaded ${count} Pokémon for Generation ${selectedGeneration}.`;
      },
      error: (err) => (err instanceof Error ? err.message : "Failed to load generation data"),
    });

    promise.finally(() => {
      setIsRefreshing(false);
    });
  }, [
    selectedGeneration,
    selectedFormCategory,
    showFavorites,
    fetchPokemonData,
    isRefreshing,
    pokemonData?.total,
  ]);

  // Auto-fetch full dataset if a Forms category is selected and results are empty (ensures form tags exist)
  useEffect(() => {
    if (showFavorites) return;
    if (!selectedFormCategory) return;
    if (isRefreshing) return;
    if (items.length > 0) return;
    if (fetchedFormCategoryRef.current.has(selectedFormCategory)) return;

    fetchedFormCategoryRef.current.add(selectedFormCategory);
    setIsRefreshing(true);

    const promise = runWithRetries(() => fetchPokemonData({ limit: 1025, offset: 0 }));

    toast.promise(promise, {
      loading: `Preparing data for "${selectedFormCategory}" forms...`,
      success: (data) => {
        const count = (data as any)?.cached ?? 0;
        return `Data ready! Cached ${count} entries.`;
      },
      error: (err) => (err instanceof Error ? err.message : "Failed to backfill form data"),
    });

    promise.finally(() => {
      setIsRefreshing(false);
    });
  }, [selectedFormCategory, items.length, showFavorites, fetchPokemonData, isRefreshing]);

  // Backfill all Pokémon in default (All Forms) state to ensure full dataset is available for infinite scroll
  useEffect(() => {
    // Only in default list (not favorites, not alternate forms)
    if (showFavorites) return;
    if (selectedFormCategory === "alternate") return;
    if (!pokemonData) return;
    if (isRefreshing) return;

    const total = pokemonData.total ?? 0;
    // If some data exists but it's not the full dex yet, backfill in the background
    if (total > 0 && total < 1025) {
      setIsRefreshing(true);
      const promise = runWithRetries(() => fetchPokemonData({ limit: 1025, offset: 0 }));
      // We keep this silent to avoid toasting during normal scroll; just ensure data gets filled
      promise.finally(() => setIsRefreshing(false));
    }
  }, [pokemonData, showFavorites, selectedFormCategory, fetchPokemonData, isRefreshing]);

  // Enable auto infinite scroll only after first manual "Load More"
  const [infiniteEnabled, setInfiniteEnabled] = useState(false);

  // Regional client-side visible count (since regional data is client-only)
  const [regionalVisibleCount, setRegionalVisibleCount] = useState(30);

  // Infinite scroll: auto-load when near bottom (fallback button remains)
  useEffect(() => {
    const THRESHOLD_PX = 400;

    const handleScroll = () => {
      // Skip in favorites mode
      if (showFavorites) return;

      const scrollY = window.scrollY || window.pageYOffset;
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      const docH = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight,
        document.body.clientHeight,
        document.documentElement.clientHeight
      );
      const nearBottom = scrollY + viewportH >= docH - THRESHOLD_PX;
      if (!nearBottom) return;

      // Regional: client-side infinite after first manual load
      if (selectedFormCategory === "regional") {
        if (!infiniteEnabled) return;
        const total = regionalFlatList.length;
        if (regionalVisibleCount < total) {
          setRegionalVisibleCount((c) => Math.min(c + BATCH_LIMIT, total));
        }
        return;
      }

      // Alternate: infinite after first manual load
      if (selectedFormCategory === "alternate") {
        if (!infiniteEnabled) return;
        if (altHasMore && !altLoading) {
          // load next 30
          const token = altTokenRef.current;
          void loadAltUntil(altList.length + BATCH_LIMIT, token);
        }
        return;
      }

      // Mega: client-side visible count after first manual load
      if (selectedFormCategory === "mega") {
        if (!infiniteEnabled) return;
        const total = megaList.length;
        if (megaVisibleCount < total) {
          setMegaVisibleCount((c) => Math.min(c + BATCH_LIMIT, total));
        }
        return;
      }

      // Gigantamax: client-side visible count after first manual load
      if (selectedFormCategory === "gigantamax") {
        if (!infiniteEnabled) return;
        const total = gmaxList.length;
        if (gmaxVisibleCount < total) {
          setGmaxVisibleCount((c) => Math.min(c + BATCH_LIMIT, total));
        }
        return;
      }

      // Default list auto-fetch only after enabling infinite
      if (!infiniteEnabled) return;

      if (hasMore && !isLoadingMore) {
        // Start background backfill if dataset is incomplete
        const totalNow = pokemonData?.total ?? 0;
        if (totalNow < 1025 && !isRefreshing) {
          setIsRefreshing(true);
          const promise = runWithRetries(() => fetchPokemonData({ limit: 1025, offset: 0 }));
          promise.finally(() => setIsRefreshing(false));
        }

        setIsLoadingMore(true);
        setOffset((o) => o + BATCH_LIMIT);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [
    showFavorites,
    selectedFormCategory,
    hasMore,
    isLoadingMore,
    BATCH_LIMIT,
    setIsLoadingMore,
    setOffset,
    pokemonData?.total,
    isRefreshing,
    fetchPokemonData,
    infiniteEnabled,
    regionalFlatList.length,
    regionalVisibleCount,
    altHasMore,
    altLoading,
    altList.length,
    megaList.length,
    megaVisibleCount,
    gmaxList.length,
    gmaxVisibleCount,
  ]);

  useEffect(() => {
    setItems([]);
    setOffset(0);
    setHasMore(true);
    setIsLoadingMore(false);
    setInfiniteEnabled(false); // require manual "Load More" again after any filter change
    if (selectedFormCategory === "regional") {
      setRegionalVisibleCount(30);
    }
    if (selectedFormCategory === "mega") {
      setMegaVisibleCount(30);
    }
    if (selectedFormCategory === "gigantamax") {
      setGmaxVisibleCount(30);
    }
  }, [searchQuery, selectedGeneration, showFavorites, selectedTypes.join(","), selectedFormCategory || ""]);

  // Append new page results
  useEffect(() => {
    if (showFavorites) return; // favorites view doesn't paginate
    if (!pokemonData || !pokemonData.pokemon) return;

    if (offset === 0) {
      // On new filter/search, replace items with the first page (top up from next page if short)
      const first = pokemonData.pokemon;
      if (first.length < BATCH_LIMIT && nextPokemonData && Array.isArray(nextPokemonData.pokemon)) {
        const needed = Math.max(0, BATCH_LIMIT - first.length);
        const extra = nextPokemonData.pokemon.slice(0, needed);
        setItems([...first, ...extra]);
      } else {
        setItems(first);
      }
    } else {
      // Subsequent pages: append without duplicates
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.pokemonId));
        const appended = pokemonData.pokemon.filter((p) => !seen.has(p.pokemonId));
        return appended.length ? [...prev, ...appended] : prev;
      });
    }

    const total = pokemonData.total ?? 0;
    setHasMore(offset + BATCH_LIMIT < total);
    setIsLoadingMore(false);
  }, [pokemonData, nextPokemonData, offset, showFavorites]);

  const displayPokemon = selectedFormCategory === "alternate"
    ? [...altList].sort((a, b) => a.pokemonId - b.pokemonId)
    : (selectedFormCategory === "mega"
        ? [...megaList].sort((a, b) => a.pokemonId - b.pokemonId).slice(0, megaVisibleCount)
        : (selectedFormCategory === "gigantamax"
            ? [...gmaxList].sort((a, b) => a.pokemonId - b.pokemonId).slice(0, gmaxVisibleCount)
            : (selectedFormCategory === "regional"
                ? [...regionalFlatList].sort((a, b) => a.pokemonId - b.pokemonId).slice(0, regionalVisibleCount)
                : (() => {
                    // Default: list or favorites, enforce generation range if selected
                    const base = showFavorites ? (favorites || []) : items;
                    let arr = [...base];

                    if (selectedGeneration) {
                      const range = GEN_RANGES[selectedGeneration];
                      if (range) {
                        arr = arr.filter((p) => p.pokemonId >= range.start && p.pokemonId <= range.end);
                      }
                    }

                    return arr.sort((a, b) => a.pokemonId - b.pokemonId);
                  })()
              )
          )
      );

  const favoriteIds = Array.isArray(favorites) ? favorites.map((f) => f.pokemonId) : [];
  const isInitialLoading =
    selectedFormCategory === "alternate"
      ? altList.length === 0 && (altLoading || isLoadingMore)
      : (selectedFormCategory === "mega"
          ? megaList.length === 0 && megaLoading
          : (selectedFormCategory === "gigantamax"
              ? gmaxList.length === 0 && gmaxLoading
              : (selectedFormCategory === "regional"
                  ? regionalLoading && (!showFavorites)
                  : (!showFavorites && pokemonData === undefined && items.length === 0))));

  const totalItems = showFavorites ? (favorites?.length ?? 0) : (pokemonData?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / INITIAL_LIMIT));

  const getPageNumbers = (current: number, total: number): Array<number | "ellipsis"> => {
    const pages: Array<number | "ellipsis"> = [];
    const add = (p: number | "ellipsis") => pages.push(p);

    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);

    add(1);
    if (start > 2) add("ellipsis");
    for (let p = start; p <= end; p++) add(p);
    if (end < total - 1) add("ellipsis");
    if (total > 1) add(total);

    if (current === 2) pages.splice(1, 0, 2);
    if (current === total - 1 && total > 2) pages.splice(pages.length - 1, 0, total - 1);

    const seen = new Set<string>();
    return pages.filter((p) => {
      const key = String(p);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return (
    <ErrorBoundary onRetry={handleDataRefresh}>
      <div className="min-h-screen bg-background">
        <PokemonHeader
          isDark={isDark}
          onThemeToggle={handleThemeToggle}
          showFavorites={showFavorites}
          onFavoritesToggle={() => setShowFavorites(!showFavorites)}
        />

        <main className="container mx-auto px-4 py-8">
          {!showFavorites && (
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="mb-8"
            >
              <PokemonSearch
                onSearch={handleSearch}
                onFilterChange={handleFilterChange}
                searchQuery={searchQuery}
                selectedTypes={selectedTypes}
                selectedGeneration={selectedGeneration}
                selectedFormCategory={selectedFormCategory}
              />
            </motion.div>
          )}

          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mb-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                  {showFavorites ? "Your Favorites" : "Pokémon"}
                </h2>
              </div>

              {!showFavorites && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDataRefresh}
                    disabled={isRefreshing}
                    aria-busy={isRefreshing}
                    aria-label="Update Pokédex data"
                    className="gap-2"
                  >
                    <RotateCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                    <span className="hidden sm:inline">Update Data</span>
                  </Button>
                </div>
              )}
            </div>
          </motion.div>

          {!isInitialLoading && displayPokemon.length === 0 && !pokemonData?.total && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-12"
            >
              <Alert className="max-w-md mx-auto flex flex-col items-center gap-3 text-left">
                <div className="w-full flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="flex-1">
                    No Pokémon data found. You can try fetching the data again.
                  </AlertDescription>
                </div>
                <div className="w-full flex items-center justify-center gap-2">
                  <Button
                    variant="default"
                    className="px-5"
                    onClick={handleDataRefresh}
                    disabled={isRefreshing}
                    aria-busy={isRefreshing}
                    aria-label="Fetch Pokémon Data"
                  >
                    {isRefreshing ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="h-5 w-5 rounded-full bg-white/10 backdrop-blur ring-2 ring-white/40 shadow-md shadow-primary/30 flex items-center justify-center">
                          <img
                            src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                            alt="Loading Pokéball"
                            className="h-4 w-4 animate-bounce-spin"
                          />
                        </span>
                        Fetching…
                      </span>
                    ) : (
                      "Fetch Pokémon Data"
                    )}
                  </Button>
                </div>
              </Alert>
            </motion.div>
          )}

          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}>
            {selectedFormCategory === "gender-diff" ? (
              <GenderDiffGrid />
            ) : (
              <PokemonGrid
                key={`${
                  selectedFormCategory === "alternate" ? "alt" : (showFavorites ? "fav" : "infinite")
                }-${selectedGeneration ?? "all"}-${selectedTypes.join(",")}-${searchQuery}-${selectedFormCategory ?? "all"}`}
                pokemon={displayPokemon as unknown as Pokemon[]}
                favorites={favoriteIds}
                onFavoriteToggle={handleFavoriteToggle}
                isLoading={isInitialLoading}
              />
            )}
          </motion.div>

          {selectedFormCategory === "alternate" ? (
            <div className="mt-8 flex flex-col items-center gap-3">
              {!altHasMore && altList.length > 0 && (
                <div className="text-muted-foreground text-sm">No more Pokémon</div>
              )}
              {altHasMore && (
                <>
                  {altLoading ? (
                    <div
                      className="w-full sm:w-auto flex items-center justify-center"
                      aria-busy="true"
                      aria-live="polite"
                    >
                      <div className="w-full sm:w-auto px-6 h-11 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg border border-white/10 flex items-center justify-center">
                        <div className="h-9 w-9 rounded-full bg-white/10 backdrop-blur ring-2 ring-white/40 shadow-md shadow-primary/30 flex items-center justify-center animate-pulse">
                          <img
                            src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                            alt="Loading Pokéball"
                            className="h-7 w-7 animate-bounce-spin drop-shadow"
                          />
                        </div>
                        <span className="sr-only">Loading more Pokémon…</span>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="default"
                      className="w-full sm:w-auto px-6 h-11 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md hover:from-blue-500 hover:to-purple-500 active:scale-[0.99] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                      onClick={async () => {
                        if (altLoading) return;
                        const current = altList.length;
                        const token = altTokenRef.current;
                        // Load 30 more entries
                        await loadAltUntil(current + 30, token);
                        setInfiniteEnabled(true); // enable infinite scrolling after first manual load
                        if (!altQueueRef.current || altQueueRef.current.length === 0) {
                          // Only update hasMore if still valid
                          if (token === altTokenRef.current) {
                            setAltHasMore(false);
                          }
                        }
                      }}
                      disabled={altLoading}
                      aria-busy={altLoading}
                      aria-live="polite"
                      aria-label="Load more Pokémon"
                    >
                      Load More
                    </Button>
                  )}
                </>
              )}
            </div>
          ) : selectedFormCategory === "mega" ? (
            <div className="mt-8 flex flex-col items-center gap-3">
              {megaLoading ? (
                <div
                  className="w-full sm:w-auto flex items-center justify-center"
                  aria-busy="true"
                  aria-live="polite"
                >
                  <div className="w-full sm:w-auto px-6 h-11 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg border border-white/10 flex items-center justify-center">
                    <div className="h-9 w-9 rounded-full bg-white/10 backdrop-blur ring-2 ring-white/40 shadow-md shadow-primary/30 flex items-center justify-center animate-pulse">
                      <img
                        src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                        alt="Loading Pokéball"
                        className="h-7 w-7 animate-bounce-spin drop-shadow"
                      />
                    </div>
                    <span className="sr-only">Loading Mega Evolutions…</span>
                  </div>
                </div>
              ) : (
                <>
                  {megaVisibleCount >= megaList.length && megaList.length > 0 && (
                    <div className="text-muted-foreground text-sm">No more Pokémon</div>
                  )}
                  {megaVisibleCount < megaList.length && (
                    <Button
                      variant="default"
                      className="w-full sm:w-auto px-6 h-11 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md hover:from-blue-500 hover:to-purple-500 active:scale-[0.99] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                      onClick={() => {
                        const total = megaList.length;
                        setMegaVisibleCount((c) => Math.min(c + BATCH_LIMIT, total));
                        setInfiniteEnabled(true); // enable infinite after first manual load
                      }}
                      aria-label="Load more Pokémon"
                    >
                      Load More
                    </Button>
                  )}
                </>
              )}
            </div>
          ) : selectedFormCategory === "gigantamax" ? (
            <div className="mt-8 flex flex-col items-center gap-3">
              {gmaxLoading ? (
                <div
                  className="w-full sm:w-auto flex items-center justify-center"
                  aria-busy="true"
                  aria-live="polite"
                >
                  <div className="w-full sm:w-auto px-6 h-11 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg border border-white/10 flex items-center justify-center">
                    <div className="h-9 w-9 rounded-full bg-white/10 backdrop-blur ring-2 ring-white/40 shadow-md shadow-primary/30 flex items-center justify-center animate-pulse">
                      <img
                        src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                        alt="Loading Pokéball"
                        className="h-7 w-7 animate-bounce-spin drop-shadow"
                      />
                    </div>
                    <span className="sr-only">Loading Gigantamax forms…</span>
                  </div>
                </div>
              ) : (
                <>
                  {gmaxVisibleCount >= gmaxList.length && gmaxList.length > 0 && (
                    <div className="text-muted-foreground text-sm">No more Pokémon</div>
                  )}
                  {gmaxVisibleCount < gmaxList.length && (
                    <Button
                      variant="default"
                      className="w-full sm:w-auto px-6 h-11 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md hover:from-blue-500 hover:to-purple-500 active:scale-[0.99] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                      onClick={() => {
                        const total = gmaxList.length;
                        setGmaxVisibleCount((c) => Math.min(c + BATCH_LIMIT, total));
                        setInfiniteEnabled(true); // enable infinite after first manual load
                      }}
                      aria-label="Load more Pokémon"
                    >
                      Load More
                    </Button>
                  )}
                </>
              )}
            </div>
          ) : selectedFormCategory === "regional" ? (
            <div className="mt-8 flex flex-col items-center gap-3">
              {regionalLoading ? (
                <div
                  className="w-full sm:w-auto flex items-center justify-center"
                  aria-busy="true"
                  aria-live="polite"
                >
                  <div className="w-full sm:w-auto px-6 h-11 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg border border-white/10 flex items-center justify-center">
                    <div className="h-9 w-9 rounded-full bg-white/10 backdrop-blur ring-2 ring-white/40 shadow-md shadow-primary/30 flex items-center justify-center animate-pulse">
                      <img
                        src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                        alt="Loading Pokéball"
                        className="h-7 w-7 animate-bounce-spin drop-shadow"
                      />
                    </div>
                    <span className="sr-only">Loading Regional forms…</span>
                  </div>
                </div>
              ) : (
                <>
                  {regionalVisibleCount >= regionalFlatList.length && regionalFlatList.length > 0 && (
                    <div className="text-muted-foreground text-sm">No more Pokémon</div>
                  )}
                  {regionalVisibleCount < regionalFlatList.length && (
                    <Button
                      variant="default"
                      className="w-full sm:w-auto px-6 h-11 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md hover:from-blue-500 hover:to-purple-500 active:scale-[0.99] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                      onClick={() => {
                        const total = regionalFlatList.length;
                        setRegionalVisibleCount((c) => Math.min(c + BATCH_LIMIT, total));
                        setInfiniteEnabled(true); // enable infinite after first manual load
                      }}
                      aria-label="Load more Pokémon"
                    >
                      Load More
                    </Button>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="mt-8 flex flex-col items-center gap-3">
              {!showFavorites && (
                <>
                  {/* Show "No more Pokémon" only if we know the full dex is cached */}
                  {!hasMore && items.length > 0 && (pokemonData?.total ?? 0) >= 1025 && (
                    <div className="text-muted-foreground text-sm">No more Pokémon</div>
                  )}

                  {/* Show Load More when there are more pages OR dataset incomplete */}
                  {(hasMore || ((pokemonData?.total ?? 0) < 1025)) && (
                    <>
                      {isLoadingMore ? (
                        <div
                          className="w-full sm:w-auto flex items-center justify-center"
                          aria-busy="true"
                          aria-live="polite"
                        >
                          <div className="w-full sm:w-auto px-6 h-11 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg border border-white/10 flex items-center justify-center">
                            <div className="h-9 w-9 rounded-full bg-white/10 backdrop-blur ring-2 ring-white/40 shadow-md shadow-primary/30 flex items-center justify-center animate-pulse">
                              <img
                                src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                                alt="Loading Pokéball"
                                className="h-7 w-7 animate-bounce-spin drop-shadow"
                              />
                            </div>
                            <span className="sr-only">Loading more Pokémon…</span>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="default"
                          className="w-full sm:w-auto px-6 h-11 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md hover:from-blue-500 hover:to-purple-500 active:scale-[0.99] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                          onClick={() => {
                            if (isLoadingMore) return;

                            const totalNow = pokemonData?.total ?? 0;
                            if (totalNow < 1025 && !isRefreshing) {
                              setIsRefreshing(true);
                              const promise = runWithRetries(() => fetchPokemonData({ limit: 1025, offset: 0 }));
                              promise.finally(() => setIsRefreshing(false));
                            }

                            setIsLoadingMore(true);
                            setOffset((o) => o + BATCH_LIMIT);
                            setInfiniteEnabled(true); // enable infinite scrolling after first manual load
                          }}
                          disabled={isLoadingMore}
                          aria-busy={isLoadingMore}
                          aria-live="polite"
                          aria-label="Load more Pokémon"
                        >
                          Load More
                        </Button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}