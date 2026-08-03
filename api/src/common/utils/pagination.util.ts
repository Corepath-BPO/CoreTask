import type { PaginationMeta } from '@coretask/types';

export interface PageRequest {
  page: number;
  limit: number;
}

/** Converts a page request into Prisma's `skip`/`take`. */
export function toSkipTake({ page, limit }: PageRequest): { skip: number; take: number } {
  return { skip: (page - 1) * limit, take: limit };
}

export function buildPaginationMeta(request: PageRequest, total: number): PaginationMeta {
  return {
    page: request.page,
    limit: request.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / request.limit),
  };
}
