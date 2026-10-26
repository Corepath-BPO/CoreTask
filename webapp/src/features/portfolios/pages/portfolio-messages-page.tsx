import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import { MessageSquare } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageCard, MessageComposer } from '@/features/projects/components/message-thread';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { useCurrentUser } from '@/stores/auth.store';

import {
  useDeletePortfolioMessage,
  usePortfolioMessages,
  usePostPortfolioMessage,
  useReplyToPortfolioMessage,
} from '../hooks/use-portfolio-messages';
import { usePortfolio } from '../hooks/use-portfolios';

/**
 * A portfolio's Messages tab — the conversation about a set of projects
 * rather than any one of them: priorities across the programme, a decision
 * that touches three projects at once.
 *
 * Shared with the workspace like the portfolio itself. Members post and
 * reply, guests read; deleting is the author's or a manager's. A new message
 * tells the portfolio's owner and whoever starred it.
 */
export function PortfolioMessagesPage({ portfolioId }: { portfolioId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const me = useCurrentUser();
  const { portfolio } = usePortfolio(workspaceId, portfolioId);
  const role = workspace?.role ?? WorkspaceRole.GUEST;
  const canPost = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const canManage = hasAtLeastRole(role, WorkspaceRole.MANAGER);

  const messages = usePortfolioMessages(workspaceId, portfolioId);
  const post = usePostPortfolioMessage(workspaceId, portfolioId);
  const reply = useReplyToPortfolioMessage(workspaceId, portfolioId);
  const remove = useDeletePortfolioMessage(workspaceId, portfolioId);
  const [composing, setComposing] = useState(false);

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Messages</h2>
            <p className="text-sm text-muted-foreground">
              Conversations that span the projects in {portfolio?.name ?? 'this portfolio'}. Its
              owner and everyone who starred it are notified.
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
            placeholder="Write a message to the portfolio…"
            pending={post.isPending}
            onPost={(payload, done) => post.mutate(payload, { onSuccess: done })}
            onCancel={() => setComposing(false)}
          />
        )}

        {messages.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))}
          </div>
        ) : (messages.data ?? []).length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No messages yet"
            description="Start a conversation about the projects in this portfolio."
          />
        ) : (
          <ul className="space-y-3">
            {(messages.data ?? []).map((message) => (
              <li key={message.id}>
                <MessageCard
                  workspaceId={workspaceId}
                  message={message}
                  canReply={canPost}
                  canDelete={canManage || message.author?.id === me?.id}
                  currentUserId={me?.id}
                  replying={reply.isPending}
                  onReply={(body, done) =>
                    reply.mutate({ messageId: message.id, body }, { onSuccess: done })
                  }
                  onDelete={() => remove.mutate(message.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
