import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_DEFAULT_PAGE,
  PAGINATION_MAX_LIMIT,
} from '@coretask/contracts';
import { z } from 'zod';

export const uuidSchema = z.uuid('Must be a valid identifier.');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION_DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
});
export type PaginationQueryInput = z.input<typeof paginationQuerySchema>;
export type PaginationQueryOutput = z.output<typeof paginationQuerySchema>;

/**
 * Normalises a free-text name into a URL-safe slug.
 *
 * Shared so the web client can preview the workspace URL while typing and the
 * API can derive the same value when the client omits it.
 */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      // Strip the combining marks that NFKD split off, so "Café" becomes "cafe".
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 40)
      .replace(/-+$/g, '')
  );
}
