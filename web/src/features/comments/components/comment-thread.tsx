import { COMMENT_MAX_LENGTH, WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { Comment, WorkspaceMember } from '@coretask/types';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { cn, formatRelativeTime, initials } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import type { CommentParent } from '../api/comments.api';
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
} from '../hooks/use-comments';

import { CommentBody } from './comment-body';
import { MentionTextarea } from './mention-textarea';

interface CommentThreadProps {
  workspaceId: string | undefined;
  parent: CommentParent | null;
  role: WorkspaceRole;
}

export function CommentThread({ workspaceId, parent, role }: CommentThreadProps) {
  const { data, isLoading, isError, error } = useComments(workspaceId, parent);
  const createComment = useCreateComment(workspaceId, parent);
  const { data: memberData } = useWorkspaceMembers(workspaceId);
  const members = memberData ?? [];
  const currentUser = useCurrentUser();

  const [draft, setDraft] = useState('');

  const canComment = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const canModerate = hasAtLeastRole(role, WorkspaceRole.MANAGER);
  const comments = data?.items ?? [];

  /**
   * `mutate` with a callback rather than `await mutateAsync`: the latter still
   * rejects after `onError` has shown the toast, and nothing here would catch
   * it — a failed post would surface as an unhandled rejection.
   *
   * Clearing in `onSuccess` also means a failure leaves the draft intact rather
   * than silently discarding what someone typed.
   */
  const submit = () => {
    const body = draft.trim();
    if (!body) return;

    createComment.mutate(body, { onSuccess: () => setDraft('') });
  };

  return (
    <section aria-labelledby="comments-heading" className="space-y-4">
      <h3 id="comments-heading" className="flex items-center gap-1.5 text-sm font-semibold">
        <MessageSquare className="size-3.5" aria-hidden="true" />
        Comments
        {comments.length > 0 && (
          <span className="font-normal text-muted-foreground">({comments.length})</span>
        )}
      </h3>

      {isLoading && <CommentSkeleton />}

      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Could not load comments.'}
        </p>
      )}

      {!isLoading && !isError && comments.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No comments yet. {canComment ? 'Start the conversation.' : ''}
        </p>
      )}

      {comments.length > 0 && (
        <ul className="space-y-4">
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              workspaceId={workspaceId}
              parent={parent}
              members={members}
              currentUserId={currentUser?.id}
              canEdit={comment.authorId === currentUser?.id}
              canDelete={comment.authorId === currentUser?.id || canModerate}
            />
          ))}
        </ul>
      )}

      {canComment && (
        <div className="space-y-2">
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            members={members}
            onSubmit={submit}
            label="Write a comment"
            placeholder="Write a comment… use @ to mention someone"
            maxLength={COMMENT_MAX_LENGTH}
            disabled={createComment.isPending}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              <kbd className="rounded border px-1 font-mono text-[10px]">@</kbd> to mention ·{' '}
              <kbd className="rounded border px-1 font-mono text-[10px]">Ctrl</kbd> +{' '}
              <kbd className="rounded border px-1 font-mono text-[10px]">Enter</kbd> to post
            </span>
            <Button
              size="sm"
              onClick={submit}
              disabled={draft.trim().length === 0}
              loading={createComment.isPending}
            >
              {createComment.isPending ? 'Posting…' : 'Comment'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function CommentRow({
  comment,
  workspaceId,
  parent,
  members,
  currentUserId,
  canEdit,
  canDelete,
}: {
  comment: Comment;
  workspaceId: string | undefined;
  parent: CommentParent | null;
  members: WorkspaceMember[];
  currentUserId: string | undefined;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const updateComment = useUpdateComment(workspaceId, parent);
  const deleteComment = useDeleteComment(workspaceId, parent);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const save = () => {
    const body = draft.trim();
    if (!body || body === comment.body) {
      setEditing(false);
      return;
    }

    // Closes only on success, so a failed save keeps the editor and the text.
    updateComment.mutate({ commentId: comment.id, body }, { onSuccess: () => setEditing(false) });
  };

  const startEditing = () => {
    // Seeded here rather than synced from props in an effect: the draft is only
    // ever meaningful while the editor is open.
    setDraft(comment.body);
    setEditing(true);
  };

  return (
    <li className="flex gap-3">
      <Avatar className="mt-0.5 size-7 shrink-0">
        {comment.author?.avatarUrl && <AvatarImage src={comment.author.avatarUrl} alt="" />}
        <AvatarFallback className="text-[10px]">
          {comment.author ? initials(comment.author.name) : '??'}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{comment.author?.name ?? 'Removed account'}</span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(comment.createdAt)}
          </span>
          {comment.editedAt && (
            <span className="text-xs text-muted-foreground" title={comment.editedAt}>
              (edited)
            </span>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <MentionTextarea
              value={draft}
              onChange={setDraft}
              members={members}
              onSubmit={save}
              label="Edit comment"
              maxLength={COMMENT_MAX_LENGTH}
              disabled={updateComment.isPending}
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={save} loading={updateComment.isPending}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
                disabled={updateComment.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <CommentBody
            body={comment.body}
            mentions={comment.mentions}
            currentUserId={currentUserId}
            className={cn(deleteComment.isPending && 'opacity-50')}
          />
        )}

        {!editing && (canEdit || canDelete) && (
          <div className="flex gap-1">
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
                onClick={startEditing}
              >
                <Pencil className="size-3" aria-hidden="true" />
                Edit
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-1.5 py-0.5 text-xs font-normal text-muted-foreground hover:text-destructive"
                disabled={deleteComment.isPending}
                onClick={() => deleteComment.mutate(comment.id)}
              >
                <Trash2 className="size-3" aria-hidden="true" />
                Delete
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function CommentSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">Loading comments</span>
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
