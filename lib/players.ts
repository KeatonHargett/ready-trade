'use client';

import { useEffect, useState } from 'react';
import type { LeagueSettings, Player } from './types';

/**
 * Shared across every consumer in the app.
 *
 * The original code kept this cache in `useState` inside PlayerSelector, which is
 * rendered twice (giving + getting). That fetched, parsed and transformed the same
 * ~151KB payload once per side, straight from the browser. Module scope plus an
 * in-flight map means one request serves both, even when they mount on the same tick.
 *
 * The request now goes to /api/values, so FantasyCalc is hit once per revalidation
 * window for the whole app rather than once per visitor.
 */
const cache = new Map<string, Player[]>();
const inFlight = new Map<string, Promise<Player[]>>();

const cacheKey = (settings: LeagueSettings) =>
  `${settings.isDynasty}|${settings.numQbs}|${settings.numTeams}|${settings.ppr}`;

export async function getPlayers(settings: LeagueSettings): Promise<Player[]> {
  const key = cacheKey(settings);

  const cached = cache.get(key);
  if (cached) return cached;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const query = new URLSearchParams({
    isDynasty: String(settings.isDynasty),
    numQbs: String(settings.numQbs),
    numTeams: String(settings.numTeams),
    ppr: String(settings.ppr),
  });

  const request = fetch(`/api/values?${query.toString()}`)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`/api/values responded ${response.status}`);
      }
      const body = (await response.json()) as { players: Player[] };
      cache.set(key, body.players);
      return body.players;
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
