import { ALLOWED_UPLOAD_MIME_TYPES, FILENAME_MAX_LENGTH } from '@coretask/contracts';
import { z } from 'zod';

/** True when the name carries a C0 control character or DEL. */
function hasControlCharacter(name: string): boolean {
  return [...name].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

/**
 * Rejects a filename that could escape the directory it is written into, or
 * break the header it is later echoed in.
 *
 * The stored key is built from a fresh UUID and never from this value, so this
 * is not what keeps the bucket safe. It stops a name like `../../etc/passwd`
 * being displayed and handed back as a download filename, and a name carrying
 * CR or LF from splitting the `Content-Disposition` header it ends up in.
 */
export const filenameSchema = z
  .string()
  .trim()
  .min(1, 'A filename is required.')
  .max(FILENAME_MAX_LENGTH, `Must be at most ${FILENAME_MAX_LENGTH} characters.`)
  .refine((name) => !name.includes('/') && !name.includes('\\'), 'Filenames cannot contain slashes.')
  .refine((name) => name !== '.' && name !== '..', 'That is not a filename.')
  .refine((name) => !hasControlCharacter(name), 'Filenames cannot contain control characters.');

export const mimeTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => ALLOWED_UPLOAD_MIME_TYPES.includes(value), 'That file type is not supported.');

/**
 * `sizeBytes` is what the client *claims*. It bounds the presigned URL that gets
 * issued, but the API re-reads the stored object at confirm time — the upload
 * goes straight to the bucket, so the declaration is a request, not a fact.
 */
export const createAttachmentSchema = z
  .object({
    filename: filenameSchema,
    mimeType: mimeTypeSchema,
    sizeBytes: z.number().int().positive('A file cannot be empty.'),
    taskId: z.uuid().optional(),
    ticketId: z.uuid().optional(),
  })
  .refine(
    (value) => Boolean(value.taskId) !== Boolean(value.ticketId),
    'Attach to exactly one of a task or a ticket.',
  );
export type CreateAttachmentInput = z.input<typeof createAttachmentSchema>;
