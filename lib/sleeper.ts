import 'server-only';

import { fetchFantasyCalcPlayers } from './api';
import {
  PICK_POSITION,
  type FantasyCalcPlayerResponse,
  type LeagueSettings,
  type Player,
} from './types';

const SLEEPER_API = 'https://api.sleeper.app/v1';

/**
 * Sleeper's player dictionary is ~14.6MB across ~12k entries. Sleeper asks callers to
 * fetch it at most once per day, and it is far past Next's 2MB Data Cache ceiling, so
 * it is held in module memory (pruned to the fields we use) rather than cached by
 * `fetch`. It must never reach the browser.
 */
const PLAYER_DICT_TTL_MS = 24 * 60 * 60 * 1000;

export interface SleeperPlayerRef {
  name: string;
  position: string;
  team: string;
}

let playerDict: Map<string, SleeperPlayerRef> | null = null;
let playerDictFetchedAt = 0;
let playerDictInFlight: Promise<Map<string, SleeperPlayerRef>> | null = null;

async function loadPlayerDict(): Promise<Map<string, SleeperPlayerRef>> {
  if (playerDict && Date.now() - playerDictFetchedAt < PLAYER_DICT_TTL_MS) {
    return playerDict;
  }
  if (playerDictInFlight) return playerDictInFlight;

  playerDictInFlight = (async () => {
    const response = await fetch(`${SLEEPER_API}/players/nfl`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Sleeper player dictionary failed: ${response.status}`);
    }
    const raw = (await response.json()) as Record<
      string,
      {
        full_name?: string;
        first_name?: string;
        last_name?: string;
        position?: string;
        team?: string;
      } | null
    >;

    const pruned = new Map<string, SleeperPlayerRef>();
    for (const [id, p] of Object.entries(raw)) {
      if (!p) continue;
      pruned.set(id, {
        // Team defenses carry no full_name; their last_name is the team nickname.
        name:
          p.full_name ||
          [p.first_name, p.last_name].filter(Boolean).join(' ') ||
          id,
        position: p.position || 'UNK',
        team: p.team || '',
      });
    }

    playerDict = pruned;
    playerDictFetchedAt = Date.now();
    return pruned;
  })();

  try {
    return await playerDictInFlight;
  } finally {
    playerDictInFlight = null;
  }
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  status: string;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: Record<string, number>;
}

interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
}

interface SleeperUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string };
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${SLEEPER_API}/${path}`, {
    // League state moves during a season; a short revalidate keeps it live but cheap.
    next: { revalidate: 300 },
  });
  if (!response.ok) {
    throw new Error(`Sleeper request failed (${path}): ${response.status}`);
  }
  return response.json();
}

/**
 * Derive FantasyCalc query settings from the league itself, so none of this has to be
 * hand-configured when Sleeper already knows it.
 *
 * Sleeper `settings.type`: 0 = redraft, 1 = keeper, 2 = dynasty. Keeper leagues are
 * valued on the dynasty curve, because players carry over.
 */
export function deriveSettings(league: SleeperLeague): LeagueSettings {
  const positions = league.roster_positions ?? [];
  const qbSlots = positions.filter(
    (slot) => slot === 'QB' || slot === 'SUPER_FLEX'
  ).length;

  return {
    isDynasty: (league.settings?.type ?? 0) >= 1,
    numQbs: qbSlots >= 2 ? 2 : 1,
    numTeams: league.total_rosters,
    ppr: league.scoring_settings?.rec ?? 0,
  };
}

export interface RosterAsset {
  sleeperId: string;
  name: string;
  position: string;
  team: string;
  /** False for kickers and defenses, which FantasyCalc does not price. */
  valued: boolean;
  value?: number;
  redraftValue?: number;
  overallRank?: number;
  maybeAge?: number;
  isStarter: boolean;
}

export interface LeagueTeam {
  rosterId: number;
  ownerId: string | null;
  displayName: string;
  teamName: string;
  players: RosterAsset[];
  totalValue: number;
  unvaluedCount: number;
}

export interface LeagueSnapshot {
  league: {
    id: string;
    name: string;
    season: string;
    status: string;
    teams: number;
    rosterPositions: string[];
  };
  settings: LeagueSettings;
  teams: LeagueTeam[];
}

export async function getLeagueSnapshot(
  leagueId: string
): Promise<LeagueSnapshot> {
  const league = await getJson<SleeperLeague>(`league/${leagueId}`);
  const settings = deriveSettings(league);

  const [rosters, users, dict, values] = await Promise.all([
    getJson<SleeperRoster[]>(`league/${leagueId}/rosters`),
    getJson<SleeperUser[]>(`league/${leagueId}/users`),
    loadPlayerDict(),
    fetchFantasyCalcPlayers(settings),
  ]);

  const valueBySleeperId = new Map<string, FantasyCalcPlayerResponse>();
  for (const entry of values) {
    // Picks carry synthetic FP_* ids that never appear on a Sleeper roster.
    if (entry.player.position === PICK_POSITION) continue;
    if (entry.player.sleeperId) {
      valueBySleeperId.set(String(entry.player.sleeperId), entry);
    }
  }

  const usersById = new Map(users.map((u) => [u.user_id, u]));

  const teams: LeagueTeam[] = rosters.map((roster) => {
    const starters = new Set(roster.starters ?? []);
    const user = roster.owner_id ? usersById.get(roster.owner_id) : undefined;

    const players: RosterAsset[] = (roster.players ?? []).map((sleeperId) => {
      const ref = dict.get(sleeperId);
      const priced = valueBySleeperId.get(sleeperId);

      return {
        sleeperId,
        name: ref?.name ?? sleeperId,
        position: ref?.position ?? 'UNK',
        team: ref?.team ?? '',
        valued: Boolean(priced),
        value: priced?.value,
        redraftValue: priced?.redraftValue,
        overallRank: priced?.overallRank,
        maybeAge: priced?.player.maybeAge,
        isStarter: starters.has(sleeperId),
      };
    });

    return {
      rosterId: roster.roster_id,
      ownerId: roster.owner_id,
      displayName: user?.display_name ?? 'Unknown',
      teamName: user?.metadata?.team_name ?? user?.display_name ?? 'Unknown',
      players,
      totalValue: players.reduce((sum, p) => sum + (p.value ?? 0), 0),
      unvaluedCount: players.filter((p) => !p.valued).length,
    };
  });

  return {
    league: {
      id: league.league_id,
      name: league.name,
      season: league.season,
      status: league.status,
      teams: league.total_rosters,
      rosterPositions: league.roster_positions ?? [],
    },
    settings,
    teams,
  };
}

/** Values-only passthrough, consumed by the client selector via /api/values. */
export async function getValues(settings: LeagueSettings): Promise<Player[]> {
  const response = await fetchFantasyCalcPlayers(settings);
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
    sleeperId: item.player.sleeperId,
    maybeAge: item.player.maybeAge,
  }));
}
