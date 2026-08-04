import type { Team } from '@coretask/types';
import { Crown, UserPlus, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { initials } from '@/lib/utils';

import { useAddTeamMember, useRemoveTeamMember, useTeam } from '../hooks/use-teams';

interface TeamRosterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  team: Team | null;
  /** False for someone who may look but not change the roster. */
  canManage: boolean;
}

export function TeamRosterDialog({
  open,
  onOpenChange,
  workspaceId,
  team,
  canManage,
}: TeamRosterDialogProps) {
  // Only fetch while the dialog is open — the list view already has everything
  // it needs, and the roster is the one thing it does not carry.
  const { data: detail, isLoading } = useTeam(workspaceId, open && team ? team.id : undefined);
  const { data: members } = useWorkspaceMembers(workspaceId);

  const addMember = useAddTeamMember(workspaceId);
  const removeMember = useRemoveTeamMember(workspaceId);
  const [selected, setSelected] = useState('');

  /** Workspace members not already on the team — the only valid additions. */
  const candidates = useMemo(() => {
    const onTeam = new Set((detail?.members ?? []).map((member) => member.id));
    return (members ?? []).filter((member) => !onTeam.has(member.user.id));
  }, [members, detail]);

  if (!team) return null;

  const add = () => {
    if (!selected) return;
    addMember.mutate({ teamId: team.id, userId: selected }, { onSuccess: () => setSelected('') });
  };

  const busy = addMember.isPending || removeMember.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: team.color }}
            />
            {team.name}
          </DialogTitle>
          <DialogDescription>
            {canManage
              ? 'Anyone in this workspace can join. Being on a team does not change what they may do.'
              : 'Only a workspace administrator or the team lead can change this roster.'}
          </DialogDescription>
        </DialogHeader>

        {canManage && (
          <div className="flex gap-2">
            <Select value={selected} onValueChange={setSelected} disabled={busy}>
              <SelectTrigger aria-label="Person to add" className="w-full">
                <SelectValue placeholder="Add someone…" />
              </SelectTrigger>
              <SelectContent>
                {candidates.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    Everyone is already on this team.
                  </div>
                ) : (
                  candidates.map((member) => (
                    <SelectItem key={member.user.id} value={member.user.id}>
                      {member.user.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button onClick={add} disabled={!selected || busy} loading={addMember.isPending}>
              <UserPlus className="size-4" aria-hidden="true" />
              Add
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <span className="sr-only">Loading the roster</span>
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : (detail?.members ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nobody is on this team yet.
          </p>
        ) : (
          <ul aria-label={`${team.name} members`} className="divide-y rounded-md border">
            {(detail?.members ?? []).map((member) => (
              <li key={member.id} className="flex items-center gap-3 px-3 py-2">
                <Avatar className="size-7 shrink-0">
                  {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}
                  <AvatarFallback className="text-[10px]">{initials(member.name)}</AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{member.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>

                {member.id === detail?.leadId && (
                  <Badge variant="secondary" className="shrink-0">
                    <Crown className="size-3" aria-hidden="true" />
                    Lead
                  </Badge>
                )}

                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    aria-label={`Remove ${member.name} from ${team.name}`}
                    onClick={() => removeMember.mutate({ teamId: team.id, userId: member.id })}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
