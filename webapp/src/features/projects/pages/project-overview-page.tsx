import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import { Link, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Columns3, History, Target, Users } from 'lucide-react';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjectActivity } from '@/features/activity/hooks/use-activity';
import { describeStory } from '@/features/activity/lib/story-text';
import { ConnectedGoals } from '@/features/goals/components/connected-goals';
import { TaskDetailDialog } from '@/features/tasks/components/task-detail-dialog';
import { useProjectWorkItems } from '@/features/work-items/hooks/use-project-work-items';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn, formatDate, formatRelativeTime, humanizeEnum } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import {
  KeyResourcesCard,
  MilestonesCard,
  ProjectPortfoliosCard,
} from '../components/overview-cards';
import { useProjectMembers } from '../hooks/use-project-members';
import { useProject } from '../hooks/use-projects';
import { useProjectAccess } from '../lib/project-access';

/**
 * A project at a glance.
 *
 * Its numbers come from the project summary the API already returns; beside
 * them, Asana's key resources, milestones and the portfolios it is in.
 */
export function ProjectOverviewPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { workspace } = useActiveWorkspace();
  const { data: project, isLoading } = useProject(workspace?.id, projectId);
  const { data: members } = useProjectMembers(workspace?.id, projectId);
  const { data: activity } = useProjectActivity(workspace?.id, projectId);
  const me = useCurrentUser();
  const access = useProjectAccess(project);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const recentActivity = (activity?.pages[0]?.items ?? []).slice(0, 5);
  // Names for the lines, which otherwise read "created this task" with no task
  // in sight — the same list the Activity tab and every view already hold.
  const { data: workItems } = useProjectWorkItems(workspace?.id, projectId, {});
  const titles = useMemo(
    () => new Map((workItems?.items ?? []).map((item) => [item.id, item.title])),
    [workItems],
  );

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

      <div className="grid gap-4 lg:grid-cols-3">
        <KeyResourcesCard
          workspaceId={workspace?.id}
          projectId={projectId}
          canEdit={access.canEdit && !project.archivedAt}
        />
        <MilestonesCard
          workspaceId={workspace?.id}
          projectId={projectId}
          onOpenTask={setOpenTaskId}
        />
        <ProjectPortfoliosCard workspaceId={workspace?.id} projectId={projectId} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Asana's "Project roles": who is on it, and as what. */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Users className="size-4" aria-hidden="true" />
              Project roles
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!members || members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody has been added yet. Anyone in the workspace can open a public project.
              </p>
            ) : (
              <ul className="space-y-2">
                {members.slice(0, 8).map((member) => (
                  <li key={member.userId} className="flex items-center gap-2.5 text-sm">
                    <PersonAvatar
                      name={member.user.name}
                      avatarUrl={member.user.avatarUrl}
                      className="size-7"
                      fallbackClassName="text-[10px]"
                    />
                    <span className="min-w-0 flex-1 truncate">{member.user.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {humanizeEnum(member.role)}
                    </span>
                  </li>
                ))}
                {members.length > 8 && (
                  <li className="text-xs text-muted-foreground">and {members.length - 8} more</li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* The goals this project moves — Asana's "Connected goals". */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Target className="size-4" aria-hidden="true" />
              Connected goals
            </CardTitle>
          </CardHeader>
          <CardContent>
            {workspace && (
              <ConnectedGoals
                workspaceId={workspace.id}
                projectId={projectId}
                canConnect={hasAtLeastRole(
                  workspace.role ?? WorkspaceRole.GUEST,
                  WorkspaceRole.MEMBER,
                )}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <History className="size-4" aria-hidden="true" />
            Recent activity
          </CardTitle>
          <Link
            to="/projects/$projectId/activity"
            params={{ projectId }}
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has happened here yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentActivity.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2 text-sm">
                  {entry.actor && (
                    <PersonAvatar
                      name={entry.actor.name}
                      avatarUrl={entry.actor.avatarUrl}
                      className="mt-0.5 size-5"
                      fallbackClassName="text-[9px]"
                    />
                  )}
                  <p className="min-w-0 leading-snug">
                    <span className="font-medium">{entry.actor?.name ?? 'Automation'}</span>{' '}
                    <span className="text-muted-foreground">
                      {entry.entity === 'TASK' || entry.entity === 'TICKET'
                        ? describeStory(entry, {
                            itemWord: entry.entity === 'TICKET' ? 'ticket' : 'task',
                            meId: me?.id,
                          })
                        : // After a name, as the Activity tab does: "Ada posted a status update".
                          entry.summary.charAt(0).toLowerCase() + entry.summary.slice(1)}
                    </span>
                    {titles.has(entry.entityId) && (
                      <>
                        {' · '}
                        <button
                          type="button"
                          onClick={() => setOpenTaskId(entry.entityId)}
                          className="cursor-pointer font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                        >
                          {titles.get(entry.entityId)}
                        </button>
                      </>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      · {formatRelativeTime(entry.createdAt)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <TaskDetailDialog
        workspaceId={workspace?.id}
        taskId={openTaskId}
        role={access.effectiveRole}
        onClose={() => setOpenTaskId(null)}
      />
    </div>
  );
}
