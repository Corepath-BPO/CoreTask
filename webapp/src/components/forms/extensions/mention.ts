import Mention, { type MentionOptions } from '@tiptap/extension-mention';
import { mergeAttributes } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';

import { matchesQuery } from '@/lib/mention-query';

/** Somebody `@` can name. */
export interface MentionCandidate {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

/** What the editor shows while an `@` is being typed. */
export interface MentionSuggestion {
  items: MentionCandidate[];
  query: string;
  /** Turns the `@query` into a chip for this person. */
  command: (candidate: MentionCandidate) => void;
  /** Where the caret is, for placing the list. */
  clientRect: (() => DOMRect | null) | null | undefined;
}

/** Beyond a handful the list stops being scannable and needs more typing. */
export const MAX_MENTION_SUGGESTIONS = 6;

/**
 * A mention inside a description, stored as `<span data-mention="uuid">@Name</span>`.
 *
 * The same attribute the comment chip renders, so one style rule and one entry
 * in the server's allow-list cover both. No `data-type`, no `data-label`: the
 * name is the text, and the server writes nothing it did not list.
 */
interface HighlightOptions {
  /**
   * The reader's own id. A chip naming them gets `data-me`, which the
   * stylesheet tints — set by a read-only view, never by the composer, so the
   * flag never reaches the stored markup (and the server would drop it anyway).
   */
  highlightId: string | null;
}

export const DescriptionMention = Mention.extend<MentionOptions & HighlightOptions>({
  addOptions() {
    return { ...(this.parent?.() as MentionOptions), highlightId: null };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-mention'),
        renderHTML: (attributes) =>
          attributes['id'] ? { 'data-mention': String(attributes['id']) } : {},
      },
      label: {
        default: null,
        parseHTML: (element) => (element.textContent ?? '').replace(/^@/, ''),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const me = this.options.highlightId;
    const mine = me !== null && String(node.attrs['id'] ?? '').toLowerCase() === me.toLowerCase();

    return [
      'span',
      mergeAttributes(HTMLAttributes, mine ? { 'data-me': '' } : {}),
      `@${String(node.attrs['label'] ?? '')}`,
    ];
  },

  renderText({ node }) {
    return `@${String(node.attrs['label'] ?? '')}`;
  },
});

export interface MentionHooks {
  /** Read on every keystroke, so a member list that arrives later still counts. */
  candidates: () => MentionCandidate[];
  onState: (suggestion: MentionSuggestion | null) => void;
  /** Return true when the key was the list's — arrows, Enter, Escape. */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

function toSuggestion(props: SuggestionProps<MentionCandidate>): MentionSuggestion {
  return {
    items: props.items,
    query: props.query,
    command: (candidate) => props.command(candidate),
    clientRect: props.clientRect,
  };
}

/**
 * The mention node with its `@` picker wired to React state.
 *
 * Tiptap's suggestion utility expects to own a popup; here it only reports —
 * the editor component draws the list itself, inside its own box, so a click
 * on a name can never count as a click "outside" the dialog around it.
 */
export function mentionExtension(hooks: MentionHooks) {
  return DescriptionMention.configure({
    suggestion: {
      char: '@',
      allowSpaces: true,
      items: ({ query }) =>
        hooks
          .candidates()
          .filter((candidate) => matchesQuery(candidate, query))
          .slice(0, MAX_MENTION_SUGGESTIONS),
      command: ({ editor, range, props }) => {
        const candidate = props as MentionCandidate;
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: DescriptionMention.name, attrs: { id: candidate.id, label: candidate.name } },
            { type: 'text', text: ' ' },
          ])
          .run();
      },
      render: () => ({
        onStart: (props) => hooks.onState(toSuggestion(props)),
        onUpdate: (props) => hooks.onState(toSuggestion(props)),
        onKeyDown: (props: SuggestionKeyDownProps) => hooks.onKeyDown(props.event),
        onExit: () => hooks.onState(null),
      }),
    },
  });
}
