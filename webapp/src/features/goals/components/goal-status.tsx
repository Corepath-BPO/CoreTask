import { GOAL_STATUS_LABEL, type GoalStatus } from '@coretask/contracts';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

/**
 * Status is state, so it carries its word as well as its colour — never the
 * colour alone. Only the readings that ask for attention get a loud one.
 */
const VARIANT: Record<GoalStatus, BadgeVariant> = {
  NO_STATUS: 'muted',
  ON_TRACK: 'success',
  AT_RISK: 'warning',
  OFF_TRACK: 'destructive',
  ACHIEVED: 'success',
  PARTIAL: 'warning',
  MISSED: 'destructive',
  DROPPED: 'muted',
};

export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  return <Badge variant={VARIANT[status]}>{GOAL_STATUS_LABEL[status]}</Badge>;
}

/** A thin meter: the fill on a lighter track of the same hue, the number beside it. */
export function GoalProgress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="meter"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-primary/15"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {value}%
      </span>
    </div>
  );
}
