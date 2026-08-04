import { WorkspaceRole, canManageMember, grantableRoles } from '@coretask/contracts';
import type { WorkspaceMember } from '@coretask/types';
import { Crown, LogOut, MoreHorizontal, UserMinus } from 'lucide-react';
import { useState } from 'react';

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDate, humanizeEnum, initials } from '@/lib/utils';

import { useRemoveMember, useTransferOwnership, useUpdateMemberRole } from '../hooks/use-members';

interface MemberRowProps {
  member: WorkspaceMember;
  workspaceId: string | undefined;
  /** The viewer's role, which decides everything offered here. */
  actorRole: WorkspaceRole;
  isSelf: boolean;
  onLeave: (member: WorkspaceMember) => void;
}

type Confirmation = 'remove' | 'transfer' | null;

export function MemberRow({ member, workspaceId, actorRole, isSelf, onLeave }: MemberRowProps) {
  const updateRole = useUpdateMemberRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const transferOwnership = useTransferOwnership(workspaceId);

  const [confirming, setConfirming] = useState<Confirmation>(null);

  /*
   * The same rules the API enforces, so nothing is offered that would be
   * refused. `canManageMember` is strictly-greater, which already rules out
   * peers, the owner, and acting on yourself — the UI does not restate any of
   * that, it just asks.
   */
  const canManage = canManageMember(actorRole, member.role);
  const roles = grantableRoles(actorRole);
  const canTransfer = actorRole === WorkspaceRole.OWNER && !isSelf;
  const canLeave = isSelf && member.role !== WorkspaceRole.OWNER;
  const busy = updateRole.isPending || removeMember.isPending || transferOwnership.isPending;

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

      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Joined {formatDate(member.joinedAt)}
        </span>

        {canManage ? (
          <Select
            value={member.role}
            disabled={busy}
            onValueChange={(role) =>
              updateRole.mutate({ memberId: member.id, role: role as WorkspaceRole })
            }
          >
            <SelectTrigger aria-label={`Role for ${member.user.name}`} className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role} value={role}>
                  {humanizeEnum(role)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant={member.role === WorkspaceRole.OWNER ? 'default' : 'secondary'}>
            {humanizeEnum(member.role)}
          </Badge>
        )}

        {(canManage || canTransfer || canLeave) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={busy}
                aria-label={`Actions for ${member.user.name}`}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canTransfer && (
                <DropdownMenuItem onSelect={() => setConfirming('transfer')}>
                  <Crown className="size-4" aria-hidden="true" />
                  Make owner
                </DropdownMenuItem>
              )}
              {canManage && (
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirming('remove')}>
                  <UserMinus className="size-4" aria-hidden="true" />
                  Remove from workspace
                </DropdownMenuItem>
              )}
              {canLeave && (
                <DropdownMenuItem variant="destructive" onSelect={() => onLeave(member)}>
                  <LogOut className="size-4" aria-hidden="true" />
                  Leave workspace
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          {confirming === 'remove' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {member.user.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  They lose access immediately, and any open tasks or tickets assigned to them are
                  unassigned. Work they have already finished stays attributed to them.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    removeMember.mutate({ memberId: member.id, name: member.user.name })
                  }
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}

          {confirming === 'transfer' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Make {member.user.name} the owner?</AlertDialogTitle>
                <AlertDialogDescription>
                  You become an administrator, and only they will be able to transfer ownership
                  again. This cannot be undone on your own.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => transferOwnership.mutate(member.id)}>
                  Transfer ownership
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
