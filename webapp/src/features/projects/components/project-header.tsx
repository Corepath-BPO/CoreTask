import { WorkItemType } from '@coretask/contracts';
import type { ProjectSummary } from '@coretask/types';
import { Link } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  CalendarSync,
  ChevronDown,
  Circle,
  Copy,
  FileDown,
  LayoutGrid,
  LayoutTemplate,
  List,
  LogOut,
  Pencil,
  Sparkles,
  Ticket,
  UserPlus,
  Users,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusUpdateChip, StatusUpdateMenu } from '@/features/portfolios/components/status-update';
import type { ProjectStatusUpdateValue } from '@/features/projects/hooks/use-project-updates';

import type { ProjectAccess } from '../lib/project-access';

import { ProjectNotificationsButton } from './project-notifications-button';
import { ProjectStarButton } from './project-star-button';
import { ProjectMembersStack } from './sharing/project-members-stack';
import { ProjectPrivacyBadge } from './sharing/project-privacy-badge';

interface ProjectHeaderProps {
  project: ProjectSummary;
  access: ProjectAccess;
  statusUpdate: { status: ProjectStatusUpdateValue } | null | undefined;
  customizeOpen: boolean;
  joinPending?: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onShare: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onSetStatus: (status: ProjectStatusUpdateValue) => void;
  onCustomize: () => void;
  /** Whether the reader may start projects — and so duplicate this one, or keep it as a template. */
  canStartProjects?: boolean;
  onDuplicate?: () => void;
  onSaveTemplate?: () => void;
  /** Open "Sync to calendar" — anyone who can see the project may. */
  onSyncCalendar?: () => void;
  /** Download the project as CSV — a read, open to anyone who can see it. */
  onExportCsv?: () => void;
  /** Ask the project's owner for a status update; left out for the owner. */
  onRequestStatus?: () => void;
  /** Open the update a rule's AI step drafted; present only while one waits. */
  onReviewDraft?: () => void;
}

/**
 * The project's title row, laid out the way Asana lays it out: team
 * breadcrumb over an icon tile, the name with its padlock and actions caret,
 * star and "Set status", then on the right the members, Join or Share, and
 * Customize.
 *
 * Everything gated here reads the reader's standing *in this project*, not
 * their workspace role — a workspace manager who is a viewer here gets a
 * read-only row.
 */
export function ProjectHeader({
  project,
  access,
  statusUpdate,
  customizeOpen,
  joinPending = false,
  onEdit,
  onArchive,
  onShare,
  onJoin,
  onLeave,
  onSetStatus,
  onCustomize,
  canStartProjects = false,
  onDuplicate,
  onSaveTemplate,
  onSyncCalendar,
  onExportCsv,
  onRequestStatus,
  onReviewDraft,
}: ProjectHeaderProps) {
  const archived = project.archivedAt !== null;
  const TileIcon = project.defaultWorkItemType === WorkItemType.TICKET ? Ticket : List;
  const showsMenu =
    access.canEdit ||
    access.canManage ||
    access.canLeave ||
    canStartProjects ||
    Boolean(onSyncCalendar) ||
    Boolean(onExportCsv);

  return (
    <>
      {/* Asana puts the team where a breadcrumb would go; it links back to the
          browse page already filtered to that team. */}
      <Link
        to="/projects"
        search={project.team ? { teamId: project.team.id } : {}}
        className="inline-block text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        {project.team?.name ?? 'Projects'}
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white"
          style={{ backgroundColor: project.color }}
        >
          <TileIcon className="size-4" />
        </span>

        <h1 className="max-w-[40rem] truncate text-xl font-semibold tracking-tight">
          {project.name}
        </h1>

        {access.isPrivate && <ProjectPrivacyBadge />}

        {showsMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${project.name}`}>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {access.canEdit && (
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil />
                  Edit project
                </DropdownMenuItem>
              )}
              {canStartProjects && onDuplicate && (
                <DropdownMenuItem onSelect={onDuplicate}>
                  <Copy />
                  Duplicate project
                </DropdownMenuItem>
              )}
              {canStartProjects && onSaveTemplate && (
                <DropdownMenuItem onSelect={onSaveTemplate}>
                  <LayoutTemplate />
                  Save as template
                </DropdownMenuItem>
              )}
              {onSyncCalendar && (
                <DropdownMenuItem onSelect={onSyncCalendar}>
                  <CalendarSync />
                  Sync to calendar
                </DropdownMenuItem>
              )}
              {onExportCsv && (
                <DropdownMenuItem onSelect={onExportCsv}>
                  <FileDown />
                  Export to CSV
                </DropdownMenuItem>
              )}
              {access.canLeave && (
                <DropdownMenuItem onSelect={onLeave}>
                  <LogOut />
                  Leave project
                </DropdownMenuItem>
              )}
              {(access.canEdit || access.canLeave) && access.canManage && <DropdownMenuSeparator />}
              {access.canManage && (
                <DropdownMenuItem
                  variant={archived ? 'default' : 'destructive'}
                  onSelect={onArchive}
                >
                  {archived ? <ArchiveRestore /> : <Archive />}
                  {archived ? 'Restore project' : 'Archive project'}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <ProjectStarButton
          workspaceId={project.workspaceId}
          projectId={project.id}
          projectName={project.name}
        />

        {/* Only members hear from a project, so only they choose what. */}
        {access.isMember && (
          <ProjectNotificationsButton
            workspaceId={project.workspaceId}
            projectId={project.id}
            projectName={project.name}
          />
        )}

        {/* Asana's "Set status" — the portfolios status machinery, from the
            project itself. Picking a status opens the composer. */}
        <StatusUpdateMenu
          onPick={onSetStatus}
          onRequest={onRequestStatus}
          trigger={
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              {statusUpdate ? (
                <StatusUpdateChip status={statusUpdate.status} />
              ) : (
                <>
                  <Circle className="size-3" aria-hidden="true" />
                  Set status
                </>
              )}
            </Button>
          }
        />

        {onReviewDraft && (
          <Button variant="outline" size="sm" onClick={onReviewDraft}>
            <Sparkles className="text-primary-strong" />
            Review AI draft
          </Button>
        )}

        {archived && <Badge variant="muted">Archived</Badge>}

        {access.isAdminOverride && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="muted" className="cursor-default">
                Admin access
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              You can see this private project as a workspace admin; you are not a member.
            </TooltipContent>
          </Tooltip>
        )}

        <div className="ml-auto flex items-center gap-2">
          <ProjectMembersStack
            members={project.members}
            memberCount={project.memberCount}
            leadId={project.leadId}
            onClick={onShare}
          />
          {access.canJoin && (
            <Button variant="secondary" size="sm" loading={joinPending} onClick={onJoin}>
              <UserPlus />
              Join
            </Button>
          )}
          <Button size="sm" onClick={onShare}>
            <Users />
            Share
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={customizeOpen}
            onClick={onCustomize}
            className="hidden sm:inline-flex"
          >
            <LayoutGrid />
            Customize
          </Button>
        </div>
      </div>
    </>
  );
}
