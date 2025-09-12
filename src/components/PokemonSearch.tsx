import { useState, useEffect } from "react";
import { Search, Filter, X, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { POKEMON_TYPES } from "@/lib/pokemon-api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PokemonSearchProps {
  onSearch: (query: string) => void;
  onFilterChange: (filters: {
    types: string[];
    formCategory?: string;
  }) => void;
  searchQuery: string;
  selectedTypes: string[];
  selectedFormCategory?: string;
  selectedRegion: string;
  onRegionChange: (value: string) => void;
  regionOptions: Array<{ key: string; label: string; range?: string }>;
}

export function PokemonSearch({
  onSearch,
  onFilterChange,
  searchQuery,
  selectedTypes,
  selectedFormCategory,
  selectedRegion,
  onRegionChange,
  regionOptions,
}: PokemonSearchProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery);

  const hasTypesActive = selectedTypes.length > 0;
  const hasFormActive = !!selectedFormCategory && selectedFormCategory !== "any";

  // Add: helper to clean region labels by removing number ranges in parentheses like (#-#)
  const cleanRegionLabel = (label: string) => {
    // Remove ranges like (#-#)
    let s = label.replace(/\(\s*#.*?\)/g, "").trim();
    // Remove any stray parentheses that may remain (e.g., trailing ")")
    s = s.replace(/[()]/g, "").replace(/\s{2,}/g, " ").trim();
    return s;
  };

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      try {
        onSearch(localSearch);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Search failed";
        toast.error(msg);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [localSearch, onSearch]);

  const handleTypeToggle = (type: string) => {
    try {
      const newTypes = selectedTypes.includes(type)
        ? selectedTypes.filter(t => t !== type)
        : [...selectedTypes, type];
      
      onFilterChange({
        types: newTypes,
        formCategory: selectedFormCategory,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update type filter";
      toast.error(msg);
    }
  };

  const handleFormsChange = (value: string) => {
    try {
      onFilterChange({
        types: selectedTypes,
        formCategory: value === "any" ? undefined : value,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update forms filter";
      toast.error(msg);
    }
  };

  const clearFilters = () => {
    try {
      onFilterChange({ types: [], formCategory: undefined });
      if (selectedRegion !== "all") onRegionChange("all");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to clear filters";
      toast.error(msg);
    }
  };

  const hasActiveFilters = selectedTypes.length > 0 || selectedFormCategory;

  const FORM_OPTIONS: Array<{ value: string; label: string }> = [
    { value: "alternate", label: "Alternate Forms" },
    { value: "mega", label: "Mega Evolutions" },
    { value: "gigantamax", label: "Gigantamax Forms" },
  ];

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search Pokémon by name or number..."
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          className="pl-9 pr-4"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {/* Type Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "gap-2 shrink-0",
                hasTypesActive &&
                  "border-primary/50 ring-2 ring-primary/30 bg-primary/5"
              )}
            >
              <Filter className="h-4 w-4" />
              Types
              {selectedTypes.length > 0 && (
                <Badge
                  variant="secondary"
                  className={cn(
                    "ml-1",
                    "bg-primary/10 text-primary border-primary/30"
                  )}
                >
                  {selectedTypes.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <div className="space-y-4">
              <h4 className="font-medium">Filter by Type</h4>
              <div className="grid grid-cols-2 gap-2">
                {POKEMON_TYPES.map((type) => (
                  <div key={type} className="flex items-center space-x-2">
                    <Checkbox
                      id={type}
                      checked={selectedTypes.includes(type)}
                      onCheckedChange={() => handleTypeToggle(type)}
                    />
                    <label
                      htmlFor={type}
                      className="text-sm font-medium capitalize cursor-pointer"
                    >
                      {type}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Forms Filter */}
        <div className="shrink-0">
          <Select value={selectedFormCategory || "any"} onValueChange={handleFormsChange}>
            <SelectTrigger
              className={cn(
                "w-40 sm:w-48",
                hasFormActive &&
                  "border-primary/50 ring-2 ring-primary/30 bg-primary/5"
              )}
            >
              <SelectValue placeholder="Forms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">All Forms</SelectItem>
              {FORM_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Region Filter */}
        <div className="shrink-0">
          <Select value={selectedRegion} onValueChange={onRegionChange}>
            <SelectTrigger
              className={cn(
                "w-44 sm:w-52 rounded-full gap-2 pl-2 pr-3 h-10 shadow-sm border-2",
                "bg-gradient-to-br from-background to-muted/40",
                "hover:bg-accent/50 transition-colors",
                selectedRegion !== "all" &&
                  "border-primary/50 ring-2 ring-primary/30 bg-primary/5"
              )}
            >
              {/* Leading icon for visual affordance */}
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <SelectValue placeholder="Region" />
            </SelectTrigger>
            <SelectContent>
              {regionOptions.map((opt) => (
                <SelectItem key={opt.key} value={opt.key}>
                  {cleanRegionLabel(opt.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Clear Region button when region filter is applied */}
        {selectedRegion !== "all" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRegionChange("all")}
            className="gap-2 shrink-0"
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">Clear Region</span>
          </Button>
        )}

        {/* Clear Filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="gap-2 shrink-0"
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        )}
      </div>

      {/* Active Filters Display */}
      {selectedTypes.length > 0 && (
        <div className="flex flex-wrap gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
          {selectedTypes.map((type) => (
            <Badge
              key={type}
              variant="secondary"
              className="gap-1 cursor-pointer"
              onClick={() => handleTypeToggle(type)}
            >
              {type}
              <X className="h-3 w-3" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}