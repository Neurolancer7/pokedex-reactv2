export type GigantamaxPokemon = {
  id: number;           // National Dex ID
  name: string;         // base name
  gmaxFormName: string; // e.g. "charizard-gmax"
  sprite: string;       // official artwork or Gmax sprite
  types: string[];      // Pokémon types
  height: number;
  weight: number;
  abilities: string[];
};

// Canonical base names for Gigantamax-capable Pokémon
const GMAX_BASE_NAMES: string[] = [
  "venusaur","charizard","blastoise","butterfree","pikachu","meowth","machamp",
  "gengar","kingler","lapras","eevee","snorlax","garbodor","melmetal","rillaboom",
  "cinderace","inteleon","corviknight","orbeetle","drednaw","coalossal","flapple",
  "appletun","sandaconda","toxtricity","centiskorch","hatterene","grimmsnarl",
  "alcremie","copperajah","duraludon"
];

// Basic jittered exponential backoff retry for transient fetch failures
async function fetchWithRetryJson(
  url: string,
  label: string,
  init?: RequestInit,
  attempts = 4,
  baseDelayMs = 250,
  timeoutMs = 15000
): Promise<any> {
  let lastErr: unknown = undefined;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        const text = res.statusText || "Unknown";
        // Retry on 429 / 5xx
        if ((res.status === 429 || res.status >= 500) && i < attempts - 1) {
          const delayMs = baseDelayMs * Math.pow(2, i) + Math.floor(Math.random() * 120);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw new Error(`[${label}] HTTP ${res.status} ${text}`);
      }
      try {
        return await res.json();
      } catch {
        throw new Error(`[${label}] Invalid JSON`);
      }
    } catch (e) {
      lastErr = e;
      // Retry on AbortError / network errors
      if (i < attempts - 1) {
        const delayMs = baseDelayMs * Math.pow(2, i) + Math.floor(Math.random() * 120);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`[${label}] ${msg}`);
    } finally {
      clearTimeout(id);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`[${label}] Unknown error`);
}

// Throttle concurrency by processing in fixed-size batches
async function mapBatched<T, R>(items: T[], batchSize: number, fn: (v: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fn));
    out.push(...results);
  }
  return out;
}

// Resolve a Gmax form name for a base pokemon using both `pokemon.forms` and `pokemon-species.varieties`
// Returns a normalized form name (e.g. "charizard-gmax") and a likely pokemon-form URL.
function resolveGmaxFormRefs(
  baseName: string,
  pokemonJson: any,
  speciesJson: any
): { formName: string; formUrl: string } | null {
  // Prefer direct form refs from the pokemon endpoint (forms contain pokemon-form URLs)
  const forms: Array<{ name?: string; url?: string }> = Array.isArray(pokemonJson?.forms) ? pokemonJson.forms : [];
  for (const f of forms) {
    const fname = String(f?.name ?? "").toLowerCase();
    const furl = String(f?.url ?? "");
    if (fname.includes("gmax") || fname.includes("gigantamax")) {
      if (fname && furl) {
        return { formName: fname, formUrl: furl };
      }
    }
  }

  // Fallback to species varieties (varieties reference "pokemon/{varietyName}" URLs)
  const varieties: Array<{ pokemon?: { name?: string; url?: string } }> =
    Array.isArray(speciesJson?.varieties) ? speciesJson.varieties : [];
  for (const v of varieties) {
    const vname = String(v?.pokemon?.name ?? "").toLowerCase();
    if (vname.includes("gmax") || vname.includes("gigantamax")) {
      // Construct pokemon-form URL from the variety name (pokemon-form names match variety names)
      return {
        formName: vname,
        formUrl: `https://pokeapi.co/api/v2/pokemon-form/${vname}`,
      };
    }
  }

  // Last attempt: conventional naming "<name>-gmax"
  const conventional = `${baseName}-gmax`;
  return {
    formName: conventional,
    formUrl: `https://pokeapi.co/api/v2/pokemon-form/${conventional}`,
  };
}

function pickSpriteFromForm(formJson: any, pokemonJson: any, id: number): string {
  const official =
    pokemonJson?.sprites?.other?.["official-artwork"]?.front_default ??
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

  // Prefer pokemon-form provided sprite if available; otherwise fall back to official artwork
  const formDefault = formJson?.sprites?.front_default as string | undefined;
  return formDefault || official;
}

async function fetchSingleGmax(baseName: string): Promise<GigantamaxPokemon | null> {
  const name = baseName.toLowerCase();
  try {
    const pokemonUrl = `https://pokeapi.co/api/v2/pokemon/${name}`;
    const speciesUrl = `https://pokeapi.co/api/v2/pokemon-species/${name}`;

    const [pokemonJson, speciesJson] = await Promise.all([
      fetchWithRetryJson(pokemonUrl, `pokemon:${name}`),
      fetchWithRetryJson(speciesUrl, `species:${name}`),
    ]);

    const id: number = Number(pokemonJson?.id);
    if (!Number.isFinite(id) || id <= 0) return null;

    const gmaxRef = resolveGmaxFormRefs(name, pokemonJson, speciesJson);
    if (!gmaxRef) return null;

    // Fetch the pokemon-form details for the gmax variant (best-effort)
    let formJson: any | null = null;
    try {
      formJson = await fetchWithRetryJson(gmaxRef.formUrl, `pokemon-form:${gmaxRef.formName}`);
    } catch {
      // If the explicit form fetch fails, skip this one
      return null;
    }

    // Validate form name actually looks like a Gmax form
    const formName = String(formJson?.name ?? gmaxRef.formName ?? "").toLowerCase();
    if (!(formName.includes("gmax") || formName.includes("gigantamax"))) {
      return null;
    }

    // Collect base fields
    const types: string[] = Array.isArray(pokemonJson?.types)
      ? pokemonJson.types
          .map((t: any) => String(t?.type?.name ?? ""))
          .filter((t: string) => t.length > 0)
      : [];

    const abilities: string[] = Array.isArray(pokemonJson?.abilities)
      ? pokemonJson.abilities
          .map((a: any) => String(a?.ability?.name ?? ""))
          .filter((s: string) => s.length > 0)
      : [];

    const height: number = typeof pokemonJson?.height === "number" ? pokemonJson.height : 0;
    const weight: number = typeof pokemonJson?.weight === "number" ? pokemonJson.weight : 0;

    const sprite = pickSpriteFromForm(formJson, pokemonJson, id);

    return {
      id,
      name: String(pokemonJson?.name ?? name),
      gmaxFormName: formName,
      sprite,
      types,
      height,
      weight,
      abilities,
    };
  } catch {
    // Skip this Pokémon on any unexpected failure
    return null;
  }
}

/**
 * Fetch detailed data for every Gigantamax-capable Pokémon.
 * - Uses Promise.all in throttled batches (default 5) to avoid rate limits.
 * - Retries transient network/API errors.
 * - Skips entries when a Gigantamax form can't be confirmed.
 */
export async function fetchGigantamaxList(batchSize: number = 5): Promise<GigantamaxPokemon[]> {
  const results = await mapBatched(GMAX_BASE_NAMES, batchSize, fetchSingleGmax);
  // Filter nulls and enforce stable order by national dex id
  const list: GigantamaxPokemon[] = results.filter((x): x is GigantamaxPokemon => x !== null);
  list.sort((a, b) => a.id - b.id);
  return list;
}
