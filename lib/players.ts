'use client';

import { useEffect, useState } from 'react';
import { fetchFantasyCalcPlayers } from './api';
import type {
  FantasyCalcResponse,
  LeagueSettings,
  Player,
} from './types';

/**
 * Shared across every consumer in the app.
 *
 * The original code kept this cache in `useState` inside PlayerSelector, which is
 * rendered twice (giving + getting). That fetched, parsed and transformed the same
 * ~151KB payload once per side. Module scope plus an in-flight map means one request
 * serves both, even when they mount on the same tick.
 */
const cache = new Map<string, Player[]>();
const inFlight = new Map<string, Promise<Player[]>>();

const cacheKey = (settings: LeagueSettings) =>
  `${settings.isDynasty}|${settings.numQbs}|${settings.numTeams}|${settings.ppr}`;

function transform(response: FantasyCalcResponse): Player[] {
  return response.map((item) => ({
    id: item.player.id,
    name: item.player.name,
    position: item.player.position,
    team: item.player.maybeTeam || '',
    value: item.value,
    overallRank: item.overallRank,
    positionRank: item.positionRank,
    trend30Day: item.trend30Day,
    redraftValue: item.redraftValue,
    combinedValue: item.combinedValue,
    starter: item.starter,
    maybeTier: item.maybeTier,
    maybeAdp: item.maybeAdp,
    maybeTradeFrequency: item.maybeTradeFrequency,
    // Preserved for the Sleeper join and dynasty valuation. The original
    // transform dropped both on the floor.
    sleeperId: item.player.sleeperId,
    maybeAge: item.player.maybeAge,
  }));
}

export async function getPlayers(settings: LeagueSettings): Promise<Player[]> {
  const key = cacheKey(settings);

  const cached = cache.get(key);
  if (cached) return cached;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = fetchFantasyCalcPlayers(settings)
    .then((response) => {
      const players = transform(response);
      cache.set(key, players);
      return players;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

export interface UsePlayersResult {
  players: Player[];
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

export function usePlayers(settings: LeagueSettings): UsePlayersResult {
  const key = cacheKey(settings);
  const [players, setPlayers] = useState<Player[]>(() => cache.get(key) ?? []);
  const [isLoading, setIsLoading] = useState(!cache.has(key));
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const cached = cache.get(key);
    if (cached) {
      setPlayers(cached);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    getPlayers(settings)
      .then((result) => {
        if (cancelled) return;
        setPlayers(result);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load players:', err);
        setError('Failed to load players.');
        setPlayers([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `settings` is intentionally tracked via its serialized key so a fresh object
    // with identical values does not retrigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  return {
    players,
    isLoading,
    error,
    retry: () => setAttempt((n) => n + 1),
  };
}
