import { APPROVAL_ACTION_LABEL, APPROVAL_STATUS_LABEL, ApprovalStatus } from '@coretask/contracts';
import { Check, RotateCcw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { APPROVAL_TONE } from '../lib/task-kinds';

const DECISIONS = [
  { status: ApprovalStatus.APPROVED, icon: Check, tone: 'hover:text-success' },
  { status: ApprovalStatus.CHANGES_REQUESTED, icon: RotateCcw, tone: 'hover:text-warning-strong' },
  { status: ApprovalStatus.REJECTED, icon: X, tone: 'hover:text-destructive' },
] as const;

/**
 * An approval's answer, in the pane's top bar where a task has "Mark
 * complete": Approve, Request changes or Reject — Asana's three buttons.
 *
 * Once decided, the decision is shown and the other two stay offered, so a
 * reviewer can change their mind; choosing the current one again takes it
 * back to pending.
 */
export function ApprovalDecision({
  status,
  disabled,
  onDecide,
}: {
  status: ApprovalStatus | null;
  disabled: boolean;
  onDecide: (status: ApprovalStatus) => void;
}) {
  const current = status ?? ApprovalStatus.PENDING;

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Approval decision">
      {current !== ApprovalStatus.PENDING && (
        <span className={cn('px-1 text-xs font-medium', APPROVAL_TONE[current])}>
          {APPROVAL_STATUS_LABEL[current]}
        </span>
      )}
      {DECISIONS.map(({ status: decision, icon: Icon, tone }) => {
        const chosen = current === decision;
        return (
          <Button
            key={decision}
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-pressed={chosen}
            onClick={() => onDecide(chosen ? ApprovalStatus.PENDING : decision)}
            className={cn(tone, chosen && APPROVAL_TONE[decision])}
          >
            <Icon />
            {APPROVAL_ACTION_LABEL[decision]}
          </Button>
        );
      })}
    </div>
  );
}
