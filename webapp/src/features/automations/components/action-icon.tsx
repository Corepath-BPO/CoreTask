import type { AutomationAction } from '@coretask/contracts';
import {
  ArrowRightLeft,
  ArrowRightToLine,
  BellRing,
  Bot,
  CalendarClock,
  CalendarDays,
  CalendarX,
  CircleCheck,
  CircleDot,
  ClipboardList,
  Flag,
  FolderMinus,
  ListChecks,
  ListTree,
  Mail,
  MessageSquare,
  NotebookPen,
  Play,
  Shapes,
  SlidersHorizontal,
  SquarePlus,
  Tag,
  TextCursorInput,
  Ticket,
  Timer,
  UserMinus,
  UserPlus,
  Users,
  UsersRound,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/** What a rule does, as an icon, beside its trigger's on a gallery card. */
const ACTION_ICON: Record<AutomationAction, LucideIcon> = {
  ASSIGN_USER: UserPlus,
  UNASSIGN_USER: UserMinus,
  MOVE_TO_SECTION: ArrowRightToLine,
  MOVE_TO_PROJECT: ArrowRightLeft,
  UPDATE_STATUS: CircleDot,
  UPDATE_PRIORITY: Flag,
  SET_DUE_DATE: CalendarClock,
  CLEAR_DUE_DATE: CalendarX,
  SET_START_DATE: CalendarDays,
  CLEAR_START_DATE: CalendarX,
  SET_ESTIMATE: Timer,
  SET_CUSTOM_FIELD: SlidersHorizontal,
  ADD_COMMENT: MessageSquare,
  SEND_IN_APP_NOTIFICATION: BellRing,
  CREATE_SUBTASK: ListTree,
  SEND_WEBHOOK: Webhook,
  SET_COMPLETION: CircleCheck,
  REMOVE_FROM_PROJECT: FolderMinus,
  CREATE_TASK: SquarePlus,
  ADD_REMOVE_COLLABORATORS: Users,
  SET_TASK_NAME: TextCursorInput,
  SET_TASK_DESCRIPTION: NotebookPen,
  SET_TASK_TYPE: Shapes,
  SEND_EMAIL: Mail,
  SET_TICKET_STATUS: Ticket,
  SET_TICKET_PRIORITY: Tag,
  AI_ACTION: Bot,
  AI_DRAFT_UPDATE: ClipboardList,
  CREATE_CHECKLIST: ListChecks,
  ASSIGN_TEAM: UsersRound,
};

/**
 * Decorative: the card's words say the same. An action this build does not
 * know yet gets a plain "do something".
 */
export function ActionIcon({ action, className }: { action: string; className?: string }) {
  const Icon = ACTION_ICON[action as AutomationAction] ?? Play;

  return (
    <Icon className={cn('size-4 shrink-0 text-muted-foreground', className)} aria-hidden="true" />
  );
}
