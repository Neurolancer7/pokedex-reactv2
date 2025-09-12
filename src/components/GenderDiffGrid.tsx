import { useMemo, useState, useEffect } from "react";
import { genderDiffSpecies } from "@/lib/genderDiffSpecies";
import { useGenderDiffPokemon, spriteFromDexId } from "@/lib/useGenderDiffPokemon";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RotateCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ExternalLink } from "lucide-react";

function genderSpriteUrl(dexId: number, g: "male" | "female"): string {
  const base = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
  return g === "female" ? `${base}/female/${dexId}.png` : `${base}/${dexId}.png`;
}

type Props = {
  species?: string[];
};

export function GenderDiffGrid({ species }: Props) {
  const names = useMemo(() => (species && species.length > 0 ? species : genderDiffSpecies), [species]);
  const { data, isLoading, error, refetch } = useGenderDiffPokemon(names);

  const sorted = useMemo(() => {
    return Array.isArray(data) ? [...data].sort((a, b) => a.dexId - b.dexId) : data;
  }, [data]);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{ name: string; dexId: number } | null>(null);
  const [gender, setGender] = useState<"male" | "female">("male");
  const [imgKey, setImgKey] = useState(0); // forces img reload on toggle
  // streamlined: no client-side Bulbapedia probing; rely on server-side fetching and cache
  const [descLoading, setDescLoading] = useState(false);
  const [descError, setDescError] = useState<string | null>(null);
  const [descText, setDescText] = useState<string | null>(null);
  const [descSource, setDescSource] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(30);
  const [infiniteEnabled, setInfiniteEnabled] = useState(false);

  useEffect(() => {
    setVisibleCount(30);
    setInfiniteEnabled(false);
  }, [species, isLoading]);

  useEffect(() => {
    const THRESHOLD_PX = 400;
    const onScroll = () => {
      if (!Array.isArray(sorted) || sorted.length === 0) return;
      if (!infiniteEnabled) return;

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

      if (visibleCount < sorted.length) {
        setVisibleCount((c) => Math.min(c + 30, sorted.length));
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, [sorted, infiniteEnabled, visibleCount]);

  const fetchGenderDiff = useAction(api.genderDiffActions.fetchGenderDifference);

  // Load Bulbapedia gender differences (server-side scraped & cached)
  useEffect(() => {
    const load = async () => {
      if (!open || !selected) {
        setDescLoading(false);
        setDescError(null);
        setDescText(null);
        setDescSource(null);
        return;
      }
      setDescLoading(true);
      setDescError(null);
      setDescText(null);
      setDescSource(null);
      try {
        const res = await fetchGenderDiff({ name: selected.name, dexId: selected.dexId });
        setDescText(res.description || null);
        setDescSource((res as any).sourceUrl || null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load description";
        setDescError(msg);
      } finally {
        setDescLoading(false);
      }
    };
    load();
  }, [open, selected?.name, selected?.dexId, fetchGenderDiff]);

  return (
    <div className="w-full">
      {/* Loading */}
      {isLoading && (
        <div className="w-full flex items-center justify-center py-8" aria-busy="true" aria-live="polite">
          <div className="px-6 h-11 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg border border-white/10 flex items-center justify-center">
            <div className="h-9 w-9 rounded-full bg-white/10 backdrop-blur ring-2 ring-white/40 shadow-md shadow-primary/30 flex items-center justify-center animate-pulse">
              <img
                src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                alt="Loading Pokéball"
                className="h-7 w-7 animate-bounce-spin drop-shadow"
              />
            </div>
            <span className="ml-3 text-sm">Fetching Pokémon with Gender Differences…</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="mb-4">
          <Alert>
            <AlertDescription className="flex items-center justify-between gap-2">
              <span className="text-sm">{error.message}</span>
              <Button variant="outline" size="sm" onClick={refetch} className="gap-2">
                <RotateCw className="h-4 w-4" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!data || data.length === 0) && (
        <div className="text-center text-muted-foreground py-12 text-sm">No Pokémon found.</div>
      )}

      {/* Grid */}
      {Array.isArray(sorted) && sorted.length > 0 && (
        <>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {sorted.slice(0, visibleCount).map((p) => (
              <Card
                key={`${p.dexId}-${p.name}`}
                className="overflow-hidden border-2 hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => {
                  setSelected({ name: p.name, dexId: p.dexId });
                  setGender("male");
                  setImgKey((k) => k + 1);
                  setOpen(true);
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-sm font-mono text-muted-foreground">#{String(p.dexId).padStart(4, "0")}</span>
                    <span
                      title="Gender Differences"
                      aria-label="Gender Differences"
                      className="inline-flex items-center justify-center rounded-full bg-background border shadow p-1.5 ring-2 ring-pink-500/40"
                    >
                      <img
                        src="https://harmless-tapir-303.convex.cloud/api/storage/d3256155-fdbb-486b-b117-e4850f259ab5"
                        alt="Gender Differences"
                        className="h-6 w-6 object-contain drop-shadow"
                      />
                    </span>
                  </div>

                  <div className="w-full flex items-center justify-center mb-3">
                    <div className="w-28 h-28 flex items-center justify-center bg-gradient-to-br from-muted/50 to-muted rounded-full">
                      <img
                        src={spriteFromDexId(p.dexId)}
                        alt={p.name}
                        className="w-24 h-24 object-contain"
                        loading="lazy"
                      />
                    </div>
                  </div>

                  <h3 className="font-bold text-lg text-center mb-3 tracking-tight capitalize">{p.name.replace("-", " ")}</h3>

                  <div className="flex flex-wrap gap-2">
                    {p.forms.map((f, idx) => (
                      <Button
                        key={`${p.dexId}-${f.name}-${idx}`}
                        asChild
                        variant="outline"
                        size="sm"
                        className="capitalize"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <a href={f.url} target="_blank" rel="noreferrer">
                          {f.name.replace("-", " ")}
                        </a>
                      </Button>
                    ))}
                    {p.forms.length === 0 && (
                      <span className="text-xs text-muted-foreground">No forms listed</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination controls */}
          <div className="mt-8 flex flex-col items-center gap-3">
            {visibleCount >= sorted.length && sorted.length > 0 && (
              <div className="text-muted-foreground text-sm">No more Pokémon</div>
            )}
            {visibleCount < sorted.length && (
              <Button
                variant="default"
                className="w-full sm:w-auto px-6 h-11 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md hover:from-blue-500 hover:to-purple-500 active:scale-[0.99] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                onClick={() => {
                  setVisibleCount((c) => Math.min(c + 30, sorted.length));
                  setInfiniteEnabled(true);
                }}
                aria-label="Load more Pokémon"
              >
                Load More
              </Button>
            )}
          </div>
        </>
      )}

      {/* Simplified Gender Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl p-0">
          <div className="p-6">
            <DialogHeader className="mb-4">
              <DialogTitle className="text-xl font-bold capitalize">
                {selected?.name?.replace("-", " ")}
              </DialogTitle>
            </DialogHeader>

            {/* Gender toggle */}
            <div className="flex items-center justify-center gap-2 mb-4">
              <Button
                variant={gender === "male" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setGender("male");
                  setImgKey((k) => k + 1);
                }}
                aria-pressed={gender === "male"}
              >
                Male
              </Button>
              <Button
                variant={gender === "female" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setGender("female");
                  setImgKey((k) => k + 1);
                }}
                aria-pressed={gender === "female"}
              >
                Female
              </Button>
            </div>

            {/* Gendered sprite */}
            <div className="w-full flex items-center justify-center">
              <div className="w-60 h-60 flex items-center justify-center bg-gradient-to-br from-muted/50 to-muted rounded-lg border">
                {selected && (
                  <img
                    key={`${selected.dexId}-${gender}-${imgKey}`}
                    src={genderSpriteUrl(selected.dexId, gender)}
                    alt={`${selected.name} ${gender}`}
                    className="w-52 h-52 object-contain"
                    onError={(e) => {
                      // Fallback to male if female sprite missing
                      const img = e.currentTarget as HTMLImageElement;
                      if (gender === "female") {
                        img.src = genderSpriteUrl(selected.dexId, "male");
                      }
                    }}
                  />
                )}
              </div>
            </div>

            {/* Gender Differences description (shown only in this filtered modal) */}
            <div className="mt-5 p-4 rounded-lg border bg-gradient-to-br from-pink-500/5 to-purple-500/5">
              <div className="mb-2 text-sm font-semibold">Gender Differences</div>

              {/* Loading state */}
              {descLoading && (
                <div className="w-full flex items-center justify-center py-3" aria-busy="true" aria-live="polite">
                  <div className="px-4 h-10 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow border border-white/10 flex items-center justify-center">
                    <div className="h-8 w-8 rounded-full bg-white/10 backdrop-blur ring-2 ring-white/40 shadow flex items-center justify-center animate-pulse">
                      <img
                        src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                        alt="Loading Pokéball"
                        className="h-6 w-6 animate-bounce-spin drop-shadow"
                      />
                    </div>
                    <span className="ml-2 text-xs">Loading gender differences…</span>
                  </div>
                </div>
              )}

              {/* Error state */}
              {!descLoading && descError && (
                <Alert className="mt-2">
                  <AlertDescription className="text-sm">{descError}</AlertDescription>
                </Alert>
              )}

              {/* Description or fallback */}
              {!descLoading && !descError && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {descText || "No known visual gender differences."}
                </p>
              )}

              {/* Attribution */}
              {!descLoading && (
                <div className="mt-3 text-xs text-muted-foreground flex items-center gap-2">
                  <span>Descriptions sourced from Bulbapedia</span>
                  {descSource && (
                    <a
                      href={descSource}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline hover:text-foreground"
                    >
                      Source <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}