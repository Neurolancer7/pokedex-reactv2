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

    if (!region) {
      return new Response(JSON.stringify({ error: "region is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    try {
      // Best-effort ensure cache; do not fail request if it throws
      try {
        await ctx.runAction(internal.regionalDexActions.ensureRegion, { region });
      } catch (e) {
        // ignore background ensure failure; proceed to serve what we have
        console.error("ensureRegion error:", e);
      }

      const page = await ctx.runQuery(api.regionalDex.page, { region, limit, offset });
      return new Response(JSON.stringify(page), {
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