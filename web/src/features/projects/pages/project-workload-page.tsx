import type { Task } from '@coretask/types';
import { useNavigate } from '@tanstack/react-router';
import { Gauge } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { toast } from 'sonner';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { EmptyState } from '@/components/feedback/empty-state';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { usePortfolioTasks } from '@/features/portfolios/hooks/use-portfolio-tasks';
import { useUpdateTask } from '@/features/tasks/hooks/use-tasks';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { formatDueDate } from '@/lib/utils/format';

import { useProject } from '../hooks/use-projects';
import { useProjectAccess } from '../lib/project-access';
import {
  acceptsDrop,
  cellLoad,
  weeklyWorkload,
  workloadMove,
  type WorkloadColumn,
} from '../lib/weekly-workload';

type Measure = 'tasks' | 'hours';

/** The task being dragged, and the column it came from. */
interface Dragging {
  task: Task;
  from: string;
}

const MEASURE_KEY = 'coretask.workload.measure';

/** "Oct 23": where a dropped task now falls due, for the toast. */
const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function readMeasure(): Measure {
  try {
    return window.localStorage.getItem(MEASURE_KEY) === 'hours' ? 'hours' : 'tasks';
  } catch {
    return 'tasks';
  }
}

/** A heat step for a load against the busiest cell: four tints, or none. */
function heat(load: number, max: number): string {
  if (load === 0 || max === 0) return '';
  const ratio = load / max;
  if (ratio > 0.75) return 'bg-primary/45';
  if (ratio > 0.5) return 'bg-primary/30';
  if (ratio > 0.25) return 'bg-primary/20';
  return 'bg-primary/10';
}

/**
 * The project's Workload tab — Asana's: who has what, and when it is due.
 *
 * A row per person carrying open work here, a column per week from this one,
 * with what is already overdue before them and what is due later or never
 * after them. A cell is darker the more it holds, counted in tasks or in the
 * hours their estimates add up to; opening one lists its tasks, and a task
 * opens in the panel without leaving the grid.
 *
 * Editors drag a task out of a cell's list onto another cell: the row hands it
 * to that person, the column moves its due date (`workloadMove`).
 */
export function ProjectWorkloadPage({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { workspace } = useActiveWorkspace();
  const { tasks, isLoading } = usePortfolioTasks(workspace?.id, [projectId]);
  const { data: project } = useProject(workspace?.id, projectId);
  const access = useProjectAccess(project);
  const canEdit = access.canEdit && !project?.archivedAt;
  const updateTask = useUpdateTask(workspace?.id);
  const [measure, setMeasure] = useState<Measure>(readMeasure);
  const [dragging, setDragging] = useState<Dragging | null>(null);

  const grid = useMemo(() => weeklyWorkload(tasks, new Date()), [tasks]);
  const max = Math.max(
    0,
    ...grid.rows.flatMap((row) =>
      grid.columns
        .filter((column) => column.start !== undefined)
        .map((column) => cellLoad(row.cells[column.key], measure)),
    ),
  );

  const choose = (next: Measure) => {
    setMeasure(next);
    try {
      window.localStorage.setItem(MEASURE_KEY, next);
    } catch {
      // A private window keeps the choice for the visit only.
    }
  };

  const drop = (personId: string | null, personName: string, column: WorkloadColumn) => {
    if (!dragging) return;
    const { task, from } = dragging;
    setDragging(null);
    const payload = workloadMove(task, from, { personId, column }, new Date());
    if (!payload) return;
    updateTask.mutate(
      { taskId: task.id, payload },
      {
        onSuccess: () => {
          const where = [
            payload.assigneeId !== undefined ? personName : null,
            payload.dueDate !== undefined
              ? payload.dueDate
                ? `due ${DAY_LABEL.format(new Date(`${payload.dueDate}T00:00:00Z`))}`
                : 'no due date'
              : null,
          ].filter(Boolean);
          toast.success(`“${task.title}” moved: ${where.join(', ')}.`);
        },
      },
    );
  };

  const open = (task: Task) =>
    void navigate({
      to: '/projects/$projectId/workload',
      params: { projectId },
      search: { task: task.id },
    });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  if (grid.rows.length === 0) {
    return (
      <EmptyState
        icon={Gauge}
        title="Nothing open"
        description="When this project has open tasks, who carries them and when shows here."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Open work by person and the week it is due. Darker cells hold more.
          {canEdit && ' Drag a task from a cell to hand it over or move its week.'}
        </p>
        <div role="radiogroup" aria-label="Measure" className="inline-flex rounded-lg border p-0.5">
          {(['tasks', 'hours'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={measure === option}
              onClick={() => choose(option)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium',
                measure === option ? 'bg-muted text-foreground' : 'text-muted-foreground',
              )}
            >
              {option === 'tasks' ? 'Tasks' : 'Estimated hours'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
              <th scope="col" className="w-48 px-3 py-2 text-left font-medium">
                Person
              </th>
              {grid.columns.map((column) => (
                <th key={column.key} scope="col" className="px-2 py-2 text-center font-medium">
                  {column.label}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Open
              </th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => {
              const name = row.person?.name ?? 'Unassigned';
              return (
                <tr key={row.person?.id ?? 'unassigned'} className="border-b last:border-b-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <span className="flex items-center gap-2">
                      {row.person ? (
                        <PersonAvatar
                          name={row.person.name}
                          avatarUrl={row.person.avatarUrl}
                          className="size-6"
                          fallbackClassName="text-[9px]"
                        />
                      ) : (
                        <span
                          className="size-6 rounded-full border border-dashed"
                          aria-hidden="true"
                        />
                      )}
                      <span className={cn('truncate', !row.person && 'text-muted-foreground')}>
                        {name}
                      </span>
                    </span>
                  </th>
                  {grid.columns.map((column) => (
                    <Cell
                      key={column.key}
                      person={name}
                      column={column}
                      tasks={row.cells[column.key] ?? []}
                      measure={measure}
                      max={max}
                      onOpen={open}
                      canEdit={canEdit}
                      dragging={dragging}
                      onDragStart={(task) => setDragging({ task, from: column.key })}
                      onDragEnd={() => setDragging(null)}
                      onDrop={() => drop(row.person?.id ?? null, name, column)}
                    />
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {measure === 'tasks'
                      ? row.open
                      : `${Math.round((row.estimatedMinutes / 60) * 10) / 10}h`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({
  person,
  column,
  tasks,
  measure,
  max,
  onOpen,
  canEdit,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  person: string;
  column: WorkloadColumn;
  tasks: Task[];
  measure: Measure;
  max: number;
  onOpen: (task: Task) => void;
  canEdit: boolean;
  dragging: Dragging | null;
  onDragStart: (task: Task) => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const load = cellLoad(tasks, measure);
  const accepts = canEdit && dragging !== null && acceptsDrop(column, dragging.from);

  // A drop target only while a drag it can take is on: everything else is
  // left to the browser, so text and links still drag as they normally would.
  const target = accepts
    ? {
        onDragOver: (event: DragEvent) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setOver(true);
        },
        onDragLeave: () => setOver(false),
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setOver(false);
          onDrop();
        },
      }
    : {};
  const ring = over && accepts ? 'ring-2 ring-primary ring-inset' : '';

  if (tasks.length === 0) {
    return (
      <td
        {...target}
        className={cn(
          'px-2 py-2 text-center text-xs text-muted-foreground/50',
          accepts && 'bg-muted/30',
          ring,
        )}
      >
        ·
      </td>
    );
  }
  const tint =
    column.key === 'overdue'
      ? 'bg-destructive/15 text-destructive'
      : column.start !== undefined
        ? heat(load, max)
        : 'bg-muted/50';

  return (
    <td {...target} className={cn('p-1 text-center', ring)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${person}, ${column.label}: ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
            className={cn(
              'w-full rounded-md px-2 py-1.5 text-xs font-medium tabular-nums transition-colors hover:ring-1 hover:ring-ring/40',
              tint,
            )}
          >
            {measure === 'hours' ? `${load}h` : load}
          </button>
        </PopoverTrigger>
        {/* Out of the way while one of its tasks is dragged, so it does not
            cover the cells the task could go to. */}
        <PopoverContent
          align="center"
          className={cn('w-72 p-1', dragging && 'pointer-events-none opacity-0')}
        >
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            {person} · {column.label}
          </p>
          <ul>
            {tasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  draggable={canEdit}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', task.title);
                    onDragStart(task);
                  }}
                  onDragEnd={() => {
                    onDragEnd();
                    setOpen(false);
                  }}
                  onClick={() => onOpen(task)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted',
                    canEdit && 'cursor-grab active:cursor-grabbing',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  {task.dueDate && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDueDate(task.dueDate)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </td>
  );
}
