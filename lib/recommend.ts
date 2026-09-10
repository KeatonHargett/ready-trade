import { evaluateTrade, type TradeEvaluation } from './trade';
import {
  computeLeagueNeeds,
  fillsNeedAt,
  needTier,
  type TeamNeeds,
} from './need';
import { isPick, type LeagueSettings, type LeagueTeam, type Player } from './types';

/**
 * Trade partner recommender.
 *
 * All fairness scoring comes from `evaluateTrade` - nothing here recomputes a value
 * delta or a percentage. The scan runs with `withNotes: false` because note strings
 * are built per call and dominate at ~25k candidates; the handful that survive are
 * re-evaluated with notes on, through the same function.
 *
 * Positional need (lib/need.ts) affects ORDER ONLY. It never moves a percentage and
 * never lets an unfair trade through the band - it decides which of several equally
 * fair deals is worth showing first, and supplies the reason.
 */

/**
 * Candidate shapes, in the order a human would actually propose them.
 *
 * 2-for-2 is deliberately absent: it was ~73% of the total scan cost and produces
 * packages nobody sends. Dropping it took a 10-team scan from ~36ms to ~10ms and
 * made the output more actionable, not less.
 */
const SHAPES: ReadonlyArray<readonly [give: number, get: number]> = [
  [1, 1],
  [2, 1],
  [1, 2],
];

export const FAIRNESS_BANDS = [10, 15] as const;
export type FairnessBand = (typeof FAIRNESS_BANDS)[number];

export interface TradeSuggestion {
  giving: Player[];
  getting: Player[];
  evaluation: TradeEvaluation;
  /**
   * Positions the receiving team is thin at that this deal would fill. Empty when
   * the deal does not address a hole. Drives the "X is thin at TE" context.
   */
  fillsNeed: string[];
}

export interface PartnerRecommendation {
  rosterId: number;
  teamName: string;
  displayName: string;
  /** Every fair combination found, not just the ones displayed. */
  fairCount: number;
  /** Fair combinations that also fill a position this team is thin at. */
  needFitCount: number;
  /** Positions this team is thin at, neediest first. */
  thinPositions: string[];
  /** Best few: need-filling first, then closest to even. */
  suggestions: TradeSuggestion[];
}

export interface RecommendOptions {
  /** Max absolute value gap, as a percentage of the larger side. */
  maxPercent?: number;
  /** How many suggestions to keep per team. */
  perTeam?: number;
}

/** Index combinations of a fixed size. Sizes here are 1 or 2, so this stays small. */
function combinations<T>(items: T[], size: number): T[][] {
  if (size === 1) return items.map((item) => [item]);

  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      out.push([items[i], items[j]]);
    }
  }
  return out;
}

/** Picks are excluded on both sides, matching the roster pool's limitation. */
const tradeable = (players: Player[]) => players.filter((p) => !isPick(p));

export function recommendPartners(
  myPool: Player[],
  others: Array<{ team: LeagueTeam; pool: Player[] }>,
  settings: LeagueSettings,
  options: RecommendOptions = {}
): PartnerRecommendation[] {
  const { maxPercent = 15, perTeam = 3 } = options;

  const mine = tradeable(myPool);
  if (mine.length === 0) return [];

  // League-relative, so it needs every roster - including yours - as the baseline.
  const needs = computeLeagueNeeds(others.map((o) => o.team));

  const results: PartnerRecommendation[] = [];

  for (const { team, pool } of others) {
    const theirNeeds: TeamNeeds | undefined = needs.get(team.rosterId);
    const theirs = tradeable(pool);
    if (theirs.length === 0) continue;

    // Kept per shape so the output stays varied. Sorting one flat list by percentage
    // would bury every clean 1-for-1 under packages sitting a fraction closer to the
    // top of the band.
    const byShape = new Map<string, TradeSuggestion[]>();
    let fairCount = 0;
    let needFitCount = 0;

    for (const [giveSize, getSize] of SHAPES) {
      if (mine.length < giveSize || theirs.length < getSize) continue;

      const shapeKey = `${giveSize}-${getSize}`;
      const bucket: TradeSuggestion[] = [];

      for (const giving of combinations(mine, giveSize)) {
        for (const getting of combinations(theirs, getSize)) {
          const evaluation = evaluateTrade(giving, getting, settings, {
            withNotes: false,
          });

          if (Math.abs(evaluation.percentDifference) <= maxPercent) {
            // They receive what I give up, so their need is scored against `giving`.
            bucket.push({
              giving,
              getting,
              evaluation,
              fillsNeed: fillsNeedAt(
                theirNeeds,
                giving.map((p) => p.position)
              ),
            });
          }
        }
      }

      if (bucket.length === 0) continue;

      // Need first, fairness second.
      //
      // A deal that hands them a position they are thin at is likelier to be accepted
      // than an equally fair one at a position they are already deep. Tiers keep this
      // honest: a hair of need difference cannot outrank a much fairer deal, because
      // everything in this bucket already cleared the band.
      //
      // Closest-to-even breaks the tie. Sorting by "most favourable to you" instead
      // pinned every suggestion to the top of the band, and a deal reading +14.9% to
      // you reads -14.9% on their calculator, so it gets declined.
      bucket.sort((a, b) => {
        const tierDelta =
          needTier(theirNeeds, b.giving.map((p) => p.position)) -
          needTier(theirNeeds, a.giving.map((p) => p.position));
        if (tierDelta !== 0) return tierDelta;
        return (
          Math.abs(a.evaluation.percentDifference) -
          Math.abs(b.evaluation.percentDifference)
        );
      });
      byShape.set(shapeKey, bucket);
      fairCount += bucket.length;
      needFitCount += bucket.filter((s) => s.fillsNeed.length > 0).length;
    }

    if (fairCount === 0) continue;

    // Round-robin across shapes: best 1-for-1, then best 2-for-1, then best 1-for-2,
    // then second-best of each, and so on.
    const fair: TradeSuggestion[] = [];
    const buckets = [...byShape.values()];
    for (let depth = 0; fair.length < perTeam; depth++) {
      const before = fair.length;
      for (const bucket of buckets) {
        if (fair.length >= perTeam) break;
        if (bucket[depth]) fair.push(bucket[depth]);
      }
      if (fair.length === before) break;
    }

    results.push({
      rosterId: team.rosterId,
      teamName: team.teamName,
      displayName: team.displayName,
      fairCount,
      needFitCount,
      thinPositions: theirNeeds?.thinPositions ?? [],
      // Re-run the keepers through the same function with notes on.
      suggestions: fair.map((s) => ({
        ...s,
        evaluation: evaluateTrade(s.giving, s.getting, settings),
      })),
    });
  }

  // The best partner is one you can actually help. Deals that fill a hole for them
  // rank the team above one that merely has lots of value-matched combinations;
  // total workable deals is the tiebreak, then how close their best offer is to even.
  results.sort((a, b) => {
    if (b.needFitCount !== a.needFitCount) return b.needFitCount - a.needFitCount;
    if (b.fairCount !== a.fairCount) return b.fairCount - a.fairCount;
    return (
      Math.abs(a.suggestions[0]?.evaluation.percentDifference ?? Infinity) -
      Math.abs(b.suggestions[0]?.evaluation.percentDifference ?? Infinity)
    );
  });

  return results;
}
