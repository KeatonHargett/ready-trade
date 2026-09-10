import { evaluateTrade, type TradeEvaluation } from './trade';
import { isPick, type LeagueSettings, type LeagueTeam, type Player } from './types';

/**
 * Trade partner recommender.
 *
 * All fairness scoring comes from `evaluateTrade` - nothing here recomputes a value
 * delta or a percentage. The scan runs with `withNotes: false` because note strings
 * are built per call and dominate at ~25k candidates; the handful that survive are
 * re-evaluated with notes on, through the same function.
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
}

export interface PartnerRecommendation {
  rosterId: number;
  teamName: string;
  displayName: string;
  /** Every fair combination found, not just the ones displayed. */
  fairCount: number;
  /** Best few, closest to even first. */
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

  const results: PartnerRecommendation[] = [];

  for (const { team, pool } of others) {
    const theirs = tradeable(pool);
    if (theirs.length === 0) continue;

    // Kept per shape so the output stays varied. Sorting one flat list by percentage
    // would bury every clean 1-for-1 under packages sitting a fraction closer to the
    // top of the band.
    const byShape = new Map<string, TradeSuggestion[]>();
    let fairCount = 0;

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
            bucket.push({ giving, getting, evaluation });
          }
        }
      }

      if (bucket.length === 0) continue;

      // Closest to even first. Sorting by "most favourable to you" instead pins every
      // suggestion to the top of the band - and a deal that reads +14.9% to you reads
      // -14.9% on their calculator, so it gets declined. The point of this list is
      // trades that actually get accepted.
      bucket.sort(
        (a, b) =>
          Math.abs(a.evaluation.percentDifference) -
          Math.abs(b.evaluation.percentDifference)
      );
      byShape.set(shapeKey, bucket);
      fairCount += bucket.length;
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
      // Re-run the keepers through the same function with notes on.
      suggestions: fair.map((s) => ({
        ...s,
        evaluation: evaluateTrade(s.giving, s.getting, settings),
      })),
    });
  }

  // A good partner is one with lots of workable deals; break ties on how close to
  // even their best offer is.
  results.sort((a, b) => {
    if (b.fairCount !== a.fairCount) return b.fairCount - a.fairCount;
    return (
      Math.abs(a.suggestions[0]?.evaluation.percentDifference ?? Infinity) -
      Math.abs(b.suggestions[0]?.evaluation.percentDifference ?? Infinity)
    );
  });

  return results;
}
