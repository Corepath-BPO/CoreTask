import type { Attachment } from '@coretask/types';

/** A picture the browser can show in place; SVG stays a file, as it can carry script. */
export const isImage = (attachment: Pick<Attachment, 'mimeType'>): boolean =>
  attachment.mimeType.startsWith('image/') && attachment.mimeType !== 'image/svg+xml';
