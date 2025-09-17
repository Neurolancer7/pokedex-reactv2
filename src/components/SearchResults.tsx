import { useMemo, useState } from "react";
import type { Pokemon } from "@/lib/pokemon-api";
import { PokemonGrid } from "@/components/PokemonGrid";
import { Button } from "@/components/ui/button";

type SearchResultsProps = {
  pokemon: ReadonlyArray<Pokemon>;
  favorites?: number[];
  isLoading?: boolean;
  pageSize?: number;
  layoutVariant?: "default" | "alternate";
  onFavoriteToggle?: (pokemonId: number) => void;
};

export default function SearchResults({
  pokemon,
  favorites = [],
  isLoading = false,
  pageSize = 40,
  layoutVariant = "default",
  onFavoriteToggle,
}: SearchResultsProps) {
  const [visible, setVisible] = useState(pageSize);

  const sliced = useMemo(() => {
    // For alternate variant we show full list to allow own infinite scroll elsewhere
    if (layoutVariant === "alternate") return pokemon as Pokemon[];
    return (pokemon as Pokemon[]).slice(0, visible);
  }, [pokemon, visible, layoutVariant]);

  const hasMore =
    layoutVariant === "alternate" ? false : visible < (pokemon?.length || 0);

  return (
    <div className="flex flex-col gap-4">
      <PokemonGrid
        pokemon={sliced as Pokemon[]}
        favorites={favorites}
        isLoading={isLoading}
        onFavoriteToggle={onFavoriteToggle}
        layoutVariant={layoutVariant}
      />

      {!isLoading && hasMore && (
        <div className="flex justify-center">
          <Button
            className="px-6"
            onClick={() => setVisible((v) => Math.min(v + pageSize, pokemon.length))}
            aria-label="Load more results"
          >
            Load More
          </Button>
        </div>
      )}
    </div>
  );
}
