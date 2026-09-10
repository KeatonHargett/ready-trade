import { describe, expect, it } from 'vitest';
import { recommendPartners } from './recommend';
import { evaluateTrade } from './trade';
import {
  PICK_POSITION,
  type LeagueSettings,
  type LeagueTeam,
  type Player,
  type RosterAsset,
} from './types';

const SETTINGS: LeagueSettings = {
  isDynasty: true,
  numQbs: 1,
  numTeams: 10,
  ppr: 1,
};

let nextId = 1;

function player(value: number, overrides: Partial<Player> = {}): Player {
  return {
    id: nextId++,
    name: `P${nextId}`,
    position: 'WR',
    team: 'DAL',
    value,
    overallRank: 50,
    positionRank: 25,
    trend30Day: 0,
    redraftValue: value,
    combinedValue: value * 2,
    starter: true,
    maybeAge: 25,
    ...overrides,
  };
}

function team(rosterId: number, name: string): LeagueTeam {
  return {
    rosterId,
    ownerId: `owner-${rosterId}`,
    displayName: name,
    teamName: name,
    players: [],
    totalValue: 0,
    unvaluedCount: 0,
  };
}

function asset(position: string, value: number, isStarter = false): RosterAsset {
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

/** A LeagueTeam whose roster actually drives need scoring. */
function rosteredTeam(
  rosterId: number,
  name: string,
  players: RosterAsset[]
): LeagueTeam {
  return { ...team(rosterId, name), players };
}

describe('recommendPartners', () => {
  it('only returns trades inside the fairness band', () => {
    const mine = [player(5000), player(3000)];
    const theirs = [player(5200), player(20000)];

    const [result] = recommendPartners(
      mine,
      [{ team: team(2, 'Them'), pool: theirs }],
      SETTINGS,
      { maxPercent: 10 }
    );

    expect(result).toBeDefined();
    for (const suggestion of result.suggestions) {
      expect(Math.abs(suggestion.evaluation.percentDifference)).toBeLessThanOrEqual(10);
    }
    // The 20000 player cannot pair fairly with anything on a 5000/3000 roster
    // except as part of a package, which is outside the shapes we scan 1-for-1.
    const involvesWhale = result.suggestions.some((s) =>
      s.getting.some((p) => p.value === 20000)
    );
    expect(involvesWhale).toBe(false);
  });

  it('respects a tighter band', () => {
    const mine = [player(5000)];
    const theirs = [player(5600)]; // ~10.7% apart

    const loose = recommendPartners(
      mine,
      [{ team: team(2, 'Them'), pool: theirs }],
      SETTINGS,
      { maxPercent: 15 }
    );
    const tight = recommendPartners(
      mine,
      [{ team: team(2, 'Them'), pool: theirs }],
      SETTINGS,
      { maxPercent: 10 }
    );

    expect(loose).toHaveLength(1);
    expect(tight).toHaveLength(0);
  });

  it('excludes draft picks on both sides', () => {
    const mine = [player(5000), player(4000, { position: PICK_POSITION })];
    const theirs = [player(5000, { position: PICK_POSITION }), player(4900)];

    const [result] = recommendPartners(
      mine,
      [{ team: team(2, 'Them'), pool: theirs }],
      SETTINGS
    );

    const anyPick = result.suggestions.some(
      (s) =>
        s.giving.some((p) => p.position === PICK_POSITION) ||
        s.getting.some((p) => p.position === PICK_POSITION)
    );
    expect(anyPick).toBe(false);
  });

  it('ranks teams with more workable deals first', () => {
    const mine = [player(5000), player(4000), player(3000)];
    const rich = [player(5050), player(4050), player(3050)]; // many fair pairings
    const poor = [player(5000), player(30000), player(40000)]; // one fair pairing

    const results = recommendPartners(
      mine,
      [
        { team: team(3, 'Poor Fit'), pool: poor },
        { team: team(2, 'Good Fit'), pool: rich },
      ],
      SETTINGS,
      { maxPercent: 10 }
    );

    expect(results[0].teamName).toBe('Good Fit');
    expect(results[0].fairCount).toBeGreaterThan(results[1].fairCount);
  });

  it('orders suggestions closest-to-even first, not most-favourable first', () => {
    const mine = [player(5000)];
    const theirs = [player(5000), player(5400), player(4600)];

    const [result] = recommendPartners(
      mine,
      [{ team: team(2, 'Them'), pool: theirs }],
      SETTINGS,
      { maxPercent: 15, perTeam: 3 }
    );

    const percents = result.suggestions.map((s) => s.evaluation.percentDifference);
    // The even swap leads, not the one that maxes out the band in your favour.
    expect(percents[0]).toBe(0);
    const magnitudes = percents.map(Math.abs);
    expect([...magnitudes]).toEqual([...magnitudes].sort((a, b) => a - b));
  });

  it('attaches notes to the suggestions it keeps', () => {
    const mine = [player(6000), player(2000)];
    const theirs = [player(7900)];

    const [result] = recommendPartners(
      mine,
      [{ team: team(2, 'Them'), pool: theirs }],
      SETTINGS,
      { maxPercent: 15 }
    );

    const consolidation = result.suggestions.find((s) => s.giving.length === 2);
    expect(consolidation).toBeDefined();
    expect(consolidation!.evaluation.notes.length).toBeGreaterThan(0);
  });

  it('ranks a deal filling a hole above an equally fair one at a deep position', () => {
    // They start a TE but a weak one, and are deep at WR.
    const them = rosteredTeam(2, 'Them', [
      asset('TE', 500, true),
      asset('WR', 5000, true),
      asset('WR', 4800, true),
      asset('WR', 4600),
      asset('WR', 4400),
    ]);
    const rivals = [3, 4].map((id) =>
      rosteredTeam(id, `Rival ${id}`, [
        asset('TE', 6000, true),
        asset('WR', 5000, true),
      ])
    );

    // Two identically-valued assets I could send: a TE and a WR.
    const mine = [
      player(5000, { position: 'TE', name: 'My TE' }),
      player(5000, { position: 'WR', name: 'My WR' }),
    ];
    const theirPool = [player(5000, { position: 'WR', name: 'Their WR' })];

    const results = recommendPartners(
      mine,
      [
        { team: them, pool: theirPool },
        ...rivals.map((t) => ({ team: t, pool: [] as Player[] })),
      ],
      SETTINGS,
      { maxPercent: 15, perTeam: 4 }
    );

    const partner = results.find((r) => r.teamName === 'Them')!;
    expect(partner).toBeDefined();

    // Both candidate 1-for-1s are exactly 0% apart, so only need can separate them.
    const first = partner.suggestions[0];
    expect(first.giving[0].position).toBe('TE');
    expect(first.fillsNeed).toContain('TE');
    expect(partner.thinPositions).toContain('TE');
    expect(partner.needFitCount).toBeGreaterThan(0);
  });

  it('does not let need change any fairness percentage', () => {
    const them = rosteredTeam(2, 'Them', [
      asset('TE', 500, true),
      asset('WR', 5000, true),
    ]);
    const mine = [player(5000, { position: 'TE' })];
    const theirPool = [player(5400, { position: 'WR' })];

    const [result] = recommendPartners(
      mine,
      [{ team: them, pool: theirPool }],
      SETTINGS,
      { maxPercent: 15 }
    );

    const suggestion = result.suggestions[0];
    // Same numbers evaluateTrade would produce on its own, need or no need.
    const direct = evaluateTrade(suggestion.giving, suggestion.getting, SETTINGS);
    expect(suggestion.evaluation.percentDifference).toBe(direct.percentDifference);
    expect(suggestion.evaluation.difference).toBe(direct.difference);
    expect(suggestion.evaluation.verdict).toBe(direct.verdict);
  });

  it('returns nothing when there is no roster to trade from', () => {
    expect(recommendPartners([], [{ team: team(2, 'Them'), pool: [player(100)] }], SETTINGS))
      .toHaveLength(0);
  });

  it('scans a full 10-team league fast enough to run during render', () => {
    const roster = (seed: number) =>
      Array.from({ length: 15 }, (_, i) => player(1000 + ((seed * 137 + i * 311) % 9000)));

    const mine = roster(1);
    const others = Array.from({ length: 9 }, (_, i) => ({
      team: team(i + 2, `Team ${i + 2}`),
      pool: roster(i + 2),
    }));

    const started = performance.now();
    const results = recommendPartners(mine, others, SETTINGS, { maxPercent: 15 });
    const elapsed = performance.now() - started;

    expect(results.length).toBeGreaterThan(0);
    // Generous ceiling; this guards against a shape being added that explodes.
    expect(elapsed).toBeLessThan(2000);
  });
});
