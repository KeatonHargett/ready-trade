'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronsUpDown, Link2, Loader2, Unlink } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { storage } from '@/lib/league';
import type { LeagueSnapshot, LeagueTeam } from '@/lib/types';

interface LeagueConnectProps {
  snapshot: LeagueSnapshot | null;
  isLoading: boolean;
  error: string | null;
  onLoad: (leagueId: string) => void;
  onClear: () => void;
  selectedTeam: LeagueTeam | null;
  onSelectTeam: (team: LeagueTeam | null) => void;
}

const SCORING = (ppr: number) =>
  ppr === 1 ? 'Full PPR' : ppr === 0.5 ? 'Half PPR' : 'Standard';

export default function LeagueConnect({
  snapshot,
  isLoading,
  error,
  onLoad,
  onClear,
  selectedTeam,
  onSelectTeam,
}: LeagueConnectProps) {
  const [input, setInput] = useState('');
  const [teamOpen, setTeamOpen] = useState(false);

  useEffect(() => {
    const stored = storage.leagueId.read();
    if (stored) setInput(stored);
  }, []);

  const submit = () => {
    if (input.trim()) onLoad(input.trim());
  };

  return (
    <Card className="border-gray-800/20 dark:border-gray-300/10">
      <CardHeader className="pb-3">
        <CardTitle>Your Sleeper League</CardTitle>
        <CardDescription>
          Connect a league to pull settings and rosters straight from Sleeper.
          Find the id in your league URL:{' '}
          <span className="font-mono text-xs">sleeper.com/leagues/&lt;id&gt;</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!snapshot ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={input}
              inputMode="numeric"
              placeholder="Sleeper league id"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
              className="sm:max-w-xs"
            />
            <Button onClick={submit} disabled={!input.trim() || isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading
                </>
              ) : (
                <>
                  <Link2 className="mr-2 h-4 w-4" />
                  Connect
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{snapshot.league.name}</p>
                <p className="text-sm text-muted-foreground">
                  {snapshot.league.season} · {snapshot.league.teams} teams ·{' '}
                  {SCORING(snapshot.settings.ppr)} ·{' '}
                  {snapshot.settings.numQbs === 2 ? 'Superflex' : '1 QB'} ·{' '}
                  {snapshot.settings.isDynasty ? 'Keeper/Dynasty' : 'Redraft'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={onClear}>
                <Unlink className="mr-2 h-4 w-4" />
                Disconnect
              </Button>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Your team</label>
              <Popover open={teamOpen} onOpenChange={setTeamOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={teamOpen}
                    className="w-full sm:w-80 justify-between"
                  >
                    <span className="truncate">
                      {selectedTeam ? selectedTeam.teamName : 'Select your team'}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandList>
                      <CommandGroup className="max-h-[300px] overflow-y-auto">
                        {snapshot.teams.map((team) => (
                          <CommandItem
                            key={team.rosterId}
                            value={String(team.rosterId)}
                            onSelect={() => {
                              onSelectTeam(team);
                              setTeamOpen(false);
                            }}
                            className="flex items-center gap-2"
                          >
                            <Check
                              className={cn(
                                'h-4 w-4 shrink-0',
                                selectedTeam?.rosterId === team.rosterId
                                  ? 'opacity-100'
                                  : 'opacity-0'
                              )}
                            />
                            <span className="font-medium truncate">
                              {team.teamName}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">
                              {team.displayName}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">
            {error} Double-check the league id.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
