import { RichTextView } from '@/components/forms/rich-text-editor';
import { commentToEditorHtml } from '@/lib/rich-text';
import { cn } from '@/lib/utils';

interface CommentBodyProps {
  /** Sanitised HTML — or, for a row from before comments were rich text, tokens. */
  body: string;
  /** Where inline pictures live. */
  workspaceId?: string | undefined;
  /** Highlights mentions of this user, so being named stands out in a thread. */
  currentUserId?: string | undefined;
  className?: string;
}

/**
 * A comment as the thread shows it: the same read-only renderer a description
 * gets, so bold, lists, links, chips and inline pictures read the same in
 * both places. The server converts legacy token bodies; the client repeats
 * the conversion only as a courtesy for anything that skipped the API.
 */
export function CommentBody({ body, workspaceId, currentUserId, className }: CommentBodyProps) {
  return (
    <RichTextView
      html={commentToEditorHtml(body)}
      workspaceId={workspaceId}
      highlightMentionId={currentUserId}
      className={cn('comment-body', className)}
    />
  );
}
