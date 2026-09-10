import { isPick, type LeagueSettings, type Player } from './types';

/**
 * Trade evaluation, extracted from the view and made pure so it can be unit tested
 * and, later, run in a loop across every roster in a league for trade-partner
 * suggestions.
 *
 * Two things the original in-component version got wrong:
 *
 * 1. It OR-ed a value check against an average-rank check and evaluated the
 *    best-case tier first, so average rank could win outright. Giving five top-15
 *    players for one top-1 player produced `rankDifference = 11`, which tripped
 *    "VERY_GOOD" before a value difference of -259.5 was ever looked at - the app
 *    told you to accept a trade where you gave up 3.5x the value. Average rank is
 *    now reported as context only and never gates the verdict.
 *
 * 2. Its thresholds were absolute point gaps, so the same +/-20 boundary judged a
 *    10-point trade and a 400-point trade. They are proportional now.
 */

export type Verdict =
  | 'lopsided-win'
  | 'win'
  | 'slight-win'
  | 'even'
  | 'slight-loss'
  | 'loss'
  | 'lopsided-loss';

/** Percentage of the larger side, so the bands mean the same thing at any scale. */
const THRESHOLDS = {
  LOPSIDED: 20,
  CLEAR: 10,
  SLIGHT: 4,
} as const;

export interface TradeSideSummary {
  count: number;
  value: number;
  redraftValue: number;
  averageRank: number | null;
  /** Value-weighted average age. Null when nothing on this side carries an age. */
  averageAge: number | null;
  pickCount: number;
}

export interface TradeNote {
  kind: 'consolidation' | 'depth' | 'age' | 'picks' | 'rank';
  text: string;
}

export interface TradeEvaluation {
  giving: TradeSideSummary;
  getting: TradeSideSummary;
  /** Raw value delta, positive when you come out ahead. */
  difference: number;
  /** Delta as a percentage of the larger side. This drives the verdict. */
  percentDifference: number;
  verdict: Verdict;
  /** Context that does not change the verdict but changes how you read it. */
  notes: TradeNote[];
  /** False until both sides have at least one asset. */
  isComplete: boolean;
}

function summarize(players: Player[]): TradeSideSummary {
  const value = players.reduce((sum, p) => sum + p.value, 0);
  const ranked = players.filter((p) => !isPick(p));

  const aged = players.filter((p) => typeof p.maybeAge === 'number');
  const agedValue = aged.reduce((sum, p) => sum + p.value, 0);

  return {
    count: players.length,
    value,
    redraftValue: players.reduce((sum, p) => sum + p.redraftValue, 0),
    averageRank: ranked.length
      ? ranked.reduce((sum, p) => sum + p.overallRank, 0) / ranked.length
      : null,
    // Weighted by value: a 33-year-old WR3 should not drag the average as hard as
    // a 33-year-old cornerstone.
    averageAge:
      aged.length && agedValue > 0
        ? aged.reduce((sum, p) => sum + p.maybeAge! * p.value, 0) / agedValue
        : null,
    pickCount: players.filter(isPick).length,
  };
}

function verdictFor(percentDifference: number): Verdict {
  if (percentDifference >= THRESHOLDS.LOPSIDED) return 'lopsided-win';
  if (percentDifference >= THRESHOLDS.CLEAR) return 'win';
  if (percentDifference >= THRESHOLDS.SLIGHT) return 'slight-win';
  if (percentDifference <= -THRESHOLDS.LOPSIDED) return 'lopsided-loss';
  if (percentDifference <= -THRESHOLDS.CLEAR) return 'loss';
  if (percentDifference <= -THRESHOLDS.SLIGHT) return 'slight-loss';
  return 'even';
}

function buildNotes(
  giving: TradeSideSummary,
  getting: TradeSideSummary,
  settings: LeagueSettings
): TradeNote[] {
  const notes: TradeNote[] = [];

  if (getting.count < giving.count) {
    notes.push({
      kind: 'consolidation',
      text: `You consolidate ${giving.count} assets into ${getting.count}. You gain roster spots, but raw value overstates how much depth you keep.`,
    });
  } else if (getting.count > giving.count) {
    notes.push({
      kind: 'depth',
      text: `You take back ${getting.count} assets for ${giving.count}. That is depth, not a top-end upgrade, and it costs roster spots.`,
    });
  }

  if (
    settings.isDynasty &&
    giving.averageAge !== null &&
    getting.averageAge !== null
  ) {
    const delta = getting.averageAge - giving.averageAge;
    if (Math.abs(delta) >= 1) {
      notes.push({
        kind: 'age',
        text:
          delta < 0
            ? `You get ${Math.abs(delta).toFixed(1)} years younger by value. That matters in a keeper league.`
            : `You get ${delta.toFixed(1)} years older by value. Fine if you are contending, costly if you are not.`,
      });
    }
  }

  if (giving.pickCount || getting.pickCount) {
    notes.push({
      kind: 'picks',
      text: `Picks involved: giving ${giving.pickCount}, getting ${getting.pickCount}. Pick values are market averages and swing hard once the rookie class is known.`,
    });
  }

  if (giving.averageRank !== null && getting.averageRank !== null) {
    const delta = giving.averageRank - getting.averageRank;
    if (Math.abs(delta) >= 5) {
      notes.push({
        kind: 'rank',
        text:
          delta > 0
            ? `The players you receive average ${delta.toFixed(0)} ranks higher. Context only - with uneven player counts, average rank is not a fairness measure.`
            : `The players you give up average ${Math.abs(delta).toFixed(0)} ranks higher. Context only - with uneven player counts, average rank is not a fairness measure.`,
      });
    }
  }

  return notes;
}

export function evaluateTrade(
  playersGiving: Player[],
  playersGetting: Player[],
  settings: LeagueSettings
): TradeEvaluation {
  const giving = summarize(playersGiving);
  const getting = summarize(playersGetting);

  const difference = getting.value - giving.value;
  const larger = Math.max(giving.value, getting.value);
  const percentDifference = larger > 0 ? (difference / larger) * 100 : 0;

  const isComplete = giving.count > 0 && getting.count > 0;

  return {
    giving,
    getting,
    difference,
    percentDifference,
    verdict: verdictFor(percentDifference),
    notes: isComplete ? buildNotes(giving, getting, settings) : [],
    isComplete,
  };
}

export const VERDICT_COPY: Record<
  Verdict,
  { text: string; tone: 'good' | 'bad' | 'neutral' }
> = {
  'lopsided-win': {
    text: "Lopsided in your favor. Send it before they run the numbers.",
    tone: 'good',
  },
  win: { text: 'Clear win for you.', tone: 'good' },
  'slight-win': { text: 'Modest win. Worth doing.', tone: 'good' },
  even: { text: 'Close to even. This one comes down to fit and need.', tone: 'neutral' },
  'slight-loss': {
    text: 'You give up a little. Ask for a late pick to even it out.',
    tone: 'bad',
  },
  loss: { text: 'You lose this one on value.', tone: 'bad' },
  'lopsided-loss': {
    text: 'Lopsided against you. Do not do this.',
    tone: 'bad',
  },
};

/** FantasyCalc values are large integers; the UI has always shown them /100. */
export const formatValue = (value: number) => (value / 100).toFixed(1);
