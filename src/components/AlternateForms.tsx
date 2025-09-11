import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface FormInfo {
  speciesName: string;
  speciesId: number;
  forms: { formName: string; formId: number }[];
}

type SortKey = "speciesName" | "speciesId" | "formsCount";

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

/**
 * Small delay to avoid hammering the API.
 */
function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Basic fetch with retries and small backoff. Keeps it lightweight for client-side usage.
 */
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
 * - Uses species -> varieties -> pokemon -> forms -> pokemon-form detail to collect form ids and names.
 * - Applies gentle rate limiting.
 * - Caches to localStorage.
 */
async function fetchAlternateForms(): Promise<FormInfo[]> {
  // Use cache
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

      // Slight stagger to avoid bursts
      await delay(120);

      try {
        // 1) species -> to get varieties and the species id
        const speciesData = await fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokemon-species/${speciesName}`);
        const speciesId: number = Number(speciesData?.id ?? 0);

        // 2) varieties (each variety references a pokemon)
        const varieties: Array<{ pokemon: { name: string, url: string } }> = Array.isArray(speciesData?.varieties) ? speciesData.varieties : [];
        const formEntries: { formName: string; formId: number }[] = [];
        const formIdSet = new Set<number>();

        // 3) For each variety: fetch pokemon data -> read .forms[] and fetch pokemon-form details
        for (const v of varieties) {
          const pokeName = v?.pokemon?.name;
          if (!pokeName) continue;

          // Small pacing
          await delay(80);

          try {
            const pokemonData = await fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokemon/${pokeName}`);
            const forms: Array<{ name: string; url: string }> = Array.isArray(pokemonData?.forms) ? pokemonData.forms : [];

            for (const f of forms) {
              const fname = f?.name;
              if (!fname) continue;

              // Another light pacing
              await delay(60);

              try {
                // Fetch pokemon-form entry to get form id
                const formData = await fetchJsonWithRetry<any>(`https://pokeapi.co/api/v2/pokemon-form/${fname}`);
                const fid = Number(formData?.id ?? 0);
                if (Number.isFinite(fid) && fid > 0 && !formIdSet.has(fid)) {
                  formIdSet.add(fid);
                  formEntries.push({ formName: String(formData?.name ?? fname), formId: fid });
                }
              } catch (err) {
                // Non-fatal; continue with next form
                // console.warn("form fetch failed for", fname, err);
              }
            }
          } catch (err) {
            // Non-fatal; continue with next variety
            // console.warn("pokemon fetch failed for", pokeName, err);
          }
        }

        // Deduplicate species entries
        const normalizedSpeciesName = String(speciesName).toLowerCase();
        if (!seenSpecies.has(normalizedSpeciesName)) {
          seenSpecies.add(normalizedSpeciesName);
          results.push({
            speciesName: normalizedSpeciesName,
            speciesId: speciesId,
            forms: formEntries.sort((a, b) => a.formId - b.formId),
          });
        }
      } catch (err) {
        // Non-fatal; push an empty entry to indicate species processed with no forms
        results.push({
          speciesName: String(speciesName).toLowerCase(),
          speciesId: 0,
          forms: [],
        });
      }
    }
  };

  await Promise.all(Array.from({ length: workers }, () => worker()));

  // Sort results by speciesId then name
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

export function AlternateForms() {
  const [data, setData] = useState<FormInfo[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [query, setQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortKey>("speciesId");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    setLoading(true);
    fetchAlternateForms()
      .then((res) => {
        setData(res);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Failed to load alternate forms";
        toast.error(msg);
        setData([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const base = q.length
      ? data.filter((row) => {
          if (row.speciesName.includes(q)) return true;
          if (String(row.speciesId).includes(q)) return true;
          if (row.forms.some((f) => f.formName?.toLowerCase().includes(q) || String(f.formId).includes(q))) return true;
          return false;
        })
      : data;

    const sorted = [...base].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "speciesId") cmp = (a.speciesId || 0) - (b.speciesId || 0);
      if (sortBy === "speciesName") cmp = a.speciesName.localeCompare(b.speciesName);
      if (sortBy === "formsCount") cmp = a.forms.length - b.forms.length;
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [data, query, sortBy, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="bg-card/60 border rounded-xl shadow-sm p-4 md:p-6">
      <div className="mb-4 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold">Alternate Forms</h3>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search species, forms, or IDs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full sm:w-72"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              try {
                localStorage.removeItem(CACHE_KEY);
                toast.success("Cache cleared. Reloading…");
                setLoading(true);
                fetchAlternateForms()
                  .then((res) => setData(res))
                  .catch((err) => {
                    const msg = err instanceof Error ? err.message : "Failed to reload alternate forms";
                    toast.error(msg);
                    setData([]);
                  })
                  .finally(() => setLoading(false));
              } catch {
                // ignore
              }
            }}
          >
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading alternate forms…
        </div>
      ) : (
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[160px]">
                  <Button variant="ghost" size="sm" className="gap-1 px-0" onClick={() => toggleSort("speciesName")}>
                    Species Name
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead className="min-w-[100px]">
                  <Button variant="ghost" size="sm" className="gap-1 px-0" onClick={() => toggleSort("speciesId")}>
                    Dex ID
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead className="min-w-[260px]">
                  <Button variant="ghost" size="sm" className="gap-1 px-0" onClick={() => toggleSort("formsCount")}>
                    Form Name(s)
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead className="min-w-[220px]">Form ID(s)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.speciesName}>
                  <TableCell className="capitalize">{row.speciesName}</TableCell>
                  <TableCell>{row.speciesId || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.forms.length ? row.forms.map((f) => f.formName).join(", ") : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.forms.length ? row.forms.map((f) => f.formId).join(", ") : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {!filtered.length && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-10">
                    No results found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
