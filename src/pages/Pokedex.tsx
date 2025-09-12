import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
// removed unused @tanstack/react-query imports
import { AlertCircle, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { useQuery as useConvexQuery, useMutation as useConvexMutation, useAction } from "convex/react";
import { useAuth } from "@/hooks/use-auth";

import { PokemonHeader } from "@/components/PokemonHeader";
import { PokemonSearch } from "@/components/PokemonSearch";
import { PokemonGrid } from "@/components/PokemonGrid";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlternateForms } from "@/components/AlternateForms";
import { GenderDiffGrid } from "@/components/GenderDiffGrid";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

async function fetchJsonWithRetry<T>(url: string, attempts = 4, baseDelayMs = 300): Promise<T> {
  let lastErr: unknown;
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      const jitter = Math.floor(Math.random() * 150);
      await sleep(baseDelayMs * Math.pow(2, i) + jitter);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to fetch JSON");
}

export default function Pokedex() {
  const { isAuthenticated } = useAuth();
  // Disable all data I/O across the page
  const DATA_DISABLED = true;
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("theme") === "dark" || 
        (!localStorage.getItem("theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
    return false;
  });
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedFormCategory, setSelectedFormCategory] = useState<string | undefined>(undefined);
  const [showFavorites, setShowFavorites] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Infinite scroll state
  const BATCH_LIMIT = 30;
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Add ref to ensure auto-fetch only triggers once
  const autoFetchRef = useRef(false);
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

  const INITIAL_LIMIT = 1025; // Show all; removes need for pagination

  const PAGE_SIZE = Number((import.meta as any)?.env?.VITE_DEFAULT_PAGE_SIZE) || 40;
  const API_BASE: string =
    ((import.meta as any)?.env?.VITE_POKEAPI_URL as string) || "https://pokeapi.co/api/v2";

  const [masterList, setMasterList] = useState<Pokemon[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(false);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [infiniteEnabled, setInfiniteEnabled] = useState(false);

  // Alternate-forms mode local state
  const [altList, setAltList] = useState<Pokemon[]>([]);
  const [altHasMore, setAltHasMore] = useState(false);
  const altQueueRef = useRef<string[] | null>(null);
  const [altLoading, setAltLoading] = useState(false);

  // Regions mapping: label, display range, and pokedex slugs to aggregate
  const REGION_OPTIONS: Array<{
    key: string;
    label: string;
    range: string;
    slugs: string[];
  }> = [
    { key: "kanto", label: "Kanto", range: "#001–#151", slugs: ["kanto"] },
    { key: "johto", label: "Johto", range: "#152–#251", slugs: ["original-johto"] },
    { key: "hoenn", label: "Hoenn", range: "#252–#386", slugs: ["hoenn"] },
    { key: "sinnoh", label: "Sinnoh", range: "#387–#493", slugs: ["original-sinnoh"] },
    { key: "unova", label: "Unova", range: "#494–#649", slugs: ["original-unova"] },
    {
      key: "kalos",
      label: "Kalos",
      range: "#650–#721",
      slugs: ["kalos-central", "kalos-coastal", "kalos-mountain"],
    },
    {
      key: "alola",
      label: "Alola",
      range: "#722–#809",
      slugs: ["updated-alola"], // includes USUM updates
    },
    {
      key: "galar",
      label: "Galar",
      range: "#810–#898 (+DLC)",
      slugs: ["galar", "isle-of-armor", "crown-tundra"],
    },
    { key: "hisui", label: "Hisui", range: "#899–#905", slugs: ["hisui"] },
    { key: "paldea", label: "Paldea", range: "#906–#1010", slugs: ["paldea"] },
  ];

  const [selectedRegion, setSelectedRegion] = useState<string>("kanto");

  // Helper to build minimal Pokemon from species id + name
  function buildMinimalPokemon(id: number, name: string): Pokemon {
    const artwork = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
    return {
      pokemonId: id,
      name,
      height: 0,
      weight: 0,
      baseExperience: undefined,
      types: [],
      abilities: [],
      stats: [],
      sprites: {
        frontDefault: undefined,
        frontShiny: undefined,
        officialArtwork: artwork,
      },
      moves: [],
      generation: 0,
      species: undefined,
    };
  }

  // Fetch region pokedex and populate masterList
  const fetchRegionPokemon = async (regionKey: string) => {
    try {
      setLoadingMaster(true);
      setMasterError(null);

      const region = REGION_OPTIONS.find((r) => r.key === regionKey);
      if (!region) throw new Error("Unknown region");

      // Fetch all slugs for this region (handle sub-dex merges)
      const results = await Promise.all(
        region.slugs.map((slug) =>
          fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokedex/${slug}`)
        )
      );

      // Aggregate pokemon_entries -> species id + name
      const map: Map<number, string> = new Map();
      for (const r of results) {
        const entries: any[] = Array.isArray(r?.pokemon_entries) ? r.pokemon_entries : [];
        for (const e of entries) {
          const name: string = String(e?.pokemon_species?.name ?? "").trim();
          const url: string = String(e?.pokemon_species?.url ?? "");
          const idMatch = url.match(/\/pokemon-species\/(\d+)\/?$/);
          const id = idMatch ? Number(idMatch[1]) : NaN;
          if (!name || !Number.isFinite(id)) continue;
          if (!map.has(id)) map.set(id, name);
        }
      }

      // Build minimal list, sort by national dex ascending
      const list: Pokemon[] = Array.from(map.entries())
        .map(([id, name]) => buildMinimalPokemon(id, name))
        .sort((a, b) => a.pokemonId - b.pokemonId);

      setMasterList(list);
      setVisibleCount(PAGE_SIZE);
      setHasMore(PAGE_SIZE < list.length);
      toast.success(`Loaded ${region.label} Pokédex`);
    } catch (error) {
      console.error("Error loading region:", error);
      const message = error instanceof Error ? error.message : "Failed to load region Pokédex";
      setMasterError(message);
      toast.error(message);
      setMasterList([]);
      setVisibleCount(PAGE_SIZE);
      setHasMore(false);
    } finally {
      setIsRefreshing(false);
      setLoadingMaster(false);
    }
  };

  // Fetch all Pokémon (including forms) directly from PokeAPI
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await fetchRegionPokemon(selectedRegion);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [selectedRegion, PAGE_SIZE]);

  // Client-side filtering for search and types; ignore form categories for the unified list
  const filteredList = masterList.filter((p) => {
    const matchesSearch =
      !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(p.pokemonId).includes(searchQuery.trim());
    const matchesTypes =
      selectedTypes.length === 0 ||
      p.types.some((t) => selectedTypes.includes(String(t).toLowerCase()));
    return matchesSearch && matchesTypes;
  });

  // Reset visible count when filters/search change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setHasMore(true);
    setIsLoadingMore(false);
    setInfiniteEnabled(false);
  }, [searchQuery, selectedTypes.join(",") /* ignore forms filter intentionally */]);

  // Derive display items
  const displayPokemon = filteredList.slice(0, visibleCount);

  // Maintain hasMore based on filtered length
  useEffect(() => {
    setHasMore(visibleCount < filteredList.length);
  }, [visibleCount, filteredList.length]);

  // Override infinite scroll to use visibleCount / filteredList
  useEffect(() => {
    const THRESHOLD_PX = 400;

    const handleScroll = () => {
      const scrollY = window.scrollY || window.pageYOffset;
      const viewportH =
        window.innerHeight || document.documentElement.clientHeight;
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

      if (!infiniteEnabled) return;
      if (visibleCount < filteredList.length && !isLoadingMore) {
        setIsLoadingMore(true);
        setTimeout(() => {
          setVisibleCount((c) => Math.min(c + PAGE_SIZE, filteredList.length));
          setIsLoadingMore(false);
        }, 0);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [infiniteEnabled, visibleCount, filteredList.length, PAGE_SIZE, isLoadingMore]);

  // Disable any automatic data backfill or auto-fetching
  const AUTO_FETCH_ENABLED = false;

  // Add: local no-op stubs to remove backend dependencies safely
  const clearCache = async (_args?: any) => {};
  const fetchPokemonData = async (_args: any) => ({ cached: 0, total: 0, pokemon: [] as Pokemon[] });
  const pokemonData: any = undefined;
  const nextPokemonData: any = undefined;

  // On page load: purge all cached data (pokemon, species, forms, regional, gender)
  useEffect(() => {
    void clearCache({ scopes: ["pokemon", "species", "forms", "regional", "gender"] });
  }, [clearCache]);

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

  const handleFilterChange = (filters: { types: string[]; formCategory?: string }) => {
    // Immediately reset pagination on filter changes to avoid race conditions
    setItems([]);
    setOffset(0);
    setHasMore(true);
    setIsLoadingMore(false);

    setSelectedTypes(filters.types);
    setSelectedFormCategory(filters.formCategory);
  };

  const handleFavoriteToggle = async (_pokemonId: number) => {
    toast("Favorites are disabled for this demo");
    return;
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
      await fetchRegionPokemon(selectedRegion);
    } finally {
      setIsRefreshing(false);
    }
  };

  // When switching regions: reset UI and scroll to top smoothly
  const handleRegionChange = (value: string) => {
    setSelectedRegion(value);
    setSearchQuery("");
    setSelectedTypes([]);
    setVisibleCount(PAGE_SIZE);
    setHasMore(true);
    setIsLoadingMore(false);
    setInfiniteEnabled(false);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  };

  // Right before return: define a simple initial loading flag for the empty state
  const isInitialLoading = loadingMaster;

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
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold tracking-tight">
                  {showFavorites ? "Your Favorites" : "Pokémon"}
                </h2>
                {/* Region pill */}
                <div className="min-w-[180px]">
                  <Select value={selectedRegion} onValueChange={handleRegionChange}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Region" />
                    </SelectTrigger>
                    <SelectContent>
                      {REGION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.key} value={opt.key}>
                          {opt.label} {opt.range ? `(${opt.range})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
            {/* Always render the unified grid */}
            <PokemonGrid
              key={`unified-${selectedTypes.join(",")}-${searchQuery}`}
              pokemon={displayPokemon as unknown as Pokemon[]}
              favorites={[]}
              onFavoriteToggle={handleFavoriteToggle}
              isLoading={loadingMaster}
            />
          </motion.div>

          {/* Unified Load More section */}
          <div className="mt-8 flex flex-col items-center gap-3">
            <>
              {!hasMore && displayPokemon.length > 0 && (
                <div className="text-muted-foreground text-sm">No more Pokémon</div>
              )}

              {hasMore && (
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
                        setIsLoadingMore(true);
                        setTimeout(() => {
                          setVisibleCount((c) =>
                            Math.min(c + PAGE_SIZE, filteredList.length)
                          );
                          setIsLoadingMore(false);
                          setInfiniteEnabled(true); // enable infinite after first manual load
                        }, 0);
                      }}
                      disabled={isLoadingMore || loadingMaster}
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
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
}