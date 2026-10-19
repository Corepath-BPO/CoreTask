import { PROJECT_MESSAGE_TITLE_MAX } from '@coretask/contracts';
import type { PostProjectMessagePayload, ThreadMessage } from '@coretask/types';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { RichTextEditor, RichTextView } from '@/components/forms/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatRelativeTime } from '@/lib/utils';

/*
 * The pieces of a Messages tab — a composer, a message with its replies — as
 * a project's and a portfolio's share them. Each takes what to do rather than
 * a hook, so where a message lives stays the page's business.
 */

/** Settles a mutation for the component: `done` runs only once it succeeded. */
type Send<T> = (value: T, done: () => void) => void;

export function MessageComposer({
  workspaceId,
  placeholder,
  pending,
  onPost,
  onCancel,
}: {
  workspaceId: string;
  placeholder: string;
  pending: boolean;
  onPost: Send<PostProjectMessagePayload>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState<string | null>(null);

  const ready = title.trim() !== '' && body !== null && !pending;
  const submit = () => {
    if (!ready || body === null) return;
    onPost({ title: title.trim(), body }, onCancel);
  };

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <Input
          aria-label="Message subject"
          placeholder="Subject"
          value={title}
          maxLength={PROJECT_MESSAGE_TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
        />
        <RichTextEditor
          initialValue=""
          onChange={setBody}
          onSubmit={submit}
          workspaceId={workspaceId}
          toolbar="always"
          minHeightClassName="min-h-28"
          placeholder={placeholder}
          ariaLabel="Message"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!ready}>
            Post message
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AuthorLine({
  name,
  avatarUrl,
  at,
}: {
  name: string;
  avatarUrl: string | null;
  at: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <PersonAvatar
        name={name}
        avatarUrl={avatarUrl}
        className="size-7"
        fallbackClassName="text-[10px]"
      />
      <span className="truncate text-sm font-medium">{name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(at)}</span>
    </div>
  );
}

export function DeleteMenu({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${label}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MessageCard({
  workspaceId,
  message,
  canReply,
  canDelete,
  currentUserId,
  replying,
  onReply,
  onDelete,
}: {
  workspaceId: string | undefined;
  message: ThreadMessage;
  canReply: boolean;
  canDelete: boolean;
  currentUserId: string | undefined;
  replying: boolean;
  onReply: Send<string>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState('');

  const send = () => {
    const body = draft.trim();
    if (!body || replying) return;
    onReply(body, () => setDraft(''));
  };

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-2">
          <AuthorLine
            name={message.author?.name ?? 'Someone who has left'}
            avatarUrl={message.author?.avatarUrl ?? null}
            at={message.createdAt}
          />
          {canDelete && <DeleteMenu label={message.title} onDelete={onDelete} />}
        </div>
        <h3 className="text-base font-semibold">{message.title}</h3>
        <RichTextView
          html={message.body}
          workspaceId={workspaceId}
          highlightMentionId={currentUserId}
          className="text-sm"
        />

        {message.replies.length > 0 && (
          <ul className="space-y-3 border-t pt-3">
            {message.replies.map((entry) => (
              <li key={entry.id} className="space-y-1">
                <AuthorLine
                  name={entry.author?.name ?? 'Someone who has left'}
                  avatarUrl={entry.author?.avatarUrl ?? null}
                  at={entry.createdAt}
                />
                <RichTextView
                  html={entry.body}
                  workspaceId={workspaceId}
                  highlightMentionId={currentUserId}
                  className="pl-9 text-sm"
                />
              </li>
            ))}
          </ul>
        )}

        {canReply && (
          <div className="flex items-end gap-2 border-t pt-3">
            <Textarea
              aria-label={`Reply to ${message.title}`}
              placeholder="Reply…"
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) send();
              }}
              className="min-h-9 resize-none"
            />
            <Button size="sm" onClick={send} disabled={!draft.trim() || replying}>
              Reply
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
