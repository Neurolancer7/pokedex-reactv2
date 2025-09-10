import { motion } from "framer-motion";
import { ArrowRight, Search, Heart, Zap, Shield, Star, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "react-router";
import { useQuery as useConvexQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PokemonGrid } from "@/components/PokemonGrid";
import type { Pokemon } from "@/lib/pokemon-api";
import { useEffect, useState } from "react";

const LANDING_FEATURES = [
  {
    icon: Search,
    title: "Advanced Search",
    description: "Find Pokémon by name, type, generation, or stats with powerful filtering options.",
  },
  {
    icon: Heart,
    title: "Personal Favorites",
    description: "Save your favorite Pokémon and build your dream team collection.",
  },
  {
    icon: Zap,
    title: "Detailed Stats",
    description: "View comprehensive stats, abilities, moves, and evolution chains.",
  },
  {
    icon: Shield,
    title: "Type Effectiveness",
    description: "Learn about type matchups and strategic battle advantages.",
  },
];

const LANDING_SAMPLE_POKEMON = [
  { id: 1, name: "Bulbasaur", types: ["grass", "poison"], image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/1.png" },
  { id: 4, name: "Charmander", types: ["fire"], image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/4.png" },
  { id: 7, name: "Squirtle", types: ["water"], image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/7.png" },
  { id: 25, name: "Pikachu", types: ["electric"], image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png" },
];

const LANDING_TYPE_COLORS: Record<string, string> = {
  grass: "#78C850",
  poison: "#A040A0",
  fire: "#F08030",
  water: "#6890F0",
  electric: "#F8D030",
};

export default function Landing() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("theme");
      if (saved) return saved === "dark";
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [isDark]);

  const pokemonData = useConvexQuery(api.pokemon.list, {
    limit: 20,
    offset: 0,
  });

  // Normalize results to full Pokemon objects for the grid
  const normalizedLandingPokemon: Pokemon[] = (pokemonData?.pokemon ?? []).map((p: any) => ({
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Header */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="container mx-auto px-4 py-6"
      >
        <div className="flex items-center justify-between">
          <motion.div
            whileHover={{ scale: 1.05 }}
            className="flex items-center gap-3"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center overflow-hidden">
              <img
                src="https://harmless-tapir-303.convex.cloud/api/storage/dfdec238-dbb0-44cd-9147-50ae677b8144"
                alt="Pokédex logo"
                className="w-8 h-8 object-contain"
                loading="eager"
                decoding="async"
                fetchPriority="high"
                width={32}
                height={32}
              />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Pokédex</h1>
              <p className="text-xs text-muted-foreground">Gotta catch 'em all!</p>
            </div>
          </motion.div>

          <div className="flex items-center gap-4">
            {/* Dark mode toggle on right side of nav */}
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={() => setIsDark((d) => !d)}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>

            {isAuthenticated ? (
              <Button onClick={() => navigate("/pokedex")} className="gap-2 w-full sm:w-auto">
                Open Pokédex
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <div className="flex items-center gap-3 sm:gap-4 flex-col sm:flex-row w-full sm:w-auto">
                <Button variant="ghost" onClick={() => navigate("/auth")} className="w-full sm:w-auto">
                  Sign In
                </Button>
                <Button onClick={() => navigate("/pokedex")} className="gap-2 w-full sm:w-auto">
                  Explore
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </motion.header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-12 md:py-20">
        <div className="text-center max-w-4xl mx-auto">
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            <Badge variant="secondary" className="mb-6 px-4 py-2">
              ✨ Powered by PokéAPI
            </Badge>
          </motion.div>

          <motion.h1
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-4xl md:text-7xl font-bold tracking-tight mb-6 bg-gradient-to-r from-blue-600 via-purple-600 to-blue-800 bg-clip-text text-transparent"
          >
            The Ultimate
            <br />
            Pokédex Experience
          </motion.h1>

          <motion.p
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed"
          >
            Discover, explore, and learn about all your favorite Pokémon with our comprehensive, 
            modern Pokédex featuring detailed stats, beautiful artwork, and powerful search capabilities.
          </motion.p>

          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center mb-12 md:mb-16"
          >
            <Button
              size="lg"
              onClick={() => navigate("/pokedex")}
              className="gap-2 px-8 py-6 text-lg w-full sm:w-auto"
            >
              Start Exploring
              <ArrowRight className="h-5 w-5" />
            </Button>
            {!isAuthenticated && (
              <Button
                variant="outline"
                size="lg"
                onClick={() => navigate("/auth")}
                className="px-8 py-6 text-lg w-full sm:w-auto"
              >
                Sign Up Free
              </Button>
            )}
          </motion.div>

          {/* Sample Pokemon Cards */}
          <motion.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto"
          >
            {LANDING_SAMPLE_POKEMON.map((pokemon, index) => (
              <motion.div
                key={pokemon.id}
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.6 + index * 0.1 }}
                whileHover={{ y: -8, scale: 1.05 }}
                className="cursor-pointer"
              >
                <Card className="overflow-hidden border-2 hover:border-primary/50 transition-all duration-300">
                  <CardContent className="p-4 sm:p-4">
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-3 bg-gradient-to-br from-muted/50 to-muted rounded-full flex items-center justify-center">
                        <img
                          src={pokemon.image}
                          alt={pokemon.name}
                          className="w-12 h-12 object-contain"
                        />
                      </div>
                      <h3 className="font-semibold mb-2">{pokemon.name}</h3>
                      <div className="flex gap-1 justify-center">
                        {pokemon.types.map((type) => (
                          <Badge
                            key={type}
                            variant="secondary"
                            className="text-xs"
                            style={{
                              backgroundColor: LANDING_TYPE_COLORS[type] + "20",
                              color: LANDING_TYPE_COLORS[type],
                            }}
                          >
                            {type}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Explore Section with paginated grid */}
      <section className="container mx-auto px-4 py-12 md:py-16">
        <div className="mb-6 md:mb-8 text-center">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Explore Pokémon</h2>
        </div>

        <PokemonGrid
          pokemon={normalizedLandingPokemon}
          favorites={[]} // favorites not shown on landing
          isLoading={pokemonData === undefined}
        />
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-14 md:py-20">
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Everything You Need to Know
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Our Pokédex provides comprehensive information about every Pokémon, 
            from basic stats to detailed battle strategies.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {LANDING_FEATURES.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ y: 30, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ y: -4 }}
            >
              <Card className="h-full border-2 hover:border-primary/50 transition-all duration-300">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-14 md:py-20">
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true }}
          className="text-center bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-blue-500/10 rounded-2xl p-8 md:p-12"
        >
          <div className="flex justify-center mb-6">
            <div className="flex -space-x-2">
              {LANDING_SAMPLE_POKEMON.slice(0, 3).map((pokemon) => (
                <div
                  key={pokemon.id}
                  className="w-12 h-12 bg-white rounded-full border-2 border-background flex items-center justify-center"
                >
                  <img
                    src={pokemon.image}
                    alt={pokemon.name}
                    className="w-8 h-8 object-contain"
                  />
                </div>
              ))}
            </div>
          </div>
          
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Ready to Start Your Journey?
          </h2>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join thousands of trainers exploring the world of Pokémon. 
            Create your account to save favorites and track your progress.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              onClick={() => navigate("/pokedex")}
              className="gap-2 px-8 py-6 text-lg w-full sm:w-auto"
            >
              <Star className="h-5 w-5" />
              Explore Pokédex
            </Button>
            {!isAuthenticated && (
              <Button
                variant="outline"
                size="lg"
                onClick={() => navigate("/auth")}
                className="px-8 py-6 text-lg w-full sm:w-auto"
              >
                Create Account
              </Button>
            )}
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 border-t">
        <div className="text-center text-muted-foreground">
          <p className="mb-2">
            Built with ❤️ using{" "}
            <a
              href="https://pokeapi.co"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-primary transition-colors"
            >
              PokéAPI
            </a>
          </p>
          <p className="text-sm">
            Pokémon and Pokémon character names are trademarks of Nintendo.
          </p>
        </div>
      </footer>
    </div>
  );
}