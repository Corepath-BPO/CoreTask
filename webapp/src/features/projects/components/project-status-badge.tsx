import { ProjectStatus } from '@coretask/contracts';

import { Badge } from '@/components/ui/badge';
import { humanizeEnum } from '@/lib/utils';

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

/** Only states that need attention get a loud colour; the rest stay neutral. */
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  [ProjectStatus.PLANNING]: 'secondary',
  [ProjectStatus.ACTIVE]: 'default',
  [ProjectStatus.ON_HOLD]: 'warning',
  [ProjectStatus.COMPLETED]: 'success',
  [ProjectStatus.ARCHIVED]: 'muted',
};

export function ProjectStatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'muted'}>{humanizeEnum(status)}</Badge>;
}
