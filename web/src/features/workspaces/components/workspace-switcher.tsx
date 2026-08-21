import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, initials } from '@/lib/utils';

import { useActiveWorkspace } from '../hooks/use-workspaces';

import { CreateWorkspaceDialog } from './create-workspace-dialog';

interface WorkspaceSwitcherProps {
  collapsed?: boolean;
}

export function WorkspaceSwitcher({ collapsed = false }: WorkspaceSwitcherProps) {
  const { workspace, workspaces, isLoading, select } = useActiveWorkspace();
  const [createOpen, setCreateOpen] = useState(false);

  if (isLoading) {
    return <Skeleton className={cn('h-10', collapsed ? 'w-10' : 'w-full')} />;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'flex w-full items-center gap-3 rounded-xl border border-sidebar-border bg-background/35 px-2.5 py-2.5 text-left shadow-[inset_0_1px_0_oklch(1_0_0/4%)] transition-[border-color,background-color] hover:border-primary/25 hover:bg-background/55 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
            collapsed && 'justify-center px-0',
          )}
          aria-label="Switch workspace"
        >
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[11px] font-bold text-primary-foreground"
          >
            {workspace ? initials(workspace.name) : '-'}
          </span>

          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {workspace?.name ?? 'No workspace'}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {workspace ? `${workspace.memberCount} members` : 'Create one to begin'}
                </span>
              </span>
              <ChevronsUpDown
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>

          {workspaces.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">You have no workspaces yet.</p>
          )}

          {workspaces.map((candidate) => (
            <DropdownMenuItem
              key={candidate.id}
              onSelect={() => select(candidate.id)}
              className="gap-2.5"
            >
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground"
              >
                {initials(candidate.name)}
              </span>
              <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {candidate.role}
              </span>
              {candidate.id === workspace?.id && (
                <Check className="size-4 text-primary-strong" aria-label="Current workspace" />
              )}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus />
            Create workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
