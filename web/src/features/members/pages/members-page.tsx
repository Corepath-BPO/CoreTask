import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { WorkspaceInvitation, WorkspaceMember } from '@coretask/types';
import { MailPlus, Users, X } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useActiveWorkspace,
  useWorkspaceMembers,
} from '@/features/workspaces/hooks/use-workspaces';
import { formatDate, formatRelativeTime, humanizeEnum, initials } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import { InviteMemberDialog } from '../components/invite-member-dialog';
import { useInvitations, useRevokeInvitation } from '../hooks/use-invitations';

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
                  isSelf={member.user.id === currentUser?.id}
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
    </div>
  );
}

function MemberRow({ member, isSelf }: { member: WorkspaceMember; isSelf: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <Avatar className="size-8 shrink-0">
        {member.user.avatarUrl && <AvatarImage src={member.user.avatarUrl} alt="" />}
        <AvatarFallback className="text-[11px]">{initials(member.user.name)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {member.user.name}
          {isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Joined {formatDate(member.joinedAt)}
        </span>
        <Badge variant={member.role === WorkspaceRole.OWNER ? 'default' : 'secondary'}>
          {humanizeEnum(member.role)}
        </Badge>
      </div>
    </li>
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
