import { describe, expect, it } from 'vitest';
import { evaluateTrade } from './trade';
import { PICK_POSITION, type LeagueSettings, type Player } from './types';

const DYNASTY: LeagueSettings = {
  isDynasty: true,
  numQbs: 1,
  numTeams: 10,
  ppr: 1,
};

let nextId = 1;

function player(overrides: Partial<Player> = {}): Player {
  const value = overrides.value ?? 1000;
  return {
    id: nextId++,
    name: `Player ${nextId}`,
    position: 'WR',
    team: 'DAL',
    value,
    overallRank: 50,
    positionRank: 25,
    trend30Day: 0,
    redraftValue: value,
    combinedValue: value * 2,
    starter: true,
    ...overrides,
  };
}

describe('evaluateTrade', () => {
  it('never contradicts the sign of the value difference', () => {
    // The exact shape that broke the original: five strong players for one elite
    // player. Real FantasyCalc values. Average rank favours the single player by 11,
    // which used to trip the best-case tier before value was ever considered.
    const giving = [
      player({ value: 7583, overallRank: 10 }), // Justin Jefferson
      player({ value: 7483, overallRank: 11 }), // De'Von Achane
      player({ value: 7294, overallRank: 12 }), // CeeDee Lamb
      player({ value: 7049, overallRank: 13 }), // Saquon Barkley
      player({ value: 6795, overallRank: 14 }), // Chase Brown
    ];
    const getting = [player({ value: 10253, overallRank: 1 })]; // Jahmyr Gibbs

    const result = evaluateTrade(giving, getting, DYNASTY);

    expect(result.difference).toBeLessThan(0);
    expect(result.verdict).toBe('lopsided-loss');
    // Average rank still favours the received side; it must not drive the verdict.
    expect(result.giving.averageRank! - result.getting.averageRank!).toBeGreaterThan(
      10
    );
  });

  it('scales thresholds proportionally rather than by absolute points', () => {
    // Same 25% edge at wildly different scales must produce the same verdict.
    const small = evaluateTrade(
      [player({ value: 300 })],
      [player({ value: 400 })],
      DYNASTY
    );
    const large = evaluateTrade(
      [player({ value: 30000 })],
      [player({ value: 40000 })],
      DYNASTY
    );

    expect(small.verdict).toBe(large.verdict);
    expect(small.verdict).toBe('lopsided-win');
  });

  it('does not call a large absolute gap lopsided when it is proportionally small', () => {
    // A 1500-point gap used to be an automatic "very good" under absolute
    // thresholds. Against 40k of value it is under 4%.
    const result = evaluateTrade(
      [player({ value: 40000 })],
      [player({ value: 41500 })],
      DYNASTY
    );

    expect(result.difference).toBe(1500);
    expect(result.verdict).toBe('even');
  });

  it('treats an even swap as even', () => {
    const result = evaluateTrade(
      [player({ value: 5000, overallRank: 20 })],
      [player({ value: 5000, overallRank: 21 })],
      DYNASTY
    );

    expect(result.percentDifference).toBe(0);
    expect(result.verdict).toBe('even');
  });

  it('flags a lopsided 1-for-1 correctly in both directions', () => {
    const losing = evaluateTrade(
      [player({ value: 10000 })],
      [player({ value: 3000 })],
      DYNASTY
    );
    const winning = evaluateTrade(
      [player({ value: 3000 })],
      [player({ value: 10000 })],
      DYNASTY
    );

    expect(losing.verdict).toBe('lopsided-loss');
    expect(winning.verdict).toBe('lopsided-win');
  });

  it('handles picks as first-class assets and excludes them from average rank', () => {
    const giving = [player({ value: 6000, overallRank: 20 })];
    const getting = [
      player({ value: 3000, overallRank: 60 }),
      player({
        value: 2900,
        position: PICK_POSITION,
        overallRank: 65,
        maybeAge: undefined,
      }),
    ];

    const result = evaluateTrade(giving, getting, DYNASTY);

    expect(result.getting.pickCount).toBe(1);
    expect(result.getting.value).toBe(5900);
    // Rank average ignores the pick, so it reflects the one real player.
    expect(result.getting.averageRank).toBe(60);
    expect(result.notes.some((n) => n.kind === 'picks')).toBe(true);
  });

  it('weights age by value and only reports a meaningful swing', () => {
    const giving = [
      player({ value: 9000, maybeAge: 30 }),
      player({ value: 100, maybeAge: 22 }),
    ];
    const getting = [player({ value: 9000, maybeAge: 24 })];

    const result = evaluateTrade(giving, getting, DYNASTY);

    // Value weighting keeps the cheap 22-year-old from masking the age given up.
    expect(result.giving.averageAge!).toBeGreaterThan(29);
    expect(result.notes.some((n) => n.kind === 'age')).toBe(true);
  });

  it('reports incomplete until both sides have assets', () => {
    const result = evaluateTrade([player()], [], DYNASTY);

    expect(result.isComplete).toBe(false);
    expect(result.notes).toHaveLength(0);
  });

  it('does not divide by zero on two empty sides', () => {
    const result = evaluateTrade([], [], DYNASTY);

    expect(result.percentDifference).toBe(0);
    expect(result.verdict).toBe('even');
    expect(result.giving.averageRank).toBeNull();
  });
});
