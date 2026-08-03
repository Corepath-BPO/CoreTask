import { TaskPriority, TaskStatus, TicketPriority, TicketStatus } from '@coretask/contracts';

import { Badge } from '@/components/ui/badge';
import { humanizeEnum } from '@/lib/utils';

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

/**
 * Status colour is meaning, not decoration: only blocked/overdue states get a
 * loud colour, so a screen full of work does not read as a screen full of alarms.
 */
const TASK_STATUS_VARIANT: Record<TaskStatus, BadgeVariant> = {
  [TaskStatus.BACKLOG]: 'muted',
  [TaskStatus.TODO]: 'secondary',
  [TaskStatus.IN_PROGRESS]: 'default',
  [TaskStatus.IN_REVIEW]: 'warning',
  [TaskStatus.BLOCKED]: 'destructive',
  [TaskStatus.DONE]: 'success',
  [TaskStatus.CANCELLED]: 'muted',
};

const TICKET_STATUS_VARIANT: Record<TicketStatus, BadgeVariant> = {
  [TicketStatus.OPEN]: 'secondary',
  [TicketStatus.TRIAGED]: 'default',
  [TicketStatus.IN_PROGRESS]: 'default',
  [TicketStatus.WAITING]: 'warning',
  [TicketStatus.RESOLVED]: 'success',
  [TicketStatus.CLOSED]: 'muted',
};

const TASK_PRIORITY_VARIANT: Record<TaskPriority, BadgeVariant> = {
  [TaskPriority.NONE]: 'muted',
  [TaskPriority.LOW]: 'muted',
  [TaskPriority.MEDIUM]: 'secondary',
  [TaskPriority.HIGH]: 'warning',
  [TaskPriority.CRITICAL]: 'destructive',
};

const TICKET_PRIORITY_VARIANT: Record<TicketPriority, BadgeVariant> = {
  [TicketPriority.LOW]: 'muted',
  [TicketPriority.MEDIUM]: 'secondary',
  [TicketPriority.HIGH]: 'warning',
  [TicketPriority.URGENT]: 'destructive',
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant={TASK_STATUS_VARIANT[status]}>{humanizeEnum(status)}</Badge>;
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <Badge variant={TICKET_STATUS_VARIANT[status]}>{humanizeEnum(status)}</Badge>;
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === TaskPriority.NONE) return null;
  return <Badge variant={TASK_PRIORITY_VARIANT[priority]}>{humanizeEnum(priority)}</Badge>;
}

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return <Badge variant={TICKET_PRIORITY_VARIANT[priority]}>{humanizeEnum(priority)}</Badge>;
}
