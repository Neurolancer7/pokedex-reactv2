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

export default http;