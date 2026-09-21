import { mergeAttributes, Node, ReactNodeViewRenderer, type Editor } from '@tiptap/react';

import { AttachmentImageView } from './attachment-image-view';

export interface AttachmentImageOptions {
  /** Which workspace's attachments the pictures belong to. */
  workspaceId: string | undefined;
}

export interface AttachmentImageAttrs {
  attachmentId: string;
  alt?: string | null;
}

/**
 * A picture in a description, stored as `<img data-attachment="uuid" alt="…">`.
 *
 * Never a `src`. The bucket is private and every link to it expires, so the
 * markup names the attachment and the node view asks for a fresh URL when it
 * draws. The server's allow-list writes exactly these two attributes.
 */
export const AttachmentImage = Node.create<AttachmentImageOptions>({
  name: 'attachmentImage',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { workspaceId: undefined };
  },

  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-attachment'),
        renderHTML: (attributes) => ({
          'data-attachment': String(attributes['attachmentId'] ?? ''),
        }),
      },
      alt: {
        default: null,
        parseHTML: (element) => element.getAttribute('alt'),
        renderHTML: (attributes) => (attributes['alt'] ? { alt: String(attributes['alt']) } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[data-attachment]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentImageView);
  },
});

/** Puts a picture where the caret is. Focusing means the eventual blur saves it. */
export function insertAttachmentImage(editor: Editor, attrs: AttachmentImageAttrs): void {
  if (editor.isDestroyed) return;
  editor.chain().focus().insertContent({ type: AttachmentImage.name, attrs }).run();
}
