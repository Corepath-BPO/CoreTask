import { BOARD_TASK_LIMIT, PAGINATION_MAX_LIMIT } from '@coretask/contracts';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, CircleCheckBig, FolderKanban, Ticket } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { useTasks } from '@/features/tasks/hooks/use-tasks';
import { useTickets } from '@/features/tickets/hooks/use-tickets';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn } from '@/lib/utils';

type ItemKind = 'task' | 'ticket' | 'project';
type CalendarItem = {
  id: string;
  kind: ItemKind;
  title: string;
  date: string;
  detail: string;
  to: '/my-tasks' | '/tickets' | '/projects/$projectId/board';
  search?: { task: string } | { ticket: string };
  params?: { projectId: string };
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarPage() {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [filter, setFilter] = useState<'all' | ItemKind>('all');
  const range = useMemo(() => calendarRange(month), [month]);
  const [selectedDate, setSelectedDate] = useState(() => dayKey(new Date()));

  const tasks = useTasks(workspace?.id, {
    dueAfter: range.start.toISOString(),
    dueBefore: range.end.toISOString(),
    limit: BOARD_TASK_LIMIT,
  });
  const tickets = useTickets(workspace?.id, {
    dueAfter: range.start.toISOString(),
    dueBefore: range.end.toISOString(),
    includeClosed: true,
    limit: PAGINATION_MAX_LIMIT,
  });
  const projects = useProjects(workspace?.id, { limit: PAGINATION_MAX_LIMIT });

  const items = useMemo<CalendarItem[]>(() => {
    const taskItems: CalendarItem[] = (tasks.data?.items ?? []).flatMap((task) =>
      task.dueDate
        ? [
            {
              id: task.id,
              kind: 'task',
              title: task.title,
              date: dayKey(new Date(task.dueDate)),
              detail: task.status.replaceAll('_', ' '),
              to: '/my-tasks',
              search: { task: task.id },
            },
          ]
        : [],
    );
    const ticketItems: CalendarItem[] = (tickets.data?.items ?? []).flatMap((ticketItem) =>
      ticketItem.dueDate
        ? [
            {
              id: ticketItem.id,
              kind: 'ticket',
              title: ticketItem.title,
              date: dayKey(new Date(ticketItem.dueDate)),
              detail: `${ticketItem.key} · ${ticketItem.status.replaceAll('_', ' ')}`,
              to: '/tickets',
              search: { ticket: ticketItem.key },
            },
          ]
        : [],
    );
    const projectItems: CalendarItem[] = (projects.data?.items ?? []).flatMap((project) => {
      if (!project.dueDate) return [];
      const due = new Date(project.dueDate);
      if (due < range.start || due > range.end) return [];
      return [
        {
          id: project.id,
          kind: 'project',
          title: project.name,
          date: dayKey(due),
          detail: `${project.key} milestone`,
          to: '/projects/$projectId/board',
          params: { projectId: project.id },
        },
      ];
    });
    return [...taskItems, ...ticketItems, ...projectItems];
  }, [projects.data, range, tasks.data, tickets.data]);

  const visibleItems = filter === 'all' ? items : items.filter((item) => item.kind === filter);
  const days = useMemo(() => eachDay(range.start, range.end), [range]);
  const selectedItems = visibleItems.filter((item) => item.date === selectedDate);
  const isLoading = workspaceLoading || tasks.isLoading || tickets.isLoading || projects.isLoading;

  if (isLoading) return <CalendarSkeleton />;
  if (!workspace)
    return (
      <EmptyState
        icon={FolderKanban}
        title="No workspace yet"
        description="Create a workspace to see its schedule."
        className="mt-10"
      />
    );

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <PageHeader
        title="Calendar"
        description={`Deadlines and milestones across ${workspace.name}.`}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              const today = startOfMonth(new Date());
              setMonth(today);
              setSelectedDate(dayKey(new Date()));
            }}
          >
            Today
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between border-b pb-5">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous month"
              onClick={() => setMonth(addMonths(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <CardTitle className="min-w-36 text-center text-base">
              {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </CardTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next month"
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {(['all', 'task', 'ticket', 'project'] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? 'secondary' : 'ghost'}
                className="h-7 capitalize"
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'All' : `${value}s`}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-7 border-b bg-muted/35">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((date) => {
              const key = dayKey(date);
              const dayItems = visibleItems.filter((item) => item.date === key);
              const currentMonth = date.getMonth() === month.getMonth();
              const selected = selectedDate === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDate(key)}
                  className={cn(
                    'min-h-24 border-b border-r p-2 text-left transition-colors hover:bg-muted/45 sm:min-h-32',
                    !currentMonth && 'bg-muted/20 text-muted-foreground',
                    selected && 'bg-primary/[0.07] ring-1 ring-inset ring-primary/40',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold',
                      key === dayKey(new Date()) && 'bg-primary text-primary-foreground',
                    )}
                  >
                    {date.getDate()}
                  </span>
                  <div className="mt-1 space-y-1">
                    {dayItems.slice(0, 3).map((item) => (
                      <div
                        key={`${item.kind}-${item.id}`}
                        className={cn(
                          'truncate rounded-md border-l-2 px-1.5 py-1 text-[10px] font-medium sm:text-xs',
                          itemTone(item.kind),
                        )}
                      >
                        {item.title}
                      </div>
                    ))}
                    {dayItems.length > 3 && (
                      <span className="block px-1 text-[10px] text-muted-foreground">
                        +{dayItems.length - 3} more
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{formatSelectedDate(selectedDate)}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 pt-0 md:grid-cols-2 xl:grid-cols-3">
          {selectedItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing scheduled for this day.</p>
          ) : (
            selectedItems.map((item) => (
              <Button
                key={`${item.kind}-${item.id}`}
                asChild
                variant="outline"
                className="h-auto justify-start whitespace-normal px-3 py-3 text-left"
              >
                <Link to={item.to} search={item.search} params={item.params}>
                  {item.kind === 'task' ? (
                    <CircleCheckBig className="text-primary-strong" />
                  ) : item.kind === 'ticket' ? (
                    <Ticket className="text-warning-strong" />
                  ) : (
                    <FolderKanban className="text-chart-5" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate">{item.title}</span>
                    <span className="block text-xs font-normal capitalize text-muted-foreground">
                      {item.detail}
                    </span>
                  </span>
                </Link>
              </Button>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}
function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function calendarRange(month: Date) {
  const start = startOfMonth(month);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 41);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
function eachDay(start: Date, end: Date) {
  const days: Date[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1))
    days.push(new Date(cursor));
  return days;
}
function itemTone(kind: ItemKind) {
  return kind === 'task'
    ? 'border-primary bg-primary/10'
    : kind === 'ticket'
      ? 'border-warning bg-warning/10'
      : 'border-chart-5 bg-chart-5/10';
}
function formatSelectedDate(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year!, month! - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
function CalendarSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-[650px] w-full rounded-xl" />
    </div>
  );
}
