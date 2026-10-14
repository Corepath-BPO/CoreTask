import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { ProjectMessage } from '@coretask/types';
import { MessageSquare } from 'lucide-react';
import { useMemo, useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusUpdateChip } from '@/features/portfolios/components/status-update';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { useCurrentUser } from '@/stores/auth.store';

import {
  useDeleteMessage,
  useDeleteStatusUpdate,
  usePostMessage,
  useProjectMessages,
  useReplyToMessage,
  useStatusUpdateHistory,
  type ProjectStatusUpdate,
} from '../hooks/use-project-updates';
import { useProject } from '../hooks/use-projects';
import { AuthorLine, DeleteMenu, MessageCard, MessageComposer } from '../components/message-thread';
import { useProjectAccess } from '../lib/project-access';

type FeedEntry =
  | { kind: 'message'; at: string; message: ProjectMessage }
  | { kind: 'status'; at: string; update: ProjectStatusUpdate };

/**
 * The project's Messages tab — Asana's conversation space.
 *
 * Messages and status updates read as one feed, newest first, because both
 * are the project talking about itself; a status update is posted from the
 * header's "Set status" and lands here beside the messages. Replies sit under
 * their message. Posting is for anyone who can edit the project's tasks;
 * deleting is the author's, or a manager's.
 */
export function ProjectMessagesPage({ projectId }: { projectId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const me = useCurrentUser();
  const { data: project } = useProject(workspaceId, projectId);
  const { effectiveRole } = useProjectAccess(project);
  const canPost = hasAtLeastRole(effectiveRole, WorkspaceRole.MEMBER);
  const canManage = hasAtLeastRole(effectiveRole, WorkspaceRole.MANAGER);

  const messages = useProjectMessages(workspaceId, projectId);
  const statuses = useStatusUpdateHistory(workspaceId, projectId);
  const post = usePostMessage(workspaceId, projectId);
  const reply = useReplyToMessage(workspaceId, projectId);
  const removeMessage = useDeleteMessage(workspaceId, projectId);
  const [composing, setComposing] = useState(false);

  const feed = useMemo<FeedEntry[]>(
    () =>
      [
        ...(messages.data ?? []).map((message): FeedEntry => ({
          kind: 'message',
          at: message.createdAt,
          message,
        })),
        ...(statuses.data ?? []).map((update): FeedEntry => ({
          kind: 'status',
          at: update.updatedAt,
          update,
        })),
      ].sort((a, b) => b.at.localeCompare(a.at)),
    [messages.data, statuses.data],
  );

  const isLoading = messages.isLoading || statuses.isLoading;
  const mayDelete = (authorId: string | undefined) => canManage || authorId === me?.id;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Messages</h2>
          <p className="text-sm text-muted-foreground">
            Conversations and status updates for this project. Its members are notified of each one.
          </p>
        </div>
        {canPost && !composing && (
          <Button size="sm" onClick={() => setComposing(true)}>
            <MessageSquare />
            New message
          </Button>
        )}
      </div>

      {composing && workspaceId && (
        <MessageComposer
          workspaceId={workspaceId}
          placeholder="Write a message to the project…"
          pending={post.isPending}
          onPost={(payload, done) => post.mutate(payload, { onSuccess: done })}
          onCancel={() => setComposing(false)}
        />
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : feed.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No messages yet"
          description="Start a conversation with the project's members, or post a status update from the header."
        />
      ) : (
        <ul className="space-y-3">
          {feed.map((entry) =>
            entry.kind === 'message' ? (
              <li key={`message-${entry.message.id}`}>
                <MessageCard
                  workspaceId={workspaceId}
                  message={entry.message}
                  canReply={canPost}
                  canDelete={mayDelete(entry.message.author?.id)}
                  currentUserId={me?.id}
                  replying={reply.isPending}
                  onReply={(body, done) =>
                    reply.mutate({ messageId: entry.message.id, body }, { onSuccess: done })
                  }
                  onDelete={() => removeMessage.mutate(entry.message.id)}
                />
              </li>
            ) : (
              <li key={`status-${entry.update.id}`}>
                <StatusCard
                  workspaceId={workspaceId}
                  projectId={projectId}
                  update={entry.update}
                  canDelete={mayDelete(entry.update.author?.id)}
                />
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function StatusCard({
  workspaceId,
  projectId,
  update,
  canDelete,
}: {
  workspaceId: string | undefined;
  projectId: string;
  update: ProjectStatusUpdate;
  canDelete: boolean;
}) {
  const remove = useDeleteStatusUpdate(workspaceId, projectId);

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-2">
          <AuthorLine
            name={update.author?.name ?? 'Someone who has left'}
            avatarUrl={update.author?.avatarUrl ?? null}
            at={update.updatedAt}
          />
          {canDelete && (
            <DeleteMenu label="this status update" onDelete={() => remove.mutate(update.id)} />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusUpdateChip status={update.status} />
          {update.title && <h3 className="text-sm font-semibold">{update.title}</h3>}
        </div>
        {update.note && (
          <section>
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Summary
            </h4>
            <p className="whitespace-pre-wrap text-sm">{update.note}</p>
          </section>
        )}
        {update.nextSteps && (
          <section>
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Next steps
            </h4>
            <p className="whitespace-pre-wrap text-sm">{update.nextSteps}</p>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
