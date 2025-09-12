export interface FormInfo {
  speciesName: string;
  speciesId: number;
  forms: { formName: string; formId: number }[];
  // Add: default variety pokemon name if it exists (used to avoid 404s for species without a direct /pokemon endpoint)
  basePokemonName?: string;
}

const SPECIES_WITH_FORMS: string[] = [
  "pichu","unown","castform","kyogre","groudon","deoxys","burmy","wormadam",
  "cherrim","shellos","gastrodon","rotom","dialga","palkia","giratina",
  "shaymin","arceus","basculin","darmanitan","deerling","sawsbuck","tornadus",
  "thundurus","landorus","enamorus","kyurem","keldeo","meloetta","genesect",
  "greninja","vivillon","flabebe","floette","florges","furfrou","meowstic",
  "aegislash","pumpkaboo","gourgeist","xerneas","zygarde","hoopa","oricorio",
  "lycanroc","wishiwashi","silvally","minior","mimikyu","necrozma","magearna",
  "cramorant","toxtricity","sinistea","polteageist","alcremie","eiscue",
  "indeedee","morpeko","zacian","zamazenta","eternatus","urshifu","zarude",
  "calyrex","ursaluna","oinkologne","maushold","squawkabilly","palafin",
  "tatsugiri","dudunsparce","gimmighoul","poltchageist","sinistcha","ogerpon",
  "terapagos"
];

const CACHE_KEY = "alternateForms:v1";

// Small delay helper
function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

// Fetch with retries and small backoff
async function fetchJsonWithRetry<T>(url: string, attempts = 3, baseDelayMs = 250): Promise<T> {
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
  throw lastErr instanceof Error ? lastErr : new Error(`Failed to fetch ${url}`);
}

/**
 * Fetch all alternate forms for provided species list.
 * - Uses species -> varieties -> pokemon -> forms -> pokemon-form detail (for form id).
 * - Applies gentle rate limiting.
 * - Caches to localStorage.
 * - Excludes Mega and Gigantamax entries for this dataset.
 */
export async function fetchAlternateForms(): Promise<FormInfo[]> {
  // Try cache
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed as FormInfo[];
    }
  } catch {
    // ignore cache errors
  }

  const results: FormInfo[] = [];
  const seenSpecies = new Set<string>();

  // Concurrency control
  const queue = [...SPECIES_WITH_FORMS];
  const workers = 3;

  const worker = async () => {
    while (queue.length) {
      const speciesName = queue.shift();
      if (!speciesName) break;

      // Stagger to avoid bursts
      await delay(120);

      try {
        // 1) Species to get varieties and species id
        const speciesData = await fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokemon-species/${speciesName}`);
        const speciesId: number = Number(speciesData?.id ?? 0);

        // Include is_default to capture the canonical pokemon entry name (if it maps to /pokemon/{name})
        const varieties: Array<{ pokemon: { name: string, url: string }, is_default?: boolean }> =
          Array.isArray(speciesData?.varieties) ? speciesData.varieties : [];

        // Determine default variety pokemon name (e.g. "toxtricity-amped" rather than "toxtricity")
        const defaultVariety = varieties.find((v) => v?.is_default);
        const basePokemonName: string | undefined = defaultVariety?.pokemon?.name
          ? String(defaultVariety.pokemon.name).toLowerCase()
          : undefined;

        const formEntries: { formName: string; formId: number }[] = [];
        const formIdSet = new Set<number>();

        // 3) For each variety: fetch pokemon -> read .forms[] -> fetch pokemon-form for form ids
        for (const v of varieties) {
          const pokeName = v?.pokemon?.name;
          if (!pokeName) continue;

          await delay(80);

          try {
            const pokemonData = await fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokemon/${pokeName}`);
            const forms: Array<{ name: string; url: string }> = Array.isArray(pokemonData?.forms) ? pokemonData.forms : [];

            for (const f of forms) {
              const fname = f?.name;
              if (!fname) continue;

              // Exclude Mega/Gigantamax for this dataset
              const lf = fname.toLowerCase();
              if (lf.includes("-mega") || lf.includes("gigantamax") || lf.includes("-gmax")) continue;

              await delay(60);
              try {
                const formData = await fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokemon-form/${fname}`);
                const fid = Number(formData?.id ?? 0);
                if (Number.isFinite(fid) && fid > 0 && !formIdSet.has(fid)) {
                  formIdSet.add(fid);
                  formEntries.push({ formName: String(formData?.name ?? fname), formId: fid });
                }
              } catch {
                // Non-fatal
              }
            }
          } catch {
            // Non-fatal
          }
        }

        const normalizedSpeciesName = String(speciesName).toLowerCase();
        if (!seenSpecies.has(normalizedSpeciesName)) {
          seenSpecies.add(normalizedSpeciesName);
          results.push({
            speciesName: normalizedSpeciesName,
            speciesId: speciesId,
            forms: formEntries.sort((a, b) => a.formId - b.formId),
            // Add: pass along the default pokemon name if available
            basePokemonName,
          });
        }
      } catch {
        results.push({
          speciesName: String(speciesName).toLowerCase(),
          speciesId: 0,
          forms: [],
          basePokemonName: undefined,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: workers }, () => worker()));

  // Sort results by speciesId then speciesName
  results.sort((a, b) => {
    if (a.speciesId && b.speciesId && a.speciesId !== b.speciesId) return a.speciesId - b.speciesId;
    return a.speciesName.localeCompare(b.speciesName);
  });

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(results));
  } catch {
    // ignore cache write errors
  }

  return results;
}