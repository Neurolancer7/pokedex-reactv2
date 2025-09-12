"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

async function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchWithRetryJson(url: string, label: string, attempts = 3): Promise<any> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(to);
      if (!res.ok) {
        if ((res.status >= 500 || res.status === 429) && i < attempts - 1) {
          await delay(200 * Math.pow(2, i));
          continue;
        }
        throw new Error(`[${label}] HTTP ${res.status} ${res.statusText}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await delay(200 * Math.pow(2, i));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`[${label}] Unknown error`);
}

function parseIdFromUrl(url: string): number | null {
  try {
    const parts = String(url).split("/").filter(Boolean);
    const idStr = parts[parts.length - 1];
    const id = Number(idStr);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

type VarietyInfo = {
  formName: string;
  formId?: number;
  types: string[];
  sprite?: string;
};

export const ensureRegion = internalAction({
  args: { region: v.string() },
  handler: async (ctx, args) => {
    const region = args.region.toLowerCase();

    // Load region pokedex listing
    const pokedex = await fetchWithRetryJson(
      `https://pokeapi.co/api/v2/pokedex/${region}`,
      "pokedex"
    );

    const entries: Array<{ entry_number?: number; pokemon_species?: { name?: string; url?: string } }> =
      Array.isArray(pokedex?.pokemon_entries) ? pokedex.pokemon_entries : [];

    // Concurrency cap
    const CONCURRENCY = 5;

    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const batch = entries.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (entry) => {
          try {
            const speciesName = String(entry?.pokemon_species?.name ?? "");
            const speciesUrl = String(entry?.pokemon_species?.url ?? "");
            const dexId =
              parseIdFromUrl(speciesUrl) ??
              (await (async () => {
                try {
                  const s = await fetchWithRetryJson(
                    `https://pokeapi.co/api/v2/pokemon-species/${speciesName}`,
                    "species-fallback"
                  );
                  return Number(s?.id ?? 0);
                } catch {
                  return 0;
                }
              })());
            if (!Number.isFinite(dexId) || dexId <= 0) return;

            // Fetch species details
            const species = await fetchWithRetryJson(
              `https://pokeapi.co/api/v2/pokemon-species/${speciesName}`,
              "species"
            );

            const varieties: Array<{ pokemon?: { name?: string } }> = Array.isArray(species?.varieties)
              ? species.varieties
              : [];

            // Fetch all varieties with small parallelism (<= 5)
            const varietyNames: string[] = varieties
              .map((v) => String(v?.pokemon?.name ?? ""))
              .filter(Boolean);

            const varResults: VarietyInfo[] = [];
            for (let j = 0; j < varietyNames.length; j += CONCURRENCY) {
              const vBatch = varietyNames.slice(j, j + CONCURRENCY);
              const settled = await Promise.allSettled(
                vBatch.map(async (vn) => {
                  const p = await fetchWithRetryJson(
                    `https://pokeapi.co/api/v2/pokemon/${vn}`,
                    "pokemon"
                  );
                  const pid = Number(p?.id ?? 0);
                  const types: string[] = Array.isArray(p?.types)
                    ? p.types
                        .map((t: any) => String(t?.type?.name ?? ""))
                        .filter(Boolean)
                    : [];
                  const sprite: string | undefined =
                    p?.sprites?.other?.["official-artwork"]?.front_default ??
                    p?.sprites?.front_default ??
                    undefined;
                  return {
                    formName: String(vn),
                    formId: Number.isFinite(pid) ? pid : undefined,
                    types,
                    sprite,
                  } as VarietyInfo;
                })
              );

              for (const r of settled) {
                if (r.status === "fulfilled") varResults.push(r.value);
              }
            }

            // Choose base entry (species name match), fallback to first
            const base =
              varResults.find((v) => v.formName === speciesName) ?? varResults[0] ?? null;
            const baseTypes = base?.types ?? [];
            const baseSprite = base?.sprite;

            // Forms list includes all varieties (including base, as a normalized list)
            const forms: VarietyInfo[] = varResults.map((v) => ({
              formName: v.formName,
              formId: v.formId,
              types: v.types,
              sprite: v.sprite,
            }));

            // Upsert entry
            await ctx.runMutation(internal.regionalDex.upsertEntry, {
              region,
              dexId,
              name: speciesName,
              types: baseTypes,
              sprite: baseSprite,
              forms,
            });
          } catch (e) {
            console.error("ensureRegion batch item error:", e);
          }
        })
      );

      // gentle pacing
      try {
        await delay(80);
      } catch {
        // ignore
      }
    }
  },
});
