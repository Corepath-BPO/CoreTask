import { outOfOfficeLabel, type OutOfOfficePeriod } from '@coretask/contracts';
import { Plane } from 'lucide-react';

import { cn, ymd } from '@/lib/utils';

/**
 * "Out of office until Oct 23" beside a name — on member lists and in the
 * pickers someone uses to hand work over. Nothing once the time off is past.
 */
export function OutOfOfficeHint({
  period,
  className,
}: {
  period: OutOfOfficePeriod | null | undefined;
  className?: string;
}) {
  const label = outOfOfficeLabel(period, ymd(new Date()));
  if (!label) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400',
        className,
      )}
      title={period?.note ?? undefined}
    >
      <Plane className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}
