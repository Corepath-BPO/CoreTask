import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { ActivityEntry, Attachment, Comment, WorkspaceMember } from '@coretask/types';
import {
  Bot,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { toast } from 'sonner';

import { IntegrationBadge } from '@/components/common/integration-badge';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useItemActivity } from '@/features/activity/hooks/use-activity';
import { describeStory } from '@/features/activity/lib/story-text';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { cn, formatRelativeTime, initials } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

import type { CommentParent } from '../api/comments.api';
import {
  flattenComments,
  useComments,
  useCreateComment,
  useDeleteComment,
  useToggleCommentLike,
  useToggleCommentPin,
  useUpdateComment,
} from '../hooks/use-comments';
import { useThreadRealtime } from '../hooks/use-thread-realtime';
import { draftKey, useCommentDraftStore } from '../stores/comment-draft.store';

import { CommentAttachments } from './comment-attachments';
import { CommentBody } from './comment-body';
import { CommentComposer, type CommentComposerHandle } from './comment-composer';

interface CommentThreadProps {
  workspaceId: string | undefined;
  parent: CommentParent | null;
  role: WorkspaceRole;
  /** The composer, so the task panel's Tab+C chord can focus it. */
  composerRef?: Ref<CommentComposerHandle> | undefined;
  /** A comment a link named: scrolled into view and lit up once loaded. */
  focusCommentId?: string | null | undefined;
  /** The in-app path a "Copy link" on a comment should copy. */
  permalink?: ((commentId: string) => string) | undefined;
}

type FeedItem =
  | { kind: 'comment'; at: string; comment: Comment }
  | { kind: 'story'; at: string; story: ActivityEntry };

/**
 * Asana's thread: the item's stories — "changed the due date", "moved to In
 * Review" — interleaved with its comments, oldest at the top, the composer
 * at the bottom, and a switch to hide the stories when only the conversation
 * matters.
 */
export function CommentThread({
  workspaceId,
  parent,
  role,
  composerRef,
  focusCommentId,
  permalink,
}: CommentThreadProps) {
  const {
    data,
    isLoading,
    isError,
    error,
    hasPreviousPage,
    isFetchingPreviousPage,
    fetchPreviousPage,
  } = useComments(workspaceId, parent);
  const activity = useItemActivity(workspaceId, parent);
  const createComment = useCreateComment(workspaceId, parent);
  const { data: memberData } = useWorkspaceMembers(workspaceId);
  const members = memberData ?? [];
  const currentUser = useCurrentUser();
  const mode = useUiStore((state) => state.activityFeedMode);
  const setMode = useUiStore((state) => state.setActivityFeedMode);
  const { lastCommentAt } = useThreadRealtime(workspaceId, parent);

  const comments = useMemo(() => flattenComments(data), [data]);
  const commentTotal = data?.pages[0]?.meta.total ?? comments.length;

  /*
   * The draft is HTML, or null while the box is empty; the composer owns the
   * editor and reports every edit here so the button knows when to light up.
   * It is also kept in the draft store, keyed by item, so closing the panel
   * and opening it again finds the words still there.
   */
  const key = parent ? draftKey(parent) : '';
  const saved = useCommentDraftStore((state) => (key ? state.drafts[key] : undefined));
  const writeDraft = useCommentDraftStore((state) => state.write);
  const clearDraft = useCommentDraftStore((state) => state.clear);
  const [draft, setDraft] = useState<string | null>(saved?.html ?? null);
  const [pendingFiles, setPendingFiles] = useState<Attachment[]>(saved?.attachments ?? []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composer = useRef<CommentComposerHandle | null>(null);
  // The linked comment whose ring has already faded; the ring itself is derived.
  const [faded, setFaded] = useState<string | null>(null);

  useEffect(() => {
    if (key) writeDraft(key, { html: draft, attachments: pendingFiles });
  }, [key, draft, pendingFiles, writeDraft]);

  /*
   * A link that names a comment: bring it into view once it is on screen and
   * hold a ring on it long enough to be seen. When it is older than the
   * loaded window, earlier pages are pulled in until it appears — a bounded
   * number of times, so a deleted comment does not fetch the whole thread.
   */
  const loadedCount = comments.length;
  const focusLoaded = focusCommentId
    ? comments.some((comment) => comment.id === focusCommentId)
    : false;
  const highlighted =
    focusCommentId && focusLoaded && faded !== focusCommentId ? focusCommentId : null;
  const reachRef = useRef(0);
  useEffect(() => {
    if (!focusCommentId || loadedCount === 0) return;
    if (!focusLoaded) {
      if (hasPreviousPage && !isFetchingPreviousPage && reachRef.current < 10) {
        reachRef.current += 1;
        void fetchPreviousPage();
      }
      return;
    }
    document
      .querySelector<HTMLElement>(`[data-comment-id="${focusCommentId}"]`)
      ?.scrollIntoView({ block: 'center' });
    const timer = setTimeout(() => setFaded(focusCommentId), 2500);
    return () => clearTimeout(timer);
  }, [
    focusCommentId,
    focusLoaded,
    loadedCount,
    hasPreviousPage,
    isFetchingPreviousPage,
    fetchPreviousPage,
  ]);

  // One handle for the thread and for the panel's Tab+C chord.
  useImperativeHandle(
    composerRef,
    () => ({
      focus: () => composer.current?.focus(),
      clear: () => composer.current?.clear(),
    }),
    [],
  );

  const canComment = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const canModerate = hasAtLeastRole(role, WorkspaceRole.MANAGER);
  const stories = useMemo(
    () => activity.data?.pages.flatMap((page) => page.items) ?? [],
    [activity.data],
  );

  const feed = useMemo<FeedItem[]>(() => {
    const pinned = comments.find((comment) => comment.pinnedAt !== null);
    const items: FeedItem[] = comments
      .filter((comment) => comment !== pinned)
      .map((comment) => ({ kind: 'comment', at: comment.createdAt, comment }));
    if (mode === 'all') {
      for (const story of stories) items.push({ kind: 'story', at: story.createdAt, story });
    }
    // Oldest first: a conversation reads top to bottom, and a story sits
    // where it happened between the comments around it. The pinned comment
    // stays above all of it, whatever its date.
    items.sort((a, b) => a.at.localeCompare(b.at));
    return pinned ? [{ kind: 'comment', at: pinned.createdAt, comment: pinned }, ...items] : items;
  }, [comments, stories, mode]);

  // A reply that just arrived from the other browser: bring it into view,
  // but only when the reader is already at the bottom, not while they are
  // reading something older.
  useEffect(() => {
    if (lastCommentAt === null) return;
    const bottom = bottomRef.current;
    if (!bottom) return;
    const pane = bottom.closest('[data-scroll-pane]') ?? bottom.parentElement?.parentElement;
    const nearBottom = !pane || pane.scrollHeight - pane.scrollTop - pane.clientHeight < 200;
    if (nearBottom) bottom.scrollIntoView({ block: 'end' });
  }, [lastCommentAt]);

  /**
   * `mutate` with a callback rather than `await mutateAsync`: the latter still
   * rejects after `onError` has shown the toast, and nothing here would catch
   * it — a failed post would surface as an unhandled rejection.
   *
   * Clearing in `onSuccess` also means a failure leaves the draft intact rather
   * than silently discarding what someone typed.
   */
  const submit = () => {
    if (!draft) return;

    createComment.mutate(
      {
        body: draft,
        ...(pendingFiles.length > 0
          ? { attachmentIds: pendingFiles.map((attachment) => attachment.id) }
          : {}),
      },
      {
        onSuccess: () => {
          composer.current?.clear();
          setDraft(null);
          setPendingFiles([]);
          if (key) clearDraft(key);
          // Posted: the thread ends with what was just said.
          requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
        },
      },
    );
  };

  const copyLink = (commentId: string) => {
    if (!permalink) return;
    const path = permalink(commentId);
    const href = `${window.location.origin}${path}`;
    void navigator.clipboard?.writeText(href).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy the link'),
    );
  };

  const itemWord = parent?.kind === 'ticket' ? 'ticket' : 'task';

  return (
    <section aria-labelledby="comments-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id="comments-heading" className="flex items-center gap-1.5 text-sm font-semibold">
          <MessageSquare className="size-3.5" aria-hidden="true" />
          Comments
          {commentTotal > 0 && (
            <span className="font-normal text-muted-foreground">({commentTotal})</span>
          )}
        </h3>

        {/* Asana's segmented control on the right of the heading. */}
        <div
          role="tablist"
          aria-label="Activity feed"
          className="flex rounded-md border p-0.5 text-xs"
        >
          {(
            [
              ['all', 'All activity'],
              ['comments', 'Comments only'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                'rounded px-2 py-0.5 transition-colors',
                mode === value
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {(hasPreviousPage || (mode === 'all' && activity.hasNextPage)) && (
        <div className="flex gap-3">
          {hasPreviousPage && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              loading={isFetchingPreviousPage}
              onClick={() => void fetchPreviousPage()}
            >
              Show earlier comments
            </Button>
          )}
          {mode === 'all' && activity.hasNextPage && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              loading={activity.isFetchingNextPage}
              onClick={() => void activity.fetchNextPage()}
            >
              Show earlier activity
            </Button>
          )}
        </div>
      )}

      {isLoading && <CommentSkeleton />}

      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Could not load comments.'}
        </p>
      )}

      {!isLoading && !isError && feed.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No comments yet. {canComment ? 'Start the conversation.' : ''}
        </p>
      )}

      {feed.length > 0 && (
        <ul className="space-y-4">
          {feed.map((item) =>
            item.kind === 'comment' ? (
              <CommentRow
                key={item.comment.id}
                comment={item.comment}
                workspaceId={workspaceId}
                parent={parent}
                members={members}
                currentUserId={currentUser?.id}
                canEdit={item.comment.authorId === currentUser?.id}
                canDelete={item.comment.authorId === currentUser?.id || canModerate}
                canPin={item.comment.authorId === currentUser?.id || canModerate}
                canLike={canComment}
                me={currentUser}
                highlighted={highlighted === item.comment.id}
                onCopyLink={permalink ? () => copyLink(item.comment.id) : undefined}
              />
            ) : (
              <StoryRow
                key={item.story.id}
                story={item.story}
                itemWord={itemWord}
                meId={currentUser?.id}
              />
            ),
          )}
        </ul>
      )}

      <div ref={bottomRef} aria-hidden="true" />

      {canComment && (
        <div className="space-y-2">
          <CommentComposer
            ref={composer}
            workspaceId={workspaceId}
            parent={parent}
            initialValue={saved?.html ?? null}
            onChange={setDraft}
            onSubmit={submit}
            onAttachmentsChange={setPendingFiles}
            members={members}
            label="Write a comment"
            placeholder="Ask a question or post an update… use @ to mention someone"
            disabled={createComment.isPending}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              <kbd className="rounded border px-1 font-mono text-[10px]">@</kbd> to mention ·{' '}
              <kbd className="rounded border px-1 font-mono text-[10px]">Ctrl</kbd> +{' '}
              <kbd className="rounded border px-1 font-mono text-[10px]">Enter</kbd> to post
            </span>
            <Button size="sm" onClick={submit} disabled={!draft} loading={createComment.isPending}>
              {createComment.isPending ? 'Posting…' : 'Comment'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** "**Ada** changed the due date from Sep 1 to Sep 12 · 2h" */
function StoryRow({
  story,
  itemWord,
  meId,
}: {
  story: ActivityEntry;
  itemWord: 'task' | 'ticket';
  meId: string | undefined;
}) {
  const actor = story.actor;
  const name = actor ? (actor.id === meId ? 'You' : actor.name) : 'An automation';

  return (
    <li className="flex items-center gap-3" data-story-id={story.id}>
      {actor ? (
        <PersonAvatar
          name={actor.name}
          avatarUrl={actor.avatarUrl}
          className="size-5 shrink-0"
          fallbackClassName="text-[9px]"
        />
      ) : (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
          <Bot className="size-3 text-muted-foreground" aria-hidden="true" />
        </span>
      )}
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{name}</span>{' '}
        {actor?.isServiceAccount && <IntegrationBadge className="mr-1 align-middle" />}
        {describeStory(story, { itemWord, meId })}
        <span className="whitespace-nowrap"> · {formatRelativeTime(story.createdAt)}</span>
      </p>
    </li>
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
  canPin,
  canLike,
  me,
  highlighted = false,
  onCopyLink,
}: {
  comment: Comment;
  workspaceId: string | undefined;
  parent: CommentParent | null;
  members: WorkspaceMember[];
  currentUserId: string | undefined;
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  canLike: boolean;
  me: { id: string; name: string; email: string; avatarUrl: string | null } | null;
  highlighted?: boolean;
  onCopyLink?: (() => void) | undefined;
}) {
  const updateComment = useUpdateComment(workspaceId, parent);
  const deleteComment = useDeleteComment(workspaceId, parent);
  const toggleLike = useToggleCommentLike(workspaceId, parent, me);
  const togglePin = useToggleCommentPin(workspaceId, parent);
  const pinned = comment.pinnedAt !== null;

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState<string | null>(comment.body);

  const save = () => {
    if (!draft || draft === comment.body) {
      setEditing(false);
      return;
    }

    // Closes only on success, so a failed save keeps the editor and the text.
    updateComment.mutate(
      { commentId: comment.id, body: draft },
      { onSuccess: () => setEditing(false) },
    );
  };

  const startEditing = () => {
    // Seeded here rather than synced from props in an effect: the draft is only
    // ever meaningful while the editor is open.
    setDraft(comment.body);
    setEditing(true);
  };

  return (
    <li
      className={cn(
        'group/comment -mx-2 flex gap-3 rounded-md px-2 py-1 transition-shadow',
        highlighted && 'ring-2 ring-primary/40',
      )}
      data-comment-id={comment.id}
    >
      <Avatar className="mt-0.5 size-7 shrink-0">
        {comment.author?.avatarUrl && <AvatarImage src={comment.author.avatarUrl} alt="" />}
        <AvatarFallback className="text-[10px]">
          {comment.author ? initials(comment.author.name) : '??'}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{comment.author?.name ?? 'Removed account'}</span>
          {comment.author?.isServiceAccount && <IntegrationBadge />}
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(comment.createdAt)}
          </span>
          {comment.editedAt && (
            <span className="text-xs text-muted-foreground" title={comment.editedAt}>
              (edited)
            </span>
          )}
          {pinned && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground"
              title={comment.pinnedBy ? `Pinned by ${comment.pinnedBy.name}` : 'Pinned'}
            >
              <Pin className="size-2.5" aria-hidden="true" />
              Pinned
            </span>
          )}

          {/* Asana's "…" at the right edge of a comment, shown on hover. */}
          {!editing && (onCopyLink || canEdit || canDelete || canPin) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Comment actions"
                  className="ml-auto size-6 self-center opacity-0 transition-opacity group-hover/comment:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                >
                  <MoreHorizontal className="size-3.5" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onCopyLink && (
                  <DropdownMenuItem onSelect={onCopyLink}>
                    <Link2 />
                    Copy link
                  </DropdownMenuItem>
                )}
                {canPin && (
                  <DropdownMenuItem
                    onSelect={() => togglePin.mutate({ commentId: comment.id, pinned })}
                  >
                    {pinned ? <PinOff /> : <Pin />}
                    {pinned ? 'Unpin' : 'Pin to top'}
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <DropdownMenuItem onSelect={startEditing}>
                    <Pencil />
                    Edit
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    {(onCopyLink || canEdit || canPin) && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setConfirmingDelete(true)}
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <CommentComposer
              workspaceId={workspaceId}
              parent={parent}
              initialValue={comment.body}
              onChange={setDraft}
              onSubmit={save}
              members={members}
              label="Edit comment"
              disabled={updateComment.isPending}
              canAttach={false}
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
          <>
            <CommentBody
              body={comment.body}
              workspaceId={workspaceId}
              currentUserId={currentUserId}
              className={cn(deleteComment.isPending && 'opacity-50')}
            />
            <CommentAttachments workspaceId={workspaceId} attachments={comment.attachments} />
          </>
        )}

        {!editing && (
          <div className="flex items-center gap-1">
            {/* Asana's thumbs-up: a small button, the count beside it, and
                who they are on hover. Guests can see it and not press it. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={comment.likedByMe}
                  aria-label={comment.likedByMe ? 'Unlike' : 'Like'}
                  disabled={!canLike || toggleLike.isPending}
                  onClick={() =>
                    toggleLike.mutate({ commentId: comment.id, liked: comment.likedByMe })
                  }
                  className={cn(
                    'h-auto px-1.5 py-0.5 text-xs font-normal text-muted-foreground',
                    comment.likedByMe && 'text-primary',
                  )}
                >
                  <ThumbsUp
                    className={cn('size-3', comment.likedByMe && 'fill-current')}
                    aria-hidden="true"
                  />
                  {comment.likeCount > 0 && <span>{comment.likeCount}</span>}
                </Button>
              </TooltipTrigger>
              {comment.likeCount > 0 && (
                <TooltipContent side="bottom">{likersText(comment, currentUserId)}</TooltipContent>
              )}
            </Tooltip>

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
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="size-3" aria-hidden="true" />
                Delete
              </Button>
            )}
          </div>
        )}
      </div>

      {/* The same question the attachment strip asks before it removes a file. */}
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
            <AlertDialogDescription>
              It will disappear from the thread for everyone. Files posted with it stay on the{' '}
              {parent?.kind === 'ticket' ? 'ticket' : 'task'}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmingDelete(false);
                deleteComment.mutate(comment.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/** "You, Ada and 3 others" — the tooltip under the thumbs-up. */
function likersText(comment: Comment, meId: string | undefined): string {
  const names = comment.likedBy.map((user) => (user.id === meId ? 'You' : user.name));
  const you = names.indexOf('You');
  if (you > 0) {
    names.splice(you, 1);
    names.unshift('You');
  }
  const unnamed = comment.likeCount - names.length;
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length + Math.max(0, unnamed);
  if (shown.length === 0) return `${comment.likeCount} like${comment.likeCount === 1 ? '' : 's'}`;
  if (rest > 0) return `${shown.join(', ')} and ${rest} other${rest === 1 ? '' : 's'}`;
  if (shown.length === 1) return shown[0] as string;
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
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
