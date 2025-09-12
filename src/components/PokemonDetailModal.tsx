import { motion, AnimatePresence } from "framer-motion";
import { X, Heart, Ruler, Weight, Zap, Shield, Sword, Activity, Sparkles } from "lucide-react";
import { ExternalLink } from "lucide-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatPokemonId, formatPokemonName, getTypeColor, calculateStatPercentage } from "@/lib/pokemon-api";
import type { Pokemon } from "@/lib/pokemon-api";
import { POKEMON_GENERATIONS } from "@/lib/pokemon-api";
import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { genderDiffSpecies } from "@/lib/genderDiffSpecies";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PokemonDetailModalProps {
  pokemon: Pokemon | null;
  isOpen: boolean;
  onClose: () => void;
  isFavorite?: boolean;
  onFavoriteToggle?: (pokemonId: number) => void;
  onNavigate?: (direction: "prev" | "next") => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  showGenderDifferences?: boolean;
}

type Stat = { name: string; baseStat: number; effort: number };
type GenderVariant = {
  name: string;
  id: number;
  sprite: string;
  isMale: boolean | null; // null if not male/female specifically
  stats: Stat[];
  types: string[];
  height?: number;
  weight?: number;
  hasSeparateStats: boolean; // false when falling back to default stats
};

export function PokemonDetailModal({
  pokemon,
  isOpen,
  onClose,
  isFavorite = false,
  onFavoriteToggle,
  onNavigate,
  hasPrev,
  hasNext,
  showGenderDifferences = false,
}: PokemonDetailModalProps) {
  if (!pokemon) return null;

  const [enhanced, setEnhanced] = useState<Pokemon | null>(null);
  const [showShiny, setShowShiny] = useState(false);
  const [evolutionPreview, setEvolutionPreview] = useState<Array<{ name: string; sprite?: string; id?: number }>>([]);
  const [baseFormPreview, setBaseFormPreview] = useState<{ name: string; sprite?: string; id?: number } | null>(null);
  const [genderPanelOpen, setGenderPanelOpen] = useState(false);
  const [gvLoading, setGvLoading] = useState(false);
  const [gvError, setGvError] = useState<string | null>(null);
  const [genderVariants, setGenderVariants] = useState<GenderVariant[] | null>(null);

  const fetchGenderDifference = useAction(api.genderDiffActions.fetchGenderDifference);
  const [gdLoading, setGdLoading] = useState(false);
  const [gdError, setGdError] = useState<string | null>(null);
  const [gdText, setGdText] = useState<string | null>(null);
  const [gdSource, setGdSource] = useState<string | null>(null);

  // Helper: gender sprite url fallback (front_default style, not official artwork)
  const genderSpriteUrl = (dexId: number, g: "male" | "female"): string => {
    const base = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
    return g === "female" ? `${base}/female/${dexId}.png` : `${base}/${dexId}.png`;
  };

  useEffect(() => {
    let mounted = true;
    setEnhanced(null);
    setShowShiny(false);
    setEvolutionPreview([]);

    const needsDetails =
      !pokemon.stats?.length ||
      !pokemon.abilities?.length ||
      !pokemon.sprites?.officialArtwork ||
      !pokemon.species?.flavorText;

    if (!needsDetails) return;

    const nameOrId = String(pokemon.name || pokemon.pokemonId);

    const fetchJson = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed ${res.status} ${url}`);
      return res.json();
    };

    const normalize = (base: Pokemon, detail: any, species: any): Pokemon => {
      const types: string[] = Array.isArray(detail?.types)
        ? detail.types.map((t: any) => String(t?.type?.name ?? "")).filter(Boolean)
        : base.types ?? [];

      const abilities: Array<{ name: string; isHidden: boolean }> = Array.isArray(detail?.abilities)
        ? detail.abilities.map((a: any) => ({
            name: String(a?.ability?.name ?? ""),
            isHidden: Boolean(a?.is_hidden),
          })).filter((a: any) => a.name)
        : Array.isArray(base.abilities)
          ? base.abilities.map((a: any) =>
              typeof a === "string" ? { name: a, isHidden: false } : { name: String(a?.name ?? ""), isHidden: Boolean(a?.isHidden) }
            ).filter((a: any) => a.name)
          : [];

      const stats: Array<{ name: string; baseStat: number; effort: number }> = Array.isArray(detail?.stats)
        ? detail.stats
              .map((s: any) => ({
                name: String(s?.stat?.name ?? ""),
                baseStat: Number(s?.base_stat ?? 0),
                effort: Number(s?.effort ?? 0),
              }))
              .filter((s: any) => s.name)
        : Array.isArray(base.stats)
          ? base.stats.map((s: any) => ({
              name: String(s?.name ?? ""),
              baseStat: Number(s?.baseStat ?? s?.value ?? 0),
              effort: Number(s?.effort ?? 0),
            })).filter((s: any) => s.name)
          : [];

      const sprites = {
        frontDefault: detail?.sprites?.front_default ?? base.sprites?.frontDefault,
        frontShiny: detail?.sprites?.front_shiny ?? base.sprites?.frontShiny,
        officialArtwork: detail?.sprites?.other?.["official-artwork"]?.front_default ?? base.sprites?.officialArtwork,
      };

      const pickEnglishFlavor = () => {
        const entries = Array.isArray(species?.flavor_text_entries) ? species.flavor_text_entries : [];
        const en = entries.find((e: any) => e?.language?.name === "en");
        const text = String(en?.flavor_text ?? "").replace(/\f/g, " ").replace(/\n/g, " ").trim();
        return text || base.species?.flavorText;
      };

      const speciesOut = {
        flavorText: pickEnglishFlavor(),
        genus: (() => {
          const g = Array.isArray(species?.genera)
            ? species.genera.find((x: any) => x?.language?.name === "en")?.genus
            : undefined;
          return g ?? base.species?.genus;
        })(),
        captureRate: typeof species?.capture_rate === "number" ? species.capture_rate : base.species?.captureRate,
        baseHappiness: typeof species?.base_happiness === "number" ? species.base_happiness : base.species?.baseHappiness,
        growthRate: String(species?.growth_rate?.name ?? base.species?.growthRate ?? ""),
        habitat: String(species?.habitat?.name ?? base.species?.habitat ?? ""),
        evolutionChainId: (() => {
          const url: string | undefined = species?.evolution_chain?.url;
          if (!url) return base.species?.evolutionChainId;
          const m = url.match(/\/(\d+)\/?$/);
          return m ? Number(m[1]) : base.species?.evolutionChainId;
        })(),
      };

      const parsedGen = (() => {
        const genName: string | undefined = species?.generation?.name;
        if (!genName || typeof genName !== "string") return base.generation;
        const match = genName.match(/generation-(\w+)/);
        if (!match) return base.generation;
        const roman = match[1]?.toUpperCase();
        const romanMap: Record<string, number> = {
          I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9,
        };
        return romanMap[roman] ?? base.generation;
      })();

      return {
        ...base,
        baseExperience: typeof detail?.base_experience === "number" ? detail.base_experience : base.baseExperience,
        height: typeof detail?.height === "number" ? detail.height : base.height,
        weight: typeof detail?.weight === "number" ? detail.weight : base.weight,
        types: types,
        abilities: abilities,
        stats: stats,
        sprites: sprites,
        species: speciesOut,
        generation: typeof base.generation === "number" ? base.generation : (parsedGen ?? base.generation),
      };
    };

    (async () => {
      try {
        let detail: any | null = null;
        let species: any | null = null;

        const API = (import.meta as any)?.env?.VITE_POKEAPI_URL || "https://pokeapi.co/api/v2";

        const tryFetchPokemon = async (name: string) => {
          return await fetchJson(`${API}/pokemon/${name}`);
        };

        const tryFetchPokemonById = async (id: number) => {
          return await fetchJson(`${API}/pokemon/${id}`);
        };

        const tryFetchViaForm = async (formOrName: string) => {
          const form = await fetchJson(`${API}/pokemon-form/${formOrName}`);
          const pUrl: string = String(form?.pokemon?.url ?? "");
          if (!pUrl) throw new Error("Missing linked pokemon url from form");
          const poke = await fetchJson(pUrl);
          const linkedName: string = String(poke?.name ?? formOrName);
          return { poke, linkedName };
        };

        const tryFetchSpecies = async (name: string) => {
          try {
            return await fetchJson(`${API}/pokemon-species/${name}`);
          } catch {
            const asNum = Number(name);
            if (Number.isFinite(asNum) && asNum > 0) {
              return await fetchJson(`${API}/pokemon-species/${asNum}`);
            }
            throw new Error("Species not found");
          }
        };

        let pokemonNameForSpecies: string = nameOrId;

        try {
          detail = await tryFetchPokemon(nameOrId);
          pokemonNameForSpecies = String(detail?.name ?? nameOrId);
        } catch {
          try {
            const { poke, linkedName } = await tryFetchViaForm(nameOrId);
            detail = poke;
            pokemonNameForSpecies = linkedName;
          } catch {
            const idNum = Number(pokemon.pokemonId);
            if (Number.isFinite(idNum) && idNum > 0) {
              detail = await tryFetchPokemonById(idNum);
              pokemonNameForSpecies = String(detail?.name ?? pokemonNameForSpecies);
            } else {
              detail = null;
            }
          }
        }

        species = await tryFetchSpecies(pokemonNameForSpecies);

        if (!mounted) return;

        setEnhanced(normalize(pokemon, detail ?? {}, species ?? {}));
      } catch {
      }
    })();

    return () => {
      mounted = false;
    };
  }, [pokemon]);

  useEffect(() => {
    let mounted = true;
    const API = (import.meta as any)?.env?.VITE_POKEAPI_URL || "https://pokeapi.co/api/v2";

    const loadEvolution = async () => {
      try {
        const evoId = enhanced?.species?.evolutionChainId;
        if (!evoId) return;

        const evoRes = await fetch(`${API}/evolution-chain/${evoId}`);
        if (!evoRes.ok) return;
        const evo = await evoRes.json();

        const collectSpeciesNames = (node: any): string[] => {
          if (!node) return [];
          const name = String(node?.species?.name ?? "").trim();
          const next: any[] = Array.isArray(node?.evolves_to) ? node.evolves_to : [];
          if (next.length === 0) return name ? [name] : [];
          return [name, ...collectSpeciesNames(next[0])];
        };

        const names = collectSpeciesNames(evo?.chain);
        if (!names.length) return;

        const sprites = await Promise.all(
          names.map(async (nm) => {
            try {
              // First try the direct pokemon endpoint
              let pd: any | null = null;
              let pr = await fetch(`${API}/pokemon/${nm}`);
              if (!pr.ok) {
                // Fallback: fetch species to find a default variety (handles cases like "toxtricity")
                const sr = await fetch(`${API}/pokemon-species/${nm}`);
                if (!sr.ok) throw new Error("species fail");
                const sp = await sr.json();
                const varieties: any[] = Array.isArray(sp?.varieties) ? sp.varieties : [];
                const def = varieties.find((v: any) => Boolean(v?.is_default));
                const varPokeUrl: string | undefined = def?.pokemon?.url || varieties[0]?.pokemon?.url;
                if (!varPokeUrl) throw new Error("no variety");
                pr = await fetch(varPokeUrl);
                if (!pr.ok) throw new Error("pokemon from variety fail");
              }
              pd = await pr.json();

              const sprite: string | undefined =
                pd?.sprites?.other?.["official-artwork"]?.front_default ||
                pd?.sprites?.front_default ||
                undefined;
              const idNum: number | undefined = typeof pd?.id === "number" ? pd.id : undefined;
              return { name: nm, sprite, id: idNum };
            } catch {
              return { name: nm };
            }
          })
        );

        if (!mounted) return;
        setEvolutionPreview(sprites);
      } catch {
      }
    };

    setEvolutionPreview([]);
    if (enhanced?.species?.evolutionChainId) {
      loadEvolution();
    }

    return () => {
      mounted = false;
    };
  }, [enhanced?.species?.evolutionChainId]);

  useEffect(() => {
    const API = (import.meta as any)?.env?.VITE_POKEAPI_URL || "https://pokeapi.co/api/v2";
    const nm = String((enhanced ?? pokemon)?.name ?? "").toLowerCase();

    // Only proceed for Mega forms
    const isMegaLocal = (() => {
      if (!nm) return false;
      return nm.includes("-mega");
    })();

    // Derive base species from Mega form name
    const deriveBaseFromMega = (nameLower: string): string | null => {
      if (!nameLower) return null;
      if (nameLower.endsWith("-mega-x")) return nameLower.slice(0, -7);
      if (nameLower.endsWith("-mega-y")) return nameLower.slice(0, -7);
      if (nameLower.endsWith("-mega")) return nameLower.slice(0, -5);
      // Fallback: if contains "-mega" anywhere, strip that suffix and anything after it
      const idx = nameLower.indexOf("-mega");
      if (idx > 0) return nameLower.slice(0, idx);
      return null;
    };

    const baseName = deriveBaseFromMega(nm);
    setBaseFormPreview(null);
    if (!isMegaLocal || !baseName) return;

    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`${API}/pokemon/${baseName}`);
        if (!res.ok) return;
        const data = await res.json();
        const sprite: string | undefined =
          data?.sprites?.other?.["official-artwork"]?.front_default ||
          data?.sprites?.front_default ||
          undefined;
        const idNum: number | undefined = typeof data?.id === "number" ? data.id : undefined;
        if (!mounted) return;
        setBaseFormPreview({ name: baseName, sprite, id: idNum });
      } catch {
        // ignore
      }
    })();

    return () => {
      mounted = false;
    };
  }, [enhanced?.name, pokemon?.name]);

  const loadGenderVariants = async () => {
    if (genderVariants || gvLoading) return;
    try {
      setGvLoading(true);
      setGvError(null);

      const API = (import.meta as any)?.env?.VITE_POKEAPI_URL || "https://pokeapi.co/api/v2";
      const baseName = String((enhanced ?? pokemon)?.name ?? "").toLowerCase();
      const baseId = Number((enhanced ?? pokemon)?.pokemonId ?? pokemon?.pokemonId ?? 0);

      const fetchJson = async (url: string) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
        return r.json();
      };

      // Get base pokemon (stats/types/sprites) and candidate forms
      const baseP = await fetchJson(`${API}/pokemon/${baseName}`).catch(async () => {
        // Fallback to id if name fails
        if (!Number.isFinite(baseId) || baseId <= 0) throw new Error("Base pokemon not found");
        return await fetchJson(`${API}/pokemon/${baseId}`);
      });

      const candidateFormNames: string[] = [
        String(baseP?.name ?? baseName),
        ...(Array.isArray(baseP?.forms) ? baseP.forms.map((f: any) => String(f?.name ?? "")).filter(Boolean) : []),
      ];
      // Deduplicate
      const uniqFormNames = Array.from(new Set(candidateFormNames));

      // Identify male/female form names if present
      const maleFormName = uniqFormNames.find((n) => n.endsWith("-male"));
      const femaleFormName = uniqFormNames.find((n) => n.endsWith("-female"));

      const fetchPokemonDetail = async (nameOrId: string | number) => {
        const p = await fetchJson(`${API}/pokemon/${nameOrId}`);
        const id: number = typeof p?.id === "number" ? p.id : baseId;
        const types: string[] = Array.isArray(p?.types)
          ? p.types.map((t: any) => String(t?.type?.name ?? "")).filter(Boolean)
          : [];
        const stats: Stat[] = Array.isArray(p?.stats)
          ? p.stats
              .map((s: any) => ({
                name: String(s?.stat?.name ?? ""),
                baseStat: Number(s?.base_stat ?? 0),
                effort: Number(s?.effort ?? 0),
              }))
              .filter((s: any) => s.name)
          : [];
        const height: number | undefined = typeof p?.height === "number" ? p.height : undefined;
        const weight: number | undefined = typeof p?.weight === "number" ? p.weight : undefined;
        const sprite: string | undefined =
          p?.sprites?.other?.["official-artwork"]?.front_default || p?.sprites?.front_default || undefined;
        return { id, types, stats, height, weight, sprite };
      };

      // Prepare base details for fallback
      const baseDetail = await fetchPokemonDetail(String(baseP?.name ?? baseName));

      // Build Male variant
      let maleVariant: GenderVariant | null = null;
      if (maleFormName) {
        const info = await fetchPokemonDetail(maleFormName);
        maleVariant = {
          name: maleFormName,
          id: info.id,
          sprite: info.sprite || genderSpriteUrl(info.id || baseId, "male"),
          isMale: true,
          stats: info.stats,
          types: info.types.length ? info.types : baseDetail.types,
          height: info.height ?? baseDetail.height,
          weight: info.weight ?? baseDetail.weight,
          hasSeparateStats: true,
        };
      } else {
        // Fallback to base stats with male sprite (front_default path)
        maleVariant = {
          name: String(baseP?.name ?? baseName),
          id: baseDetail.id || baseId,
          sprite: baseDetail.sprite || genderSpriteUrl(baseDetail.id || baseId, "male"),
          isMale: true,
          stats: baseDetail.stats,
          types: baseDetail.types,
          height: baseDetail.height,
          weight: baseDetail.weight,
          hasSeparateStats: false,
        };
      }

      // Build Female variant
      let femaleVariant: GenderVariant | null = null;
      if (femaleFormName) {
        const info = await fetchPokemonDetail(femaleFormName);
        femaleVariant = {
          name: femaleFormName,
          id: info.id,
          sprite: info.sprite || genderSpriteUrl(info.id || baseId, "female"),
          isMale: false,
          stats: info.stats,
          types: info.types.length ? info.types : baseDetail.types,
          height: info.height ?? baseDetail.height,
          weight: info.weight ?? baseDetail.weight,
          hasSeparateStats: true,
        };
      } else {
        // Fallback to base stats with female sprite path, if exists
        femaleVariant = {
          name: String(baseP?.name ?? baseName),
          id: baseDetail.id || baseId,
          sprite: genderSpriteUrl(baseDetail.id || baseId, "female"),
          isMale: false,
          stats: baseDetail.stats,
          types: baseDetail.types,
          height: baseDetail.height,
          weight: baseDetail.weight,
          hasSeparateStats: false,
        };
      }

      // If both variants are identical sprites and no separate stats, still show both as requested.
      setGenderVariants([maleVariant, femaleVariant]);
    } catch (e) {
      setGvError(e instanceof Error ? e.message : "Failed to load gender variants");
      setGenderVariants(null);
    } finally {
      setGvLoading(false);
    }
  };

  const handleFavoriteClick = () => {
    onFavoriteToggle?.(pokemon.pokemonId);
  };

  const statIcons = {
    hp: Activity,
    attack: Sword,
    defense: Shield,
    "special-attack": Zap,
    "special-defense": Shield,
    speed: Activity,
  };

  const data = enhanced ?? pokemon;
  // Add: stable base dex id for sprite fallbacks used in render
  const baseDexId = Number((enhanced ?? pokemon)?.pokemonId ?? 0);
  const heightM = Number.isFinite(data?.height) ? (data!.height / 10).toFixed(1) : "–";
  const weightKg = Number.isFinite(data?.weight) ? (data!.weight / 10).toFixed(1) : "–";
  const spriteDefault = data?.sprites?.officialArtwork || data?.sprites?.frontDefault;
  const spriteShiny = data?.sprites?.frontShiny || undefined;
  const currentSprite = showShiny && spriteShiny ? spriteShiny : spriteDefault;

  const isGmax = (() => {
    const n = String(data?.name ?? "").toLowerCase();
    return n.includes("gmax") || n.includes("gigantamax");
  })();

  const isMega = (() => {
    const n = String(data?.name ?? "").toLowerCase();
    return n.includes("mega");
  })();

  const megaVariant: "X" | "Y" | undefined = (() => {
    if (!isMega) return undefined;
    const n = String(data?.name ?? "").toLowerCase();
    if (n.endsWith("-mega-x")) return "X";
    if (n.endsWith("-mega-y")) return "Y";
    return undefined;
  })();

  const isAlternateForm = (() => {
    const n = String(data?.name ?? "").toLowerCase();
    if (!n) return false;
    if (isMega || isGmax) return false;
    return n.includes("-");
  })();

  const gmaxMove: string | undefined = (() => {
    if (!isGmax) return undefined;
    const lower = String(data?.name ?? "").toLowerCase();
    let base = lower;
    if (lower.endsWith("-gmax")) base = lower.slice(0, -5);
    else if (lower.endsWith("-gigantamax")) base = lower.slice(0, -"gigantamax".length - 1);
    const MOVES: Record<string, string> = {
      venusaur: "G-Max Vine Lash",
      charizard: "G-Max Wildfire",
      blastoise: "G-Max Cannonade",
      butterfree: "G-Max Befuddle",
      pikachu: "G-Max Volt Crash",
      meowth: "G-Max Gold Rush",
      machamp: "G-Max Chi Strike",
      gengar: "G-Max Terror",
      kingler: "G-Max Foam Burst",
      lapras: "G-Max Resonance",
      eevee: "G-Max Cuddle",
      snorlax: "G-Max Replenish",
      garbodor: "G-Max Malodor",
      melmetal: "G-Max Meltdown",
      rillaboom: "G-Max Drum Solo",
      cinderace: "G-Max Fireball",
      inteleon: "G-Max Hydrosnipe",
      corviknight: "G-Max Wind Rage",
      orbeetle: "G-Max Gravitas",
      drednaw: "G-Max Stonesurge",
      coalossal: "G-Max Volcalith",
      flapple: "G-Max Tartness",
      appletun: "G-Max Sweetness",
      sandaconda: "G-Max Sandblast",
      toxtricity: "G-Max Stun Shock",
      centiskorch: "G-Max Centiferno",
      hatterene: "G-Max Smite",
      grimmsnarl: "G-Max Snooze",
      alcremie: "G-Max Finale",
      copperajah: "G-Max Steelsurge",
      duraludon: "G-Max Depletion",
    };
    return MOVES[base];
  })();

  const typesSafe: string[] = Array.isArray(data?.types) ? data!.types : [];
  // Add: derive a primary theme color from the first type (fallback to Tailwind blue)
  const primaryTypeColor: string = (() => {
    const t = typesSafe[0];
    try {
      return t ? getTypeColor(t) : "#3b82f6";
    } catch {
      return "#3b82f6";
    }
  })();

  const statsSafe: Array<{ name: string; baseStat: number; effort: number }> =
    Array.isArray((data as any)?.stats)
      ? (data as any).stats.map((s: any) => ({
          name: String(s?.name ?? s?.stat?.name ?? ""),
          baseStat: Number(s?.baseStat ?? s?.value ?? 0),
          effort: Number(s?.effort ?? 0),
        })).filter((s: any) => s.name)
      : [];
  const abilitiesSafe: Array<{ name: string; isHidden: boolean }> =
    Array.isArray((data as any)?.abilities)
      ? (data as any).abilities.map((a: any) =>
          typeof a === "string"
            ? { name: a, isHidden: false }
            : { name: String(a?.name ?? a?.ability?.name ?? ""), isHidden: Boolean(a?.isHidden ?? a?.is_hidden) }
        ).filter((a: any) => a.name)
      : [];
  const movesSafe: string[] = Array.isArray(data?.moves)
    ? data!.moves.map((m: any) => (typeof m === "string" ? m : String(m?.move?.name ?? ""))).filter(Boolean)
    : [];
  const statTotal = statsSafe.reduce((sum, s) => sum + (Number.isFinite(s.baseStat) ? s.baseStat : 0), 0);

  const generationNumber: number | undefined =
    typeof (data as any)?.generation === "number" ? (data as any).generation : undefined;
  const regionLabel = (() => {
    if (!generationNumber) return undefined;
    const found = POKEMON_GENERATIONS.find((g) => g.id === generationNumber);
    return found ? found.name : undefined;
  })();

  const normalizeForWhitelist = (nm: string): string => {
    const lower = nm.toLowerCase();
    if (lower.endsWith("-mega-x")) return lower.slice(0, -7);
    if (lower.endsWith("-mega-y")) return lower.slice(0, -7);
    if (lower.endsWith("-mega")) return lower.slice(0, -5);
    if (lower.endsWith("-gmax")) return lower.slice(0, -5);
    if (lower.endsWith("-gigantamax")) return lower.slice(0, -"gigantamax".length - 1);
    if (lower.endsWith("-male")) return lower.slice(0, -5);
    if (lower.endsWith("-female")) return lower.slice(0, -7);
    return lower;
  };

  const inGenderDiffWhitelist = (() => {
    const nm = String((enhanced ?? pokemon)?.name ?? "").trim();
    if (!nm) return false;
    const normalized = normalizeForWhitelist(nm);
    // genderDiffSpecies is already canonicalized; compare lowercased
    return genderDiffSpecies.some((s) => s.toLowerCase() === normalized);
  })();

  useEffect(() => {
    const run = async () => {
      setGdLoading(false);
      setGdError(null);
      setGdText(null);
      setGdSource(null);
      if (!isOpen || !showGenderDifferences || !inGenderDiffWhitelist) return;

      try {
        setGdLoading(true);
        const nm = String((enhanced ?? pokemon)?.name ?? "").toLowerCase();
        const dexId = Number((enhanced ?? pokemon)?.pokemonId ?? pokemon?.pokemonId ?? 0);
        if (!nm || !Number.isFinite(dexId) || dexId <= 0) {
          setGdText("No known visual gender differences.");
          return;
        }
        const res = await fetchGenderDifference({ name: normalizeForWhitelist(nm), dexId });
        setGdText(res.description || "No known visual gender differences.");
        setGdSource((res as any).sourceUrl || null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load description";
        setGdError(msg);
      } finally {
        setGdLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, showGenderDifferences, inGenderDiffWhitelist, (enhanced ?? pokemon)?.name, (enhanced ?? pokemon)?.pokemonId]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={`w-[95vw] sm:max-w-3xl max-h-[90vh] p-0 rounded-lg sm:rounded-xl border-2 ${isMega ? "ring-2 ring-fuchsia-500/30 shadow-lg shadow-fuchsia-500/20" : ""}`}
        // Add subtle themed border/glow using primary type color (only adds when not Mega)
        style={!isMega ? { borderColor: primaryTypeColor + "33", boxShadow: `0 10px 30px ${primaryTypeColor}22` } : undefined}
      >
        <ScrollArea className="max-h-[90vh]">
          <div className="p-4 sm:p-6">
            {/* Header */}
            <DialogHeader className="flex flex-row items-center justify-between space-y-0 mb-6">
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-muted-foreground">
                  #{formatPokemonId(pokemon.pokemonId)}
                </span>
                <DialogTitle className="text-2xl font-bold tracking-tight flex items-center gap-2">
                  {formatPokemonName(pokemon.name)}
                  {isMega && (
                    <span
                      title="Mega Evolution"
                      aria-label="Mega Evolution"
                      className="inline-flex items-center justify-center rounded-full bg-background border shadow p-1.5 ring-2 ring-fuchsia-500/40"
                    >
                      <img
                        src="https://harmless-tapir-303.convex.cloud/api/storage/5bccd8f0-8ff6-48ea-9149-b26759dfe4d5"
                        alt="Mega Evolution"
                        className="h-6 w-6 object-contain drop-shadow"
                      />
                    </span>
                  )}
                </DialogTitle>
              </div>
              <div className="flex items-center gap-2">
                {typeof onNavigate === "function" && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onNavigate("prev")}
                      disabled={!hasPrev}
                      aria-label="Previous Pokémon"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onNavigate("next")}
                      disabled={!hasNext}
                      aria-label="Next Pokémon"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </>
                )}
                {onFavoriteToggle && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleFavoriteClick}
                  >
                    <Heart 
                      className={`h-5 w-5 ${isFavorite ? 'fill-red-500 text-red-500' : 'text-muted-foreground'}`} 
                    />
                  </Button>
                )}
              </div>
            </DialogHeader>

            {/* Main Content */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Left Column */}
              <div className="space-y-4">
                {/* Pokemon Image with Shiny toggle */}
                <div className="relative">
                  <div
                    className={`w-full aspect-square rounded-lg flex items-center justify-center
                      ${isGmax
                        ? "bg-gradient-to-br from-purple-600/15 via-fuchsia-500/10 to-purple-700/15 ring-2 ring-purple-500/30 shadow-lg shadow-purple-500/20"
                        : isMega
                          ? "bg-gradient-to-br from-fuchsia-600/15 via-pink-500/10 to-fuchsia-700/15 ring-2 ring-fuchsia-500/30 shadow-lg shadow-fuchsia-500/20"
                          : "bg-gradient-to-br from-muted/50 to-muted border-2"}
                    `}
                    // Themed ring and shadow for non Mega/G-Max
                    style={!isGmax && !isMega ? { borderColor: primaryTypeColor + "33", boxShadow: `0 8px 24px ${primaryTypeColor}22` } : undefined}
                  >
                    {currentSprite ? (
                      <motion.img
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 220, damping: 20 }}
                        src={currentSprite}
                        alt={pokemon.name}
                        className={`w-4/5 h-4/5 object-contain ${isGmax ? "drop-shadow-[0_8px_24px_rgba(168,85,247,0.35)]" : ""}`}
                      />
                    ) : (
                      <div className="text-6xl">❓</div>
                    )}
                  </div>

                  {/* G-MAX badge */}
                  {isGmax && (
                    <div className="absolute -top-2 -left-2">
                      <span
                        title="Gigantamax"
                        aria-label="Gigantamax"
                        className="inline-flex items-center justify-center rounded-full bg-background border shadow p-1.5 ring-2 ring-pink-500/40"
                      >
                        <img
                          src="https://harmless-tapir-303.convex.cloud/api/storage/63c94427-b9f7-4312-b254-b148bf2b227e"
                          alt="Gigantamax"
                          className="h-6 w-6 object-contain drop-shadow"
                        />
                      </span>
                    </div>
                  )}

                  {/* Mega badge */}
                  {isMega && (
                    <div className="absolute -top-2 -right-2">
                      <span
                        title="Mega Evolution"
                        aria-label="Mega Evolution"
                        className="inline-flex items-center justify-center rounded-full bg-background border shadow p-1.5 ring-2 ring-fuchsia-500/40"
                      >
                        <img
                          src="https://harmless-tapir-303.convex.cloud/api/storage/5bccd8f0-8ff6-48ea-9149-b26759dfe4d5"
                          alt="Mega Evolution"
                          className="h-6 w-6 object-contain drop-shadow"
                        />
                      </span>
                    </div>
                  )}

                  {/* Shiny toggle control (only shown if shiny exists) */}
                  {spriteShiny && (
                    <div className="mt-3 flex items-center justify-center gap-2">
                      {(() => {
                        const baseClass = "transition-colors";
                        const shinyClass = showShiny
                          ? (isGmax
                              ? "bg-purple-600/15 ring-2 ring-purple-500/40"
                              : isMega
                                ? "bg-fuchsia-600/15 ring-2 ring-fuchsia-500/40"
                                : isAlternateForm
                                  ? "bg-sky-600/10 ring-2 ring-sky-500/40"
                                  : "")
                          : (isGmax
                              ? "hover:ring-1 hover:ring-purple-500/30"
                              : isMega
                                ? "hover:ring-1 hover:ring-fuchsia-500/30"
                                : isAlternateForm
                                  ? "hover:ring-1 hover:ring-sky-500/30"
                                  : "");

                        return (
                          <Button
                            variant={showShiny ? "default" : "outline"}
                            size="sm"
                            onClick={() => setShowShiny((s) => !s)}
                            aria-pressed={showShiny}
                            className={`${baseClass} ${shinyClass}`}
                          >
                            <Sparkles
                              className={`h-4 w-4 mr-1 ${showShiny ? (isGmax ? "text-purple-500" : isMega ? "text-fuchsia-500" : isAlternateForm ? "text-sky-500" : "text-foreground") : "text-muted-foreground"}`}
                            />
                            {showShiny ? "Showing Shiny" : "Show Shiny"}
                          </Button>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Types */}
                <div className="flex gap-2 justify-center">
                  {typesSafe.map((type) => (
                    <Badge
                      key={type}
                      variant="secondary"
                      className="px-3 py-1 font-medium"
                      style={{
                        backgroundColor: getTypeColor(type) + "20",
                        color: getTypeColor(type),
                        borderColor: getTypeColor(type) + "40",
                      }}
                    >
                      {formatPokemonName(type)}
                    </Badge>
                  ))}
                </div>

                {/* G-MAX Move chip under image */}
                {isGmax && gmaxMove && (
                  <div className="mt-2 text-center">
                    <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium bg-purple-500/10 text-foreground border-purple-500/30">
                      G-MAX Move: <span className="ml-1 font-semibold">{gmaxMove}</span>
                    </span>
                  </div>
                )}

                {/* Physical Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <Ruler className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                    <div className="text-sm text-muted-foreground">Height</div>
                    <div className="font-semibold">{heightM}m</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <Weight className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                    <div className="text-sm text-muted-foreground">Weight</div>
                    <div className="font-semibold">{weightKg}kg</div>
                  </div>
                </div>

                {/* Description */}
                {(data?.species?.flavorText) && (
                  <div className="p-4 bg-muted/30 rounded-lg">
                    <h4 className="font-semibold mb-2">Description</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {data.species.flavorText}
                    </p>
                  </div>
                )}

                {/* Moved: Additional Info (species data) under Description */}
                {(data?.species) && (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {isGmax && (
                      <div>
                        <div className="text-muted-foreground">Form</div>
                        <div className="font-medium">Gigantamax</div>
                      </div>
                    )}
                    {isGmax && gmaxMove && (
                      <div>
                        <div className="text-muted-foreground">G-MAX Move</div>
                        <div className="font-medium">{gmaxMove}</div>
                      </div>
                    )}
                    {isMega && (
                      <div>
                        <div className="text-muted-foreground">Form</div>
                        <div className="font-medium">
                          Mega Evolution{megaVariant ? ` (${megaVariant})` : ""}
                        </div>
                      </div>
                    )}
                    {generationNumber && (
                      <>
                        <div>
                          <div className="text-muted-foreground">Generation</div>
                          <div className="font-medium">Gen {generationNumber}</div>
                        </div>
                        {regionLabel && (
                          <div>
                            <div className="text-muted-foreground">Region</div>
                            <div className="font-medium">{regionLabel}</div>
                          </div>
                        )}
                      </>
                    )}
                    {data.species.genus && (
                      <div>
                        <div className="text-muted-foreground">Species</div>
                        <div className="font-medium">{data.species.genus}</div>
                      </div>
                    )}
                    {data.species.habitat && (
                      <div>
                        <div className="text-muted-foreground">Habitat</div>
                        <div className="font-medium capitalize">{data.species.habitat}</div>
                      </div>
                    )}
                    {typeof data.species.captureRate === "number" && (
                      <div>
                        <div className="text-muted-foreground">Capture Rate</div>
                        <div className="font-medium">{data.species.captureRate}</div>
                      </div>
                    )}
                    {/* Only show Base EXP when > 0 to avoid stray "0" */}
                    {(typeof data.baseExperience === "number" && data.baseExperience > 0) && (
                      <div>
                        <div className="text-muted-foreground">Base EXP</div>
                        <div className="font-medium">{data.baseExperience}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right Column - Stats and Details */}
              <div className="space-y-6">
                {/* Base Stats */}
                <div>
                  <h4 className="font-semibold mb-4 flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Base Stats
                    {statTotal > 0 && (
                      <span className="ml-auto text-sm text-muted-foreground">
                        Total: <span className="font-semibold text-foreground">{statTotal}</span>
                      </span>
                    )}
                  </h4>
                  <div className="space-y-3">
                    {statsSafe.map((stat) => {
                      const name = String(stat?.name ?? "stat");
                      const IconComponent = ((): any => {
                        switch (name) {
                          case "hp": return Activity;
                          case "attack": return Sword;
                          case "defense": return Shield;
                          case "special-attack": return Zap;
                          case "special-defense": return Shield;
                          case "speed": return Activity;
                          default: return Activity;
                        }
                      })();
                      const base = Number(stat?.baseStat ?? 0);
                      const percentage = calculateStatPercentage(base);

                      return (
                        <div key={name} className="space-y-1">
                          <div className="flex justify-between items-center text-sm">
                            <div className="flex items-center gap-2">
                              <IconComponent className="h-3 w-3 text-muted-foreground" />
                              <span className="capitalize font-medium">
                                {name.replace("-", " ")}
                              </span>
                            </div>
                            <span className="font-mono font-semibold">{base}</span>
                          </div>
                          <Progress value={percentage} className="h-2" />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Evolution Chain Preview */}
                {evolutionPreview.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-3">Evolution Chain</h4>
                    <div className="flex items-center gap-3 overflow-x-auto pb-2">
                      {evolutionPreview.map((s, i) => (
                        <div key={`${s.name}-${i}`} className="flex items-center gap-3">
                          <div className="flex flex-col items-center">
                            <div className="w-16 h-16 rounded-full bg-muted/50 border flex items-center justify-center">
                              {s.sprite ? (
                                <img
                                  src={s.sprite}
                                  alt={s.name}
                                  className="w-12 h-12 object-contain"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="text-xs text-muted-foreground">No Img</div>
                              )}
                            </div>
                            <div className="mt-1 text-xs font-medium capitalize">
                              {formatPokemonName(s.name)}
                            </div>
                          </div>
                          {i < evolutionPreview.length - 1 && (
                            <div className="text-muted-foreground">→</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Base Form (for Mega evolutions) */}
                {isMega && baseFormPreview && (
                  <div>
                    <h4 className="font-semibold mb-3">Base Form</h4>
                    <div className="flex items-center gap-3">
                      <div className="w-16 h-16 rounded-full bg-muted/50 border flex items-center justify-center">
                        {baseFormPreview.sprite ? (
                          <img
                            src={baseFormPreview.sprite}
                            alt={baseFormPreview.name}
                            className="w-12 h-12 object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <div className="text-xs text-muted-foreground">No Img</div>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <div className="text-sm font-medium capitalize">
                          {formatPokemonName(baseFormPreview.name)}
                        </div>
                        {typeof baseFormPreview.id === "number" && (
                          <div className="text-xs text-muted-foreground">
                            #{formatPokemonId(baseFormPreview.id)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Top Moves (preview) */}
                {(() => {
                  const topMoves = movesSafe.slice(0, 10);
                  if (topMoves.length === 0) return null;
                  return (
                    <div>
                      <h4 className="font-semibold mb-3">Top Moves</h4>
                      <div className="flex flex-wrap gap-2">
                        {topMoves.map((m, idx) => (
                          <Badge key={`${m}-${idx}`} variant="outline" className="capitalize">
                            {String(m).replace("-", " ")}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Abilities */}
                <div>
                  <h4 className="font-semibold mb-3">Abilities</h4>
                  <div className="space-y-2">
                    {abilitiesSafe.map((ability, index) => (
                      <div
                        key={`${ability.name}-${index}`}
                        className="flex items-center justify-between p-2 bg-muted/30 rounded"
                      >
                        <span className="capitalize font-medium">
                          {String(ability.name).replace("-", " ")}
                        </span>
                        {ability.isHidden && (
                          <Badge variant="outline" className="text-xs">
                            Hidden
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Gender Differences (only when filter is active AND species in whitelist) */}
                {showGenderDifferences && inGenderDiffWhitelist && (
                  <div
                    className={`p-4 rounded-lg border ${
                      isGmax
                        ? "bg-gradient-to-br from-purple-600/10 via-fuchsia-500/5 to-purple-700/10 border-purple-500/30"
                        : isMega
                        ? "bg-gradient-to-br from-fuchsia-600/10 via-pink-500/5 to-fuchsia-700/10 border-fuchsia-500/30"
                        : "bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <img
                          src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                          alt=""
                          className="h-4 w-4 opacity-70"
                        />
                        <h4 className="font-semibold">Gender Differences</h4>
                      </div>
                      {gdSource && (
                        <a
                          href={gdSource}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs underline text-muted-foreground hover:text-foreground"
                          aria-label="Open Bulbapedia source"
                        >
                          Source
                        </a>
                      )}
                    </div>

                    {gdLoading && (
                      <div className="w-full flex items-center justify-center py-3">
                        <div className="h-10 w-10 rounded-full bg-white/10 backdrop-blur ring-2 ring-white/40 shadow-md flex items-center justify-center animate-pulse">
                          <img
                            src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                            alt="Loading Pokéball"
                            className="h-7 w-7 animate-bounce-spin drop-shadow"
                          />
                        </div>
                      </div>
                    )}

                    {!gdLoading && gdError && (
                      <p className="text-sm text-muted-foreground">
                        No known visual gender differences.
                      </p>
                    )}

                    {!gdLoading && !gdError && (
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {gdText || "No known visual gender differences."}
                      </p>
                    )}

                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Descriptions sourced from{" "}
                      <a
                        href={gdSource || "https://bulbapedia.bulbagarden.net/"}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        Bulbapedia
                      </a>
                      .
                    </div>
                  </div>
                )}

                {/* Additional Info */}
                {(data?.species) && (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {isGmax && (
                      <div>
                        <div className="text-muted-foreground">Form</div>
                        <div className="font-medium">Gigantamax</div>
                      </div>
                    )}
                    {isGmax && gmaxMove && (
                      <div>
                        <div className="text-muted-foreground">G-MAX Move</div>
                        <div className="font-medium">{gmaxMove}</div>
                      </div>
                    )}
                    {isMega && (
                      <div>
                        <div className="text-muted-foreground">Form</div>
                        <div className="font-medium">
                          Mega Evolution{megaVariant ? ` (${megaVariant})` : ""}
                        </div>
                      </div>
                    )}
                    {generationNumber && (
                      <>
                        <div>
                          <div className="text-muted-foreground">Generation</div>
                          <div className="font-medium">Gen {generationNumber}</div>
                        </div>
                        {regionLabel && (
                          <div>
                            <div className="text-muted-foreground">Region</div>
                            <div className="font-medium">{regionLabel}</div>
                          </div>
                        )}
                      </>
                    )}
                    {data.species.genus && (
                      <div>
                        <div className="text-muted-foreground">Species</div>
                        <div className="font-medium">{data.species.genus}</div>
                      </div>
                    )}
                    {data.species.habitat && (
                      <div>
                        <div className="text-muted-foreground">Habitat</div>
                        <div className="font-medium capitalize">{data.species.habitat}</div>
                      </div>
                    )}
                    {typeof data.species.captureRate === "number" && (
                      <div>
                        <div className="text-muted-foreground">Capture Rate</div>
                        <div className="font-medium">{data.species.captureRate}</div>
                      </div>
                    )}
                    {(typeof data.baseExperience === "number" && data.baseExperience > 0) && (
                      <div>
                        <div className="text-muted-foreground">Base EXP</div>
                        <div className="font-medium">{data.baseExperience}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Gender Differences Panel */}
                {genderPanelOpen && (
                  <div className="mt-3 p-3 rounded-lg border bg-gradient-to-br from-pink-500/5 to-purple-500/5">
                    {gvLoading && (
                      <div className="w-full flex items-center justify-center py-3" aria-busy="true" aria-live="polite">
                        <div className="px-4 h-10 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow border border-white/10 flex items-center justify-center animate-pulse">
                          <div className="h-8 w-8 rounded-full bg-white/10 backdrop-blur ring-2 ring-white/40 shadow flex items-center justify-center">
                            <img
                              src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                              alt="Loading Pokéball"
                              className="h-6 w-6 animate-bounce-spin drop-shadow"
                            />
                          </div>
                          <span className="ml-2 text-xs">Loading gender variants…</span>
                        </div>
                      </div>
                    )}

                    {!gvLoading && gvError && (
                      <div className="text-sm text-muted-foreground">
                        Failed to load gender variants. Showing default details.
                      </div>
                    )}

                    {!gvLoading && !gvError && Array.isArray(genderVariants) && genderVariants.length > 0 && (
                      <Tabs defaultValue="male" className="w-full">
                        <TabsList className="grid grid-cols-2 w-full">
                          <TabsTrigger value="male">Male</TabsTrigger>
                          <TabsTrigger value="female">Female</TabsTrigger>
                        </TabsList>
                        {genderVariants.map((v, idx) => {
                          const value = v.isMale ? "male" : "female";
                          return (
                            <TabsContent key={`${value}-${idx}`} value={value} className="mt-3">
                              <div className="grid sm:grid-cols-2 gap-4">
                                {/* Sprite */}
                                <div className="w-full flex items-center justify-center">
                                  <div className="w-52 h-52 flex items-center justify-center bg-gradient-to-br from-muted/50 to-muted rounded-lg border">
                                    <img
                                      src={v.sprite}
                                      alt={`${(enhanced ?? pokemon)?.name} ${value}`}
                                      className="w-44 h-44 object-contain"
                                      onError={(e) => {
                                        const img = e.currentTarget as HTMLImageElement;
                                        img.src = v.isMale === false
                                          ? genderSpriteUrl(v.id || baseDexId, "female")
                                          : genderSpriteUrl(v.id || baseDexId, "male");
                                      }}
                                    />
                                  </div>
                                </div>

                                {/* Info */}
                                <div className="space-y-3">
                                  {/* Types */}
                                  <div className="flex gap-2 flex-wrap">
                                    {v.types.map((t) => (
                                      <Badge
                                        key={`${value}-${t}`}
                                        variant="secondary"
                                        className="px-3 py-1 font-medium"
                                        style={{
                                          backgroundColor: getTypeColor(t) + "20",
                                          color: getTypeColor(t),
                                          borderColor: getTypeColor(t) + "40",
                                        }}
                                      >
                                        {formatPokemonName(t)}
                                      </Badge>
                                    ))}
                                  </div>

                                  {/* Height/Weight */}
                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="text-center p-2 bg-muted/50 rounded-lg">
                                      <Ruler className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                                      <div className="text-xs text-muted-foreground">Height</div>
                                      <div className="font-semibold">
                                        {typeof v.height === "number" ? (v.height / 10).toFixed(1) : "–"}m
                                      </div>
                                    </div>
                                    <div className="text-center p-2 bg-muted/50 rounded-lg">
                                      <Weight className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                                      <div className="text-xs text-muted-foreground">Weight</div>
                                      <div className="font-semibold">
                                        {typeof v.weight === "number" ? (v.weight / 10).toFixed(1) : "–"}kg
                                      </div>
                                    </div>
                                  </div>

                                  {/* Stats */}
                                  <div>
                                    <h5 className="font-semibold mb-2 text-sm">Base Stats</h5>
                                    <div className="space-y-2">
                                      {v.stats.map((s) => {
                                        const nm = String(s?.name ?? "stat");
                                        const base = Number(s?.baseStat ?? 0);
                                        const percentage = calculateStatPercentage(base);
                                        const IconComponent = ((): any => {
                                          switch (nm) {
                                            case "hp": return Activity;
                                            case "attack": return Sword;
                                            case "defense": return Shield;
                                            case "special-attack": return Zap;
                                            case "special-defense": return Shield;
                                            case "speed": return Activity;
                                            default: return Activity;
                                          }
                                        })();
                                        return (
                                          <div key={`${value}-${nm}`} className="space-y-0.5">
                                            <div className="flex justify-between items-center text-xs">
                                              <div className="flex items-center gap-2">
                                                <IconComponent className="h-3 w-3 text-muted-foreground" />
                                                <span className="capitalize font-medium">
                                                  {nm.replace("-", " ")}
                                                </span>
                                              </div>
                                              <span className="font-mono font-semibold">{base}</span>
                                            </div>
                                            <Progress value={percentage} className="h-2" />
                                          </div>
                                        );
                                      })}
                                    </div>
                                    {!v.hasSeparateStats && (
                                      <div className="mt-2 text-[11px] text-muted-foreground">
                                        No separate stats for this gender. Showing default stats.
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </TabsContent>
                          );
                        })}
                      </Tabs>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}