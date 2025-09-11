// Client-side Pokemon API utilities
export interface Pokemon {
  pokemonId: number;
  name: string;
  height: number;
  weight: number;
  baseExperience?: number;
  types: string[];
  abilities: Array<{
    name: string;
    isHidden: boolean;
  }>;
  stats: Array<{
    name: string;
    baseStat: number;
    effort: number;
  }>;
  sprites: {
    frontDefault?: string;
    frontShiny?: string;
    officialArtwork?: string;
  };
  moves: string[];
  generation: number;
  species?: {
    flavorText?: string;
    genus?: string;
    captureRate?: number;
    baseHappiness?: number;
    growthRate?: string;
    habitat?: string;
    evolutionChainId?: number;
  };
}

export interface PokemonListResponse {
  pokemon: Pokemon[];
  total: number;
  hasMore: boolean;
}

export const POKEMON_GENERATIONS = [
  { id: 1, name: "Kanto", range: "1-151" },
  { id: 2, name: "Johto", range: "152-251" },
  { id: 3, name: "Hoenn", range: "252-386" },
  { id: 4, name: "Sinnoh", range: "387-493" },
  { id: 5, name: "Unova", range: "494-649" },
  { id: 6, name: "Kalos", range: "650-721" },
  { id: 7, name: "Alola", range: "722-809" },
  { id: 8, name: "Galar", range: "810-905" },
  // Add Paldea (Gen 9)
  { id: 9, name: "Paldea", range: "906-1025" },
];

export const POKEMON_TYPES = [
  "normal", "fire", "water", "electric", "grass", "ice",
  "fighting", "poison", "ground", "flying", "psychic", "bug",
  "rock", "ghost", "dragon", "dark", "steel", "fairy"
];

export function formatPokemonId(id: number): string {
  return id.toString().padStart(3, '0');
}

export function formatPokemonName(name: string): string {
  // Special handling for Mega evolutions
  const lower = name.toLowerCase();

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  if (lower.endsWith("-mega-x")) {
    const base = name.slice(0, -7); // remove "-mega-x"
    return `Mega-${capitalize(base)} X`;
  }
  if (lower.endsWith("-mega-y")) {
    const base = name.slice(0, -7); // remove "-mega-y"
    return `Mega-${capitalize(base)} Y`;
  }
  if (lower.endsWith("-mega")) {
    const base = name.slice(0, -5); // remove "-mega"
    return `Mega-${capitalize(base)}`;
  }

  // Default: simple capitalize first letter
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    normal: "#A8A878",
    fire: "#F08030",
    water: "#6890F0",
    electric: "#F8D030",
    grass: "#78C850",
    ice: "#98D8D8",
    fighting: "#C03028",
    poison: "#A040A0",
    ground: "#E0C068",
    flying: "#A890F0",
    psychic: "#F85888",
    bug: "#A8B820",
    rock: "#B8A038",
    ghost: "#705898",
    dragon: "#7038F8",
    dark: "#705848",
    steel: "#B8B8D0",
    fairy: "#EE99AC",
  };
  return colors[type] || "#68A090";
}

export function calculateStatPercentage(stat: number): number {
  // Max base stat is around 255, so we'll use that as 100%
  return Math.min((stat / 255) * 100, 100);
}