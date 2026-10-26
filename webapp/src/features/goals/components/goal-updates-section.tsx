import {
  GOAL_STATUSES,
  GOAL_STATUS_LABEL,
  GoalStatus,
  type GoalStatus as GoalStatusValue,
} from '@coretask/contracts';
import type { Goal } from '@coretask/types';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { RichTextView } from '@/components/forms/rich-text-editor';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatRelativeTime } from '@/lib/utils/format';

import { useDeleteGoalUpdate, useGoalUpdates, usePostGoalUpdate } from '../hooks/use-goal-updates';

import { GoalStatusBadge } from './goal-status';

/**
 * A goal's status updates — Asana's goal check-ins. Posting one picks the
 * status the goal is in now and says why; the newest sets the goal's status,
 * and the list below reads as how the goal has been going.
 */
export function GoalUpdatesSection({
  workspaceId,
  goal,
  canPost,
  canManage,
  currentUserId,
}: {
  workspaceId: string | undefined;
  goal: Goal;
  canPost: boolean;
  canManage: boolean;
  currentUserId: string | undefined;
}) {
  const { data: updates } = useGoalUpdates(workspaceId, goal.id);
  const post = usePostGoalUpdate(workspaceId, goal.id);
  const remove = useDeleteGoalUpdate(workspaceId, goal.id);
  const [status, setStatus] = useState<GoalStatusValue>(
    goal.status === GoalStatus.NO_STATUS ? GoalStatus.ON_TRACK : goal.status,
  );
  const [note, setNote] = useState('');

  return (
    <section className="space-y-3" aria-labelledby="goal-updates">
      <h3 id="goal-updates" className="text-sm font-semibold">
        Status updates
      </h3>

      {canPost && (
        <form
          className="space-y-2 rounded-lg border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            post.mutate(
              { status, ...(note.trim() ? { body: note.trim() } : {}) },
              { onSuccess: () => setNote('') },
            );
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">This goal is</span>
            <Select
              value={status}
              onValueChange={(next) => {
                // Radix sends '' when its options change; that is not a choice.
                if (next) setStatus(next as GoalStatusValue);
              }}
            >
              <SelectTrigger size="sm" className="h-8 w-40" aria-label="Status for this update">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOAL_STATUSES.filter((value) => value !== GoalStatus.NO_STATUS).map((value) => (
                  <SelectItem key={value} value={value}>
                    {GOAL_STATUS_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            value={note}
            rows={2}
            maxLength={5000}
            aria-label="What changed"
            placeholder="What changed, and what happens next?"
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={post.isPending}>
              Post update
            </Button>
          </div>
        </form>
      )}

      {!updates || updates.length === 0 ? (
        <p className="text-xs text-muted-foreground">No updates yet.</p>
      ) : (
        <ul className="space-y-3" aria-label="Goal updates">
          {updates.map((update) => (
            <li key={update.id} className="space-y-1.5 rounded-lg border px-3 py-2.5">
              <div className="flex items-center gap-2">
                {update.author && (
                  <PersonAvatar
                    name={update.author.name}
                    avatarUrl={update.author.avatarUrl}
                    className="size-6"
                    fallbackClassName="text-[9px]"
                  />
                )}
                <span className="min-w-0 truncate text-sm font-medium">
                  {update.author?.name ?? 'Former member'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatRelativeTime(update.createdAt)}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {update.progress}%
                  </span>
                  <GoalStatusBadge status={update.status} />
                  {(canManage || update.author?.id === currentUserId) && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-6"
                      aria-label="Delete this update"
                      onClick={() => remove.mutate(update.id)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </span>
              </div>
              {update.body && (
                <RichTextView html={update.body} workspaceId={workspaceId} className="text-sm" />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
