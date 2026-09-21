import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import type { FollowerParent } from '../api/followers.api';
import { useAddFollowers, useFollowers, useRemoveFollower } from '../hooks/use-followers';

interface CollaboratorsRowProps {
  workspaceId: string | undefined;
  parent: FollowerParent | null;
  role: WorkspaceRole;
}

/**
 * Asana's footer: "Collaborators", a row of overlapping avatars, a dashed "+"
 * that opens a member picker, and "Leave task" for the reader.
 *
 * Everyone here gets the thread's notifications. Managers see an "×" on each
 * avatar; everyone else can only remove themselves, which is what the API
 * enforces too.
 */
export function CollaboratorsRow({ workspaceId, parent, role }: CollaboratorsRowProps) {
  const me = useCurrentUser();
  const { data: followers, isLoading } = useFollowers(workspaceId, parent);
  const { data: members } = useWorkspaceMembers(workspaceId);
  const add = useAddFollowers(workspaceId, parent);
  const remove = useRemoveFollower(workspaceId, parent);
  const [picking, setPicking] = useState(false);

  const noun = parent?.kind === 'ticket' ? 'ticket' : 'task';
  const canEdit = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const canRemoveOthers = hasAtLeastRole(role, WorkspaceRole.MANAGER);
  const list = followers ?? [];
  const following = new Set(list.map((follower) => follower.user.id));
  const iFollow = me ? following.has(me.id) : false;
  const candidates = (members ?? []).filter((member) => !following.has(member.user.id));

  return (
    <section aria-labelledby="collaborators-heading" className="flex flex-wrap items-center gap-3">
      <h3 id="collaborators-heading" className="text-xs font-medium text-muted-foreground">
        Collaborators
      </h3>

      {isLoading ? (
        <div className="flex -space-x-1.5">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="size-6 rounded-full" />
        </div>
      ) : (
        <ul className="flex items-center -space-x-1.5" aria-label="Collaborators">
          {list.map((follower) => {
            const removable = canEdit && (follower.user.id === me?.id ? true : canRemoveOthers);

            return (
              <li key={follower.user.id} className="group/avatar relative">
                <PersonAvatar
                  name={follower.user.name}
                  avatarUrl={follower.user.avatarUrl}
                  title={follower.user.name}
                  className="size-6 ring-2 ring-background"
                  fallbackClassName="text-[10px]"
                />
                {removable && (
                  <button
                    type="button"
                    aria-label={`Remove ${follower.user.name}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(follower.user.id)}
                    className={cn(
                      'absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity',
                      'group-hover/avatar:opacity-100 focus-visible:opacity-100 focus-visible:outline-none',
                    )}
                  >
                    <X className="size-2.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}

          {canEdit && (
            <li className="pl-1.5">
              <Popover open={picking} onOpenChange={setPicking}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Add collaborators"
                    className="flex size-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-0">
                  <Command>
                    <CommandInput placeholder="Add a collaborator…" />
                    <CommandList>
                      <CommandEmpty>Everyone already follows this {noun}.</CommandEmpty>
                      <CommandGroup>
                        {candidates.map((member) => (
                          <CommandItem
                            key={member.user.id}
                            value={`${member.user.name} ${member.user.email}`}
                            onSelect={() => {
                              add.mutate([member.user.id]);
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
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </li>
          )}
        </ul>
      )}

      {canEdit && me && !isLoading && (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-auto px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
          loading={add.isPending || remove.isPending}
          onClick={() => (iFollow ? remove.mutate(me.id) : add.mutate([me.id]))}
        >
          {iFollow ? `Leave ${noun}` : `Join ${noun}`}
        </Button>
      )}
    </section>
  );
}
