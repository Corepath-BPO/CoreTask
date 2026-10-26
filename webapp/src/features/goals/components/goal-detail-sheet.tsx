import {
  GOAL_STATUSES,
  GoalProgressSource,
  WorkspaceRole,
  hasAtLeastRole,
  type GoalStatus,
} from '@coretask/contracts';
import type { Goal } from '@coretask/types';
import { FolderKanban, Plus, Target, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { useTeams } from '@/features/teams/hooks/use-teams';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import { useDeleteGoal, useGoalProjectLink, useUpdateGoal } from '../hooks/use-goals';
import { descendantsOf } from '../lib/goal-tree';
import { GoalMetricFields } from './goal-metric-fields';
import { GoalProgress, GoalStatusBadge } from './goal-status';
import { GoalUpdatesSection } from './goal-updates-section';

const NONE = '__none__';

const SOURCES: { value: GoalProgressSource; label: string; hint: string }[] = [
  { value: 'MANUAL', label: 'Manual', hint: 'Set the percentage by hand.' },
  { value: 'SUB_GOALS', label: 'Sub-goals', hint: 'The average of the goals beneath it.' },
  { value: 'PROJECTS', label: 'Projects', hint: 'The average completion of connected projects.' },
  {
    value: 'METRIC',
    label: 'Number',
    hint: 'A number moving from where it started towards a target, like leases signed.',
  },
];

/**
 * One goal, edited in place — Asana's goal page in a side sheet. Fields save
 * as they change, as the task pane's do.
 */
export function GoalDetailSheet({
  workspaceId,
  goal,
  goals,
  role,
  onClose,
  onOpenGoal,
  onAddSubGoal,
}: {
  workspaceId: string | undefined;
  goal: Goal | null;
  goals: Goal[];
  role: WorkspaceRole;
  onClose: () => void;
  onOpenGoal: (goalId: string) => void;
  onAddSubGoal: (parentId: string) => void;
}) {
  return (
    <Sheet open={goal !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {goal && (
          // Keyed so a different goal starts from its own values, not the last one's drafts.
          <GoalDetailBody
            key={goal.id}
            workspaceId={workspaceId}
            goal={goal}
            goals={goals}
            role={role}
            onClose={onClose}
            onOpenGoal={onOpenGoal}
            onAddSubGoal={onAddSubGoal}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function GoalDetailBody({
  workspaceId,
  goal,
  goals,
  role,
  onClose,
  onOpenGoal,
  onAddSubGoal,
}: {
  workspaceId: string | undefined;
  goal: Goal;
  goals: Goal[];
  role: WorkspaceRole;
  onClose: () => void;
  onOpenGoal: (goalId: string) => void;
  onAddSubGoal: (parentId: string) => void;
}) {
  const me = useCurrentUser();
  const update = useUpdateGoal(workspaceId);
  const remove = useDeleteGoal(workspaceId);
  const link = useGoalProjectLink(workspaceId);
  const { data: members } = useWorkspaceMembers(workspaceId);
  const { data: teams } = useTeams(workspaceId);
  const { data: projects } = useProjects(workspaceId, { limit: 100 });

  const canEdit = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const canDelete =
    hasAtLeastRole(role, WorkspaceRole.MANAGER) || (me !== null && goal.owner?.id === me.id);

  const [name, setName] = useState(goal.name);
  const [description, setDescription] = useState(goal.description ?? '');
  const [timePeriod, setTimePeriod] = useState(goal.timePeriod ?? '');
  const [manualProgress, setManualProgress] = useState(goal.progress);

  const save = (payload: Parameters<typeof update.mutate>[0]['payload']) =>
    canEdit && update.mutate({ goalId: goal.id, payload });

  const blocked = descendantsOf(goals, goal.id);
  const parentChoices = goals.filter((entry) => entry.id !== goal.id && !blocked.has(entry.id));
  const children = goals.filter((entry) => entry.parentId === goal.id);
  const linkedIds = new Set(goal.projects.map((project) => project.id));
  const linkable = (projects?.items ?? []).filter((project) => !linkedIds.has(project.id));

  return (
    <div className="space-y-6">
      <SheetHeader className="space-y-1 text-left">
        <SheetDescription className="flex items-center gap-1.5 text-xs">
          <Target className="size-3.5" aria-hidden="true" />
          Goal
        </SheetDescription>
        <SheetTitle className="sr-only">{goal.name}</SheetTitle>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => name.trim() && name.trim() !== goal.name && save({ name: name.trim() })}
          disabled={!canEdit}
          aria-label="Goal title"
          className="h-auto border-0 px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
        />
      </SheetHeader>

      <section className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Progress</p>
          <GoalStatusBadge status={goal.status} />
        </div>
        <GoalProgress value={goal.progress} />

        <div className="grid gap-1.5 pt-1">
          <Label className="text-xs text-muted-foreground">Measured by</Label>
          <div
            className="flex rounded-lg bg-muted p-0.5"
            role="radiogroup"
            aria-label="Measured by"
          >
            {SOURCES.map((source) => (
              <button
                key={source.value}
                type="button"
                role="radio"
                aria-checked={goal.progressSource === source.value}
                disabled={!canEdit}
                title={source.hint}
                onClick={() => save({ progressSource: source.value })}
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                  goal.progressSource === source.value
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {source.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {SOURCES.find((source) => source.value === goal.progressSource)?.hint}
          </p>
        </div>

        {goal.progressSource === GoalProgressSource.METRIC && (
          <GoalMetricFields goal={goal} canEdit={canEdit} onSave={save} />
        )}

        {goal.progressSource === GoalProgressSource.MANUAL && (
          <div className="flex items-center gap-3 pt-1">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={manualProgress}
              disabled={!canEdit}
              onChange={(event) => setManualProgress(Number(event.target.value))}
              // Saved when the thumb is let go, not on every step of the drag.
              onPointerUp={() =>
                manualProgress !== goal.progress && save({ progress: manualProgress })
              }
              onKeyUp={() => manualProgress !== goal.progress && save({ progress: manualProgress })}
              aria-label="Progress percentage"
              className="flex-1 accent-[var(--color-primary)]"
            />
            <span className="w-10 text-right text-sm tabular-nums">{manualProgress}%</span>
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Field label="Status">
          <Select
            value={goal.status}
            onValueChange={(value) => save({ status: value as GoalStatus })}
            disabled={!canEdit}
          >
            <SelectTrigger className="w-full" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GOAL_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  <GoalStatusBadge status={status} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Owner">
          <Select
            value={goal.owner?.id ?? NONE}
            onValueChange={(value) => save({ ownerId: value === NONE ? null : value })}
            disabled={!canEdit}
          >
            <SelectTrigger className="w-full" aria-label="Owner">
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
        </Field>

        <Field label="Team">
          <Select
            value={goal.team?.id ?? NONE}
            onValueChange={(value) => save({ teamId: value === NONE ? null : value })}
            disabled={!canEdit}
          >
            <SelectTrigger className="w-full" aria-label="Team">
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
        </Field>

        <Field label="Time period">
          <Input
            value={timePeriod}
            onChange={(event) => setTimePeriod(event.target.value)}
            onBlur={() =>
              timePeriod.trim() !== (goal.timePeriod ?? '') &&
              save({ timePeriod: timePeriod.trim() || null })
            }
            disabled={!canEdit}
            placeholder="Q4 2026"
            maxLength={32}
            aria-label="Time period"
          />
        </Field>

        <Field label="Due date">
          <Input
            type="date"
            defaultValue={goal.dueDate?.slice(0, 10) ?? ''}
            onBlur={(event) => {
              const value = event.currentTarget.value;
              if (value !== (goal.dueDate?.slice(0, 10) ?? '')) {
                save({ dueDate: value ? `${value}T00:00:00.000Z` : null });
              }
            }}
            disabled={!canEdit}
            aria-label="Due date"
          />
        </Field>

        <Field label="Supports">
          <Select
            value={goal.parentId ?? NONE}
            onValueChange={(value) => save({ parentId: value === NONE ? null : value })}
            disabled={!canEdit}
          >
            <SelectTrigger className="w-full" aria-label="Parent goal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No parent goal</SelectItem>
              {parentChoices.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </section>

      <Field label="Description">
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() =>
            description !== (goal.description ?? '') && save({ description: description || null })
          }
          disabled={!canEdit}
          rows={3}
          placeholder="Why does this goal matter, and how will you know it is met?"
          aria-label="Description"
        />
      </Field>

      <GoalUpdatesSection
        workspaceId={workspaceId}
        goal={goal}
        canPost={canEdit}
        canManage={hasAtLeastRole(role, WorkspaceRole.MANAGER)}
        currentUserId={me?.id}
      />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Sub-goals</h3>
        {children.length === 0 ? (
          <p className="text-xs text-muted-foreground">No goals support this one yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {children.map((child) => (
              <li key={child.id}>
                <button
                  type="button"
                  onClick={() => onOpenGoal(child.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1 truncate">{child.name}</span>
                  <GoalStatusBadge status={child.status} />
                  <GoalProgress value={child.progress} className="w-32" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={() => onAddSubGoal(goal.id)}>
            <Plus />
            Add sub-goal
          </Button>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Connected projects</h3>
        {goal.projects.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Connect the projects that move this goal forward
            {goal.progressSource === GoalProgressSource.PROJECTS
              ? ' — their completion is this goal’s progress.'
              : '.'}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {goal.projects.map((project) => (
              <li key={project.id} className="group flex items-center gap-3 px-3 py-2 text-sm">
                <span
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: project.color }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <GoalProgress value={project.completion} className="w-32" />
                {canEdit && (
                  <button
                    type="button"
                    onClick={() =>
                      link.mutate({ goalId: goal.id, projectId: project.id, linked: false })
                    }
                    aria-label={`Disconnect ${project.name}`}
                    className="cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && linkable.length > 0 && (
          <Select
            value=""
            onValueChange={(projectId) => link.mutate({ goalId: goal.id, projectId, linked: true })}
          >
            <SelectTrigger className="w-full sm:w-72" aria-label="Connect a project">
              <span className="flex items-center gap-2 text-muted-foreground">
                <FolderKanban className="size-4" aria-hidden="true" />
                Connect a project
              </span>
            </SelectTrigger>
            <SelectContent>
              {linkable.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </section>

      {canDelete && (
        <div className="border-t border-border pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            loading={remove.isPending}
            onClick={() => remove.mutate(goal.id, { onSuccess: onClose })}
          >
            <Trash2 />
            Delete goal
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Its sub-goals stay, moving up to this goal’s parent.
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
