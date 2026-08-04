import { useParams } from '@tanstack/react-router';
import { CalendarDays, CheckCircle2, Columns3, Users } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn, formatDate } from '@/lib/utils';

import { useProject } from '../hooks/use-projects';

/**
 * A project at a glance.
 *
 * Deliberately read-only and small. The numbers here come from the project
 * summary the API already returns, so this adds a tab without adding a query.
 */
export function ProjectOverviewPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { workspace } = useActiveWorkspace();
  const { data: project, isLoading } = useProject(workspace?.id, projectId);

  if (isLoading || !project) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  const progress =
    project.taskCount > 0 ? Math.round((project.completedTaskCount / project.taskCount) * 100) : 0;
  const overdue = Boolean(project.dueDate && new Date(project.dueDate) < new Date());

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="space-y-1.5 py-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Progress
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{progress}%</span>
              <span className="text-xs text-muted-foreground">
                {project.completedTaskCount}/{project.taskCount} tasks
              </span>
            </div>
            <Progress value={progress} aria-label={`${progress}% complete`} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 py-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Columns3 className="size-3.5" aria-hidden="true" />
              Sections
            </p>
            <p className="text-2xl font-semibold tabular-nums">{project.sections.length}</p>
            <p className="text-xs text-muted-foreground">Columns on the board</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 py-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              Timeline
            </p>
            <p className={cn('text-sm font-medium', overdue && 'text-destructive')}>
              {project.dueDate ? `Due ${formatDate(project.dueDate)}` : 'No due date'}
            </p>
            <p className="text-xs text-muted-foreground">
              {project.startDate ? `Started ${formatDate(project.startDate)}` : 'No start date'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 py-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Users className="size-3.5" aria-hidden="true" />
              Lead
            </p>
            <p className="text-sm font-medium">{project.lead?.name ?? 'Unassigned'}</p>
            <p className="text-xs text-muted-foreground">
              {project.lead ? project.lead.email : 'Nobody is leading this project'}
            </p>
          </CardContent>
        </Card>
      </div>

      {project.description && (
        <Card>
          <CardContent className="py-4">
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {project.description}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
