import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Pokemon cache tables
    pokemon: defineTable({
      pokemonId: v.number(),
      name: v.string(),
      height: v.number(),
      weight: v.number(),
      baseExperience: v.optional(v.number()),
      types: v.array(v.string()),
      abilities: v.array(v.object({
        name: v.string(),
        isHidden: v.boolean(),
      })),
      stats: v.array(v.object({
        name: v.string(),
        baseStat: v.number(),
        effort: v.number(),
      })),
      sprites: v.object({
        frontDefault: v.optional(v.string()),
        frontShiny: v.optional(v.string()),
        officialArtwork: v.optional(v.string()),
      }),
      moves: v.array(v.string()),
      generation: v.number(),
      // Add: tags for forms filtering
      formTags: v.optional(v.array(v.string())),
    }).index("by_pokemon_id", ["pokemonId"])
      .index("by_name", ["name"])
      .index("by_generation", ["generation"])
      // Add: search index for faster name search (with generation as a filter)
      .searchIndex("search_name", { searchField: "name", filterFields: ["generation"] }),

    pokemonSpecies: defineTable({
      pokemonId: v.number(),
      name: v.string(),
      flavorText: v.optional(v.string()),
      genus: v.optional(v.string()),
      captureRate: v.optional(v.number()),
      baseHappiness: v.optional(v.number()),
      growthRate: v.optional(v.string()),
      habitat: v.optional(v.string()),
      evolutionChainId: v.optional(v.number()),
      generation: v.number(),
    }).index("by_pokemon_id", ["pokemonId"]),

    pokemonTypes: defineTable({
      name: v.string(),
      color: v.string(),
    }).index("by_name", ["name"]),

    favorites: defineTable({
      userId: v.id("users"),
      pokemonId: v.number(),
    }).index("by_user", ["userId"])
      .index("by_user_and_pokemon", ["userId", "pokemonId"]),

    // Add: Table to cache all Pokémon canonical forms from PokeAPI
    pokemonForms: defineTable({
      formId: v.number(),
      formName: v.optional(v.string()),
      pokemonName: v.string(), // canonical variant name from PokeAPI (e.g., "vulpix-alola")
      pokemonId: v.number(),   // national dex id
      categories: v.array(v.string()), // ["regional", "mega", "gigantamax", "gender", "cosmetic", "alternate"]
      isDefault: v.boolean(),
      isBattleOnly: v.boolean(),
      formOrder: v.optional(v.number()),
      sprites: v.object({
        frontDefault: v.optional(v.string()),
        frontShiny: v.optional(v.string()),
        officialArtwork: v.optional(v.string()),
      }),
      versionGroup: v.optional(v.string()),
      // Add: species id (national dex id) for the form document
      speciesId: v.optional(v.number()),

      // Add: optional fields used by the forms crawler and for indexing/filtering
      generation: v.optional(v.number()),
      isMega: v.optional(v.boolean()),
      isGigantamax: v.optional(v.boolean()),
      isRegional: v.optional(v.boolean()),
      isGender: v.optional(v.boolean()),
      isCosmetic: v.optional(v.boolean()),
      isAlternate: v.optional(v.boolean()),
    })
      .index("by_form_id", ["formId"])
      .index("by_pokemon_id", ["pokemonId"])
      .index("by_pokemon_name", ["pokemonName"])
      // Add: indexes to support fast lookups for each category and generation
      .index("by_generation", ["generation"])
      .index("by_isMega", ["isMega"])
      .index("by_isGigantamax", ["isGigantamax"])
      .index("by_isRegional", ["isRegional"])
      .index("by_isGender", ["isGender"])
      .index("by_isCosmetic", ["isCosmetic"])
      .index("by_isAlternate", ["isAlternate"]),

    // Add: Cache table for regional Pokédex entries
    regionalDex: defineTable({
      region: v.string(), // canonical region id: kanto, johto, ...
      dexId: v.number(),  // national dex id
      name: v.string(),   // species base name
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
    })
      .index("by_region_and_dexId", ["region", "dexId"]),

    // Add: Cache for gender-difference descriptions sourced from Bulbapedia
    genderDifferences: defineTable({
      pokemonId: v.number(),
      name: v.string(), // species base name (lowercase)
      description: v.string(), // extracted section text
      fetchedAt: v.number(), // epoch ms
      sourceUrl: v.string(), // Bulbapedia URL used
    })
      .index("by_pokemon_id", ["pokemonId"])
      .index("by_name", ["name"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;