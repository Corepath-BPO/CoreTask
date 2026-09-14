import type { Attachment } from '@coretask/types';
import { create } from 'zustand';

export interface CommentDraft {
  html: string | null;
  /** Files already uploaded through the box, to post with the words. */
  attachments: Attachment[];
}

interface CommentDraftState {
  drafts: Record<string, CommentDraft>;
  read: (key: string) => CommentDraft | undefined;
  write: (key: string, draft: CommentDraft) => void;
  clear: (key: string) => void;
}

/**
 * Unsent comments, by item.
 *
 * Asana keeps what you were typing when you close a task and open it again,
 * and a panel that throws the words away on close teaches people to write
 * comments elsewhere first. In memory only: the files in a draft are real
 * uploads that a reload cannot vouch for, and the text is one closed panel
 * away from being posted anyway.
 */
export const useCommentDraftStore = create<CommentDraftState>()((set, get) => ({
  drafts: {},
  read: (key) => get().drafts[key],
  write: (key, draft) =>
    set((state) =>
      draft.html === null && draft.attachments.length === 0
        ? { drafts: withoutKey(state.drafts, key) }
        : { drafts: { ...state.drafts, [key]: draft } },
    ),
  clear: (key) => set((state) => ({ drafts: withoutKey(state.drafts, key) })),
}));

function withoutKey(drafts: Record<string, CommentDraft>, key: string) {
  if (!(key in drafts)) return drafts;
  const next = { ...drafts };
  delete next[key];
  return next;
}

export const draftKey = (parent: { kind: string; id: string }): string =>
  `${parent.kind}:${parent.id}`;
