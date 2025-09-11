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

  const isGmax = (() => {
    const n = String(data?.name ?? "").toLowerCase();
    return n.includes("gmax") || n.includes("gigantamax");
  })();

  const isMega = (() => {
    const n = String(data?.name ?? "").toLowerCase();
    return n.includes("mega");
  })();

  const gmaxMove: string | undefined = (() => {
    if (!isGmax) return undefined;
    const lower = String(data?.name ?? "").toLowerCase();
    let base = lower;
    if (lower.endsWith("-gmax")) base = lower.slice(0, -5);
    else if (lower.endsWith("-gigantamax")) base = lower.slice(0, -"gigantamax".length - 1);
    const MOVES: Record<string, string> = {
      venusaur: "G-Max Vine Lash",
      charizard: "G-Max Wildfire",
      blastoise: "G-Max Cannonade",
      butterfree: "G-Max Befuddle",
      pikachu: "G-Max Volt Crash",
      meowth: "G-Max Gold Rush",
      machamp: "G-Max Chi Strike",
      gengar: "G-Max Terror",
      kingler: "G-Max Foam Burst",
      lapras: "G-Max Resonance",
      eevee: "G-Max Cuddle",
      snorlax: "G-Max Replenish",
      garbodor: "G-Max Malodor",
      melmetal: "G-Max Meltdown",
      rillaboom: "G-Max Drum Solo",
      cinderace: "G-Max Fireball",
      inteleon: "G-Max Hydrosnipe",
      corviknight: "G-Max Wind Rage",
      orbeetle: "G-Max Gravitas",
      drednaw: "G-Max Stonesurge",
      coalossal: "G-Max Volcalith",
      flapple: "G-Max Tartness",
      appletun: "G-Max Sweetness",
      sandaconda: "G-Max Sandblast",
      toxtricity: "G-Max Stun Shock",
      centiskorch: "G-Max Centiferno",
      hatterene: "G-Max Smite",
      grimmsnarl: "G-Max Snooze",
      alcremie: "G-Max Finale",
      copperajah: "G-Max Steelsurge",
      duraludon: "G-Max Depletion",
    };
    return MOVES[base];
  })();

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
                <DialogTitle className="text-2xl font-bold tracking-tight flex items-center gap-2">
                  {formatPokemonName(pokemon.name)}
                  {isMega && (
                    <img
                      src="https://harmless-tapir-303.convex.cloud/api/storage/c454d9d0-824d-44a7-9f06-da70175922e2"
                      alt="Mega Evolution"
                      title="Mega Evolution"
                      className="h-5 w-5 rounded-sm shadow"
                    />
                  )}
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
                  <div
                    className={`w-full aspect-square rounded-lg flex items-center justify-center
                      ${isGmax
                        ? "bg-gradient-to-br from-purple-600/15 via-fuchsia-500/10 to-purple-700/15 ring-2 ring-purple-500/30 shadow-lg shadow-purple-500/20"
                        : "bg-gradient-to-br from-muted/50 to-muted"}
                    `}
                  >
                    {currentSprite ? (
                      <motion.img
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 220, damping: 20 }}
                        src={currentSprite}
                        alt={pokemon.name}
                        className={`w-4/5 h-4/5 object-contain ${isGmax ? "drop-shadow-[0_8px_24px_rgba(168,85,247,0.35)]" : ""}`}
                      />
                    ) : (
                      <div className="text-6xl">❓</div>
                    )}
                  </div>

                  {/* G-MAX badge */}
                  {isGmax && (
                    <div className="absolute -top-2 -left-2">
                      <img
                        src="https://harmless-tapir-303.convex.cloud/api/storage/63c94427-b9f7-4312-b254-b148bf2b227e"
                        alt="Gigantamax"
                        title="Gigantamax"
                        className="h-6 w-6 drop-shadow"
                      />
                    </div>
                  )}

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

                {/* G-Max Move chip under image */}
                {isGmax && gmaxMove && (
                  <div className="mt-2 text-center">
                    <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium bg-purple-500/10 text-foreground border-purple-500/30">
                      G-MAX Move: <span className="ml-1 font-semibold">{gmaxMove}</span>
                    </span>
                  </div>
                )}

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
                    {isGmax && (
                      <div>
                        <div className="text-muted-foreground">Form</div>
                        <div className="font-medium">Gigantamax</div>
                      </div>
                    )}
                    {isGmax && gmaxMove && (
                      <div>
                        <div className="text-muted-foreground">G-MAX Move</div>
                        <div className="font-medium">{gmaxMove}</div>
                      </div>
                    )}
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
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}