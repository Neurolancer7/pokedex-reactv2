import { useEffect, useMemo, useState } from "react";

export interface RegionalForm {
  id: number;
  name: string;
  types: string[];
  sprite: string | undefined;
  height: number;
  weight: number;
  stats: { [stat: string]: number };
}

export interface SpeciesWithForms {
  baseId: number;
  baseName: string;
  forms: RegionalForm[];
}

// Curated base species list (id + canonical lower-case name)
const BASE_SPECIES: Array<{ id: number; name: string }> = [
  { id: 19, name: "rattata" },
  { id: 20, name: "raticate" },
  { id: 26, name: "raichu" },
  { id: 27, name: "sandshrew" },
  { id: 28, name: "sandslash" },
  { id: 37, name: "vulpix" },
  { id: 38, name: "ninetales" },
  { id: 50, name: "diglett" },
  { id: 51, name: "dugtrio" },
  { id: 52, name: "meowth" },
  { id: 53, name: "persian" },
  { id: 58, name: "growlithe" },
  { id: 59, name: "arcanine" },
  { id: 74, name: "geodude" },
  { id: 75, name: "graveler" },
  { id: 76, name: "golem" },
  { id: 77, name: "ponyta" },
  { id: 78, name: "rapidash" },
  { id: 79, name: "slowpoke" },
  { id: 80, name: "slowbro" },
  { id: 83, name: "farfetchd" }, // PokeAPI species name drops punctuation
  { id: 88, name: "grimer" },
  { id: 89, name: "muk" },
  { id: 100, name: "voltorb" },
  { id: 101, name: "electrode" },
];

// Parallel-friendly fetch with simple retry + timeout
async function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
async function fetchJsonWithRetry<T>(url: string, attempts = 3, baseDelayMs = 200): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(id);
      if (!res.ok) {
        if ((res.status >= 500 || res.status === 429) && i < attempts - 1) {
          await delay(baseDelayMs * Math.pow(2, i));
          continue;
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await delay(baseDelayMs * Math.pow(2, i));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to fetch");
}

type PokeSpecies = {
  varieties?: Array<{ pokemon?: { name?: string; url?: string } }>;
};

type PokePokemon = {
  id?: number;
  name?: string;
  types?: Array<{ type?: { name?: string } }>;
  height?: number;
  weight?: number;
  stats?: Array<{ base_stat?: number; stat?: { name?: string } }>;
  sprites?: {
    front_default?: string | null;
    other?: {
      ["official-artwork"]?: { front_default?: string | null };
    };
  };
};

const isRegionalName = (n: string): boolean => {
  const s = n.toLowerCase();
  return s.includes("alola") || s.includes("galar") || s.includes("hisui") || s.includes("paldea");
};

// Build a RegionalForm from /pokemon entry
function toRegionalForm(p: PokePokemon): RegionalForm {
  const id = Number(p?.id ?? 0);
  const name = String(p?.name ?? "");
  const types: string[] = Array.isArray(p?.types)
    ? p!.types!.map((t) => String(t?.type?.name ?? "")).filter(Boolean)
    : [];
  const sprite =
    p?.sprites?.other?.["official-artwork"]?.front_default ??
    p?.sprites?.front_default ??
    undefined;
  const height = Number(p?.height ?? 0);
  const weight = Number(p?.weight ?? 0);
  const statsObj: { [stat: string]: number } = {};
  for (const s of p?.stats ?? []) {
    const statName = String(s?.stat?.name ?? "");
    const val = Number(s?.base_stat ?? 0);
    if (statName) statsObj[statName] = val;
  }
  return { id, name, types, sprite, height, weight, stats: statsObj };
}

// Fetch one species (base + official regional forms)
async function fetchSpeciesWithForms(nameOrId: string | number): Promise<SpeciesWithForms | null> {
  try {
    const species = await fetchJsonWithRetry<PokeSpecies>(
      `https://pokeapi.co/api/v2/pokemon-species/${nameOrId}`
    );

    const varietyNames: string[] = (species?.varieties ?? [])
      .map((v) => v?.pokemon?.name)
      .filter((n): n is string => Boolean(n));

    // Keep base + any regional varieties
    const filteredVarieties = varietyNames.filter(
      (n) => isRegionalName(n) || String(n).toLowerCase() === String(nameOrId).toLowerCase()
    );

    // Fallback: if no explicit regional names found, include base anyway
    const finalVarieties =
      filteredVarieties.length > 0 ? filteredVarieties : varietyNames.slice(0, 1);

    const settled = await Promise.allSettled(
      finalVarieties.map((vn) => fetchJsonWithRetry<PokePokemon>(`https://pokeapi.co/api/v2/pokemon/${vn}`))
    );

    const forms: RegionalForm[] = [];
    let baseId = 0;
    let baseName = String(nameOrId);

    for (const r of settled) {
      if (r.status === "fulfilled") {
        const pf = toRegionalForm(r.value);
        forms.push(pf);
        if (
          String(pf.name).toLowerCase() === String(nameOrId).toLowerCase() ||
          (!isRegionalName(pf.name) && baseId === 0)
        ) {
          baseId = pf.id;
          baseName = pf.name;
        }
      }
    }

    // Ensure base form is present: if not found, fetch it directly
    if (!forms.some((f) => String(f.name).toLowerCase() === String(nameOrId).toLowerCase())) {
      try {
        const baseP = await fetchJsonWithRetry<PokePokemon>(
          `https://pokeapi.co/api/v2/pokemon/${nameOrId}`
        );
        const baseForm = toRegionalForm(baseP);
        baseId = baseForm.id || baseId;
        baseName = baseForm.name || baseName;
        // Avoid duplicates by id
        if (!forms.some((f) => f.id === baseForm.id)) {
          forms.unshift(baseForm);
        }
      } catch {
        // ignore if base fetch fails; we still return known forms
      }
    }

    // Dedup by id and sort by id
    const dedup: Record<number, RegionalForm> = Object.create(null);
    for (const f of forms) dedup[f.id] = f;
    const finalForms = Object.values(dedup).sort((a, b) => a.id - b.id);

    return { baseId, baseName, forms: finalForms };
  } catch {
    return null;
  }
}

export function useRegionalForms() {
  const [data, setData] = useState<SpeciesWithForms[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const settled = await Promise.allSettled(
          BASE_SPECIES.map((s) => fetchSpeciesWithForms(s.name))
        );
        const results: SpeciesWithForms[] = [];
        for (const r of settled) {
          if (r.status === "fulfilled" && r.value) results.push(r.value);
        }
        if (!cancelled) {
          // Sort by base dex id
          setData(results.sort((a, b) => a.baseId - b.baseId));
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load regional forms";
          setError(msg);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Flatten to simple Pokemon-like list for the existing grid
  const flatList = useMemo(() => {
    const out: Array<{
      pokemonId: number;
      name: string;
      height: number;
      weight: number;
      baseExperience?: number;
      types: string[];
      abilities: string[] | Array<{ name: string; isHidden: boolean }>;
      stats: Array<{ name: string; value: number }>;
      sprites: { officialArtwork?: string; frontDefault?: string; frontShiny?: string };
      generation: number;
      species?: string;
    }> = [];

    for (const s of data ?? []) {
      for (const f of s.forms) {
        out.push({
          pokemonId: f.id,
          name: f.name, // keep variety name (includes regional naming)
          height: f.height,
          weight: f.weight,
          baseExperience: undefined,
          types: f.types,
          abilities: [], // not fetched here; UI handles missing gracefully
          stats: Object.entries(f.stats).map(([name, value]) => ({
            name,
            value: Number(value || 0),
          })),
          sprites: {
            officialArtwork: f.sprite,
            frontDefault: undefined,
            frontShiny: undefined,
          },
          generation: 0,
          species: undefined,
        });
      }
    }

    // Dedup by id and sort by national dex order
    const dedup: Record<number, (typeof out)[number]> = Object.create(null);
    for (const p of out) dedup[p.pokemonId] = p;
    return Object.values(dedup).sort((a, b) => a.pokemonId - b.pokemonId);
  }, [data]);

  return { data, flatList, isLoading, error };
}
