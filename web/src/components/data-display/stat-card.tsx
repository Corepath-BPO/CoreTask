import { TrendingDown, TrendingUp } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: number | string;
  /** Change vs the previous period. Zero renders as neutral. */
  delta?: number;
  hint?: string;
  /** Set when a *rising* number is bad, e.g. overdue work. */
  invertDelta?: boolean;
}

export function StatCard({ label, value, delta, hint, invertDelta = false }: StatCardProps) {
  const improving = delta === undefined ? null : invertDelta ? delta < 0 : delta > 0;
  const Icon = (delta ?? 0) >= 0 ? TrendingUp : TrendingDown;

  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums tracking-tight">{value}</span>

          {delta !== undefined && delta !== 0 && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 text-xs font-medium',
                improving ? 'text-success' : 'text-destructive',
              )}
            >
              <Icon className="size-3" aria-hidden="true" />
              {Math.abs(delta)}
              <span className="sr-only">
                {improving ? 'improved by' : 'worsened by'} {Math.abs(delta)}
              </span>
            </span>
          )}
        </div>

        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
