import type { AdminMember } from '@coretask/types';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { describeWork } from '../lib/describe-work';

/** Radix refuses an empty value, so "nobody" needs a name of its own. */
const NOBODY = 'nobody';

export type HandOverMode = 'deactivate' | 'remove';

interface HandOverDialogProps {
  mode: HandOverMode;
  member: AdminMember | null;
  /** Active members who could take the work over. */
  candidates: AdminMember[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reassignToUserId: string | null) => void;
}

/**
 * Asana's deprovisioning: before someone's access ends, say who gets their
 * open work. Moving it is the default when there is work to move, since an
 * unassigned task is easy to lose.
 */
export function HandOverDialog({
  mode,
  member,
  candidates,
  pending,
  onOpenChange,
  onConfirm,
}: HandOverDialogProps) {
  // Keyed by the caller on the member, so each person starts from a fresh
  // choice: last time's recipient may be the wrong one.
  const [recipient, setRecipient] = useState(NOBODY);

  if (!member) return null;

  const work = describeWork(member.openTasks, member.openTickets);
  const others = candidates.filter((candidate) => candidate.user.id !== member.user.id);
  const name = member.user.name;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'deactivate' ? `Deactivate ${name}?` : `Remove ${name}?`}
          </DialogTitle>
          <DialogDescription>
            {mode === 'deactivate'
              ? 'They lose access at once and stop getting notifications. Their role, teams and projects are kept, so reactivating them gives everything back.'
              : 'They lose access at once and leave every team and project here. Work they finished stays attributed to them.'}
          </DialogDescription>
        </DialogHeader>

        {work ? (
          <Field
            label={`Their open work: ${work}`}
            htmlFor="hand-over-recipient"
            hint="Work in a project the new assignee isn’t a member of is left unassigned."
          >
            <Select value={recipient} onValueChange={setRecipient} disabled={pending}>
              <SelectTrigger id="hand-over-recipient" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOBODY}>Leave it unassigned</SelectItem>
                {others.map((candidate) => (
                  <SelectItem key={candidate.user.id} value={candidate.user.id}>
                    Reassign to {candidate.user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <p className="text-sm text-muted-foreground">They have no open tasks or tickets here.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => onConfirm(recipient === NOBODY ? null : recipient)}
          >
            {mode === 'deactivate' ? 'Deactivate' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
