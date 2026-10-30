import {
  WORKSPACE_ROLES,
  WorkspaceRole,
  canManageMember,
  grantableRoles,
} from '@coretask/contracts';
import type { AdminInvitationLink, AdminMember, WorkspaceInvitation } from '@coretask/types';
import {
  Crown,
  Download,
  Link2,
  MailPlus,
  MoreHorizontal,
  RotateCcw,
  Search,
  UserMinus,
  UserX,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { CopyButton } from '@/components/common/copy-button';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { InviteMemberDialog } from '@/features/members/components/invite-member-dialog';
import { useInvitations, useRevokeInvitation } from '@/features/members/hooks/use-invitations';
import { useTransferOwnership, useUpdateMemberRole } from '@/features/members/hooks/use-members';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { formatDate, formatRelativeTime, humanizeEnum, initials } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import { HandOverDialog, type HandOverMode } from '../components/hand-over-dialog';
import {
  useAdminMembers,
  useAdminRemoveMember,
  useDeactivateMember,
  useInvitationLink,
  useReactivateMember,
} from '../hooks/use-admin';
import { membersCsv } from '../lib/members-csv';

type StatusFilter = 'ALL' | AdminMember['status'];
const ALL_ROLES = 'ALL';

const STATUS_LABEL: Record<AdminMember['status'], string> = {
  ACTIVE: 'Active',
  NOT_SIGNED_UP: 'Not signed up',
  DEACTIVATED: 'Deactivated',
};

const STATUS_VARIANT: Record<AdminMember['status'], 'success' | 'outline' | 'muted'> = {
  ACTIVE: 'success',
  NOT_SIGNED_UP: 'outline',
  DEACTIVATED: 'muted',
};

const HEADERS = ['Person', 'Role', 'Status', 'Last active', 'Sign-in', 'Open work', ''] as const;

/**
 * Members and Guests: one table, the Guests tab being its guest-only cut, as
 * in Asana's console. Role changes and ownership use the Members routes, so
 * this page and the Members page apply the same rules.
 */
export function AdminMembersPage({ guests = false }: { guests?: boolean }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const actorRole = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const currentUser = useCurrentUser();
  const { data: members, isLoading } = useAdminMembers(workspaceId);

  const [query, setQuery] = useState('');
  const [role, setRole] = useState<string>(ALL_ROLES);
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [inviting, setInviting] = useState(false);
  const [handOver, setHandOver] = useState<{ mode: HandOverMode; member: AdminMember } | null>(
    null,
  );
  const [transferTo, setTransferTo] = useState<AdminMember | null>(null);

  const deactivate = useDeactivateMember(workspaceId);
  const remove = useAdminRemoveMember(workspaceId);
  const transfer = useTransferOwnership(workspaceId);

  const scoped = useMemo(
    () => (members ?? []).filter((member) => !guests || member.role === WorkspaceRole.GUEST),
    [members, guests],
  );
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scoped.filter(
      (member) =>
        (role === ALL_ROLES || member.role === role) &&
        (status === 'ALL' || member.status === status) &&
        (!needle ||
          member.user.name.toLowerCase().includes(needle) ||
          member.user.email.toLowerCase().includes(needle)),
    );
  }, [scoped, query, role, status]);
  const candidates = useMemo(
    () => (members ?? []).filter((member) => member.status !== 'DEACTIVATED'),
    [members],
  );

  const exportCsv = () => {
    const blob = new Blob([membersCsv(shown)], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `${workspace?.slug ?? 'workspace'}-${guests ? 'guests' : 'members'}.csv`;
    link.click();
    URL.revokeObjectURL(href);
  };

  const confirmHandOver = (reassignToUserId: string | null) => {
    if (!handOver) return;
    const { mode, member } = handOver;
    const done = { onSuccess: () => setHandOver(null) };
    if (mode === 'deactivate') {
      deactivate.mutate({ memberId: member.id, payload: { reassignToUserId } }, done);
    } else {
      remove.mutate(
        { memberId: member.id, name: member.user.name, payload: { reassignToUserId } },
        done,
      );
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>{guests ? 'Guests' : 'Members'}</CardTitle>
            <CardDescription>
              {guests
                ? 'People with the Guest role. Give one a higher role to make them a member.'
                : 'Everyone with a membership here, deactivated people included.'}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={shown.length === 0}>
              <Download className="size-4" aria-hidden="true" />
              Export CSV
            </Button>
            <Button onClick={() => setInviting(true)}>
              <MailPlus className="size-4" aria-hidden="true" />
              Invite
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-0">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[14rem] flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or e-mail"
                aria-label="Search people"
                className="pl-8"
              />
            </div>
            {!guests && (
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger aria-label="Filter by role" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ROLES}>All roles</SelectItem>
                  {WORKSPACE_ROLES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {humanizeEnum(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
              <SelectTrigger aria-label="Filter by status" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any status</SelectItem>
                {(Object.keys(STATUS_LABEL) as AdminMember['status'][]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {STATUS_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground" aria-live="polite">
            {isLoading
              ? 'Loading people…'
              : `${shown.length} of ${scoped.length} ${scoped.length === 1 ? 'person' : 'people'}`}
          </p>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table
              className="w-full min-w-[880px] text-sm"
              aria-label={guests ? 'Guests' : 'Members'}
            >
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  {HEADERS.map((header, index) => (
                    <th
                      key={index}
                      scope="col"
                      className="px-3 py-2 text-xs font-medium text-muted-foreground"
                    >
                      {header || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 4 }).map((_, index) => (
                      <tr key={index} className="border-b border-border last:border-0">
                        {HEADERS.map((_header, cell) => (
                          <td key={cell} className="px-3 py-3">
                            <Skeleton className="h-4 w-full" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : shown.map((member) => (
                      <MemberRow
                        key={member.id}
                        member={member}
                        workspaceId={workspaceId}
                        actorRole={actorRole}
                        isSelf={member.user.id === currentUser?.id}
                        onHandOver={(mode) => setHandOver({ mode, member })}
                        onTransfer={() => setTransferTo(member)}
                      />
                    ))}
                {!isLoading && shown.length === 0 && (
                  <tr>
                    <td colSpan={HEADERS.length} className="px-3 py-8 text-center text-muted-foreground">
                      {scoped.length === 0
                        ? guests
                          ? 'No guests in this workspace.'
                          : 'Nobody here yet.'
                        : 'Nobody matches these filters.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {!guests && <PendingInvitations workspaceId={workspaceId} />}

      <InviteMemberDialog
        open={inviting}
        onOpenChange={setInviting}
        workspaceId={workspaceId}
        actorRole={actorRole}
      />

      <HandOverDialog
        key={handOver?.member.id ?? 'none'}
        mode={handOver?.mode ?? 'deactivate'}
        member={handOver?.member ?? null}
        candidates={candidates}
        pending={deactivate.isPending || remove.isPending}
        onOpenChange={(open) => !open && setHandOver(null)}
        onConfirm={confirmHandOver}
      />

      <AlertDialog
        open={transferTo !== null}
        onOpenChange={(open) => !open && setTransferTo(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make {transferTo?.user.name} the owner?</AlertDialogTitle>
            <AlertDialogDescription>
              You become a super admin, and only they will be able to transfer ownership again or
              delete the workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => transferTo && transfer.mutate(transferTo.id)}
              disabled={transfer.isPending}
            >
              Transfer ownership
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MemberRow({
  member,
  workspaceId,
  actorRole,
  isSelf,
  onHandOver,
  onTransfer,
}: {
  member: AdminMember;
  workspaceId: string | undefined;
  actorRole: WorkspaceRole;
  isSelf: boolean;
  onHandOver: (mode: HandOverMode) => void;
  onTransfer: () => void;
}) {
  const updateRole = useUpdateMemberRole(workspaceId);
  const reactivate = useReactivateMember(workspaceId);

  // The API's rules: outrank the member, grant no more than you hold.
  const canManage = canManageMember(actorRole, member.role);
  const deactivated = member.status === 'DEACTIVATED';
  const canTransfer = actorRole === WorkspaceRole.OWNER && !isSelf && !deactivated;
  const work = [
    member.openTasks > 0 ? `${member.openTasks} task${member.openTasks === 1 ? '' : 's'}` : null,
    member.openTickets > 0
      ? `${member.openTickets} ticket${member.openTickets === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean);

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/30">
      <td className="px-3 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-8 shrink-0">
            {member.user.avatarUrl && <AvatarImage src={member.user.avatarUrl} alt="" />}
            <AvatarFallback className="text-[11px]">{initials(member.user.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className={deactivated ? 'truncate font-medium text-muted-foreground' : 'truncate font-medium'}>
              {member.user.name}
              {isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        {canManage && !deactivated ? (
          <Select
            value={member.role}
            disabled={updateRole.isPending}
            onValueChange={(value) =>
              updateRole.mutate({ memberId: member.id, role: value as WorkspaceRole })
            }
          >
            <SelectTrigger aria-label={`Role for ${member.user.name}`} className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {grantableRoles(actorRole).map((value) => (
                <SelectItem key={value} value={value}>
                  {humanizeEnum(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant={member.role === WorkspaceRole.OWNER ? 'default' : 'secondary'}>
            {humanizeEnum(member.role)}
          </Badge>
        )}
      </td>
      <td className="px-3 py-3">
        <Badge variant={STATUS_VARIANT[member.status]}>{STATUS_LABEL[member.status]}</Badge>
        {deactivated && member.deactivatedAt && (
          <span className="mt-1 block text-xs text-muted-foreground">
            {formatDate(member.deactivatedAt)}
            {member.deactivatedBy && ` by ${member.deactivatedBy.name}`}
          </span>
        )}
      </td>
      <td className="px-3 py-3 tabular-nums text-muted-foreground">
        {member.user.lastActiveAt ? formatRelativeTime(member.user.lastActiveAt) : 'Never'}
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        <span className="flex flex-wrap items-center gap-1.5">
          {member.user.signInMethods.length > 0
            ? member.user.signInMethods.map(humanizeEnum).join(', ')
            : 'None yet'}
          {member.user.twoFactorEnabled && (
            <Badge variant="outline" className="text-[10px]" title="Two-step verification is on">
              2FA
            </Badge>
          )}
        </span>
      </td>
      <td className="px-3 py-3 tabular-nums text-muted-foreground">
        {work.length > 0 ? work.join(', ') : '—'}
      </td>
      <td className="px-3 py-3 text-right">
        {(canManage || canTransfer) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${member.user.name}`}
                disabled={reactivate.isPending}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canTransfer && (
                <DropdownMenuItem onSelect={onTransfer}>
                  <Crown className="size-4" aria-hidden="true" />
                  Make owner
                </DropdownMenuItem>
              )}
              {canManage && deactivated && (
                <DropdownMenuItem onSelect={() => reactivate.mutate(member.id)}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Reactivate
                </DropdownMenuItem>
              )}
              {canManage && !deactivated && (
                <DropdownMenuItem onSelect={() => onHandOver('deactivate')}>
                  <UserX className="size-4" aria-hidden="true" />
                  Deactivate…
                </DropdownMenuItem>
              )}
              {canManage && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onHandOver('remove')}>
                    <UserMinus className="size-4" aria-hidden="true" />
                    Remove from workspace…
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </td>
    </tr>
  );
}

/**
 * Invitations, with a link to pass on by hand: invitation e-mail does not
 * always arrive, and a super admin should not be stuck waiting on it.
 */
function PendingInvitations({ workspaceId }: { workspaceId: string | undefined }) {
  const { data: invitations, isLoading } = useInvitations(workspaceId);
  const revoke = useRevokeInvitation(workspaceId);
  const makeLink = useInvitationLink(workspaceId);
  const [link, setLink] = useState<(AdminInvitationLink & { email: string }) | null>(null);

  const issue = (invitation: WorkspaceInvitation) =>
    makeLink.mutate(invitation.id, {
      onSuccess: (result) => setLink({ ...result, email: invitation.email }),
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending invitations</CardTitle>
        <CardDescription>
          If an invitation e-mail does not arrive, copy a link and send it yourself. Only the
          invited address can accept it.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pt-0">
        {isLoading ? (
          <div className="space-y-3 px-5 pb-4">
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (invitations ?? []).length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">
            Nobody is waiting on an invitation.
          </p>
        ) : (
          <ul aria-label="Pending invitations" className="divide-y">
            {(invitations ?? []).map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{invitation.email}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {invitation.invitedBy ? `Invited by ${invitation.invitedBy.name} · ` : ''}
                    {invitation.expired
                      ? 'Expired'
                      : `Expires ${formatRelativeTime(invitation.expiresAt)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={invitation.expired ? 'muted' : 'secondary'}>
                    {humanizeEnum(invitation.role)}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={makeLink.isPending}
                    onClick={() => issue(invitation)}
                  >
                    <Link2 className="size-4" aria-hidden="true" />
                    Copy link
                  </Button>
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
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={link !== null} onOpenChange={(open) => !open && setLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invitation link for {link?.email}</DialogTitle>
            <DialogDescription>
              Send it to them yourself. Any earlier link for this invitation has stopped working,
              and this one expires {link ? formatRelativeTime(link.expiresAt) : ''}.
            </DialogDescription>
          </DialogHeader>
          {link && (
            <div className="flex items-center gap-2">
              <Input readOnly value={link.url} aria-label="Invitation link" className="font-mono text-xs" />
              <CopyButton value={link.url} label="Copy invitation link" successMessage="Link copied" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
