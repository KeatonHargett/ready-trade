'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Handshake, TrendingDown, Users } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatValue } from '@/lib/trade';
import {
  recommendPartners,
  FAIRNESS_BANDS,
  type FairnessBand,
  type TradeSuggestion,
} from '@/lib/recommend';
import type { LeagueSettings, LeagueTeam, Player } from '@/lib/types';

interface TradePartnersProps {
  myPool: Player[];
  others: Array<{ team: LeagueTeam; pool: Player[] }>;
  settings: LeagueSettings;
  onApply: (suggestion: TradeSuggestion) => void;
}

const names = (players: Player[]) => players.map((p) => p.name).join(' + ');

function fairnessTone(percent: number) {
  if (percent > 1) return 'text-green-600 dark:text-green-400';
  if (percent < -1) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

export default function TradePartners({
  myPool,
  others,
  settings,
  onApply,
}: TradePartnersProps) {
  const [band, setBand] = useState<FairnessBand>(15);

  // ~20ms for a 10-team league at typical roster sizes, so it runs inline.
  const recommendations = useMemo(
    () => recommendPartners(myPool, others, settings, { maxPercent: band }),
    [myPool, others, settings, band]
  );

  return (
    <Card className="border-gray-800/20 dark:border-gray-300/10">
      <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-3">
        <div>
          <CardTitle className="mb-2">Trade Partners</CardTitle>
          <CardDescription>
            Every one-for-one and two-for-one across the league that lands inside
            your fairness band, ordered so deals that fill a hole for the other
            side come first. Draft picks are excluded.
          </CardDescription>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {FAIRNESS_BANDS.map((option) => (
            <Button
              key={option}
              variant={band === option ? 'default' : 'outline'}
              size="sm"
              onClick={() => setBand(option)}
            >
              Within {option}%
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent>
        {recommendations.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <Users className="h-6 w-6 mx-auto mb-2 opacity-60" />
            <p className="text-sm">
              No trades land within {band}% right now. Try the wider band.
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {recommendations.map((partner, index) => (
              <li
                key={partner.rosterId}
                className="rounded-lg border border-border/60 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      #{index + 1}
                    </span>
                    <span className="font-medium truncate">
                      {partner.teamName}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {partner.displayName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {partner.thinPositions.length > 0 && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400"
                      >
                        <TrendingDown className="h-3 w-3" />
                        Thin at {partner.thinPositions.join(', ')}
                      </Badge>
                    )}
                    <Badge variant="secondary">
                      {partner.fairCount} workable
                      {partner.needFitCount > 0 &&
                        ` · ${partner.needFitCount} fill a need`}
                    </Badge>
                  </div>
                </div>

                <ul className="space-y-2">
                  {partner.suggestions.map((suggestion, i) => {
                    const percent = suggestion.evaluation.percentDifference;
                    return (
                      <li
                        key={i}
                        className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-sm rounded-md bg-muted/40 px-3 py-2"
                      >
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                            <span className="truncate">
                              {names(suggestion.giving)}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium">
                              {names(suggestion.getting)}
                            </span>
                          </div>
                          {suggestion.fillsNeed.length > 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              {partner.teamName} is thin at{' '}
                              {suggestion.fillsNeed.join(' and ')}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {formatValue(suggestion.evaluation.giving.value)} →{' '}
                            {formatValue(suggestion.evaluation.getting.value)}
                          </span>
                          <span
                            className={cn(
                              'tabular-nums font-medium',
                              fairnessTone(percent)
                            )}
                          >
                            {percent > 0 ? '+' : ''}
                            {percent.toFixed(1)}%
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onApply(suggestion)}
                          >
                            <Handshake className="mr-2 h-3.5 w-3.5" />
                            Load
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
