import { ProjectViewScope, WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { ProjectView } from '@coretask/types';
import { Check, ChevronDown, Copy, Eye, Pencil, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';

import { canPersistView, useManageProjectView } from '../../hooks/use-project-views';

/**
 * The saved views of one kind — Asana's "All tickets / My tickets" tabs, as a
 * menu on the toolbar. Shared views first, then the reader's own; choosing one
 * opens it at `?view=<id>`, so the link keeps it.
 *
 * The actions act on the open view and appear only where the API would allow
 * them: anyone may duplicate, a view's writer may rename or delete it, and
 * only a member may make a shared view the default.
 */
export function ViewPicker({
  workspaceId,
  projectId,
  views,
  activeView,
  meId,
  role,
  onSelect,
}: {
  workspaceId: string | undefined;
  projectId: string;
  /** Views of this kind only. */
  views: ProjectView[];
  activeView: ProjectView | undefined;
  meId: string | undefined;
  role: WorkspaceRole;
  onSelect: (viewId: string) => void;
}) {
  const manage = useManageProjectView(workspaceId, projectId);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  const shared = views.filter((view) => view.scope === ProjectViewScope.PROJECT);
  const mine = views.filter(
    (view) => view.scope === ProjectViewScope.PERSONAL && view.ownerUserId === meId,
  );

  const canWrite = canPersistView(activeView, meId, role);
  const canSetDefault =
    activeView !== undefined &&
    activeView.scope === ProjectViewScope.PROJECT &&
    !activeView.isDefault &&
    hasAtLeastRole(role, WorkspaceRole.MEMBER);
  // The default shared view is what the tab opens to; it cannot be deleted
  // out from under everyone, and the last view of a kind cannot go either.
  const canDelete =
    canWrite && activeView !== undefined && !activeView.isDefault && views.length > 1;

  const option = (view: ProjectView) => (
    <DropdownMenuItem key={view.id} onSelect={() => onSelect(view.id)}>
      <span className="flex w-4 justify-center">
        {view.id === activeView?.id && <Check className="size-4" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{view.name}</span>
      {view.isDefault && <span className="text-[10px] text-muted-foreground">Default</span>}
    </DropdownMenuItem>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="max-w-48" aria-label="Choose a saved view">
            <Eye />
            <span className="truncate">{activeView?.name ?? 'View'}</span>
            <ChevronDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Shared views</DropdownMenuLabel>
          {shared.map(option)}
          {mine.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>My views</DropdownMenuLabel>
              {mine.map(option)}
            </>
          )}

          {activeView && (
            <>
              <DropdownMenuSeparator />
              {canWrite && (
                <DropdownMenuItem
                  onSelect={() => {
                    setName(activeView.name);
                    setRenaming(true);
                  }}
                >
                  <Pencil />
                  Rename view
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() =>
                  manage.duplicate.mutate(activeView.id, {
                    onSuccess: (copy) => onSelect(copy.id),
                  })
                }
              >
                <Copy />
                Duplicate view
              </DropdownMenuItem>
              {canSetDefault && (
                <DropdownMenuItem onSelect={() => manage.setDefault.mutate(activeView.id)}>
                  <Star />
                  Make default for everyone
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    const fallback = views.find((view) => view.isDefault) ?? views[0];
                    manage.remove.mutate(activeView.id, {
                      onSuccess: () => fallback && onSelect(fallback.id),
                    });
                  }}
                >
                  <Trash2 />
                  Delete view
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename view</DialogTitle>
            <DialogDescription>
              {activeView?.scope === ProjectViewScope.PERSONAL
                ? 'Only you see this view.'
                : 'Everyone on the project sees this name.'}
            </DialogDescription>
          </DialogHeader>
          <form
            id="rename-view"
            onSubmit={(event) => {
              event.preventDefault();
              if (!activeView || !name.trim()) return;
              manage.rename.mutate(
                { viewId: activeView.id, name: name.trim() },
                { onSuccess: () => setRenaming(false) },
              );
            }}
          >
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              aria-label="View name"
            />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="rename-view"
              loading={manage.rename.isPending}
              disabled={!name.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
