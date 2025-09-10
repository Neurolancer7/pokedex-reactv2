import { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useQuery as useConvexQuery, useMutation as useConvexMutation } from "convex/react";

import { PokemonHeader } from "@/components/PokemonHeader";
import { PokemonGrid } from "@/components/PokemonGrid";
import { POKEMON_GENERATIONS } from "@/lib/pokemon-api";
import type { Pokemon } from "@/lib/pokemon-api";

export default function Region() {
  const { gen } = useParams();
  const generation = useMemo(() => {
    const n = Number(gen);
    return Number.isFinite(n) && n >= 1 && n <= 9 ? n : undefined;
  }, [gen]);

  const regionMeta = useMemo(
    () => POKEMON_GENERATIONS.find((g) => g.id === generation),
    [generation]
  );

  const { isAuthenticated } = useAuth();

  // Add pagination state for regions
  const [page, setPage] = useState(1);
  const LIMIT = 20;
  const offset = (page - 1) * LIMIT;

  // Reset page when generation changes
  useEffect(() => {
    setPage(1);
  }, [generation]);

  // Fetch paginated data for the region
  const regionData = useConvexQuery(api.pokemon.list, {
    limit: LIMIT,
    offset,
    generation: generation,
  });

  const favorites = useConvexQuery(
    api.pokemon.getFavorites,
    isAuthenticated ? {} : "skip"
  );

  const addToFavorites = useConvexMutation(api.pokemon.addToFavorites);
  const removeFromFavorites = useConvexMutation(api.pokemon.removeFromFavorites);

  const favoriteIds = Array.isArray(favorites) ? favorites.map((f) => f.pokemonId) : [];
  const isLoading = regionData === undefined;
  const displayPokemon = regionData?.pokemon ?? [];

  // Normalize results to full Pokemon objects for the grid
  const normalizedRegionPokemon: Pokemon[] = (displayPokemon as any[]).map((p: any) => ({
    pokemonId: Number(p?.pokemonId ?? 0),
    name: String(p?.name ?? ""),
    height: Number(p?.height ?? 0),
    weight: Number(p?.weight ?? 0),
    baseExperience: typeof p?.baseExperience === "number" ? p.baseExperience : undefined,
    types: Array.isArray(p?.types) ? p.types : [],
    abilities: Array.isArray(p?.abilities) ? p.abilities : [],
    stats: Array.isArray(p?.stats) ? p.stats : [],
    sprites: {
      frontDefault: p?.sprites?.frontDefault,
      frontShiny: p?.sprites?.frontShiny,
      officialArtwork: p?.sprites?.officialArtwork,
    },
    moves: Array.isArray(p?.moves) ? p.moves : [],
    generation: Number(p?.generation ?? 1),
    species: p?.species,
  }));

  // Derive total pages
  const totalItems = regionData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / LIMIT));

  const onFavoriteToggle = async (pokemonId: number) => {
    if (!isAuthenticated) {
      toast.error("Please sign in to manage favorites");
      return;
    }
    try {
      const isFav = favoriteIds.includes(pokemonId);
      if (isFav) {
        await removeFromFavorites({ pokemonId });
        toast.success("Removed from favorites");
      } else {
        await addToFavorites({ pokemonId });
        toast.success("Added to favorites");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update favorites";
      toast.error(message);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <PokemonHeader
        isDark={document.documentElement.classList.contains("dark")}
        onThemeToggle={() => {
          const root = document.documentElement;
          const nowDark = !root.classList.contains("dark");
          if (nowDark) {
            root.classList.add("dark");
            localStorage.setItem("theme", "dark");
          } else {
            root.classList.remove("dark");
            localStorage.setItem("theme", "light");
          }
        }}
        showFavorites={false}
        onFavoritesToggle={() => {}}
      />

      {/* Simple region nav bar row */}
      <div className="container mx-auto px-4 pt-3">
        <RegionNav />
      </div>

      <main className="container mx-auto px-4 py-6">
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="mb-6"
        >
          <h2 className="text-2xl font-bold tracking-tight">
            {regionMeta ? `${regionMeta.name} Region` : "All Pokémon"}
          </h2>
        </motion.div>

        {!isLoading && displayPokemon.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
          >
            <Alert className="max-w-md mx-auto">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No Pokémon available for this region yet. Try another region or load data first.
              </AlertDescription>
            </Alert>
          </motion.div>
        )}

        <PokemonGrid
          key={`region-${generation ?? 'all'}-${page}`} // Force re-render on page/gen change
          pokemon={normalizedRegionPokemon}
          favorites={favoriteIds}
          onFavoriteToggle={onFavoriteToggle}
          isLoading={isLoading}
          // Enable in-grid pagination controls
          currentPage={page}
          totalPages={totalPages}
          onPageChange={(p) => {
            setPage(p);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </main>
    </div>
  );
}

function RegionNav() {
  const navigate = useNavigate();
  const items = [{ id: 0, name: "All Pokémon", to: "/pokedex" }, ...POKEMON_GENERATIONS.map(g => ({ id: g.id, name: g.name, to: `/region/${g.id}` }))];

  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
      {items.map((item) => (
        <Button
          key={item.to}
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => navigate(item.to)}
        >
          {item.name}
        </Button>
      ))}
    </div>
  );
}