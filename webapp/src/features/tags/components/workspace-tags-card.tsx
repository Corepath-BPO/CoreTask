import { TAG_NAME_MAX, WorkspaceRole, hasAtLeastRole, type ColorToken } from '@coretask/contracts';
import type { Tag } from '@coretask/types';
import { Link } from '@tanstack/react-router';
import { Pencil, Tags, Trash2 } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ColorTokenPicker } from '@/features/colors/components/color-token-picker';

import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from '../hooks/use-tags';

import { TagChip } from './tag-chip';

/**
 * Settings › Tags: every tag in the workspace, how many tasks carry it, and a
 * way to make, rename, recolour or delete one. Each opens its tasks in search.
 */
export function WorkspaceTagsCard({
  workspaceId,
  role,
  userId,
}: {
  workspaceId: string;
  role: WorkspaceRole;
  userId: string | undefined;
}) {
  const { data: tags, isLoading } = useTags(workspaceId);
  const create = useCreateTag(workspaceId);
  const remove = useDeleteTag(workspaceId);
  const [editing, setEditing] = useState<Tag | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);

  const canEdit = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const canDelete = (tag: Tag) =>
    hasAtLeastRole(role, WorkspaceRole.MANAGER) || tag.createdBy?.id === userId;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Tags</CardTitle>
          <CardDescription>Labels any task can carry, in any project.</CardDescription>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            New tag
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !tags || tags.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center">
            <Tags className="size-5 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              No tags yet. Add one from a task’s Tags row, or here.
            </p>
          </div>
        ) : (
          <ul className="divide-y" aria-label="Workspace tags">
            {tags.map((tag) => (
              <li key={tag.id} className="flex items-center gap-2 py-2">
                <Link
                  to="/search"
                  search={{ tag: tag.id, status: 'ANY' }}
                  className="min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  aria-label={`Tasks tagged ${tag.name}`}
                >
                  <TagChip tag={tag} />
                </Link>
                <span className="flex-1 text-xs tabular-nums text-muted-foreground">
                  {tag.taskCount} {tag.taskCount === 1 ? 'task' : 'tasks'}
                </span>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${tag.name}`}
                    onClick={() => setEditing(tag)}
                  >
                    <Pencil />
                  </Button>
                )}
                {canDelete(tag) && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${tag.name}`}
                    onClick={() => setDeleting(tag)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing && (
        <TagDialog
          key={editing === 'new' ? 'new' : editing.id}
          workspaceId={workspaceId}
          tag={editing === 'new' ? null : editing}
          creating={create.isPending}
          onCreate={(payload, done) => create.mutate(payload, { onSuccess: done })}
          onClose={() => setEditing(null)}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It comes off {deleting?.taskCount ?? 0} {deleting?.taskCount === 1 ? 'task' : 'tasks'}
              . The tasks themselves are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function TagDialog({
  workspaceId,
  tag,
  creating,
  onCreate,
  onClose,
}: {
  workspaceId: string;
  tag: Tag | null;
  creating: boolean;
  onCreate: (payload: { name: string; color: ColorToken }, done: () => void) => void;
  onClose: () => void;
}) {
  const update = useUpdateTag(workspaceId);
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState<ColorToken>(tag?.color ?? 'blue');
  const ready = name.trim() !== '' && !creating && !update.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{tag ? `Edit ${tag.name}` : 'New tag'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            if (tag) {
              update.mutate(
                { tagId: tag.id, payload: { name: name.trim(), color } },
                { onSuccess: onClose },
              );
            } else {
              onCreate({ name: name.trim(), color }, onClose);
            }
          }}
        >
          <Input
            aria-label="Tag name"
            value={name}
            autoFocus
            maxLength={TAG_NAME_MAX}
            placeholder="e.g. Urgent"
            onChange={(event) => setName(event.target.value)}
          />
          <ColorTokenPicker value={color} onChange={setColor} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              {tag ? 'Save' : 'Make tag'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
