'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import PlayerSelector from '@/components/player-selector';
import TradeAnalysis from '@/components/trade-analysis';
import LeagueConnect from '@/components/league-connect';
import type { LeagueSettings, LeagueTeam, Player } from '@/lib/types';
import { usePlayers } from '@/lib/players';
import { buildRosterPool, storage, useLeague } from '@/lib/league';
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
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_SETTINGS: LeagueSettings = {
  isDynasty: true,
  numQbs: 1,
  numTeams: 12,
  ppr: 1,
};

export default function TradeAnalyzer() {
  const [playersGiving, setPlayersGiving] = useState<Player[]>([]);
  const [playersGetting, setPlayersGetting] = useState<Player[]>([]);
  const [leagueSettings, setLeagueSettings] =
    useState<LeagueSettings>(DEFAULT_SETTINGS);
  const [selectedTeam, setSelectedTeam] = useState<LeagueTeam | null>(null);

  const league = useLeague();
  const { players, isLoading, error, retry } = usePlayers(leagueSettings);

  const isConnected = Boolean(league.snapshot);

  // Sleeper is the source of truth once connected, so adopt its settings verbatim.
  useEffect(() => {
    if (league.snapshot) setLeagueSettings(league.snapshot.settings);
  }, [league.snapshot]);

  // Restore the previously chosen team when a league comes back.
  useEffect(() => {
    if (!league.snapshot) {
      setSelectedTeam(null);
      return;
    }
    const storedRosterId = storage.rosterId.read();
    const restored = storedRosterId
      ? league.snapshot.teams.find(
          (team) => String(team.rosterId) === storedRosterId
        )
      : undefined;
    setSelectedTeam(restored ?? null);
  }, [league.snapshot]);

  // Reset selections when settings change. Skips the initial mount so it does not
  // needlessly replace two already-empty arrays.
  const isInitialRender = useRef(true);
  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }
    setPlayersGiving([]);
    setPlayersGetting([]);
  }, [leagueSettings]);

  const rosterPool = useMemo(
    () => buildRosterPool(selectedTeam, players),
    [selectedTeam, players]
  );

  const useRoster = isConnected && selectedTeam !== null;
  const givingPool = useRoster ? rosterPool.players : players;

  const handleSelectTeam = (team: LeagueTeam | null) => {
    setSelectedTeam(team);
    storage.rosterId.write(team ? String(team.rosterId) : '');
    // The giving side's pool just changed out from under any existing picks.
    setPlayersGiving([]);
  };

  const handleReset = () => {
    setPlayersGiving([]);
    setPlayersGetting([]);
  };

  const pprOptions = [
    { value: '0', label: 'Standard (0 PPR)' },
    { value: '0.5', label: 'Half PPR (0.5 PPR)' },
    { value: '1', label: 'Full PPR (1 PPR)' },
  ];

  const teamOptions = Array.from({ length: 9 }, (_, i) => ({
    value: (i + 8).toString(),
    label: `${i + 8} Teams`,
  }));

  return (
    <div className="grid gap-6 md:gap-8">
      <LeagueConnect
        snapshot={league.snapshot}
        isLoading={league.isLoading}
        error={league.error}
        onLoad={league.load}
        onClear={league.clear}
        selectedTeam={selectedTeam}
        onSelectTeam={handleSelectTeam}
      />

      <Card className="border-gray-800/20 dark:border-gray-300/10">
        <CardHeader>
          <CardTitle>League Settings</CardTitle>
          <CardDescription>
            {isConnected
              ? 'Read from Sleeper. Disconnect the league to set these by hand.'
              : 'Configure your league settings for accurate trade analysis'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4',
              isConnected && 'opacity-60 pointer-events-none select-none'
            )}
            aria-disabled={isConnected}
          >
            <div className="space-y-2">
              <label className="text-sm font-medium">League Type</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Redraft</span>
                <Switch
                  id="league-type"
                  checked={leagueSettings.isDynasty}
                  disabled={isConnected}
                  onCheckedChange={(checked) =>
                    setLeagueSettings({
                      ...leagueSettings,
                      isDynasty: checked,
                    })
                  }
                />
                <span className="text-sm text-muted-foreground">Dynasty</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Number of Teams</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-44 justify-between"
                    disabled={isConnected}
                  >
                    {leagueSettings.numTeams} Teams
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandList>
                      <CommandGroup>
                        {teamOptions.map((team) => (
                          <CommandItem
                            key={team.value}
                            value={team.value}
                            onSelect={() =>
                              setLeagueSettings({
                                ...leagueSettings,
                                numTeams: parseInt(team.value),
                              })
                            }
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                leagueSettings.numTeams === parseInt(team.value)
                                  ? 'opacity-100'
                                  : 'opacity-0'
                              )}
                            />
                            {team.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Number of QBs</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">1 QB</span>
                <Switch
                  id="qb-count"
                  checked={leagueSettings.numQbs === 2}
                  disabled={isConnected}
                  onCheckedChange={(checked) =>
                    setLeagueSettings({
                      ...leagueSettings,
                      numQbs: checked ? 2 : 1,
                    })
                  }
                />
                <span className="text-sm text-muted-foreground">2 QB</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Points Per Reception
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-44 justify-between"
                    disabled={isConnected}
                  >
                    {pprOptions.find(
                      (option) => option.value === leagueSettings.ppr.toString()
                    )?.label || `${leagueSettings.ppr} PPR`}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandList>
                      <CommandGroup>
                        {pprOptions.map((ppr) => (
                          <CommandItem
                            key={ppr.value}
                            value={ppr.value}
                            onSelect={() =>
                              setLeagueSettings({
                                ...leagueSettings,
                                ppr: parseFloat(ppr.value),
                              })
                            }
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                leagueSettings.ppr === parseFloat(ppr.value)
                                  ? 'opacity-100'
                                  : 'opacity-0'
                              )}
                            />
                            {ppr.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
        <Card className="border-gray-800/20 dark:border-gray-300/10">
          <CardHeader className="pb-3">
            <CardTitle>
              {useRoster ? `${selectedTeam!.teamName} Gives` : "Players You're Giving"}
            </CardTitle>
            <CardDescription>
              {useRoster
                ? 'Your Sleeper roster, priced and sorted by value'
                : "Select the players you're trading away"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <PlayerSelector
              selectedPlayers={playersGiving}
              onChange={setPlayersGiving}
              pool={givingPool}
              showAge={leagueSettings.isDynasty}
              isLoading={isLoading || league.isLoading}
              error={error}
              onRetry={retry}
              placeholder={useRoster ? 'Select from your roster' : 'Select players'}
              emptyMessage={
                useRoster ? 'No matching player on your roster.' : 'No players found.'
              }
            />
            {useRoster && rosterPool.unpricedNames.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Not tradeable here: {rosterPool.unpricedNames.join(', ')} —
                FantasyCalc does not price kickers or defenses.
              </p>
            )}
            {isConnected && !selectedTeam && (
              <p className="text-xs text-muted-foreground">
                Pick your team above to load your roster. Until then this searches
                every player.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-gray-800/20 dark:border-gray-300/10">
          <CardHeader className="pb-3">
            <CardTitle>Players You&apos;re Getting</CardTitle>
            <CardDescription>
              Select the players you&apos;re receiving
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PlayerSelector
              selectedPlayers={playersGetting}
              onChange={setPlayersGetting}
              pool={players}
              showAge={leagueSettings.isDynasty}
              isLoading={isLoading}
              error={error}
              onRetry={retry}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="border-gray-800/20 dark:border-gray-300/10">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="mb-2">Trade Analysis</CardTitle>
            <CardDescription>
              See if this trade is beneficial for you
            </CardDescription>
          </div>
          <Button variant="outline" onClick={handleReset}>
            Clear Results
          </Button>
        </CardHeader>
        <CardContent>
          <TradeAnalysis
            playersGiving={playersGiving}
            playersGetting={playersGetting}
            leagueSettings={leagueSettings}
          />
        </CardContent>
      </Card>
    </div>
  );
}
