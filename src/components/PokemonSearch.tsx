import { useState, useEffect } from "react";
import { Search, Filter, X } from "lucide-react";
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
import { POKEMON_TYPES, POKEMON_GENERATIONS } from "@/lib/pokemon-api";

interface PokemonSearchProps {
  onSearch: (query: string) => void;
  onFilterChange: (filters: {
    types: string[];
    generation?: number;
    formCategory?: string;
  }) => void;
  searchQuery: string;
  selectedTypes: string[];
  selectedGeneration?: number;
  selectedFormCategory?: string;
}

export function PokemonSearch({
  onSearch,
  onFilterChange,
  searchQuery,
  selectedTypes,
  selectedGeneration,
  selectedFormCategory,
}: PokemonSearchProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery);

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      onSearch(localSearch);
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [localSearch, onSearch]);

  const handleTypeToggle = (type: string) => {
    const newTypes = selectedTypes.includes(type)
      ? selectedTypes.filter(t => t !== type)
      : [...selectedTypes, type];
    
    onFilterChange({
      types: newTypes,
      generation: selectedGeneration,
      formCategory: selectedFormCategory,
    });
  };

  const handleGenerationChange = (generation: string) => {
    onFilterChange({
      types: selectedTypes,
      generation: generation === "all" ? undefined : parseInt(generation),
      formCategory: selectedFormCategory,
    });
  };

  const handleFormsChange = (value: string) => {
    onFilterChange({
      types: selectedTypes,
      generation: selectedGeneration,
      formCategory: value === "any" ? undefined : value,
    });
  };

  const clearFilters = () => {
    onFilterChange({ types: [], generation: undefined, formCategory: undefined });
  };

  const hasActiveFilters = selectedTypes.length > 0 || selectedGeneration || selectedFormCategory;

  const FORM_OPTIONS: Array<{ value: string; label: string }> = [
    { value: "regional", label: "Regional Forms" },
    { value: "alternate", label: "Alternate Forms" },
    { value: "mega", label: "Mega Evolutions" },
    { value: "gigantamax", label: "Gigantamax Forms" },
    { value: "gender-diff", label: "Gender Differences" },
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
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">{/* mobile horizontal scroll */}
        {/* Generation Filter */}
        <div className="shrink-0">
          <Select
            value={selectedGeneration?.toString() || "all"}
            onValueChange={handleGenerationChange}
          >
            <SelectTrigger className="w-36 sm:w-44">{/* narrower on mobile */}
              <SelectValue placeholder="Generation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Generations</SelectItem>
              {POKEMON_GENERATIONS.map((gen) => (
                <SelectItem key={gen.id} value={gen.id.toString()}>
                  {gen.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Type Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2 shrink-0">
              <Filter className="h-4 w-4" />
              Types
              {selectedTypes.length > 0 && (
                <Badge variant="secondary" className="ml-1">
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

        {/* Add: Forms Filter */}
        <div className="shrink-0">
          <Select
            value={selectedFormCategory || "any"}
            onValueChange={handleFormsChange}
          >
            <SelectTrigger className="w-40 sm:w-48">
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

        {/* Gender Difference filter badge (uses uploaded image), styled like G-MAX badge */}
        {selectedFormCategory === "gender-diff" && (
          <div className="shrink-0">
            <span
              title="Gender Differences"
              aria-label="Gender Differences"
              className="inline-flex items-center justify-center rounded-full bg-background border shadow p-1.5 ring-2 ring-pink-500/40"
            >
              <img
                src="https://harmless-tapir-303.convex.cloud/api/storage/d3256155-fdbb-486b-b117-e4850f259ab5"
                alt="Gender Differences"
                className="h-6 w-6 object-contain drop-shadow"
              />
            </span>
          </div>
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