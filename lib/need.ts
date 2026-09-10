import type { LeagueTeam, RosterAsset } from './types';

/**
 * Positional need scoring.
 *
 * Deliberately separate from lib/trade.ts: this never touches a value delta or a
 * fairness percentage. It only answers "does this team have a hole here", which the
 * recommender uses to order equally-fair deals and to explain itself.
 *
 * Two inputs, per the simplest thing that works:
 *   1. How many players they roster at a position vs the league average.
 *   2. Whether their starters at that position are below the league median.
 */

/** The positions FantasyCalc prices. K and DEF are unpriced and untradeable here. */
export const SCORED_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;
export type ScoredPosition = (typeof SCORED_POSITIONS)[number];

export type NeedLabel = 'thin' | 'balanced' | 'deep';

export interface PositionNeed {
  position: string;
  /** How many they roster here. */
  count: number;
  leagueAverageCount: number;
  /** Average value of their starters here. Null when they start nobody at it. */
  starterValue: number | null;
  leagueMedianStarterValue: number | null;
  starterBelowMedian: boolean;
  /** Positive means need. Roughly "players short of average", plus 1 for a weak starter. */
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
  if (score >= 1) return 'thin';
  if (score <= -1) return 'deep';
  return 'balanced';
}

/**
 * Compute needs for every team in one pass, since both inputs are league-relative.
 * Pass all teams including your own - the averages should reflect the whole league.
 */
export function computeLeagueNeeds(teams: LeagueTeam[]): Map<number, TeamNeeds> {
  const result = new Map<number, TeamNeeds>();
  if (teams.length === 0) return result;

  // League-wide baselines, per position.
  const averageCount = new Map<string, number>();
  const medianStarter = new Map<string, number | null>();

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
      const leagueAverageCount = averageCount.get(position) ?? 0;
      const starterValue = starterValueAt(team.players, position);
      const leagueMedianStarterValue = medianStarter.get(position) ?? null;

      // Starting nobody at a position they should start counts as below median.
      const starterBelowMedian =
        leagueMedianStarterValue === null
          ? false
          : starterValue === null || starterValue < leagueMedianStarterValue;

      const score =
        leagueAverageCount - count + (starterBelowMedian ? 1 : 0);

      byPosition.set(position, {
        position,
        count,
        leagueAverageCount,
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
