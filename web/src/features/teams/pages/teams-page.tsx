import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { Team } from '@coretask/types';
import { Link } from '@tanstack/react-router';
import { Crown, FolderKanban, MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { initials } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import { TeamFormDialog } from '../components/team-form-dialog';
import { TeamRosterDialog } from '../components/team-roster-dialog';
import { useDeleteTeam, useTeams } from '../hooks/use-teams';

export function TeamsPage() {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const currentUser = useCurrentUser();

  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const isAdmin = hasAtLeastRole(role, WorkspaceRole.ADMIN);

  const { data: teams, isLoading } = useTeams(workspaceId);
  const deleteTeam = useDeleteTeam(workspaceId);

  const [editing, setEditing] = useState<Team | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Team | null>(null);
  const [deleting, setDeleting] = useState<Team | null>(null);

  /**
   * The same rule the API enforces: administrators run any team, and a lead
   * runs their own. Mirrored here so the UI does not offer actions the server
   * would refuse — the API remains the boundary.
   */
  const canManage = (team: Team) => isAdmin || team.leadId === currentUser?.id;

  const confirmDelete = () => {
    if (!deleting) return;
    deleteTeam.mutate(
      { teamId: deleting.id, name: deleting.name },
      { onSuccess: () => setDeleting(null) },
    );
  };

  if (workspaceLoading) return <TeamsSkeleton />;

  if (!workspace) {
    return (
      <EmptyState
        icon={Users}
        title="No workspace yet"
        description="Create a workspace before organising it into teams."
        className="mt-10"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teams"
        description={`Groups of people inside ${workspace.name}.`}
        actions={
          isAdmin ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New team
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-40 w-full" />
          ))}
        </div>
      ) : (teams ?? []).length === 0 ? (
        <EmptyState
          icon={Users}
          title="No teams yet"
          description={
            isAdmin
              ? 'Group people by what they work on, then point projects at them.'
              : 'An administrator has not set up any teams here.'
          }
          action={
            isAdmin ? <Button onClick={() => setCreating(true)}>Create a team</Button> : undefined
          }
        />
      ) : (
        <ul aria-label="Teams" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(teams ?? []).map((team) => (
            <li key={team.id}>
              <TeamCard
                team={team}
                canManage={canManage(team)}
                isAdmin={isAdmin}
                onView={() => setViewing(team)}
                onEdit={() => setEditing(team)}
                onDelete={() => setDeleting(team)}
              />
            </li>
          ))}
        </ul>
      )}

      <TeamFormDialog open={creating} onOpenChange={setCreating} workspaceId={workspaceId} />

      <TeamFormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        workspaceId={workspaceId}
        team={editing}
      />

      <TeamRosterDialog
        open={viewing !== null}
        onOpenChange={(open) => !open && setViewing(null)}
        workspaceId={workspaceId}
        team={viewing}
        canManage={viewing ? canManage(viewing) : false}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.projectCount
                ? `Its ${deleting.projectCount} project${deleting.projectCount === 1 ? '' : 's'} stay put. They simply stop belonging to a team. This cannot be undone.`
                : 'The team is removed for everyone. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface TeamCardProps {
  team: Team;
  canManage: boolean;
  isAdmin: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function TeamCard({ team, canManage, isAdmin, onView, onEdit, onDelete }: TeamCardProps) {
  return (
    <Card className="group h-full transition-shadow hover:shadow-md">
      <CardContent className="flex h-full flex-col gap-3 py-4">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-1 size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: team.color }}
          />

          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold leading-tight">{team.name}</h3>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {team.description || 'No description'}
            </p>
          </div>

          {(canManage || isAdmin) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${team.name}`}
                  className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canManage && (
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil />
                    Edit team
                  </DropdownMenuItem>
                )}
                {canManage && isAdmin && <DropdownMenuSeparator />}
                {/* Deleting is ADMIN-only: a lead may run a team but not
                    dissolve it, which is what the API enforces too. */}
                {isAdmin && (
                  <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <Trash2 />
                    Delete team
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {team.lead ? (
          <div className="flex items-center gap-2">
            <Avatar className="size-6">
              {team.lead.avatarUrl && <AvatarImage src={team.lead.avatarUrl} alt="" />}
              <AvatarFallback className="text-[9px]">{initials(team.lead.name)}</AvatarFallback>
            </Avatar>
            <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <Crown className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{team.lead.name}</span>
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No lead</p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">
            <Users className="size-3" aria-hidden="true" />
            {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}
          </Badge>
          {team.projectCount > 0 && (
            <Badge variant="outline" asChild>
              <Link to="/projects" search={{ teamId: team.id }}>
                <FolderKanban className="size-3" aria-hidden="true" />
                {team.projectCount} {team.projectCount === 1 ? 'project' : 'projects'}
              </Link>
            </Badge>
          )}
        </div>

        <Button variant="outline" size="sm" onClick={onView}>
          {canManage ? 'Manage members' : 'View members'}
        </Button>
      </CardContent>
    </Card>
  );
}

function TeamsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading teams</span>
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}
