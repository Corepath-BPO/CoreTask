import type { Goal } from '@coretask/types';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTeams } from '@/features/teams/hooks/use-teams';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { useCurrentUser } from '@/stores/auth.store';

import { useCreateGoal } from '../hooks/use-goals';

const NONE = '__none__';

/** The quarter today falls in, as Asana suggests a new goal's time period. */
function currentQuarter(): string {
  const now = new Date();
  return `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;
}

/**
 * Create a goal — Asana's short form: a name, an owner, a time period, and
 * where it sits in the tree. Everything else is edited on the goal itself.
 */
export function CreateGoalDialog({
  open,
  onOpenChange,
  workspaceId,
  goals,
  parentId = null,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  goals: Goal[];
  parentId?: string | null;
  onCreated?: (goal: Goal) => void;
}) {
  const me = useCurrentUser();
  const create = useCreateGoal(workspaceId);
  const { data: members } = useWorkspaceMembers(open ? workspaceId : undefined);
  const { data: teams } = useTeams(open ? workspaceId : undefined);

  const [name, setName] = useState('');
  const [ownerId, setOwnerId] = useState(me?.id ?? NONE);
  const [teamId, setTeamId] = useState(NONE);
  const [timePeriod, setTimePeriod] = useState(currentQuarter);
  const [parent, setParent] = useState(parentId ?? NONE);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      {
        name: trimmed,
        ownerId: ownerId === NONE ? null : ownerId,
        teamId: teamId === NONE ? null : teamId,
        timePeriod: timePeriod.trim() || null,
        parentId: parent === NONE ? null : parent,
      },
      {
        onSuccess: (goal) => {
          onOpenChange(false);
          onCreated?.(goal);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{parentId ? 'New sub-goal' : 'New goal'}</DialogTitle>
          <DialogDescription>
            Name the outcome. You can connect projects and set how progress is measured next.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="goal-name">Goal title</Label>
            <Input
              id="goal-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Grow annual revenue by 20%"
              maxLength={200}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="goal-owner">Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="goal-owner" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No owner</SelectItem>
                  {(members ?? []).map((member) => (
                    <SelectItem key={member.user.id} value={member.user.id}>
                      {member.user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="goal-period">Time period</Label>
              <Input
                id="goal-period"
                value={timePeriod}
                onChange={(event) => setTimePeriod(event.target.value)}
                placeholder="Q4 2026"
                maxLength={32}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="goal-team">Team</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger id="goal-team" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No team</SelectItem>
                  {(teams ?? []).map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="goal-parent">Supports</Label>
              <Select value={parent} onValueChange={setParent}>
                <SelectTrigger id="goal-parent" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No parent goal</SelectItem>
                  {goals.map((goal) => (
                    <SelectItem key={goal.id} value={goal.id}>
                      {goal.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
              Create goal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
