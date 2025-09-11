import { motion } from "framer-motion";
import { Heart, Star, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPokemonId, formatPokemonName, getTypeColor } from "@/lib/pokemon-api";
import type { Pokemon } from "@/lib/pokemon-api";

interface PokemonCardProps {
  pokemon: Pokemon;
  isFavorite?: boolean;
  onFavoriteToggle?: (pokemonId: number) => void;
  onClick?: (pokemon: Pokemon) => void;
}

export function PokemonCard({ 
  pokemon, 
  isFavorite = false, 
  onFavoriteToggle, 
  onClick 
}: PokemonCardProps) {
  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFavoriteToggle?.(pokemon.pokemonId);
  };

  const isGmax = (() => {
    const n = pokemon.name.toLowerCase();
    return n.includes("gmax") || n.includes("gigantamax");
  })();

  const isMega = (() => {
    const n = pokemon.name.toLowerCase();
    return n.includes("mega");
  })();

  const gmaxMove = (() => {
    if (!isGmax) return undefined;
    const lower = pokemon.name.toLowerCase();
    let base = lower;
    if (lower.endsWith("-gmax")) base = lower.slice(0, -5);
    else if (lower.endsWith("-gigantamax")) base = lower.slice(0, -"gigantamax".length - 1);
    // Mapping from base species name to the official G-Max move
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

  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      <Card 
        className="cursor-pointer overflow-hidden border-2 hover:border-primary/50 transition-colors group"
        onClick={() => onClick?.(pokemon)}
      >
        <CardContent className="p-4">
          {/* Header with ID and Favorite */}
          <div className="flex justify-between items-start mb-3">
            <span className="text-sm font-mono text-muted-foreground">
              #{formatPokemonId(pokemon.pokemonId)}
            </span>
            {onFavoriteToggle && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={handleFavoriteClick}
              >
                <Heart 
                  className={`h-4 w-4 ${isFavorite ? 'fill-red-500 text-red-500' : 'text-muted-foreground'}`} 
                />
              </Button>
            )}
          </div>

          {/* Pokemon Image */}
          <div className="relative mb-4 flex justify-center">
            {isGmax && (
              <div className="absolute -top-1 -left-1">
                <span
                  title="Gigantamax"
                  aria-label="Gigantamax form"
                  className="inline-flex items-center justify-center rounded-full bg-background border shadow p-1.5 ring-2 ring-pink-500/40"
                >
                  <img
                    src="https://harmless-tapir-303.convex.cloud/api/storage/63c94427-b9f7-4312-b254-b148bf2b227e"
                    alt="Gigantamax"
                    className="h-6 w-6 object-contain drop-shadow"
                  />
                </span>
              </div>
            )}
            {isMega && (
              <div className="absolute -top-1 -right-1">
                <span
                  title="Mega Evolution"
                  aria-label="Mega Evolution"
                  className="inline-flex items-center justify-center rounded-full bg-background border shadow p-0.5 ring-2 ring-fuchsia-500/40"
                >
                  <img
                    src="https://harmless-tapir-303.convex.cloud/api/storage/5bccd8f0-8ff6-48ea-9149-b26759dfe4d5"
                    alt="Mega Evolution"
                    className="h-7 w-7 object-contain drop-shadow"
                  />
                </span>
              </div>
            )}
            <div className="w-24 h-24 flex items-center justify-center bg-gradient-to-br from-muted/50 to-muted rounded-full">
              {pokemon.sprites.officialArtwork || pokemon.sprites.frontDefault ? (
                <img
                  src={pokemon.sprites.officialArtwork || pokemon.sprites.frontDefault}
                  alt={pokemon.name}
                  className="w-20 h-20 object-contain"
                  loading="lazy"
                />
              ) : (
                <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center">
                  <Star className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
            </div>
          </div>

          {/* Pokemon Name */}
          <h3 className="font-bold text-lg text-center mb-3 tracking-tight">
            {formatPokemonName(pokemon.name)}
          </h3>

          {/* Type Badges */}
          <div className="flex gap-1 justify-center flex-wrap">
            {pokemon.types.map((type) => (
              <Badge
                key={type}
                variant="secondary"
                className="text-xs font-medium px-2 py-1"
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

          {/* G-Max Move (only for Gigantamax forms) */}
          {isGmax && gmaxMove && (
            <div className="mt-3 text-center">
              <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium bg-accent/30">
                G-MAX Move: <span className="ml-1 text-foreground">{gmaxMove}</span>
              </span>
            </div>
          )}

          {/* Quick Stats */}
          <div className="mt-3 pt-3 border-t border-border/50">
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div className="text-center">
                <div className="font-medium">Height</div>
                <div>{(pokemon.height / 10).toFixed(1)}m</div>
              </div>
              <div className="text-center">
                <div className="font-medium">Weight</div>
                <div>{(pokemon.weight / 10).toFixed(1)}kg</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}