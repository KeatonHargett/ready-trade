import { describe, expect, it } from 'vitest';
import {
  computeLeagueNeeds,
  fillsNeedAt,
  needTier,
  requirementsFor,
} from './need';
import type { LeagueTeam, RosterAsset } from './types';

let nextId = 1;

/** The real shape of the league this was built against. */
const ROSTER_POSITIONS = [
  'QB',
  'RB',
  'RB',
  'WR',
  'WR',
  'TE',
  'FLEX',
  'FLEX',
  'K',
  'DEF',
  'BN',
  'BN',
  'BN',
  'BN',
  'BN',
];

function asset(
  position: string,
  value: number,
  isStarter = false
): RosterAsset {
  return {
    sleeperId: String(nextId++),
    name: `${position}${nextId}`,
    position,
    team: 'DAL',
    valued: true,
    value,
    redraftValue: value,
    overallRank: 50,
    maybeAge: 25,
    isStarter,
  };
}

function team(rosterId: number, players: RosterAsset[]): LeagueTeam {
  return {
    rosterId,
    ownerId: `o${rosterId}`,
    displayName: `T${rosterId}`,
    teamName: `T${rosterId}`,
    players,
    totalValue: players.reduce((s, p) => s + (p.value ?? 0), 0),
    unvaluedCount: 0,
  };
}

describe('requirementsFor', () => {
  it('splits flex slots across eligible positions instead of counting them in full', () => {
    const req = requirementsFor(ROSTER_POSITIONS);

    // 2 RB slots + 2 FLEX shared by weight (RB 2, WR 2, TE 1 -> RB takes 2/5 each).
    expect(req.get('RB')).toBeCloseTo(2.8, 5);
    expect(req.get('WR')).toBeCloseTo(2.8, 5);
    expect(req.get('TE')).toBeCloseTo(1.4, 5);
    // QB is not FLEX-eligible in this league.
    expect(req.get('QB')).toBe(1);
  });

  it('does not require three tight ends in a one-TE league', () => {
    // Counting each FLEX in full for every eligible position would make this 3,
    // which flagged every team in the league as thin at TE.
    expect(requirementsFor(ROSTER_POSITIONS).get('TE')).toBeLessThan(2);
  });

  it('gives QB a share of superflex', () => {
    const req = requirementsFor([...ROSTER_POSITIONS, 'SUPER_FLEX']);
    expect(req.get('QB')!).toBeGreaterThan(1);
  });

  it('handles a league with no flex slots', () => {
    const req = requirementsFor(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'BN']);
    expect(req.get('RB')).toBe(2);
    expect(req.get('TE')).toBe(1);
  });
});

/** Everyone rosters enough bodies; only one team is genuinely short at TE. */
function league(): LeagueTeam[] {
  const healthy = (id: number) =>
    team(id, [
      asset('QB', 5000, true),
      asset('RB', 5000, true),
      asset('RB', 4000, true),
      asset('RB', 3000),
      asset('WR', 5000, true),
      asset('WR', 4000, true),
      asset('WR', 3000),
      asset('TE', 5000, true),
      asset('TE', 2000),
    ]);

  const noTe = team(9, [
    asset('QB', 5000, true),
    asset('RB', 5000, true),
    asset('RB', 4000, true),
    asset('RB', 3000),
    asset('WR', 5000, true),
    asset('WR', 4000, true),
    asset('WR', 3000),
  ]);

  return [healthy(1), healthy(2), healthy(3), noTe];
}

describe('computeLeagueNeeds', () => {
  it('flags a team with nobody at a position as thin there', () => {
    const needs = computeLeagueNeeds(league(), ROSTER_POSITIONS);
    const thin = needs.get(9)!;

    expect(thin.byPosition.get('TE')!.count).toBe(0);
    expect(thin.byPosition.get('TE')!.label).toBe('thin');
    expect(thin.thinPositions).toContain('TE');
  });

  it('does not flag a team that covers its slots, even below the league average', () => {
    // Three RBs against a 2.8 requirement is covered, so no hole - the whole point
    // of scoring against slots rather than against what rivals happen to hoard.
    const needs = computeLeagueNeeds(league(), ROSTER_POSITIONS);
    const rb = needs.get(1)!.byPosition.get('RB')!;

    expect(rb.count).toBe(3);
    expect(rb.requirement).toBeCloseTo(2.8, 5);
    expect(rb.label).not.toBe('thin');
  });

  it('counts a below-median starter toward need even when slots are covered', () => {
    const strong = (id: number) =>
      team(id, [asset('QB', 8000, true), asset('RB', 5000, true)]);
    const weakStarter = team(4, [
      asset('QB', 500, true), // slot covered, starter far worse
      asset('RB', 5000, true),
    ]);

    const needs = computeLeagueNeeds(
      [strong(1), strong(2), strong(3), weakStarter],
      ROSTER_POSITIONS
    );
    const weak = needs.get(4)!.byPosition.get('QB')!;

    expect(weak.count).toBe(1);
    expect(weak.requirement).toBe(1);
    expect(weak.starterBelowMedian).toBe(true);
    expect(weak.score).toBe(1);
    expect(weak.label).toBe('thin');
  });

  it('marks a hoarded position deep', () => {
    const hoarder = team(1, Array.from({ length: 7 }, () => asset('WR', 3000)));
    const needs = computeLeagueNeeds([hoarder], ROSTER_POSITIONS);

    expect(needs.get(1)!.byPosition.get('WR')!.label).toBe('deep');
  });

  it('ignores unpriced roster spots when counting', () => {
    const withKicker = team(1, [
      asset('RB', 5000, true),
      { ...asset('K', 0, true), valued: false },
    ]);
    const needs = computeLeagueNeeds([withKicker], ROSTER_POSITIONS);

    expect(needs.get(1)!.byPosition.has('K')).toBe(false);
    expect(needs.get(1)!.byPosition.get('RB')!.count).toBe(1);
  });

  it('falls back to league-average counts when roster positions are unknown', () => {
    const needs = computeLeagueNeeds(league());
    const rb = needs.get(1)!.byPosition.get('RB')!;

    // Every team carries 3 RBs, so the average is the requirement.
    expect(rb.requirement).toBe(3);
  });

  it('returns an empty map for an empty league', () => {
    expect(computeLeagueNeeds([], ROSTER_POSITIONS).size).toBe(0);
  });
});

describe('needTier / fillsNeedAt', () => {
  it('tiers thin above balanced above deep', () => {
    const needs = computeLeagueNeeds(league(), ROSTER_POSITIONS);
    const thin = needs.get(9)!;

    expect(needTier(thin, ['TE'])).toBe(2);
    expect(needTier(thin, ['RB'])).toBeLessThan(2);
  });

  it('takes the best tier across a package', () => {
    const needs = computeLeagueNeeds(league(), ROSTER_POSITIONS);
    const thin = needs.get(9)!;

    expect(needTier(thin, ['RB', 'TE'])).toBe(2);
  });

  it('names only the positions actually thin, neediest first', () => {
    const needs = computeLeagueNeeds(league(), ROSTER_POSITIONS);
    const thin = needs.get(9)!;

    expect(fillsNeedAt(thin, ['TE', 'RB'])).toEqual(['TE']);
    expect(fillsNeedAt(thin, ['RB'])).toEqual([]);
  });

  it('is neutral when needs are unknown', () => {
    expect(needTier(undefined, ['TE'])).toBe(1);
    expect(fillsNeedAt(undefined, ['TE'])).toEqual([]);
  });
});
