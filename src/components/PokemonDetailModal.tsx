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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0">
        <DialogDescription className="sr-only">
          Detailed information about {formatPokemonName(pokemon.name)}
        </DialogDescription>
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
                {/* Pokemon Image */}
                <div className="relative">
                  <div className="w-full aspect-square bg-gradient-to-br from-muted/50 to-muted rounded-lg flex items-center justify-center">
                    {pokemon.sprites.officialArtwork || pokemon.sprites.frontDefault ? (
                      <motion.img
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 200 }}
                        src={pokemon.sprites.officialArtwork || pokemon.sprites.frontDefault}
                        alt={pokemon.name}
                        className="w-4/5 h-4/5 object-contain"
                      />
                    ) : (
                      <div className="text-6xl">❓</div>
                    )}
                  </div>
                </div>

                {/* Types */}
                <div className="flex gap-2 justify-center">
                  {(pokemon.types ?? []).map((type) => (
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
                    <div className="font-semibold">{(pokemon.height / 10).toFixed(1)}m</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <Weight className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                    <div className="text-sm text-muted-foreground">Weight</div>
                    <div className="font-semibold">{(pokemon.weight / 10).toFixed(1)}kg</div>
                  </div>
                </div>

                {/* Description */}
                {pokemon.species?.flavorText && (
                  <div className="p-4 bg-muted/30 rounded-lg">
                    <h4 className="font-semibold mb-2">Description</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {pokemon.species.flavorText}
                    </p>
                  </div>
                )}
              </div>

              {/* Right Column - Stats and Details */}
              <div className="space-y-6">
                {/* Base Stats */}
                <div>
                  <h4 className="font-semibold mb-4 flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Base Stats
                  </h4>
                  <div className="space-y-3">
                    {(pokemon.stats ?? []).map((stat) => {
                      const s: any = stat as any;
                      const IconComponent = statIcons[(s?.name as keyof typeof statIcons) ?? "hp"] || Activity;
                      const base = Number(s?.baseStat ?? s?.value ?? 0);
                      const name = String(s?.name ?? "stat");
                      const percentage = calculateStatPercentage(base);

                      return (
                        <div key={name} className="space-y-1">
                          <div className="flex justify-between items-center text-sm">
                            <div className="flex items-center gap-2">
                              <IconComponent className="h-3 w-3 text-muted-foreground" />
                              <span className="capitalize font-medium">
                                {name.replace('-', ' ')}
                              </span>
                            </div>
                            <span className="font-mono font-semibold">
                              {base}
                            </span>
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
                    {(pokemon.abilities ?? []).map((ability, index) => {
                      const a: any = ability as any;
                      const name = typeof a === "string" ? a : String(a?.name ?? "");
                      const isHidden = typeof a === "object" ? Boolean(a?.isHidden) : false;

                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between p-2 bg-muted/30 rounded"
                        >
                          <span className="capitalize font-medium">
                            {name.replace('-', ' ')}
                          </span>
                          {isHidden && (
                            <Badge variant="outline" className="text-xs">
                              Hidden
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Additional Info */}
                {pokemon.species && (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {pokemon.species.genus && (
                      <div>
                        <div className="text-muted-foreground">Species</div>
                        <div className="font-medium">{pokemon.species.genus}</div>
                      </div>
                    )}
                    {pokemon.species.habitat && (
                      <div>
                        <div className="text-muted-foreground">Habitat</div>
                        <div className="font-medium capitalize">{pokemon.species.habitat}</div>
                      </div>
                    )}
                    {pokemon.species.captureRate !== undefined && (
                      <div>
                        <div className="text-muted-foreground">Capture Rate</div>
                        <div className="font-medium">{pokemon.species.captureRate}</div>
                      </div>
                    )}
                    {pokemon.baseExperience && (
                      <div>
                        <div className="text-muted-foreground">Base EXP</div>
                        <div className="font-medium">{pokemon.baseExperience}</div>
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