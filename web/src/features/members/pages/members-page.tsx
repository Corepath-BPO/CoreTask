import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { WorkspaceInvitation, WorkspaceMember } from '@coretask/types';
import { useNavigate } from '@tanstack/react-router';
import { MailPlus, Users, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useActiveWorkspace,
  useWorkspaceMembers,
} from '@/features/workspaces/hooks/use-workspaces';
import { queryClient, queryKeys } from '@/lib/api/query-client';
import { formatRelativeTime, humanizeEnum } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

import { InviteMemberDialog } from '../components/invite-member-dialog';
import { MemberRow } from '../components/member-row';
import { useInvitations, useRevokeInvitation } from '../hooks/use-invitations';
import { useLeaveWorkspace } from '../hooks/use-members';

export function MembersPage() {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const currentUser = useCurrentUser();

  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canInvite = hasAtLeastRole(role, WorkspaceRole.ADMIN);

  const { data: members, isLoading: membersLoading } = useWorkspaceMembers(workspaceId);
  // Listing invitations is an administrator's view; asking as anyone else would
  // be a guaranteed 403, so the query is not even started.
  const { data: invitations, isLoading: invitationsLoading } = useInvitations(
    workspaceId,
    canInvite,
  );

  const [inviting, setInviting] = useState(false);
  const [leaving, setLeaving] = useState<WorkspaceMember | null>(null);

  const leaveWorkspace = useLeaveWorkspace(workspaceId);
  const navigate = useNavigate();
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);

  const confirmLeave = () => {
    if (!leaving) return;

    leaveWorkspace.mutate(leaving.id, {
      onSuccess: async () => {
        setLeaving(null);
        // Nothing here is readable any more, so clear the selection and let the
        // workspace switcher pick whatever is left.
        setActiveWorkspaceId(null);
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
        await navigate({ to: '/' });
        toast.success('You left the workspace');
      },
    });
  };

  if (workspaceLoading) return <MembersSkeleton />;

  if (!workspace) {
    return (
      <EmptyState
        icon={Users}
        title="No workspace yet"
        description="Create a workspace before inviting anyone to it."
        className="mt-10"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description={`People with access to ${workspace.name}.`}
        actions={
          canInvite ? (
            <Button onClick={() => setInviting(true)}>
              <MailPlus className="size-4" aria-hidden="true" />
              Invite
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {members?.length ?? 0} {members?.length === 1 ? 'person' : 'people'}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          {membersLoading ? (
            <div className="space-y-3 px-5 pb-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <ul aria-label="Workspace members" className="divide-y">
              {(members ?? []).map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  workspaceId={workspaceId}
                  actorRole={role}
                  isSelf={member.user.id === currentUser?.id}
                  onLeave={setLeaving}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canInvite && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>
              Links expire a week after they are sent. Revoking one stops it working immediately.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pt-0">
            {invitationsLoading ? (
              <div className="space-y-3 px-5 pb-4">
                {Array.from({ length: 2 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            ) : (invitations ?? []).length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">
                Nobody is waiting on an invitation.
              </p>
            ) : (
              <ul aria-label="Pending invitations" className="divide-y">
                {(invitations ?? []).map((invitation) => (
                  <InvitationRow
                    key={invitation.id}
                    invitation={invitation}
                    workspaceId={workspaceId}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <InviteMemberDialog
        open={inviting}
        onOpenChange={setInviting}
        workspaceId={workspaceId}
        actorRole={role}
      />

      {/* Leaving is handled here rather than in the row: it navigates away, and
          the row it belongs to stops existing the moment it succeeds. */}
      <AlertDialog open={leaving !== null} onOpenChange={(open) => !open && setLeaving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {workspace.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You lose access immediately, and your open tasks and tickets are unassigned. You will
              need a fresh invitation to come back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLeave}>Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InvitationRow({
  invitation,
  workspaceId,
}: {
  invitation: WorkspaceInvitation;
  workspaceId: string | undefined;
}) {
  const revoke = useRevokeInvitation(workspaceId);

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{invitation.email}</p>
        <p className="truncate text-xs text-muted-foreground">
          {invitation.invitedBy ? `Invited by ${invitation.invitedBy.name} · ` : ''}
          {invitation.expired ? 'Expired' : `Expires ${formatRelativeTime(invitation.expiresAt)}`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {invitation.team && (
          <Badge variant="outline" className="gap-1">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: invitation.team.color }}
            />
            {invitation.team.name}
          </Badge>
        )}
        <Badge variant={invitation.expired ? 'muted' : 'secondary'}>
          {humanizeEnum(invitation.role)}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate(invitation.id)}
          aria-label={`Revoke the invitation to ${invitation.email}`}
        >
          <X className="size-4" aria-hidden="true" />
          Revoke
        </Button>
      </div>
    </li>
  );
}

function MembersSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading members</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}
