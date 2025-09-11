import { motion } from "framer-motion";
import { Heart, Star } from "lucide-react";
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
                <Badge className="rounded-full bg-purple-600/90 text-white border-purple-500/80 px-2 py-0.5 text-[10px] shadow">
                  G-MAX
                </Badge>
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