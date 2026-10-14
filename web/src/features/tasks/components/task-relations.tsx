import type { DependencyDirection, DependencyTask } from '@coretask/types';
import { CheckCircle2, Circle, Loader2, Lock, Plus, Search, ThumbsUp, X } from 'lucide-react';
import { useState } from 'react';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSearch } from '@/features/search/hooks/use-search';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { cn, formatDueDate } from '@/lib/utils';

import {
  useAddDependency,
  useRemoveDependency,
  useTaskDependencies,
  useTaskLikes,
  useToggleTaskLike,
} from '../hooks/use-task-relations';

// ---------------------------------------------------------------------------
// Like
// ---------------------------------------------------------------------------

/**
 * Asana's thumbs-up in the pane's top bar: a count beside it once anyone has
 * liked the task, and the names on hover.
 */
export function TaskLikeButton({
  workspaceId,
  taskId,
}: {
  workspaceId: string | undefined;
  taskId: string;
}) {
  const { data } = useTaskLikes(workspaceId, taskId);
  const toggle = useToggleTaskLike(workspaceId, taskId);
  const liked = data?.likedByMe ?? false;
  const count = data?.count ?? 0;

  const names = (data?.users ?? []).map((user) => user.name);
  const tooltip =
    names.length === 0
      ? 'Like this task'
      : names.length <= 3
        ? `Liked by ${names.join(', ')}`
        : `Liked by ${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={liked}
          aria-label={liked ? 'Unlike this task' : 'Like this task'}
          disabled={!data}
          onClick={() => toggle.mutate(liked)}
          className={cn('h-9 gap-1 px-2', liked && 'text-primary-strong')}
        >
          <ThumbsUp className={cn(liked && 'fill-current')} />
          {count > 0 && <span className="text-xs tabular-nums">{count}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * The pane's Dependencies row: what this task is waiting on, what is waiting
 * on it, and Asana's "Add dependencies" picker.
 *
 * A task waiting on something unfinished says so with a lock, as Asana marks
 * a blocked task — the point of recording a dependency is knowing not to
 * start yet.
 */
export function DependenciesField({
  workspaceId,
  taskId,
  canEdit,
  onOpenTask,
}: {
  workspaceId: string | undefined;
  taskId: string;
  canEdit: boolean;
  onOpenTask?: ((taskId: string) => void) | undefined;
}) {
  const { data, isLoading } = useTaskDependencies(workspaceId, taskId);
  const remove = useRemoveDependency(workspaceId, taskId);

  if (isLoading) {
    return <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />;
  }

  const blockedBy = data?.blockedBy ?? [];
  const blocking = data?.blocking ?? [];
  const waiting = blockedBy.some((entry) => !entry.isCompleted);
  const linked = new Set([...blockedBy, ...blocking].map((entry) => entry.id));

  return (
    <div className="min-w-0 flex-1 space-y-1.5 py-1">
      {blockedBy.length > 0 && (
        <DependencyGroup
          label={waiting ? 'Blocked by' : 'Was waiting on'}
          icon={waiting ? <Lock className="size-3 text-warning-strong" aria-hidden="true" /> : null}
          entries={blockedBy}
          canEdit={canEdit}
          onOpenTask={onOpenTask}
          onRemove={(entry) => remove.mutate(entry.dependencyId)}
        />
      )}
      {blocking.length > 0 && (
        <DependencyGroup
          label="Blocking"
          icon={null}
          entries={blocking}
          canEdit={canEdit}
          onOpenTask={onOpenTask}
          onRemove={(entry) => remove.mutate(entry.dependencyId)}
        />
      )}
      {canEdit ? (
        <AddDependencyPicker workspaceId={workspaceId} taskId={taskId} exclude={linked} />
      ) : (
        blockedBy.length + blocking.length === 0 && (
          <span className="px-2 text-sm text-muted-foreground">None</span>
        )
      )}
    </div>
  );
}

function DependencyGroup({
  label,
  icon,
  entries,
  canEdit,
  onOpenTask,
  onRemove,
}: {
  label: string;
  icon: React.ReactNode;
  entries: DependencyTask[];
  canEdit: boolean;
  onOpenTask?: ((taskId: string) => void) | undefined;
  onRemove: (entry: DependencyTask) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </p>
      <ul className="space-y-0.5">
        {entries.map((entry) => (
          <li
            key={entry.dependencyId}
            className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/60"
          >
            {entry.isCompleted ? (
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Completed" />
            ) : (
              <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <button
              type="button"
              onClick={() => onOpenTask?.(entry.id)}
              disabled={!onOpenTask}
              className={cn(
                'min-w-0 flex-1 truncate text-left focus-visible:outline-none focus-visible:underline',
                onOpenTask && 'cursor-pointer hover:underline',
                entry.isCompleted && 'text-muted-foreground line-through',
              )}
            >
              {entry.title}
            </button>
            {entry.dueDate && !entry.isCompleted && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDueDate(entry.dueDate)}
              </span>
            )}
            {entry.assignee && (
              <PersonAvatar
                name={entry.assignee.name}
                avatarUrl={entry.assignee.avatarUrl}
                className="size-5"
                fallbackClassName="text-[9px]"
                title={entry.assignee.name}
              />
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => onRemove(entry)}
                aria-label={`Remove the dependency on “${entry.title}”`}
                className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 group-hover:opacity-100"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Finds the other task by name, through the same search the top bar uses —
 * dependencies cross projects, so the picker cannot be a list of this one's.
 */
function AddDependencyPicker({
  workspaceId,
  taskId,
  exclude,
}: {
  workspaceId: string | undefined;
  taskId: string;
  exclude: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<DependencyDirection>('BLOCKED_BY');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  useDebouncedValue(term, setDebounced);

  const { data, isFetching } = useSearch(open ? workspaceId : undefined, debounced, ['tasks']);
  const add = useAddDependency(workspaceId, taskId);

  const candidates = (data?.tasks ?? []).filter((hit) => hit.id !== taskId && !exclude.has(hit.id));

  const choose = (otherId: string) =>
    add.mutate(
      { taskId: otherId, direction },
      {
        onSuccess: () => {
          setOpen(false);
          setTerm('');
          setDebounced('');
        },
      },
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground">
          <Plus />
          Add dependencies
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-3">
        <div
          className="flex gap-1 rounded-lg bg-muted p-0.5"
          role="radiogroup"
          aria-label="This task is"
        >
          {(
            [
              ['BLOCKED_BY', 'Blocked by'],
              ['BLOCKING', 'Blocking'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={direction === value}
              onClick={() => setDirection(value)}
              className={cn(
                'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                direction === value
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Find a task by name"
            aria-label="Find a task"
            className="h-8 pl-8 text-sm"
          />
        </div>

        <ul className="max-h-60 overflow-y-auto" aria-label="Tasks">
          {debounced.trim() === '' ? (
            <li className="px-2 py-3 text-xs text-muted-foreground">
              {direction === 'BLOCKED_BY'
                ? 'Which task has to finish before this one can start?'
                : 'Which task is waiting on this one?'}
            </li>
          ) : isFetching && candidates.length === 0 ? (
            <li className="flex justify-center py-3">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
            </li>
          ) : candidates.length === 0 ? (
            <li className="px-2 py-3 text-xs text-muted-foreground">No other task matches.</li>
          ) : (
            candidates.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  disabled={add.isPending}
                  onClick={() => choose(hit.id)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  {hit.isCompleted ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                  {hit.project && (
                    <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                      {hit.project.name}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
