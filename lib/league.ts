'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LeagueSnapshot, LeagueTeam, Player } from './types';

const LEAGUE_ID_KEY = 'ready-trade:leagueId';
const ROSTER_ID_KEY = 'ready-trade:rosterId';

/**
 * Per-browser convenience only. Reads and writes are wrapped because storage throws
 * outright in some contexts (private windows, blocked site data) rather than just
 * coming back empty.
 */
export function readStored(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStored(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Nothing to do; the app works fine without a remembered league.
  }
}

export const storage = {
  leagueId: {
    read: () => readStored(LEAGUE_ID_KEY),
    write: (v: string) => writeStored(LEAGUE_ID_KEY, v),
  },
  rosterId: {
    read: () => readStored(ROSTER_ID_KEY),
    write: (v: string) => writeStored(ROSTER_ID_KEY, v),
  },
};

export interface UseLeagueResult {
  snapshot: LeagueSnapshot | null;
  isLoading: boolean;
  error: string | null;
  load: (leagueId: string) => void;
  clear: () => void;
}

export function useLeague(): UseLeagueResult {
  const [leagueId, setLeagueId] = useState('');
  const [snapshot, setSnapshot] = useState<LeagueSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore a previously connected league on mount.
  useEffect(() => {
    const stored = storage.leagueId.read();
    if (stored) setLeagueId(stored);
  }, []);

  useEffect(() => {
    if (!leagueId) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch(`/api/league/${encodeURIComponent(leagueId)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `Request failed (${response.status})`);
        }
        return body as LeagueSnapshot;
      })
      .then((result) => {
        if (cancelled) return;
        setSnapshot(result);
        storage.leagueId.write(leagueId);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.error('Failed to load league:', err);
        setError(err.message || 'Could not load that league.');
        setSnapshot(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  const load = useCallback((next: string) => setLeagueId(next.trim()), []);

  const clear = useCallback(() => {
    setLeagueId('');
    setSnapshot(null);
    setError(null);
    storage.leagueId.write('');
    storage.rosterId.write('');
  }, []);

  return { snapshot, isLoading, error, load, clear };
}

export interface RosterPool {
  /** Roster entries matched to a priced player, usable as trade assets. */
  players: Player[];
  /** Roster entries FantasyCalc does not price - kickers and defenses. */
  unpricedNames: string[];
}

/**
 * Resolve a team's roster against the full value list.
 *
 * The league route already returns values, but the trade engine needs complete
 * `Player` objects (positionRank, combinedValue, trend). Matching on `sleeperId`
 * against the list the selector already has avoids shipping a second payload.
 */
export function buildRosterPool(
  team: LeagueTeam | null,
  allPlayers: Player[]
): RosterPool {
  if (!team) return { players: [], unpricedNames: [] };

  const bySleeperId = new Map<string, Player>();
  for (const player of allPlayers) {
    if (player.sleeperId) bySleeperId.set(String(player.sleeperId), player);
  }

  const players: Player[] = [];
  const unpricedNames: string[] = [];

  for (const asset of team.players) {
    const match = bySleeperId.get(asset.sleeperId);
    if (match) players.push(match);
    else unpricedNames.push(asset.name);
  }

  players.sort((a, b) => b.value - a.value);
  return { players, unpricedNames };
}
