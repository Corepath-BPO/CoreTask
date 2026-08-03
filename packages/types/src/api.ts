import type { ErrorCode } from '@coretask/contracts';

/**
 * Every CoreTask REST response is one of these three shapes. The API guarantees
 * it via a global response interceptor + exception filter; the web client's HTTP
 * layer unwraps it in exactly one place.
 */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
  meta: null;
}

export interface ApiPaginatedResponse<TItem> {
  success: true;
  data: TItem[];
  meta: PaginationMeta;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  /** Field-level validation details, or any structured context. `null` when absent. */
  details: Record<string, unknown> | null;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<TData> =
  | ApiSuccessResponse<TData>
  | ApiPaginatedResponse<TData extends readonly (infer TItem)[] ? TItem : never>
  | ApiErrorResponse;

/** Query parameters accepted by every paginated list endpoint. */
export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export type SortDirection = 'asc' | 'desc';
