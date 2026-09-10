import { NextResponse } from 'next/server';
import { getValues } from '@/lib/sleeper';
import type { LeagueSettings } from '@/lib/types';

// FantasyCalc serves its own Cache-Control: max-age=1200. Match it rather than
// hammering upstream once per visitor.
export const revalidate = 1200;

function parseSettings(searchParams: URLSearchParams): LeagueSettings {
  const num = (key: string, fallback: number) => {
    const raw = searchParams.get(key);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    isDynasty: searchParams.get('isDynasty') === 'true',
    numQbs: num('numQbs', 1) === 2 ? 2 : 1,
    numTeams: Math.min(Math.max(num('numTeams', 12), 4), 32),
    ppr: num('ppr', 1),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const players = await getValues(parseSettings(searchParams));
    return NextResponse.json(
      { players },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=1200, stale-while-revalidate=600',
        },
      }
    );
  } catch (error) {
    console.error('[/api/values]', error);
    return NextResponse.json(
      { error: 'Failed to load player values.' },
      { status: 502 }
    );
  }
}
