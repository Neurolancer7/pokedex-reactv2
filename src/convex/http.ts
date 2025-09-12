import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/api/regional-pokedex",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const region = (url.searchParams.get("region") || "").toLowerCase();
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || "40"), 200));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || "0"));
    const resetParam = (url.searchParams.get("reset") || "").toLowerCase();
    const reset = resetParam === "1" || resetParam === "true";

    if (!region) {
      return new Response(JSON.stringify({ error: "region is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    try {
      // NEW: Fetch official regional total from PokeAPI so UI paginates to the true end.
      let expectedTotal: number | null = null;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(`https://pokeapi.co/api/v2/pokedex/${region}`, { signal: ctrl.signal });
        clearTimeout(to);
        if (res.ok) {
          const data = await res.json();
          const entries = Array.isArray(data?.pokemon_entries) ? data.pokemon_entries : [];
          expectedTotal = entries.length;
        }
      } catch (e) {
        // ignore; fallback to cached count later
        expectedTotal = null;
      }

      // Optional: purge cached region before rebuild
      if (reset) {
        try {
          await ctx.runMutation(internal.regionalDex.clearRegion, { region });
        } catch (e) {
          console.error("clearRegion error:", e);
        }
      }

      // Check current cache count
      let count = 0;
      try {
        count = await ctx.runQuery(internal.regionalDex.countByRegion, { region });
      } catch (e) {
        console.error("countByRegion error:", e);
      }

      // If first page and cache is empty (or reset), build synchronously
      if (offset === 0 && (count === 0 || reset)) {
        await ctx.runAction(internal.regionalDexActions.ensureRegion, { region });
      } else {
        // Otherwise, best effort background ensure to backfill missing entries
        try {
          await ctx.runAction(internal.regionalDexActions.ensureRegion, { region });
        } catch (e) {
          console.error("ensureRegion (background) error:", e);
        }
      }

      // Serve the requested page from cache
      const page = await ctx.runQuery(api.regionalDex.page, { region, limit, offset });

      // NEW: Force totalCount to the official expected total when available
      const responseBody = {
        ...page,
        totalCount: typeof expectedTotal === "number" && expectedTotal > 0 ? expectedTotal : page.totalCount,
      };

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      console.error("regional-pokedex endpoint error:", e);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  }),
});

http.route({
  path: "/api/aggregated-forms",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    // Helpers
    const REQUEST_TIMEOUT_MS = 15000;
    const MAX_RETRIES = 3;
    const CONCURRENCY = 5;

    async function delay(ms: number) {
      return new Promise((res) => setTimeout(res, ms));
    }

    async function fetchJsonWithRetry(url: string, label: string): Promise<any> {
      let lastErr: unknown = null;
      for (let i = 0; i < MAX_RETRIES; i++) {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
        try {
          const r = await fetch(url, { signal: ctrl.signal });
          clearTimeout(to);
          if (!r.ok) {
            if ((r.status === 429 || r.status >= 500) && i < MAX_RETRIES - 1) {
              await delay(100 * Math.pow(3, i));
              continue;
            }
            throw new Error(`[${label}] HTTP ${r.status} ${r.statusText}`);
          }
          try {
            return await r.json();
          } catch {
            throw new Error(`[${label}] Invalid JSON`);
          }
        } catch (e) {
          clearTimeout(to);
          lastErr = e;
          if (e instanceof DOMException && e.name === "AbortError") {
            throw new Error(`[${label}] Request aborted or timed out`);
          }
          if (i < MAX_RETRIES - 1) {
            await delay(100 * Math.pow(3, i));
            continue;
          }
          throw e instanceof Error ? e : new Error(String(e));
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(`[${label}] Unknown error`);
    }

    function normalizeName(s: unknown): string {
      return String(s ?? "").trim().toLowerCase();
    }

    function classifyCategories(source: {
      name?: string;
      form_name?: string;
      is_default?: boolean;
      is_battle_only?: boolean;
      is_mega?: boolean;
    }): string[] {
      const tags: Set<string> = new Set();
      const nm = normalizeName(source?.name);
      const fn = normalizeName(source?.form_name);

      if (source?.is_mega === true || nm.includes("mega") || fn.includes("mega") || nm.includes("primal") || fn.includes("primal")) {
        tags.add("mega");
      }

      if (nm.includes("gmax") || fn.includes("gmax") || nm.includes("gigantamax") || fn.includes("gigantamax")) {
        tags.add("gigantamax");
      }

      const regional = ["alola", "alolan", "galar", "galarian", "hisui", "hisuian", "paldea", "paldean"];
      if (regional.some((r) => nm.includes(r) || fn.includes(r))) {
        tags.add("regional");
      }

      if (
        nm.endsWith("-m") || nm.endsWith("-f") ||
        nm.includes("male") || nm.includes("female") ||
        fn.includes("male") || fn.includes("female")
      ) {
        tags.add("gender");
      }

      const hasPrimary = tags.has("mega") || tags.has("gigantamax") || tags.has("regional") || tags.has("gender");
      if (!hasPrimary && !!fn && source?.is_battle_only === false) {
        tags.add("cosmetic");
      }

      if (tags.size === 0 && source?.is_default === false) {
        tags.add("alternate");
      }

      return Array.from(tags);
    }

    function pickSprite(p: any, override?: any): { sprite?: string; officialArtwork?: string } {
      const oa = override?.sprites?.other?.["official-artwork"]?.front_default ??
                 p?.sprites?.other?.["official-artwork"]?.front_default ??
                 undefined;
      const fd = override?.sprites?.front_default ?? p?.sprites?.front_default ?? undefined;
      return {
        sprite: fd ?? oa,
        officialArtwork: oa ?? fd,
      };
    }

    try {
      const url = new URL(req.url);
      const speciesParam = (url.searchParams.get("species") || "").trim();
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || "40"), 200));
      const offset = Math.max(0, Number(url.searchParams.get("offset") || "0"));

      if (!speciesParam) {
        return new Response(JSON.stringify({ error: "species is required (comma-separated list)" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }

      const speciesList = speciesParam
        .split(",")
        .map((s) => normalizeName(s))
        .filter(Boolean);

      // 1) Fetch species -> get varieties for each species
      const speciesVarieties: Record<string, string[]> = {};
      const failed: Array<{ url: string; error: string }> = [];

      // Limit concurrency
      for (let i = 0; i < speciesList.length; i += CONCURRENCY) {
        const batch = speciesList.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map(async (sp) => {
            const s = await fetchJsonWithRetry(`https://pokeapi.co/api/v2/pokemon-species/${sp}`, "pokemon-species");
            const varieties = Array.isArray(s?.varieties) ? s.varieties : [];
            const varietyNames: string[] = varieties
              .map((v: any) => normalizeName(v?.pokemon?.name))
              .filter(Boolean);
            speciesVarieties[sp] = varietyNames.length > 0 ? varietyNames : [sp]; // fallback include base
          })
        );
        for (let r of settled) {
          if (r.status === "rejected") {
            failed.push({ url: "pokemon-species", error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
          }
        }
      }

      // Flatten list of variety names
      const varietyNames: string[] = [];
      for (const sp of speciesList) {
        const arr = speciesVarieties[sp] ?? [sp];
        for (const v of arr) varietyNames.push(v);
      }

      // 2) For each variety name, fetch pokemon/{variety} and then fetch each form's pokemon-form details
      type Result = {
        speciesId: number;
        speciesName: string;
        formId?: number;
        formName: string;
        isDefault: boolean;
        categories: string[];
        dexId: number;
        name: string;
        types: string[];
        sprite?: string;
        officialArtwork?: string;
        height?: number;
        weight?: number;
        stats?: Record<string, number>;
        abilities?: string[];
        source: { pokemonUrl: string; pokemonFormUrl?: string };
      };

      const allResults: Result[] = [];

      for (let i = 0; i < varietyNames.length; i += CONCURRENCY) {
        const batch = varietyNames.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map(async (vn) => {
            const p = await fetchJsonWithRetry(`https://pokeapi.co/api/v2/pokemon/${vn}`, "pokemon");

            // Basic pokemon fields
            const pokemonId = Number(p?.id ?? 0);
            if (!Number.isFinite(pokemonId) || pokemonId <= 0) return;

            const speciesName = normalizeName(p?.species?.name ?? vn);
            const speciesUrl = String(p?.species?.url ?? "");
            const speciesId = Number(speciesUrl.split("/").filter(Boolean).pop());

            const types: string[] = Array.isArray(p?.types)
              ? p.types.map((t: any) => normalizeName(t?.type?.name)).filter(Boolean)
              : [];

            const abilities: string[] = Array.isArray(p?.abilities)
              ? p.abilities.map((a: any) => normalizeName(a?.ability?.name)).filter(Boolean)
              : [];

            const stats: Record<string, number> = {};
            if (Array.isArray(p?.stats)) {
              for (const s of p.stats) {
                const key = normalizeName(s?.stat?.name);
                const baseStat = Number(s?.base_stat);
                if (key) stats[key] = Number.isFinite(baseStat) ? baseStat : 0;
              }
            }

            const { sprite, officialArtwork } = pickSprite(p);

            // Create a base entry (pokemon itself)
            const baseCategories = classifyCategories({ name: vn, is_default: p?.is_default, is_battle_only: p?.is_battle_only, is_mega: p?.is_mega });
            allResults.push({
              speciesId: Number.isFinite(speciesId) ? speciesId : pokemonId,
              speciesName,
              formId: undefined,
              formName: vn,
              isDefault: Boolean(p?.is_default),
              categories: baseCategories,
              dexId: pokemonId,
              name: vn,
              types,
              sprite,
              officialArtwork,
              height: Number(p?.height ?? 0) || undefined,
              weight: Number(p?.weight ?? 0) || undefined,
              stats,
              abilities,
              source: { pokemonUrl: `https://pokeapi.co/api/v2/pokemon/${vn}` },
            });

            // Enumerate forms from p.forms if available, fetch pokemon-form details for richer metadata
            const formsArr: Array<{ name?: string; url?: string }> = Array.isArray(p?.forms) ? p.forms : [];
            for (const f of formsArr) {
              const formName = normalizeName(f?.name);
              if (!formName) continue;
              try {
                const form = await fetchJsonWithRetry(
                  f?.url ? String(f.url) : `https://pokeapi.co/api/v2/pokemon-form/${formName}`,
                  "pokemon-form"
                );

                const formId = Number(form?.id);
                const formIsDefault = Boolean(form?.is_default);
                const formOrder = typeof form?.form_order === "number" ? form.form_order : undefined;
                const formCats = classifyCategories({
                  name: form?.name,
                  form_name: form?.form_name,
                  is_default: form?.is_default,
                  is_battle_only: form?.is_battle_only,
                  is_mega: form?.is_mega,
                });

                const spr = pickSprite(p, form);
                allResults.push({
                  speciesId: Number.isFinite(speciesId) ? speciesId : pokemonId,
                  speciesName,
                  formId: Number.isFinite(formId) ? formId : undefined,
                  formName: formName,
                  isDefault: formIsDefault,
                  categories: formCats,
                  dexId: pokemonId,
                  name: formName,
                  types,
                  sprite: spr.sprite,
                  officialArtwork: spr.officialArtwork,
                  height: Number(p?.height ?? 0) || undefined,
                  weight: Number(p?.weight ?? 0) || undefined,
                  stats,
                  abilities,
                  source: {
                    pokemonUrl: `https://pokeapi.co/api/v2/pokemon/${vn}`,
                    pokemonFormUrl: f?.url ? String(f.url) : `https://pokeapi.co/api/v2/pokemon-form/${formName}`,
                  },
                });
              } catch (e) {
                failed.push({
                  url: f?.url ? String(f.url) : `https://pokeapi.co/api/v2/pokemon-form/${formName}`,
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            }
          })
        );

        for (const r of settled) {
          if (r.status === "rejected") {
            failed.push({ url: "pokemon", error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
          }
        }
      }

      // 3) Deduplicate by formId or by dexId+formName
      const seen = new Set<string>();
      const deduped: Result[] = [];
      for (const it of allResults) {
        const key = it.formId ? `id:${it.formId}` : `nf:${it.dexId}-${it.formName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(it);
      }

      // 4) Sort: dexId asc, then formName asc (normalized)
      deduped.sort((a, b) => {
        if (a.dexId !== b.dexId) return a.dexId - b.dexId;
        const an = normalizeName(a.formName);
        const bn = normalizeName(b.formName);
        return an.localeCompare(bn);
      });

      // 5) Paginate
      const total = deduped.length;
      const page = deduped.slice(offset, offset + limit);

      const body = {
        count: total,
        hasMore: offset + limit < total,
        results: page,
        failed,
      };

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      console.error("aggregated-forms endpoint error:", e);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  }),
});

export default http;