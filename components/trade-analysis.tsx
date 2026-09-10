'use client';

import { cn } from '@/lib/utils';
import { isPick, type LeagueSettings, type Player } from '@/lib/types';
import {
  evaluateTrade,
  formatValue,
  VERDICT_COPY,
  type Verdict,
} from '@/lib/trade';
import {
  ArrowRight,
  AlertTriangle,
  ThumbsUp,
  Scale,
  PartyPopper,
  Skull,
  Frown,
  Info,
} from 'lucide-react';

interface TradeAnalysisProps {
  playersGiving: Player[];
  playersGetting: Player[];
  leagueSettings: LeagueSettings;
}

const VERDICT_ICON: Record<Verdict, React.ReactNode> = {
  'lopsided-win': <PartyPopper className="h-5 w-5" />,
  win: <ThumbsUp className="h-5 w-5" />,
  'slight-win': <ThumbsUp className="h-5 w-5" />,
  even: <Scale className="h-5 w-5" />,
  'slight-loss': <Frown className="h-5 w-5" />,
  loss: <AlertTriangle className="h-5 w-5" />,
  'lopsided-loss': <Skull className="h-5 w-5" />,
};

const TONE_CLASS = {
  good: 'bg-green-500/10 text-green-600 dark:text-green-400',
  bad: 'bg-red-500/10 text-red-600 dark:text-red-400',
  neutral: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
} as const;

const BAR_CLASS = {
  good: 'bg-green-600 dark:bg-green-500',
  bad: 'bg-red-600 dark:bg-red-500',
  neutral: 'bg-amber-500 dark:bg-amber-400',
} as const;

const PlayerListItem = ({ player }: { player: Player }) => (
  <li className="flex flex-col sm:flex-row justify-between text-sm pt-2 gap-2">
    <div className="space-y-1">
      <span className="font-medium">
        {player.name}
        {!isPick(player) && ` (${player.position})`}
      </span>
      <div className="text-xs text-muted-foreground">
        {isPick(player) ? (
          <span>Draft pick</span>
        ) : (
          <>
            <span>Overall Rank: #{player.overallRank}</span>
            <span className="mx-2">•</span>
            <span>
              {player.position} Rank: #{player.positionRank}
            </span>
            {typeof player.maybeAge === 'number' && (
              <>
                <span className="mx-2">•</span>
                <span>Age {player.maybeAge.toFixed(1)}</span>
              </>
            )}
          </>
        )}
      </div>
    </div>
    <span className="font-medium sm:text-right">
      {formatValue(player.value)}
    </span>
  </li>
);

export default function TradeAnalysis({
  playersGiving,
  playersGetting,
  leagueSettings,
}: TradeAnalysisProps) {
  // All scoring lives in lib/trade.ts so it stays pure and testable. This component
  // only renders what it returns.
  const result = evaluateTrade(playersGiving, playersGetting, leagueSettings);

  if (!result.isComplete) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Select players on both sides to see analysis</p>
      </div>
    );
  }

  const { giving, getting, difference, percentDifference, verdict, notes } =
    result;
  const copy = VERDICT_COPY[verdict];

  const total = giving.value + getting.value;
  const givingPercent = total > 0 ? (giving.value / total) * 100 : 50;
  const gettingPercent = total > 0 ? (getting.value / total) * 100 : 50;

  return (
    <div className="space-y-6">
      <div className="bg-secondary rounded-lg p-4">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <div className="flex-shrink-0">{VERDICT_ICON[verdict]}</div>
          <div
            className={cn(
              'p-4 rounded-lg max-w-[800px] flex justify-center',
              TONE_CLASS[copy.tone]
            )}
          >
            <p className="text-center">{copy.text}</p>
          </div>
        </div>

        {difference !== 0 && (
          <p className="text-sm text-muted-foreground text-center mt-3">
            {formatValue(Math.abs(difference))} points (
            {Math.abs(percentDifference).toFixed(1)}%) in{' '}
            {difference > 0 ? 'your favor' : 'their favor'}
          </p>
        )}

        {leagueSettings.isDynasty &&
          giving.redraftValue !== getting.redraftValue && (
            <p className="text-sm text-muted-foreground text-center mt-1">
              Win-now value:{' '}
              {formatValue(
                Math.abs(getting.redraftValue - giving.redraftValue)
              )}{' '}
              in{' '}
              {getting.redraftValue > giving.redraftValue
                ? 'your favor'
                : 'their favor'}
            </p>
          )}
      </div>

      {notes.length > 0 && (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li
              key={note.kind}
              className="flex gap-2 text-sm text-muted-foreground"
            >
              <Info className="h-4 w-4 mt-0.5 shrink-0 opacity-70" />
              <span>{note.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
        <div className="text-center">
          <p className="text-sm font-medium mb-1">You Give</p>
          <p className="text-2xl font-bold">{formatValue(giving.value)}</p>
          <p className="text-sm text-muted-foreground">
            {giving.count} asset{giving.count === 1 ? '' : 's'}
          </p>
        </div>

        <div className="flex justify-center">
          <ArrowRight className="h-6 w-6 text-muted-foreground" />
        </div>

        <div className="text-center">
          <p className="text-sm font-medium mb-1">You Get</p>
          <p className="text-2xl font-bold">{formatValue(getting.value)}</p>
          <p className="text-sm text-muted-foreground">
            {getting.count} asset{getting.count === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>Trade Balance</span>
          <span
            className={cn(
              difference > 0
                ? 'text-green-600 dark:text-green-400'
                : difference < 0
                ? 'text-red-600 dark:text-red-400'
                : ''
            )}
          >
            {difference > 0 ? '+' : ''}
            {percentDifference.toFixed(1)}%
          </span>
        </div>
        <div className="h-2.5 flex rounded-full overflow-hidden">
          <div
            className="bg-muted-foreground/40"
            style={{ width: `${givingPercent}%` }}
          />
          <div
            className={BAR_CLASS[copy.tone]}
            style={{ width: `${gettingPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Value out ({givingPercent.toFixed(0)}%)</span>
          <span>Value in ({gettingPercent.toFixed(0)}%)</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4">
        <div className="space-y-3">
          <h3 className="text-sm font-medium">You&apos;re Giving</h3>
          <ul className="space-y-2 divide-y divide-border/40">
            {playersGiving.map((player) => (
              <PlayerListItem key={player.id} player={player} />
            ))}
          </ul>
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-medium">You&apos;re Getting</h3>
          <ul className="space-y-2 divide-y divide-border/40">
            {playersGetting.map((player) => (
              <PlayerListItem key={player.id} player={player} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
