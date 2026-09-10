'use client';

import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, X, Loader2, AlertTriangle } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isPick, type LeagueSettings, type Player } from '@/lib/types';
import { usePlayers } from '@/lib/players';

/** Rendering 600 command items on every keystroke is wasteful; the list is scrollable anyway. */
const MAX_RESULTS = 100;

interface PlayerSelectorProps {
  selectedPlayers: Player[];
  onChange: (players: Player[]) => void;
  leagueSettings: LeagueSettings;
}

export default function PlayerSelector({
  selectedPlayers,
  onChange,
  leagueSettings,
}: PlayerSelectorProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { players, isLoading, error, retry } = usePlayers(leagueSettings);

  // No debounce/throttle: filtering is a local array scan over a few hundred items.
  // The original throttled this and *discarded* input that arrived inside the window,
  // which left the list showing stale results.
  const search = useDeferredValue(inputValue);

  const selectedPlayerIds = useMemo(
    () => new Set(selectedPlayers.map((p) => p.id)),
    [selectedPlayers]
  );

  const filteredPlayers = useMemo(() => {
    const searchLower = search.trim().toLowerCase();
    const available = players.filter((p) => !selectedPlayerIds.has(p.id));
    const matched = searchLower
      ? available.filter((p) => p.name.toLowerCase().includes(searchLower))
      : available;
    return matched.slice(0, MAX_RESULTS);
  }, [players, selectedPlayerIds, search]);

  const handleSelect = (player: Player) => {
    onChange([...selectedPlayers, player]);
    setInputValue('');
    inputRef.current?.focus();
  };

  const handleRemove = (playerId: number) => {
    onChange(selectedPlayers.filter((player) => player.id !== playerId));
  };

  const describe = (player: Player) => {
    if (isPick(player)) return 'Draft pick';
    const parts = [player.position, player.team].filter(Boolean).join(' - ');
    return leagueSettings.isDynasty && player.maybeAge
      ? `${parts} - age ${player.maybeAge.toFixed(1)}`
      : parts;
  };

  return (
    <div className="space-y-4">
      {error ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
          <span className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </span>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  <span className="truncate">Loading players...</span>
                </>
              ) : (
                <>
                  <span className="truncate">Select players</span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start">
            {/* We filter ourselves; without this cmdk applies a second fuzzy pass. */}
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search players or picks..."
                value={inputValue}
                onValueChange={setInputValue}
                ref={inputRef}
                className="w-full"
              />
              <CommandList>
                <CommandEmpty>No players found.</CommandEmpty>
                <CommandGroup className="max-h-[300px] overflow-y-auto">
                  {filteredPlayers.map((player) => (
                    <CommandItem
                      key={player.id}
                      value={String(player.id)}
                      onSelect={() => handleSelect(player)}
                      className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2"
                    >
                      <Check className={cn('mr-2 h-4 w-4', 'opacity-0')} />
                      <span className="font-medium truncate">{player.name}</span>
                      <span className="text-xs sm:text-sm text-muted-foreground truncate">
                        {describe(player)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      <div className="flex flex-wrap gap-2">
        {selectedPlayers.map((player) => (
          <Badge
            key={player.id}
            variant="secondary"
            className="flex items-center gap-1 py-1.5 max-w-full"
          >
            <span className="truncate">{player.name}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0 hover:bg-transparent flex-shrink-0"
              onClick={() => handleRemove(player.id)}
            >
              <X className="h-3 w-3" />
              <span className="sr-only">Remove {player.name}</span>
            </Button>
          </Badge>
        ))}
        {selectedPlayers.length === 0 && (
          <p className="text-sm text-muted-foreground">No players selected</p>
        )}
      </div>
    </div>
  );
}
