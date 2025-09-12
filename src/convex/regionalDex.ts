import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

// Upsert a regional dex entry
export const upsertEntry = internalMutation({
  args: {
    region: v.string(),
    dexId: v.number(),
    name: v.string(),
    types: v.array(v.string()),
    sprite: v.optional(v.string()),
    forms: v.array(
      v.object({
        formName: v.string(),
        formId: v.optional(v.number()),
        types: v.array(v.string()),
        sprite: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("regionalDex")
      .withIndex("by_region_and_dexId", (q) =>
        q.eq("region", args.region).eq("dexId", args.dexId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        types: args.types,
        sprite: args.sprite,
        forms: args.forms,
      });
      return existing._id;
    }

    return await ctx.db.insert("regionalDex", {
      region: args.region,
      dexId: args.dexId,
      name: args.name,
      types: args.types,
      sprite: args.sprite,
      forms: args.forms,
    });
  },
});

// Count by region
export const countByRegion = internalQuery({
  args: { region: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("regionalDex")
      .withIndex("by_region_and_dexId", (q) => q.eq("region", args.region))
      .collect();
    return rows.length;
  },
});

// Public page query (sorted asc by dexId then name)
export const page = query({
  args: {
    region: v.string(),
    limit: v.number(),
    offset: v.number(),
  },
  handler: async (ctx, args) => {
    const { region, limit, offset } = args;
    const rows = await ctx.db
      .query("regionalDex")
      .withIndex("by_region_and_dexId", (q) => q.eq("region", region))
      .collect();

    rows.sort((a, b) => a.dexId - b.dexId || a.name.localeCompare(b.name));

    const totalCount = rows.length;
    const slice = rows.slice(offset, offset + limit);

    return {
      data: slice,
      totalCount,
      hasMore: offset + limit < totalCount,
    };
  },
});
