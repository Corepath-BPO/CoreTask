import { COMMENT_MAX_LENGTH, COMMENT_MIN_LENGTH } from '@coretask/contracts';
import { z } from 'zod';

export const commentBodySchema = z
  .string()
  .trim()
  .min(COMMENT_MIN_LENGTH, 'Write something first.')
  .max(COMMENT_MAX_LENGTH, `Must be at most ${COMMENT_MAX_LENGTH} characters.`);

export const createCommentSchema = z.object({ body: commentBodySchema });
export type CreateCommentInput = z.input<typeof createCommentSchema>;

/**
 * Body is the only editable field, so an update is the same shape as a create.
 * Author and parent are facts about the comment, not settings.
 */
export const updateCommentSchema = z.object({ body: commentBodySchema });
export type UpdateCommentInput = z.input<typeof updateCommentSchema>;
