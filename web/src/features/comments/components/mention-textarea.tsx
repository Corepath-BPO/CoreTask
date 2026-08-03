import type { WorkspaceMember } from '@coretask/types';
import { useRef, useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { cn, initials } from '@/lib/utils';

import {
  applyMention,
  findMentionQuery,
  matchesQuery,
  type MentionQuery,
} from '../lib/mention-query';

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  members: WorkspaceMember[];
  /** Fired for Ctrl/Cmd+Enter, but only when the picker is not open. */
  onSubmit?: () => void;
  label: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

/** Beyond a handful the list stops being scannable and needs more typing. */
const MAX_SUGGESTIONS = 6;

/**
 * A textarea that completes `@` into a mention token.
 *
 * The token is inserted into the text rather than tracked alongside it, so the
 * value this emits is exactly what gets stored and what the server parses.
 * Deleting the token is what removes the mention — there is no second list to
 * fall out of sync.
 */
export function MentionTextarea({
  value,
  onChange,
  members,
  onSubmit,
  label,
  placeholder,
  rows = 3,
  maxLength,
  disabled,
  autoFocus,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const suggestions = mention
    ? members.filter((member) => matchesQuery(member.user, mention.query)).slice(0, MAX_SUGGESTIONS)
    : [];
  const open = mention !== null && suggestions.length > 0;

  const syncMention = (nextValue: string, caret: number) => {
    setMention(findMentionQuery(nextValue, caret));
    setHighlighted(0);
  };

  const choose = (member: WorkspaceMember) => {
    const textarea = textareaRef.current;
    if (!mention || !textarea) return;

    const result = applyMention(value, mention, textarea.selectionStart, member.user);
    onChange(result.value);
    setMention(null);

    // Restoring the caret has to wait for React to write the new value, or the
    // browser puts it back at the end of the old one.
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.caret, result.caret);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      // While the picker is up it owns the arrows and Enter; otherwise choosing
      // a name would submit the comment instead.
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlighted((current) => (current + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted((current) => (current - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const picked = suggestions[highlighted];
        if (picked) choose(picked);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMention(null);
        return;
      }
    }

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          syncMention(event.target.value, event.target.selectionStart);
        }}
        // Moving the caret with the mouse or arrows can leave or enter a token.
        onSelect={(event) => {
          const target = event.target as HTMLTextAreaElement;
          syncMention(target.value, target.selectionStart);
        }}
        onBlur={() => setMention(null)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-expanded={open}
        aria-controls={open ? 'mention-suggestions' : undefined}
      />

      {open && (
        <ul
          id="mention-suggestions"
          role="listbox"
          aria-label="Mention a teammate"
          className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {suggestions.map((member, index) => (
            <li key={member.user.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlighted}
                // `onMouseDown` rather than `onClick`: blur fires first and
                // would close the list before a click could land.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(member);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                  index === highlighted && 'bg-accent text-accent-foreground',
                )}
              >
                <Avatar className="size-5 shrink-0">
                  {member.user.avatarUrl && <AvatarImage src={member.user.avatarUrl} alt="" />}
                  <AvatarFallback className="text-[9px]">
                    {initials(member.user.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{member.user.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
