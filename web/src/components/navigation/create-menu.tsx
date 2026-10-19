import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { Goal } from '@coretask/types';
import { useNavigate } from '@tanstack/react-router';
import {
  Briefcase,
  CircleCheck,
  FolderKanban,
  LayoutGrid,
  MessageSquare,
  Plus,
  Target,
  Ticket,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreateGoalDialog } from '@/features/goals/components/create-goal-dialog';
import { useGoals } from '@/features/goals/hooks/use-goals';
import { InviteMemberDialog } from '@/features/members/components/invite-member-dialog';
import { ProjectFormDialog } from '@/features/projects/components/project-form-dialog';
import { QuickAddTaskDialog } from '@/features/tasks/components/quick-add-task-dialog';
import { TeamFormDialog } from '@/features/teams/components/team-form-dialog';
import { CreateWorkspaceDialog } from '@/features/workspaces/components/create-workspace-dialog';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { useUiStore } from '@/stores/ui.store';

import { MessageDestinationDialog } from './message-destination-dialog';

type Creating = 'project' | 'team' | 'invite' | 'workspace' | 'goal' | 'message' | null;

/**
 * Asana's red Create button: one menu for everything a person starts — a
 * task, a project, a team, an invitation — so nobody has to find the right
 * page first. Each entry appears only for someone allowed to use it; the API
 * enforces the same rule regardless.
 */
export function CreateMenu() {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const navigate = useNavigate();
  const [creating, setCreating] = useState<Creating>(null);
  // In the UI store rather than here, so Tab+N can open it too.
  const quickAddOpen = useUiStore((state) => state.quickAddTaskOpen);
  const setQuickAddOpen = useUiStore((state) => state.setQuickAddTaskOpen);

  const canCreateWork = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const isAdmin = hasAtLeastRole(role, WorkspaceRole.ADMIN);

  const close = (open: boolean) => {
    if (!open) setCreating(null);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="gap-1.5" aria-label="Create">
            <Plus />
            <span className="hidden sm:inline">Create</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {canCreateWork && workspaceId && (
            <>
              <DropdownMenuItem onSelect={() => setQuickAddOpen(true)}>
                <CircleCheck />
                Task
                <DropdownMenuShortcut>Tab N</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCreating('project')}>
                <FolderKanban />
                Project
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigate({ to: '/tickets' })}>
                <Ticket />
                Ticket
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigate({ to: '/portfolios' })}>
                <Briefcase />
                Portfolio
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCreating('goal')}>
                <Target />
                Goal
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCreating('message')}>
                <MessageSquare />
                Message
              </DropdownMenuItem>
            </>
          )}
          {isAdmin && workspaceId && (
            <DropdownMenuItem onSelect={() => setCreating('team')}>
              <Users />
              Team
            </DropdownMenuItem>
          )}
          {(canCreateWork || isAdmin) && workspaceId && <DropdownMenuSeparator />}
          {isAdmin && workspaceId && (
            <DropdownMenuItem onSelect={() => setCreating('invite')}>
              <UserPlus />
              Invite
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setCreating('workspace')}>
            <LayoutGrid />
            Workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mounted only while chosen, so each opens with a fresh form. */}
      {quickAddOpen && canCreateWork && (
        <QuickAddTaskDialog open onOpenChange={setQuickAddOpen} workspaceId={workspaceId} />
      )}
      {creating === 'project' && (
        <ProjectFormDialog open onOpenChange={close} workspaceId={workspaceId} />
      )}
      {creating === 'team' && (
        <TeamFormDialog open onOpenChange={close} workspaceId={workspaceId} />
      )}
      {creating === 'invite' && (
        <InviteMemberDialog open onOpenChange={close} workspaceId={workspaceId} actorRole={role} />
      )}
      {creating === 'goal' && (
        <CreateGoalFromMenu
          workspaceId={workspaceId}
          onOpenChange={close}
          onCreated={(goal) => void navigate({ to: '/goals', search: { goal: goal.id } })}
        />
      )}
      {creating === 'message' && (
        <MessageDestinationDialog workspaceId={workspaceId} onOpenChange={close} />
      )}
      <CreateWorkspaceDialog open={creating === 'workspace'} onOpenChange={close} />
    </>
  );
}

/** The goal dialog wants the goal list for its parent picker; fetched only when opened. */
function CreateGoalFromMenu({
  workspaceId,
  onOpenChange,
  onCreated,
}: {
  workspaceId: string | undefined;
  onOpenChange: (open: boolean) => void;
  onCreated: (goal: Goal) => void;
}) {
  const { data: goals } = useGoals(workspaceId);
  return (
    <CreateGoalDialog
      open
      onOpenChange={onOpenChange}
      workspaceId={workspaceId}
      goals={goals ?? []}
      onCreated={onCreated}
    />
  );
}
