import type { AutomationTrigger } from '@coretask/contracts';
import {
  AlarmClock,
  AlignLeft,
  ArrowRight,
  BadgeCheck,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CircleCheck,
  CircleDot,
  CirclePlus,
  Clock,
  Flag,
  Hourglass,
  LockOpen,
  MessageSquare,
  Paperclip,
  PencilLine,
  Play,
  Shapes,
  SlidersHorizontal,
  Ticket,
  TicketCheck,
  Timer,
  Type,
  UserPlus,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/** What sets a rule off, as an icon: a rule list reads by its triggers. */
const TRIGGER_ICON: Record<AutomationTrigger, LucideIcon> = {
  TASK_CREATED: CirclePlus,
  TASK_UPDATED: PencilLine,
  TASK_MOVED_TO_SECTION: ArrowRight,
  TASK_STATUS_CHANGED: CircleDot,
  TASK_PRIORITY_CHANGED: Flag,
  TASK_ASSIGNED: UserPlus,
  TASK_COMPLETED: CircleCheck,
  TASK_DUE_DATE_CHANGED: CalendarClock,
  TASK_START_DATE_CHANGED: CalendarDays,
  TASK_ESTIMATE_CHANGED: Timer,
  TASK_TITLE_CHANGED: Type,
  TASK_DESCRIPTION_CHANGED: AlignLeft,
  COMMENT_ADDED: MessageSquare,
  CUSTOM_FIELD_CHANGED: SlidersHorizontal,
  TICKET_CREATED: Ticket,
  TICKET_STATUS_CHANGED: TicketCheck,
  RUN_MANUALLY: Play,
  SCHEDULED_TIME: Clock,
  DUE_DATE_APPROACHING: Hourglass,
  TASK_OVERDUE: AlarmClock,
  START_DATE_APPROACHING: Hourglass,
  START_DATE_PASSED: CalendarCheck,
  TASK_NO_LONGER_BLOCKED: LockOpen,
  ATTACHMENT_ADDED: Paperclip,
  COLLABORATOR_ADDED: Users,
  TASK_TYPE_CHANGED: Shapes,
  APPROVAL_STATUS_CHANGED: BadgeCheck,
  CUSTOM_DATE_APPROACHING: Hourglass,
  CUSTOM_DATE_PASSED: CalendarCheck,
};

/**
 * Decorative: the rule's name is right beside it. A trigger this build does
 * not know yet still gets the automations bolt.
 */
export function TriggerIcon({
  triggerType,
  className,
}: {
  triggerType: string;
  className?: string;
}) {
  const Icon = TRIGGER_ICON[triggerType as AutomationTrigger] ?? Zap;

  return (
    <Icon className={cn('size-4 shrink-0 text-muted-foreground', className)} aria-hidden="true" />
  );
}
