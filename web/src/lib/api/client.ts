import { ApiRoutes } from '@coretask/contracts';
import type { ApiPaginatedResponse, ApiSuccessResponse, PaginationMeta } from '@coretask/types';
import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

import { env } from '@/app/config/env';

import { ApiError } from './api-error';

/** A request that has already been retried once after a refresh. */
type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/**
 * The access token lives in module scope, not `localStorage`.
 *
 * That keeps it out of reach of any XSS payload that can read storage, and it
 * disappears on tab close — the HTTP-only refresh cookie is what makes the
 * session survive a reload.
 */
let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Registered once by the auth store so a dead session can clear app state. */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

export const http = axios.create({
  baseURL: env.apiUrl,
  // Required for the refresh cookie to travel on /auth requests.
  withCredentials: true,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

/**
 * Single-flight refresh.
 *
 * Several requests can 401 at once when a token expires. Without this, each one
 * would rotate the refresh token, and rotation #2 would look like a replay and
 * revoke the whole session family.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const response = await axios.post<ApiSuccessResponse<{ accessToken: string }>>(
        `${env.apiUrl}${ApiRoutes.auth.refresh}`,
        {},
        { withCredentials: true, timeout: 15_000 },
      );

      const token = response.data.data.accessToken;
      setAccessToken(token);
      return token;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      // Cleared on the next tick so concurrent callers all observe this result.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (!error.response) {
      throw ApiError.network(
        error.code === 'ECONNABORTED' ? 'The request timed out. Please try again.' : undefined,
      );
    }

    const apiError = ApiError.fromResponse(error.response.data, error.response.status);
    const config = error.config as RetriableConfig | undefined;
    const isRefreshCall = config?.url?.includes(ApiRoutes.auth.refresh);

    if (apiError.isAuthExpiry && config && !config._retried && !isRefreshCall) {
      config._retried = true;
      const token = await refreshAccessToken();

      if (token) {
        config.headers.set('Authorization', `Bearer ${token}`);
        return http.request(config);
      }
    }

    // A dead session anywhere means the app should fall back to /login.
    if (apiError.isUnauthenticated && !isRefreshCall) {
      onUnauthenticated?.();
    }

    throw apiError;
  },
);

/**
 * Unwraps the standard envelope so callers work with domain data directly.
 * Errors are already `ApiError` by the time they reach here.
 */
export const apiClient = {
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const { data } = await http.get<ApiSuccessResponse<T>>(url, config);
    return data.data;
  },

  /**
   * `TMeta` widens the envelope's `meta` for endpoints that ship extra rollups
   * alongside the page information — the tasks list returns a summary there.
   */
  async getPaginated<T, TMeta extends PaginationMeta = PaginationMeta>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<{ items: T[]; meta: TMeta }> {
    const { data } = await http.get<ApiPaginatedResponse<T> & { meta: TMeta }>(url, config);
    return { items: data.data, meta: data.meta };
  },

  async post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const { data } = await http.post<ApiSuccessResponse<T>>(url, body ?? {}, config);
    return data.data;
  },

  async patch<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const { data } = await http.patch<ApiSuccessResponse<T>>(url, body ?? {}, config);
    return data.data;
  },

  async put<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const { data } = await http.put<ApiSuccessResponse<T>>(url, body ?? {}, config);
    return data.data;
  },

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const { data } = await http.delete<ApiSuccessResponse<T>>(url, config);
    return data.data;
  },
};
