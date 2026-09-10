import { NextResponse } from 'next/server';
import { getLeagueSnapshot } from '@/lib/sleeper';

export const revalidate = 300;

// Sleeper league ids are numeric strings; reject anything else before calling out.
const LEAGUE_ID = /^[0-9]{6,32}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params;

  if (!LEAGUE_ID.test(leagueId)) {
    return NextResponse.json(
      { error: 'Invalid Sleeper league id.' },
      { status: 400 }
    );
  }

  try {
    const snapshot = await getLeagueSnapshot(leagueId);
    return NextResponse.json(snapshot, {
      headers: {
        'Cache-Control': 'private, s-maxage=300, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error(`[/api/league/${leagueId}]`, error);
    return NextResponse.json(
      { error: 'Failed to load league from Sleeper.' },
      { status: 502 }
    );
  }
}
