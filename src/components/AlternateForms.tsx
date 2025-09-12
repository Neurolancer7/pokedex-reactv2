import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { fetchAlternateForms, type FormInfo } from "@/lib/alternateForms";

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

type SortKey = "speciesId" | "speciesName" | "formsCount";

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