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

  // Add: Gigantamax form names
  if (lower.endsWith("-gmax")) {
    const base = name.slice(0, -5); // remove "-gmax"
    return `Gigantamax ${capitalize(base)}`;
  }
  if (lower.endsWith("-gigantamax")) {
    const base = name.slice(0, -"gigantamax".length - 1); // remove "-gigantamax"
    return `Gigantamax ${capitalize(base)}`;
  }

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

// Add: helper to normalize names to PokeAPI slugs and handle edge cases
export function normalizePokemonName(name: string): string {
  const SPECIAL_CASES: Record<string, string> = {
    toxtricity: "toxtricity-amped",
    "mr. mime": "mr-mime",
    "mr mime": "mr-mime",
    "mr-mime": "mr-mime",
    "mime jr.": "mime-jr",
    "mime jr": "mime-jr",
    "type: null": "type-null",
    "type null": "type-null",
    "farfetch'd": "farfetchd",
    "farfetch’d": "farfetchd",
    "sirfetch'd": "sirfetchd",
    "sirfetch’d": "sirfetchd",
    "nidoran♀": "nidoran-f",
    "nidoran♀️": "nidoran-f",
    "nidoran♂": "nidoran-m",
    "nidoran♂️": "nidoran-m",
  };

  const raw = name.trim().toLowerCase();
  if (SPECIAL_CASES[raw]) return SPECIAL_CASES[raw];

  // Strip diacritics, remove punctuation, collapse whitespace to hyphens
  const withoutDiacritics = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = withoutDiacritics
    .replace(/[:.'’]/g, "") // remove punctuation commonly found in names
    .replace(/\s+/g, "-"); // spaces to hyphens

  return cleaned;
}

// Lightweight retry with exponential backoff
async function retryFetch(url: string, init: RequestInit | undefined, attempts = 3, baseDelayMs = 300): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(id);
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const delay = baseDelayMs * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed to fetch ${url}`);
}

// In-memory caches to avoid overfetching and to dedupe in-flight requests
const resolvedSlugCache: Map<string, string> = new Map();

type FetchPokemonResult = { ok: true; data: any } | { ok: false; status?: number; message?: string };
const pendingPokemonRequests: Map<string, Promise<FetchPokemonResult>> = new Map();

// Optional special slugs for species that require a specific default form
const SPECIAL_SLUG_MAP: Record<string, string> = {
  toxtricity: "toxtricity-amped",
};

/**
 * Fetch a Pokémon by base name with fallback:
 * 1) Try direct /pokemon/{candidateSlug}
 * 2) On 404, load /pokemon-species/{base} → find default variety → fetch that pokemon slug
 * Caches resolved slugs and dedupes in-flight requests.
 */
export async function fetchPokemonWithFallback(baseName: string): Promise<{ ok: true; data: any } | { ok: false; status?: number; message?: string }> {
  const base = normalizePokemonName(baseName);
  const candidate = SPECIAL_SLUG_MAP[base] || base;

  if (resolvedSlugCache.has(candidate)) {
    const slug = resolvedSlugCache.get(candidate)!;
    try {
      const res = await retryFetch(`https://pokeapi.co/api/v2/pokemon/${slug}`, undefined, 2, 300);
      if (!res.ok) return { ok: false, status: res.status, message: `HTTP ${res.status}` };
      const data = await res.json();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Network error" };
    }
  }

  if (pendingPokemonRequests.has(candidate)) {
    return pendingPokemonRequests.get(candidate)!;
  }

  const p: Promise<FetchPokemonResult> = (async () => {
    try {
      // Try direct slug first
      const direct = await retryFetch(`https://pokeapi.co/api/v2/pokemon/${candidate}`, undefined, 2, 300);
      if (direct.ok) {
        const data = await direct.json();
        resolvedSlugCache.set(candidate, data.name);
        return { ok: true, data } as const;
      }

      if (direct.status !== 404) {
        return { ok: false, status: direct.status, message: `HTTP ${direct.status}` } as const;
      }

      // Fallback via species varieties
      const speciesRes = await retryFetch(`https://pokeapi.co/api/v2/pokemon-species/${base}`, undefined, 2, 300);
      if (!speciesRes.ok) {
        return { ok: false, status: speciesRes.status, message: `Species HTTP ${speciesRes.status}` } as const;
      }
      const species = await speciesRes.json();
      const varieties: Array<{ is_default: boolean; pokemon: { name: string; url: string } }> = Array.isArray(species?.varieties) ? species.varieties : [];
      const def = varieties.find((v) => v.is_default) || varieties[0];
      if (!def) {
        return { ok: false, status: 404, message: "No varieties found" } as const;
      }
      const slug = def.pokemon.name;
      const slugRes = await retryFetch(`https://pokeapi.co/api/v2/pokemon/${slug}`, undefined, 2, 300);
      if (!slugRes.ok) {
        return { ok: false, status: slugRes.status, message: `Slug HTTP ${slugRes.status}` } as const;
      }
      const data = await slugRes.json();
      resolvedSlugCache.set(candidate, slug);
      return { ok: true, data } as const;
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Unknown error" } as const;
    } finally {
      pendingPokemonRequests.delete(candidate);
    }
  })();

  pendingPokemonRequests.set(candidate, p);
  return p;
}