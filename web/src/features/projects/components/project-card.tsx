import type { ProjectSummary } from '@coretask/types';
import { Link } from '@tanstack/react-router';
import { Archive, ArchiveRestore, Columns3, MoreHorizontal, Pencil } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { cn, daysUntil, formatDueDate, initials, percentage } from '@/lib/utils';

import { ProjectStatusBadge } from './project-status-badge';

interface ProjectCardProps {
  project: ProjectSummary;
  onEdit: (project: ProjectSummary) => void;
  onToggleArchive: (project: ProjectSummary) => void;
  canEdit: boolean;
  canArchive: boolean;
}

export function ProjectCard({
  project,
  onEdit,
  onToggleArchive,
  canEdit,
  canArchive,
}: ProjectCardProps) {
  const archived = project.archivedAt !== null;
  const progress = percentage(project.completedTaskCount, project.taskCount);
  const overdue = project.dueDate !== null && !archived && daysUntil(project.dueDate) < 0;

  return (
    <Card
      className={cn('group relative transition-shadow hover:shadow-md', archived && 'opacity-70')}
    >
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-1 size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: project.color }}
          />

          <div className="min-w-0 flex-1">
            {/* The whole card is clickable via this stretched link, so the
                action menu below needs its own stacking context to stay usable. */}
            <Link
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className="after:absolute after:inset-0 focus-visible:outline-none"
            >
              <h3 className="truncate text-sm font-semibold leading-tight group-hover:underline">
                {project.name}
              </h3>
            </Link>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {project.description || 'No description'}
            </p>
          </div>

          {(canEdit || canArchive) && (
            <div className="relative z-10">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Actions for ${project.name}`}
                    className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit && (
                    <DropdownMenuItem onSelect={() => onEdit(project)}>
                      <Pencil />
                      Edit project
                    </DropdownMenuItem>
                  )}
                  {canEdit && canArchive && <DropdownMenuSeparator />}
                  {canArchive && (
                    <DropdownMenuItem
                      variant={archived ? 'default' : 'destructive'}
                      onSelect={() => onToggleArchive(project)}
                    >
                      {archived ? <ArchiveRestore /> : <Archive />}
                      {archived ? 'Restore project' : 'Archive project'}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-mono text-[10px]">
            {project.key}
          </Badge>
          <ProjectStatusBadge status={project.status} />
          {project.team && (
            <Badge variant="outline" className="gap-1">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: project.team.color }}
              />
              {project.team.name}
            </Badge>
          )}
          {archived && <Badge variant="muted">Archived</Badge>}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {project.taskCount === 0
                ? 'No tasks yet'
                : `${project.completedTaskCount}/${project.taskCount} tasks`}
            </span>
            <span className="tabular-nums">{progress}%</span>
          </div>
          <Progress value={progress} aria-label={`${project.name} is ${progress}% complete`} />
        </div>

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Columns3 className="size-3.5" aria-hidden="true" />
            {project.sectionCount} sections
          </span>

          <div className="flex items-center gap-2">
            {project.dueDate && (
              <span className={cn(overdue && 'font-medium text-destructive')}>
                {formatDueDate(project.dueDate)}
              </span>
            )}
            {project.lead && (
              <Avatar className="size-5" title={project.lead.name}>
                {project.lead.avatarUrl && <AvatarImage src={project.lead.avatarUrl} alt="" />}
                <AvatarFallback className="text-[9px]">
                  {initials(project.lead.name)}
                </AvatarFallback>
              </Avatar>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
