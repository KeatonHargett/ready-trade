import { describe, expect, it } from 'vitest';
import { computeLeagueNeeds, fillsNeedAt, needTier } from './need';
import type { LeagueTeam, RosterAsset } from './types';

let nextId = 1;

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

/** Three teams with two TEs each, plus one that has none. */
function leagueWithTeThinTeam(): LeagueTeam[] {
  const stocked = (id: number) =>
    team(id, [
      asset('TE', 5000, true),
      asset('TE', 3000),
      asset('RB', 5000, true),
      asset('RB', 4000, true),
      asset('WR', 5000, true),
    ]);

  const teThin = team(9, [
    asset('RB', 5000, true),
    asset('RB', 4000, true),
    asset('WR', 5000, true),
    asset('WR', 4000, true),
    asset('WR', 3000),
  ]);

  return [stocked(1), stocked(2), stocked(3), teThin];
}

describe('computeLeagueNeeds', () => {
  it('flags a team with no players at a position as thin there', () => {
    const needs = computeLeagueNeeds(leagueWithTeThinTeam());
    const thin = needs.get(9)!;

    expect(thin.byPosition.get('TE')!.count).toBe(0);
    expect(thin.byPosition.get('TE')!.label).toBe('thin');
    expect(thin.thinPositions).toContain('TE');
  });

  it('flags a team carrying more than average as deep', () => {
    const needs = computeLeagueNeeds(leagueWithTeThinTeam());
    const stocked = needs.get(1)!;

    // Everyone else has 2 TEs, one team has 0, so the average is 1.5.
    expect(stocked.byPosition.get('TE')!.leagueAverageCount).toBe(1.5);
    expect(stocked.byPosition.get('TE')!.count).toBe(2);
    expect(stocked.byPosition.get('TE')!.label).not.toBe('thin');
  });

  it('counts a below-median starter toward need even at normal depth', () => {
    const strong = (id: number) =>
      team(id, [asset('QB', 8000, true), asset('RB', 5000, true)]);
    const weakStarter = team(4, [
      asset('QB', 500, true), // same count, far worse starter
      asset('RB', 5000, true),
    ]);

    const needs = computeLeagueNeeds([strong(1), strong(2), strong(3), weakStarter]);
    const weak = needs.get(4)!.byPosition.get('QB')!;

    expect(weak.count).toBe(1);
    expect(weak.starterBelowMedian).toBe(true);
    // Count is at league average, so the whole score comes from the weak starter.
    expect(weak.score).toBe(1);
    expect(weak.label).toBe('thin');
  });

  it('ignores unpriced roster spots when counting', () => {
    const withKicker = team(1, [
      asset('RB', 5000, true),
      { ...asset('K', 0, true), valued: false },
    ]);
    const needs = computeLeagueNeeds([withKicker]);

    expect(needs.get(1)!.byPosition.has('K')).toBe(false);
    expect(needs.get(1)!.byPosition.get('RB')!.count).toBe(1);
  });

  it('returns an empty map for an empty league', () => {
    expect(computeLeagueNeeds([]).size).toBe(0);
  });
});

describe('needTier / fillsNeedAt', () => {
  it('tiers thin above balanced above deep', () => {
    const needs = computeLeagueNeeds(leagueWithTeThinTeam());
    const thin = needs.get(9)!;

    expect(needTier(thin, ['TE'])).toBe(2);
    expect(needTier(thin, ['WR'])).toBeLessThan(2);
  });

  it('takes the best tier across a package', () => {
    const needs = computeLeagueNeeds(leagueWithTeThinTeam());
    const thin = needs.get(9)!;

    // A package containing a TE still counts as filling the TE hole.
    expect(needTier(thin, ['WR', 'TE'])).toBe(2);
  });

  it('names only the positions actually thin, neediest first', () => {
    const needs = computeLeagueNeeds(leagueWithTeThinTeam());
    const thin = needs.get(9)!;

    expect(fillsNeedAt(thin, ['TE', 'WR'])).toEqual(['TE']);
    expect(fillsNeedAt(thin, ['WR'])).toEqual([]);
  });

  it('is neutral when needs are unknown', () => {
    expect(needTier(undefined, ['TE'])).toBe(1);
    expect(fillsNeedAt(undefined, ['TE'])).toEqual([]);
  });
});
