import { PROJECT_RESOURCE_TITLE_MAX, TaskKind } from '@coretask/contracts';
import { Link } from '@tanstack/react-router';
import { Briefcase, Diamond, ExternalLink, Link2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { usePortfolios } from '@/features/portfolios/hooks/use-portfolios';
import { useTasks } from '@/features/tasks/hooks/use-tasks';
import { cn, formatDate } from '@/lib/utils';

import {
  useAddProjectResource,
  useProjectResources,
  useRemoveProjectResource,
} from '../hooks/use-project-resources';

/** Asana's "Key resources": the links everyone on the project should have to hand. */
export function KeyResourcesCard({
  workspaceId,
  projectId,
  canEdit,
}: {
  workspaceId: string | undefined;
  projectId: string;
  canEdit: boolean;
}) {
  const { data: resources } = useProjectResources(workspaceId, projectId);
  const add = useAddProjectResource(workspaceId, projectId);
  const remove = useRemoveProjectResource(workspaceId, projectId);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Link2 className="size-4" aria-hidden="true" />
          Key resources
        </CardTitle>
        {canEdit && !adding && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Add link
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!url.trim()) return;
              add.mutate(
                { title: title.trim(), url: url.trim() },
                {
                  onSuccess: () => {
                    setTitle('');
                    setUrl('');
                    setAdding(false);
                  },
                },
              );
            }}
          >
            <Input
              value={url}
              autoFocus
              inputMode="url"
              aria-label="Link"
              placeholder="https://…"
              onChange={(event) => setUrl(event.target.value)}
            />
            <Input
              value={title}
              maxLength={PROJECT_RESOURCE_TITLE_MAX}
              aria-label="Title"
              placeholder="Title (the site’s name when left empty)"
              onChange={(event) => setTitle(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!url.trim() || add.isPending}>
                Add
              </Button>
            </div>
          </form>
        )}
        {(resources ?? []).length === 0 && !adding ? (
          <p className="text-sm text-muted-foreground">
            No links yet. Add the brief, a shared folder, the spec — whatever the project needs to
            hand.
          </p>
        ) : (
          <ul className="space-y-1" aria-label="Key resources">
            {(resources ?? []).map((resource) => (
              <li key={resource.id} className="group flex items-center gap-2 text-sm">
                <ExternalLink
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                  title={resource.url}
                >
                  {resource.title}
                </a>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label={`Remove ${resource.title}`}
                    onClick={() => remove.mutate(resource.id)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** The project's milestones, soonest first, ticked when reached. */
export function MilestonesCard({
  workspaceId,
  projectId,
  onOpenTask,
}: {
  workspaceId: string | undefined;
  projectId: string;
  onOpenTask: (taskId: string) => void;
}) {
  const { data } = useTasks(workspaceId, {
    projectId,
    kind: TaskKind.MILESTONE,
    includeSubtasks: true,
    limit: 50,
  });
  const milestones = [...(data?.items ?? [])].sort((a, b) => {
    if (a.dueDate === b.dueDate) return a.title.localeCompare(b.title);
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Diamond className="size-4" aria-hidden="true" />
          Milestones
        </CardTitle>
      </CardHeader>
      <CardContent>
        {milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No milestones yet. Add one from the List’s Add menu, or convert a task.
          </p>
        ) : (
          <ul className="space-y-1.5" aria-label="Milestones">
            {milestones.map((milestone) => {
              const done = milestone.completedAt !== null;
              return (
                <li key={milestone.id}>
                  <button
                    type="button"
                    onClick={() => onOpenTask(milestone.id)}
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-muted/50"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-2.5 shrink-0 rotate-45 rounded-[2px]',
                        done ? 'bg-success' : 'bg-warning',
                      )}
                    />
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate',
                        done && 'text-muted-foreground line-through',
                      )}
                    >
                      {milestone.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {milestone.dueDate ? formatDate(milestone.dueDate) : 'No date'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** The portfolios this project is followed in. */
export function ProjectPortfoliosCard({
  workspaceId,
  projectId,
}: {
  workspaceId: string | undefined;
  projectId: string;
}) {
  const portfolios = usePortfolios(workspaceId).filter((portfolio) =>
    portfolio.projectIds.includes(projectId),
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Briefcase className="size-4" aria-hidden="true" />
          Portfolios
        </CardTitle>
      </CardHeader>
      <CardContent>
        {portfolios.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not in a portfolio.</p>
        ) : (
          <ul className="space-y-1" aria-label="Portfolios">
            {portfolios.map((portfolio) => (
              <li key={portfolio.id}>
                <Link
                  to="/portfolios/$portfolioId"
                  params={{ portfolioId: portfolio.id }}
                  className="flex items-center gap-2 rounded-md px-1 py-1 text-sm font-medium hover:bg-muted/50"
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: portfolio.color }}
                  />
                  <span className="truncate">{portfolio.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
