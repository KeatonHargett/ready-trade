import type { LeagueTeam, RosterAsset } from './types';

/**
 * Positional need scoring.
 *
 * Deliberately separate from lib/trade.ts: this never touches a value delta or a
 * fairness percentage. It only answers "does this team have a hole here", which the
 * recommender uses to order equally-fair deals and to explain itself.
 *
 * Two inputs:
 *   1. How many players they roster at a position vs how many that position's
 *      STARTER SLOTS require (see requirementsFor).
 *   2. Whether their starters at that position are below the league median.
 */

/** The positions FantasyCalc prices. K and DEF are unpriced and untradeable here. */
export const SCORED_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;
export type ScoredPosition = (typeof SCORED_POSITIONS)[number];

/** Sleeper's flex slot names and what each can start. */
const FLEX_ELIGIBILITY: Record<string, readonly string[]> = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};

/**
 * How many players a team needs at a position to have its starting slots covered.
 *
 * Dedicated slots count in full. Flex slots are split across the positions that can
 * fill them, weighted by dedicated slots, rather than counted in full for each.
 *
 * Counting each flex slot in full for every eligible position was measured against
 * the real league and made things worse, not better: TE's requirement became
 * 1 + 2 = 3, and since nobody rosters three tight ends in a one-TE league, all 10
 * teams got flagged thin at TE - while the RB false positives it was meant to fix
 * stayed at 7. Splitting proportionally (RB 2.8, WR 2.8, TE 1.4 here) took RB from
 * 7 false flags to 0.
 */
export function requirementsFor(
  rosterPositions: readonly string[]
): Map<string, number> {
  const dedicated = new Map<string, number>();
  for (const position of SCORED_POSITIONS) {
    dedicated.set(
      position,
      rosterPositions.filter((slot) => slot === position).length
    );
  }

  const requirement = new Map<string, number>(dedicated);

  for (const slot of rosterPositions) {
    const eligible = FLEX_ELIGIBILITY[slot];
    if (!eligible) continue;

    const weightTotal = eligible.reduce(
      (sum, position) => sum + (dedicated.get(position) ?? 0),
      0
    );

    for (const position of eligible) {
      if (!requirement.has(position)) continue;
      // Even weighting when a league has no dedicated slots for any eligible spot.
      const share =
        weightTotal > 0
          ? (dedicated.get(position) ?? 0) / weightTotal
          : 1 / eligible.length;
      requirement.set(position, (requirement.get(position) ?? 0) + share);
    }
  }

  return requirement;
}

export type NeedLabel = 'thin' | 'balanced' | 'deep';

/**
 * Requirements are fractional, so a full-point gap is a big hole. 0.75 lands where a
 * team is short of its slots, or at its slots with a below-median starter.
 */
const THIN_AT = 0.75;
const DEEP_AT = -1;

export interface PositionNeed {
  position: string;
  /** How many they roster here. */
  count: number;
  /** How many their starting slots require, flex included proportionally. */
  requirement: number;
  /** Average value of their starters here. Null when they start nobody at it. */
  starterValue: number | null;
  leagueMedianStarterValue: number | null;
  starterBelowMedian: boolean;
  /** Positive means need: players short of requirement, plus 1 for a weak starter. */
  score: number;
  label: NeedLabel;
}

export interface TeamNeeds {
  rosterId: number;
  teamName: string;
  byPosition: Map<string, PositionNeed>;
  /** Positions labelled thin, most needed first. Useful for a one-line summary. */
  thinPositions: string[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

const atPosition = (players: RosterAsset[], position: string) =>
  players.filter((p) => p.position === position && p.valued);

/** Average value of the players this team actually starts at a position. */
function starterValueAt(
  players: RosterAsset[],
  position: string
): number | null {
  const starters = atPosition(players, position).filter((p) => p.isStarter);
  if (starters.length === 0) return null;
  const total = starters.reduce((sum, p) => sum + (p.value ?? 0), 0);
  return total / starters.length;
}

function labelFor(score: number): NeedLabel {
  if (score >= THIN_AT) return 'thin';
  if (score <= DEEP_AT) return 'deep';
  return 'balanced';
}

/**
 * Compute needs for every team in one pass. The starter-quality baseline is
 * league-relative, so pass all teams including your own.
 *
 * `rosterPositions` comes straight off the Sleeper league. When it is empty the
 * requirement falls back to the league's average count at that position, which is
 * the pre-slot-aware behaviour.
 */
export function computeLeagueNeeds(
  teams: LeagueTeam[],
  rosterPositions: readonly string[] = []
): Map<number, TeamNeeds> {
  const result = new Map<number, TeamNeeds>();
  if (teams.length === 0) return result;

  const slotRequirement = rosterPositions.length
    ? requirementsFor(rosterPositions)
    : null;

  const medianStarter = new Map<string, number | null>();
  const averageCount = new Map<string, number>();

  for (const position of SCORED_POSITIONS) {
    const counts = teams.map((t) => atPosition(t.players, position).length);
    averageCount.set(
      position,
      counts.reduce((sum, n) => sum + n, 0) / teams.length
    );

    const starterValues = teams
      .map((t) => starterValueAt(t.players, position))
      .filter((v): v is number => v !== null);
    medianStarter.set(position, median(starterValues));
  }

  for (const team of teams) {
    const byPosition = new Map<string, PositionNeed>();

    for (const position of SCORED_POSITIONS) {
      const count = atPosition(team.players, position).length;
      const requirement =
        slotRequirement?.get(position) ?? averageCount.get(position) ?? 0;
      const starterValue = starterValueAt(team.players, position);
      const leagueMedianStarterValue = medianStarter.get(position) ?? null;

      // Starting nobody at a position they should start counts as below median.
      const starterBelowMedian =
        leagueMedianStarterValue === null
          ? false
          : starterValue === null || starterValue < leagueMedianStarterValue;

      const score = requirement - count + (starterBelowMedian ? 1 : 0);

      byPosition.set(position, {
        position,
        count,
        requirement,
        starterValue,
        leagueMedianStarterValue,
        starterBelowMedian,
        score,
        label: labelFor(score),
      });
    }

    const thinPositions = [...byPosition.values()]
      .filter((need) => need.label === 'thin')
      .sort((a, b) => b.score - a.score)
      .map((need) => need.position);

    result.set(team.rosterId, {
      rosterId: team.rosterId,
      teamName: team.teamName,
      byPosition,
      thinPositions,
    });
  }

  return result;
}

/**
 * Rank tier for a set of positions a team would be receiving. Tiers rather than raw
 * scores so a hair of difference cannot outweigh fairness in the sort.
 */
export function needTier(
  needs: TeamNeeds | undefined,
  positions: string[]
): number {
  if (!needs || positions.length === 0) return 1;

  let best = 0;
  for (const position of positions) {
    const need = needs.byPosition.get(position);
    const tier = need?.label === 'thin' ? 2 : need?.label === 'deep' ? 0 : 1;
    if (tier > best) best = tier;
  }
  return best;
}

/** The positions in this set that the team is actually thin at, neediest first. */
export function fillsNeedAt(
  needs: TeamNeeds | undefined,
  positions: string[]
): string[] {
  if (!needs) return [];
  const unique = [...new Set(positions)];
  return unique
    .filter((position) => needs.byPosition.get(position)?.label === 'thin')
    .sort(
      (a, b) =>
        (needs.byPosition.get(b)?.score ?? 0) -
        (needs.byPosition.get(a)?.score ?? 0)
    );
}
