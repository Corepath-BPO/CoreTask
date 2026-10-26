import type { WorkItemType } from '@coretask/contracts';
import { BadgeCheck, Diamond, ListTodo, TicketIcon, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * One icon per kind, so a mixed list reads without opening anything.
 *
 * A List showing tasks and tickets together needs the difference visible at a
 * glance — the alternative is two rows that look identical until you notice one
 * has a key and the other does not.
 */
const ICON: Record<WorkItemType, LucideIcon> = {
  TASK: ListTodo,
  TICKET: TicketIcon,
  MILESTONE: Diamond,
  APPROVAL: BadgeCheck,
};

/**
 * Colour reinforces the shape rather than replacing it — the icons differ in
 * outline too, so this is never the only signal.
 *
 * Existing semantic tokens only. There is no `--info`, and adding one for a
 * single icon would put a colour in the palette that nothing else means.
 */
const TONE: Record<WorkItemType, string> = {
  TASK: 'text-muted-foreground',
  TICKET: 'text-primary-strong',
  MILESTONE: 'text-warning-strong',
  APPROVAL: 'text-success',
};

export function WorkItemTypeIcon({ type, className }: { type: WorkItemType; className?: string }) {
  const Icon = ICON[type];

  // `aria-hidden` throughout: every place this renders already names the type
  // in text beside it, and a second announcement is noise.
  return <Icon className={cn('size-4 shrink-0', TONE[type], className)} aria-hidden="true" />;
}
