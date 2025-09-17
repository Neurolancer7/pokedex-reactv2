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

  // Add: computed counts for summary (accessible live region)
  const totalCount = pokemon?.length ?? 0;
  const showingCount =
    layoutVariant === "alternate" ? totalCount : Math.min(visible, totalCount);

  return (
    <div className="flex flex-col gap-4">
      {/* Results summary bar */}
      <div
        className="flex items-center justify-between rounded-lg border bg-card/70 px-3 py-2 text-sm"
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 items-center rounded-full border px-2.5 font-medium">
            Results
          </span>
          <span className="text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{showingCount}</span>
            {layoutVariant !== "alternate" && (
              <>
                {" "}
                of <span className="font-semibold text-foreground">{totalCount}</span>
              </>
            )}
          </span>
        </div>

        {!isLoading && totalCount === 0 ? (
          <span className="text-muted-foreground">No matches</span>
        ) : (
          <span className="text-muted-foreground">
            {layoutVariant === "alternate" ? "Alternate forms view" : "Standard view"}
          </span>
        )}
      </div>

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