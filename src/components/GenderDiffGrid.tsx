import { useMemo, useState } from "react";
import { genderDiffSpecies } from "@/lib/genderDiffSpecies";
import { useGenderDiffPokemon, spriteFromDexId } from "@/lib/useGenderDiffPokemon";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RotateCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Props = {
  species?: string[];
};

export function GenderDiffGrid({ species }: Props) {
  const names = useMemo(() => (species && species.length > 0 ? species : genderDiffSpecies), [species]);
  const { data, isLoading, error, refetch } = useGenderDiffPokemon(names);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{ name: string; dexId: number } | null>(null);
  const [gender, setGender] = useState<"male" | "female">("male");
  const [imgKey, setImgKey] = useState(0); // forces img reload on toggle

  const bulbapediaUrl = (name: string) => {
    const anchor = name.replace(/-/g, "_"); // closer to Bulbapedia's section ids
    return `https://bulbapedia.bulbagarden.net/wiki/List_of_Pok%C3%A9mon_with_gender_differences#${encodeURIComponent(anchor)}`;
  };

  const genderSpriteUrl = (dexId: number, g: "male" | "female") => {
    if (g === "female") {
      return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/female/${dexId}.png`;
    }
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dexId}.png`;
  };

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
      {Array.isArray(data) && data.length > 0 && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {data.map((p) => (
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
                  <Badge variant="secondary">Gender Diff</Badge>
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
      )}

      {/* Simplified Gender Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl p-0">
          <div className="p-6">
            <DialogHeader className="mb-4">
              <DialogTitle className="text-xl font-bold capitalize">
                {selected?.name?.replace("-", " ")}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Quick view to compare male/female appearances
              </DialogDescription>
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

            {/* Differences section with Bulbapedia link */}
            <div className="mt-5 p-4 bg-muted/30 rounded-lg">
              <h4 className="font-semibold mb-2">Differences</h4>
              <p className="text-sm text-muted-foreground">
                This species exhibits gender-based visual differences. For a detailed description, visit the Bulbapedia entry.
              </p>
              {selected && (
                <div className="mt-3">
                  <Button asChild size="sm" variant="outline" className="gap-2">
                    <a
                      href={bulbapediaUrl(selected.name)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open Bulbapedia gender differences description"
                    >
                      View details on Bulbapedia
                    </a>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}