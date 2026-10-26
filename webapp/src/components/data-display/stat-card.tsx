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
  /** Promotes the metric to the primary dashboard focus. */
  featured?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  delta,
  hint,
  invertDelta = false,
  featured = false,
  className,
}: StatCardProps) {
  const improving = delta === undefined ? null : invertDelta ? delta < 0 : delta > 0;
  const Icon = (delta ?? 0) >= 0 ? TrendingUp : TrendingDown;

  return (
    <Card
      className={cn(
        'group relative overflow-hidden shadow-none transition-[border-color,box-shadow,transform] hover:-translate-y-0.5',
        featured
          ? 'border-primary bg-primary text-primary-foreground shadow-[0_18px_48px_oklch(0.763_0.164_134/18%)] hover:shadow-[0_22px_54px_oklch(0.763_0.164_134/24%)]'
          : 'hover:border-primary/35 hover:shadow-sm',
        className,
      )}
    >
      {!featured && (
        <span className="absolute inset-x-0 top-0 h-0.5 bg-primary/75" aria-hidden="true" />
      )}
      <CardContent className={cn('space-y-2 py-5', featured && 'flex min-h-44 flex-col p-6')}>
        <p
          className={cn(
            'text-xs font-semibold',
            featured ? 'text-primary-foreground/70' : 'text-muted-foreground',
          )}
        >
          {label}
        </p>

        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'font-semibold tabular-nums tracking-[-0.05em]',
              featured ? 'text-6xl' : 'text-3xl',
            )}
          >
            {value}
          </span>

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

        {hint && (
          <p
            className={cn(
              'text-xs',
              featured ? 'mt-auto text-primary-foreground/75' : 'text-muted-foreground',
            )}
          >
            {hint}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
