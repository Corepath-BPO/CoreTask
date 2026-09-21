import {
  PROJECT_MEMBER_ROLES,
  ProjectMemberRole,
  ProjectVisibility,
  effectiveWorkspaceRole,
  type WorkspaceRole,
} from '@coretask/contracts';
import type { ProjectMember, ProjectSummary } from '@coretask/types';
import { Crown, Link2, UserPlus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PersonAvatar } from '@/components/data-display/person-avatar';
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@tanstack/react-router';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { humanizeEnum } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import {
  useAddProjectMember,
  useLeaveProject,
  useProjectMembers,
  useRemoveProjectMember,
  useUpdateProjectMemberRole,
} from '../../hooks/use-project-members';
import { useUpdateProject } from '../../hooks/use-projects';
import type { ProjectAccess } from '../../lib/project-access';

import { ProjectVisibilitySelect } from './project-visibility-select';

interface ShareProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  project: ProjectSummary | null;
  access: ProjectAccess;
  /** Called after the reader leaves a private project, before it 404s on them. */
  onLeft?: (() => void) | undefined;
}

/**
 * Asana's "Share" dialog: who can see the project, who is on it and as what.
 *
 * Only a project admin (or a workspace admin) may change anything here; for
 * everyone else it is a read-only roster with a "Leave" on their own row. The
 * last-admin rule is shown as a disabled control with a reason rather than
 * left to the server's 409, because a control that fails on click is worse
 * than one that says why it will not.
 */
export function ShareProjectDialog({
  open,
  onOpenChange,
  workspaceId,
  project,
  access,
  onLeft,
}: ShareProjectDialogProps) {
  const me = useCurrentUser();
  const projectId = project?.id;
  const { data: members, isLoading } = useProjectMembers(workspaceId, projectId, open);
  const { data: workspaceMembers } = useWorkspaceMembers(open ? workspaceId : undefined);

  const add = useAddProjectMember(workspaceId, projectId ?? '');
  const updateRole = useUpdateProjectMemberRole(workspaceId, projectId ?? '');
  const remove = useRemoveProjectMember(workspaceId, projectId ?? '');
  const leave = useLeaveProject(workspaceId);
  const updateProject = useUpdateProject(workspaceId);

  const [picking, setPicking] = useState(false);
  const [newRole, setNewRole] = useState<ProjectMemberRole>(ProjectMemberRole.EDITOR);
  const [confirmPrivate, setConfirmPrivate] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const list = useMemo(() => members ?? [], [members]);
  const onRoster = useMemo(() => new Set(list.map((member) => member.userId)), [list]);
  const workspaceRoleOf = useMemo(
    () => new Map((workspaceMembers ?? []).map((member) => [member.user.id, member.role])),
    [workspaceMembers],
  );
  /**
   * Workspace members not already on the project — the only valid additions.
   * The account behind an API key is left out: it is added from the
   * integrations side, by someone who knows what the key is for.
   */
  const candidates = useMemo(
    () =>
      (workspaceMembers ?? []).filter(
        (member) =>
          !onRoster.has(member.user.id) &&
          !(member.user as { isServiceAccount?: boolean }).isServiceAccount,
      ),
    [workspaceMembers, onRoster],
  );
  const adminCount = list.filter((member) => member.role === ProjectMemberRole.ADMIN).length;

  if (!project) return null;

  const isPrivate = project.visibility === ProjectVisibility.PRIVATE;
  const canManage = access.canManageMembers;
  const busy =
    add.isPending ||
    updateRole.isPending ||
    remove.isPending ||
    leave.isPending ||
    updateProject.isPending;

  const setVisibility = (visibility: ProjectVisibility) => {
    if (visibility === project.visibility) return;
    if (visibility === ProjectVisibility.PRIVATE) {
      /*
       * Opened a tick later, not in the select's own handler. The choice is
       * made on pointer-up, and a confirm that mounts centred under a pointer
       * still coming down receives the tail of that same click on whichever
       * button lands beneath it — which made "Make private" confirm itself.
       */
      setTimeout(() => setConfirmPrivate(true), 0);
      return;
    }
    updateProject.mutate({ projectId: project.id, payload: { visibility } });
  };

  const leaveProject = () => {
    leave.mutate(
      { projectId: project.id, name: project.name },
      {
        onSuccess: () => {
          onOpenChange(false);
          if (isPrivate && !access.isAdminOverride) onLeft?.();
        },
      },
    );
  };

  const copyLink = async () => {
    const link = `${window.location.origin}/projects/${project.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link', { description: link });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-sm"
              style={{ backgroundColor: project.color }}
            />
            Share {project.name}
          </DialogTitle>
          <DialogDescription>
            {canManage
              ? 'Add people from the workspace and choose what they may do here. A role in a project never grants more than the workspace role does.'
              : 'Only a project admin or a workspace admin can change who is in this project.'}
          </DialogDescription>
        </DialogHeader>

        {canManage && (
          <div className="flex gap-2">
            <Popover open={picking} onOpenChange={setPicking}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="flex-1 justify-start font-normal text-muted-foreground"
                  disabled={busy}
                  aria-label="Add people"
                >
                  <UserPlus className="size-4" aria-hidden="true" />
                  Add people…
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-0">
                <Command>
                  <CommandInput placeholder="Find someone in the workspace…" />
                  <CommandList>
                    <CommandEmpty>Everyone in the workspace is already here.</CommandEmpty>
                    <CommandGroup>
                      {candidates.map((member) => (
                        <CommandItem
                          key={member.user.id}
                          value={`${member.user.name} ${member.user.email}`}
                          onSelect={() => {
                            add.mutate({ userId: member.user.id, role: newRole });
                            setPicking(false);
                          }}
                        >
                          <PersonAvatar
                            name={member.user.name}
                            avatarUrl={member.user.avatarUrl}
                            className="size-5"
                            fallbackClassName="text-[9px]"
                          />
                          <span className="truncate">{member.user.name}</span>
                          <span className="ml-auto truncate text-xs text-muted-foreground">
                            {humanizeEnum(member.role)}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <Select
              value={newRole}
              onValueChange={(role) => setNewRole(role as ProjectMemberRole)}
              disabled={busy}
            >
              <SelectTrigger aria-label="Role for new members" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_MEMBER_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {humanizeEnum(role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {canManage && (
          <p className="-mt-2 text-xs text-muted-foreground">
            Not in the workspace yet?{' '}
            <Link to="/members" className="underline underline-offset-2 hover:text-foreground">
              Invite them from Members
            </Link>{' '}
            first.
          </p>
        )}

        <div className="space-y-1.5">
          <label htmlFor="share-visibility" className="text-xs font-medium text-muted-foreground">
            Who can see this project
          </label>
          <ProjectVisibilitySelect
            id="share-visibility"
            value={project.visibility}
            onValueChange={setVisibility}
            disabled={!canManage || busy}
          />
          {access.isAdminOverride && (
            <p className="text-xs text-muted-foreground">
              You can see this private project as a workspace admin; you are not a member.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Members</p>
          {isLoading ? (
            <div className="space-y-2" role="status" aria-live="polite">
              <span className="sr-only">Loading members</span>
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nobody is on this project yet.
            </p>
          ) : (
            <ul
              aria-label="Project members"
              className="max-h-72 divide-y overflow-y-auto rounded-md border"
            >
              {list.map((member) => (
                <MemberRow
                  key={member.userId}
                  member={member}
                  project={project}
                  isSelf={member.userId === me?.id}
                  canManage={canManage}
                  busy={busy}
                  isLastAdmin={
                    isPrivate && member.role === ProjectMemberRole.ADMIN && adminCount <= 1
                  }
                  workspaceRole={workspaceRoleOf.get(member.userId)}
                  onRoleChange={(role) => updateRole.mutate({ userId: member.userId, role })}
                  onRemove={() => remove.mutate({ userId: member.userId, name: member.user.name })}
                  onLeave={() => (isPrivate ? setConfirmLeave(true) : leaveProject())}
                />
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="sm:justify-start">
          <Button type="button" variant="ghost" size="sm" onClick={() => void copyLink()}>
            <Link2 className="size-4" aria-hidden="true" />
            Copy project link
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmPrivate} onOpenChange={setConfirmPrivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make this project private?</AlertDialogTitle>
            <AlertDialogDescription>
              Only members will be able to see this project. Workspace admins keep access, and you
              become a member if you are not one already.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                updateProject.mutate({
                  projectId: project.id,
                  payload: { visibility: ProjectVisibility.PRIVATE },
                })
              }
            >
              Make private
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It is private, so you will not be able to open it again until an admin adds you back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={leaveProject}>Leave project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function MemberRow({
  member,
  project,
  isSelf,
  canManage,
  busy,
  isLastAdmin,
  workspaceRole,
  onRoleChange,
  onRemove,
  onLeave,
}: {
  member: ProjectMember;
  project: ProjectSummary;
  isSelf: boolean;
  canManage: boolean;
  busy: boolean;
  isLastAdmin: boolean;
  workspaceRole: WorkspaceRole | undefined;
  onRoleChange: (role: ProjectMemberRole) => void;
  onRemove: () => void;
  onLeave: () => void;
}) {
  const lastAdminReason =
    'A private project needs at least one admin. Make someone else an admin first.';
  // What they actually act as here, when the project role is not the whole story.
  const actsAs = workspaceRole ? effectiveWorkspaceRole(workspaceRole, member.role) : null;
  const capped =
    actsAs !== null &&
    workspaceRole !== undefined &&
    actsAs !== workspaceRole &&
    (member.role === ProjectMemberRole.VIEWER || member.role === ProjectMemberRole.EDITOR);

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <PersonAvatar
        name={member.user.name}
        avatarUrl={member.user.avatarUrl}
        className="size-7 shrink-0"
        fallbackClassName="text-[10px]"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {member.user.name}
          {isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {member.user.email}
          {capped && actsAs && (
            <span className="ml-1.5">· acts as {humanizeEnum(actsAs).toLowerCase()} here</span>
          )}
        </p>
      </div>

      {member.userId === project.leadId && (
        <Badge variant="secondary" className="shrink-0">
          <Crown className="size-3" aria-hidden="true" />
          Lead
        </Badge>
      )}

      {canManage ? (
        <Select
          value={member.role}
          disabled={busy || isLastAdmin}
          onValueChange={(role) => onRoleChange(role as ProjectMemberRole)}
        >
          <SelectTrigger
            aria-label={`Role for ${member.user.name}`}
            className="h-8 w-28"
            {...(isLastAdmin ? { title: lastAdminReason } : {})}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_MEMBER_ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {humanizeEnum(role)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Badge variant="secondary">{humanizeEnum(member.role)}</Badge>
      )}

      {isSelf ? (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          disabled={busy || isLastAdmin}
          {...(isLastAdmin ? { title: lastAdminReason } : {})}
          onClick={onLeave}
        >
          Leave project
        </Button>
      ) : canManage ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          disabled={busy || isLastAdmin}
          {...(isLastAdmin ? { title: lastAdminReason } : {})}
          aria-label={`Remove ${member.user.name} from ${project.name}`}
          onClick={onRemove}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
}
