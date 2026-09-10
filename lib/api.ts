import type { FantasyCalcQueryParams, FantasyCalcResponse } from './types';

const FANTASYCALC_API = 'https://api.fantasycalc.com/values/current';

/**
 * The endpoint defaults to ~199 entries, which drops most of the player pool and
 * nearly every rookie draft pick. 600 covers the full dynasty set (423 entries live).
 */
export const DEFAULT_VALUE_LIMIT = 600;

export async function fetchFantasyCalcPlayers(
  params: FantasyCalcQueryParams
): Promise<FantasyCalcResponse> {
  const queryParams = new URLSearchParams();

  if (params.isDynasty !== undefined)
    queryParams.append('isDynasty', params.isDynasty.toString());
  if (params.numQbs !== undefined)
    queryParams.append('numQbs', params.numQbs.toString());
  if (params.numTeams !== undefined)
    queryParams.append('numTeams', params.numTeams.toString());
  if (params.ppr !== undefined)
    queryParams.append('ppr', params.ppr.toString());
  queryParams.append('limit', String(params.limit ?? DEFAULT_VALUE_LIMIT));

  const response = await fetch(`${FANTASYCALC_API}?${queryParams.toString()}`);
  if (!response.ok) {
    throw new Error(
      `FantasyCalc request failed: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}
