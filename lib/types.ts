// FantasyCalc value API
// https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=1&limit=600
//
// Notes learned from the live payload:
//  - `sleeperId` is present on 100% of entries and is our join key against Sleeper.
//  - In dynasty mode the response also carries rookie draft picks as `position: 'PICK'`,
//    with synthetic ids like `FP_2027_early_0`. Those do NOT resolve against Sleeper's
//    player dictionary - see lib/players.ts.
//  - Without `limit` the endpoint returns only ~199 entries, which omits nearly every pick.

export const PICK_POSITION = 'PICK';

export interface FantasyCalcPlayer {
  id: number;
  name: string;
  position: string;
  maybeTeam?: string;
  mflId?: string;
  sleeperId?: string;
  maybeBirthday?: string;
  maybeHeight?: string;
  maybeWeight?: number;
  maybeCollege?: string;
  maybeAge?: number;
  maybeYoe?: number;
  espnId?: string;
  fleaflickerId?: string;
}

export interface FantasyCalcPlayerResponse {
  player: FantasyCalcPlayer;
  value: number;
  overallRank: number;
  positionRank: number;
  trend30Day: number;
  redraftValue: number;
  combinedValue: number;
  starter: boolean;
  maybeTier?: number;
  maybeAdp?: number | null;
  maybeTradeFrequency?: number | null;
}

export type FantasyCalcResponse = FantasyCalcPlayerResponse[];

// For use in the UI
export interface Player {
  id: number;
  name: string;
  position: string;
  team: string;
  value: number;
  overallRank: number;
  positionRank: number;
  trend30Day: number;
  redraftValue: number;
  combinedValue: number;
  starter: boolean;
  maybeTier?: number;
  maybeAdp?: number | null;
  maybeTradeFrequency?: number | null;
  /** Join key against Sleeper. Synthetic (`FP_*`) for draft picks. */
  sleeperId?: string;
  /** Core dynasty valuation input. Absent on picks. */
  maybeAge?: number;
}

/** Draft picks are priced like players but cannot be resolved against Sleeper rosters. */
export function isPick(player: Pick<Player, 'position'>): boolean {
  return player.position === PICK_POSITION;
}

export interface LeagueSettings {
  isDynasty: boolean;
  numQbs: number;
  numTeams: number;
  ppr: number;
}

export interface FantasyCalcQueryParams {
  isDynasty?: boolean;
  numQbs?: number;
  numTeams?: number;
  ppr?: number;
  /** Omitting this silently caps the response at ~199 entries. */
  limit?: number;
}
