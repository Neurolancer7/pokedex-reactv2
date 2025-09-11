import { motion, AnimatePresence } from "framer-motion";
import { X, Heart, Ruler, Weight, Zap, Shield, Sword, Activity } from "lucide-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatPokemonId, formatPokemonName, getTypeColor, calculateStatPercentage } from "@/lib/pokemon-api";
import type { Pokemon } from "@/lib/pokemon-api";
import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface PokemonDetailModalProps {
  pokemon: Pokemon | null;
  isOpen: boolean;
  onClose: () => void;
  isFavorite?: boolean;
  onFavoriteToggle?: (pokemonId: number) => void;
  onNavigate?: (direction: "prev" | "next") => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export function PokemonDetailModal({
  pokemon,
  isOpen,
  onClose,
  isFavorite = false,
  onFavoriteToggle,
  onNavigate,
  hasPrev,
  hasNext,
}: PokemonDetailModalProps) {
  if (!pokemon) return null;

  const [enhanced, setEnhanced] = useState<Pokemon | null>(null);
  const [showShiny, setShowShiny] = useState(false);

  useEffect(() => {
    let mounted = true;
    setEnhanced(null);
    setShowShiny(false);

    const needsDetails =
      !pokemon.stats?.length ||
      !pokemon.abilities?.length ||
      !pokemon.sprites?.officialArtwork ||
      !pokemon.species?.flavorText;

    if (!needsDetails) return;

    const nameOrId = String(pokemon.name || pokemon.pokemonId);

    const fetchJson = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed ${res.status} ${url}`);
      return res.json();
    };

    const normalize = (base: Pokemon, detail: any, species: any): Pokemon => {
      const types: string[] = Array.isArray(detail?.types)
        ? detail.types.map((t: any) => String(t?.type?.name ?? "")).filter(Boolean)
        : base.types ?? [];

      const abilities: Array<{ name: string; isHidden: boolean }> = Array.isArray(detail?.abilities)
        ? detail.abilities.map((a: any) => ({
            name: String(a?.ability?.name ?? ""),
            isHidden: Boolean(a?.is_hidden),
          })).filter((a: any) => a.name)
        : Array.isArray(base.abilities)
          ? base.abilities.map((a: any) =>
              typeof a === "string" ? { name: a, isHidden: false } : { name: String(a?.name ?? ""), isHidden: Boolean(a?.isHidden) }
            ).filter((a: any) => a.name)
          : [];

      const stats: Array<{ name: string; baseStat: number; effort: number }> = Array.isArray(detail?.stats)
        ? detail.stats.map((s: any) => ({
            name: String(s?.stat?.name ?? ""),
            baseStat: Number(s?.base_stat ?? 0),
            effort: Number(s?.effort ?? 0),
          })).filter((s: any) => s.name)
        : Array.isArray(base.stats)
          ? base.stats.map((s: any) => ({
              name: String(s?.name ?? ""),
              baseStat: Number(s?.baseStat ?? s?.value ?? 0),
              effort: Number(s?.effort ?? 0),
            })).filter((s: any) => s.name)
          : [];

      const sprites = {
        frontDefault: detail?.sprites?.front_default ?? base.sprites?.frontDefault,
        frontShiny: detail?.sprites?.front_shiny ?? base.sprites?.frontShiny,
        officialArtwork: detail?.sprites?.other?.["official-artwork"]?.front_default ?? base.sprites?.officialArtwork,
      };

      // Species normalization
      const pickEnglishFlavor = () => {
        const entries = Array.isArray(species?.flavor_text_entries) ? species.flavor_text_entries : [];
        const en = entries.find((e: any) => e?.language?.name === "en");
        const text = String(en?.flavor_text ?? "").replace(/\f/g, " ").replace(/\n/g, " ").trim();
        return text || base.species?.flavorText;
      };

      const speciesOut = {
        flavorText: pickEnglishFlavor(),
        genus: (() => {
          const g = Array.isArray(species?.genera)
            ? species.genera.find((x: any) => x?.language?.name === "en")?.genus
            : undefined;
          return g ?? base.species?.genus;
        })(),
        captureRate: typeof species?.capture_rate === "number" ? species.capture_rate : base.species?.captureRate,
        baseHappiness: typeof species?.base_happiness === "number" ? species.base_happiness : base.species?.baseHappiness,
        growthRate: String(species?.growth_rate?.name ?? base.species?.growthRate ?? ""),
        habitat: String(species?.habitat?.name ?? base.species?.habitat ?? ""),
        evolutionChainId: (() => {
          const url: string | undefined = species?.evolution_chain?.url;
          if (!url) return base.species?.evolutionChainId;
          const m = url.match(/\/(\d+)\/?$/);
          return m ? Number(m[1]) : base.species?.evolutionChainId;
        })(),
      };

      return {
        ...base,
        baseExperience: typeof detail?.base_experience === "number" ? detail.base_experience : base.baseExperience,
        height: typeof detail?.height === "number" ? detail.height : base.height,
        weight: typeof detail?.weight === "number" ? detail.weight : base.weight,
        types,
        abilities,
        stats,
        sprites,
        species: speciesOut,
      };
    };

    (async () => {
      try {
        const [detail, species] = await Promise.all([
          fetchJson(`https://pokeapi.co/api/v2/pokemon/${nameOrId}`),
          fetchJson(`https://pokeapi.co/api/v2/pokemon-species/${nameOrId}`),
        ]);
        if (!mounted) return;
        setEnhanced(normalize(pokemon, detail, species));
      } catch {
        // Best-effort enhancement; ignore errors and keep base
      }
    })();

    return () => {
      mounted = false;
    };
  }, [pokemon]);

  const handleFavoriteClick = () => {
    onFavoriteToggle?.(pokemon.pokemonId);
  };

  const statIcons = {
    hp: Activity,
    attack: Sword,
    defense: Shield,
    "special-attack": Zap,
    "special-defense": Shield,
    speed: Activity,
  };

  const data = enhanced ?? pokemon;
  const heightM = Number.isFinite(data?.height) ? (data!.height / 10).toFixed(1) : "–";
  const weightKg = Number.isFinite(data?.weight) ? (data!.weight / 10).toFixed(1) : "–";
  const spriteDefault = data?.sprites?.officialArtwork || data?.sprites?.frontDefault;
  const spriteShiny = data?.sprites?.frontShiny || undefined;
  const currentSprite = showShiny && spriteShiny ? spriteShiny : spriteDefault;

  const typesSafe: string[] = Array.isArray(data?.types) ? data!.types : [];
  const statsSafe: Array<{ name: string; baseStat: number; effort: number }> =
    Array.isArray((data as any)?.stats)
      ? (data as any).stats.map((s: any) => ({
          name: String(s?.name ?? s?.stat?.name ?? ""),
          baseStat: Number(s?.baseStat ?? s?.value ?? 0),
          effort: Number(s?.effort ?? 0),
        })).filter((s: any) => s.name)
      : [];
  const abilitiesSafe: Array<{ name: string; isHidden: boolean }> =
    Array.isArray((data as any)?.abilities)
      ? (data as any).abilities.map((a: any) =>
          typeof a === "string"
            ? { name: a, isHidden: false }
            : { name: String(a?.name ?? a?.ability?.name ?? ""), isHidden: Boolean(a?.isHidden ?? a?.is_hidden) }
        ).filter((a: any) => a.name)
      : [];
  const movesSafe: string[] = Array.isArray(data?.moves)
    ? data!.moves.map((m: any) => (typeof m === "string" ? m : String(m?.move?.name ?? ""))).filter(Boolean)
    : [];
  const statTotal = statsSafe.reduce((sum, s) => sum + (Number.isFinite(s.baseStat) ? s.baseStat : 0), 0);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h[90vh] p-0">
        <ScrollArea className="max-h-[90vh]">
          <div className="p-6">
            {/* Header */}
            <DialogHeader className="flex flex-row items-center justify-between space-y-0 mb-6">
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-muted-foreground">
                  #{formatPokemonId(pokemon.pokemonId)}
                </span>
                <DialogTitle className="text-2xl font-bold tracking-tight">
                  {formatPokemonName(pokemon.name)}
                </DialogTitle>
              </div>
              <div className="flex items-center gap-2">
                {typeof onNavigate === "function" && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onNavigate("prev")}
                      disabled={!hasPrev}
                      aria-label="Previous Pokémon"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onNavigate("next")}
                      disabled={!hasNext}
                      aria-label="Next Pokémon"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </>
                )}
                {onFavoriteToggle && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleFavoriteClick}
                  >
                    <Heart 
                      className={`h-5 w-5 ${isFavorite ? 'fill-red-500 text-red-500' : 'text-muted-foreground'}`} 
                    />
                  </Button>
                )}
              </div>
            </DialogHeader>

            {/* Main Content */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Left Column - Image and Basic Info */}
              <div className="space-y-4">
                {/* Pokemon Image with Shiny toggle */}
                <div className="relative">
                  <div className="w-full aspect-square bg-gradient-to-br from-muted/50 to-muted rounded-lg flex items-center justify-center">
                    {currentSprite ? (
                      <motion.img
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 200 }}
                        src={currentSprite}
                        alt={pokemon.name}
                        className="w-4/5 h-4/5 object-contain"
                      />
                    ) : (
                      <div className="text-6xl">❓</div>
                    )}
                  </div>

                  {/* Shiny toggle control (only shown if shiny exists) */}
                  {spriteShiny && (
                    <div className="mt-3 flex items-center justify-center gap-2">
                      <Button
                        variant={showShiny ? "default" : "outline"}
                        size="sm"
                        onClick={() => setShowShiny((s) => !s)}
                        aria-pressed={showShiny}
                      >
                        {showShiny ? "Showing Shiny" : "Show Shiny"}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Types */}
                <div className="flex gap-2 justify-center">
                  {typesSafe.map((type) => (
                    <Badge
                      key={type}
                      variant="secondary"
                      className="px-3 py-1 font-medium"
                      style={{
                        backgroundColor: getTypeColor(type) + "20",
                        color: getTypeColor(type),
                        borderColor: getTypeColor(type) + "40",
                      }}
                    >
                      {formatPokemonName(type)}
                    </Badge>
                  ))}
                </div>

                {/* Physical Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <Ruler className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                    <div className="text-sm text-muted-foreground">Height</div>
                    <div className="font-semibold">{heightM}m</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <Weight className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                    <div className="text-sm text-muted-foreground">Weight</div>
                    <div className="font-semibold">{weightKg}kg</div>
                  </div>
                </div>

                {/* Description */}
                {(data?.species?.flavorText) && (
                  <div className="p-4 bg-muted/30 rounded-lg">
                    <h4 className="font-semibold mb-2">Description</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {data.species.flavorText}
                    </p>
                  </div>
                )}
              </div>

              {/* Right Column - Stats and Details */}
              <div className="space-y-6">
                {/* Base Stats with total */}
                <div>
                  <h4 className="font-semibold mb-4 flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Base Stats
                    {statTotal > 0 && (
                      <span className="ml-auto text-sm text-muted-foreground">
                        Total: <span className="font-semibold text-foreground">{statTotal}</span>
                      </span>
                    )}
                  </h4>
                  <div className="space-y-3">
                    {statsSafe.map((stat) => {
                      const name = String(stat?.name ?? "stat");
                      const IconComponent = ((): any => {
                        switch (name) {
                          case "hp": return Activity;
                          case "attack": return Sword;
                          case "defense": return Shield;
                          case "special-attack": return Zap;
                          case "special-defense": return Shield;
                          case "speed": return Activity;
                          default: return Activity;
                        }
                      })();
                      const base = Number(stat?.baseStat ?? 0);
                      const percentage = calculateStatPercentage(base);

                      return (
                        <div key={name} className="space-y-1">
                          <div className="flex justify-between items-center text-sm">
                            <div className="flex items-center gap-2">
                              <IconComponent className="h-3 w-3 text-muted-foreground" />
                              <span className="capitalize font-medium">
                                {name.replace("-", " ")}
                              </span>
                            </div>
                            <span className="font-mono font-semibold">{base}</span>
                          </div>
                          <Progress value={percentage} className="h-2" />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <Separator />

                {/* Abilities */}
                <div>
                  <h4 className="font-semibold mb-3">Abilities</h4>
                  <div className="space-y-2">
                    {abilitiesSafe.map((ability, index) => (
                      <div
                        key={`${ability.name}-${index}`}
                        className="flex items-center justify-between p-2 bg-muted/30 rounded"
                      >
                        <span className="capitalize font-medium">
                          {String(ability.name).replace("-", " ")}
                        </span>
                        {ability.isHidden && (
                          <Badge variant="outline" className="text-xs">
                            Hidden
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Additional Info */}
                {(data?.species) && (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {data.species.genus && (
                      <div>
                        <div className="text-muted-foreground">Species</div>
                        <div className="font-medium">{data.species.genus}</div>
                      </div>
                    )}
                    {data.species.habitat && (
                      <div>
                        <div className="text-muted-foreground">Habitat</div>
                        <div className="font-medium capitalize">{data.species.habitat}</div>
                      </div>
                    )}
                    {typeof data.species.captureRate === "number" && (
                      <div>
                        <div className="text-muted-foreground">Capture Rate</div>
                        <div className="font-medium">{data.species.captureRate}</div>
                      </div>
                    )}
                    {(typeof data.baseExperience === "number") && (
                      <div>
                        <div className="text-muted-foreground">Base EXP</div>
                        <div className="font-medium">{data.baseExperience}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Moves (collapsible) */}
                {movesSafe.length > 0 && (
                  <div>
                    <Collapsible>
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold">Moves</h4>
                        <CollapsibleTrigger asChild>
                          <Button variant="outline" size="sm">
                            Show ({movesSafe.length})
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                      <CollapsibleContent className="mt-3">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {movesSafe
                            .slice(0, 18)
                            .sort((a, b) => a.localeCompare(b))
                            .map((m, i) => (
                              <Badge key={`${m}-${i}`} variant="secondary" className="justify-start">
                                {String(m).replace("-", " ")}
                              </Badge>
                            ))}
                        </div>
                        {movesSafe.length > 18 && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            +{movesSafe.length - 18} more
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}