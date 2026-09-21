import { WorkItemType } from '@coretask/contracts';
import type { ProjectSummary } from '@coretask/types';
import { Link } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Circle,
  LayoutGrid,
  List,
  LogOut,
  Pencil,
  Star,
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
import type { ProjectStatusUpdateValue } from '@/stores/status-update.store';

import type { ProjectAccess } from '../lib/project-access';

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
}: ProjectHeaderProps) {
  const archived = project.archivedAt !== null;
  const TileIcon = project.defaultWorkItemType === WorkItemType.TICKET ? Ticket : List;
  const showsMenu = access.canEdit || access.canManage || access.canLeave;

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

        <Button
          variant="ghost"
          size="icon-sm"
          disabled
          title="Starring projects is not built yet"
          aria-label="Star project (not built yet)"
        >
          <Star />
        </Button>

        {/* Asana's "Set status" — the portfolios status machinery, from the
            project itself. Picking a status opens the composer. */}
        <StatusUpdateMenu
          onPick={onSetStatus}
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
