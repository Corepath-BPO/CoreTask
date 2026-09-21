import { useMutation } from '@tanstack/react-query';

import type { PlaygroundRequest } from '../lib/playground-calls';

/** What came back, kept whole: the point of the page is to see the real answer. */
export interface PlaygroundResponse {
  status: number;
  ok: boolean;
  durationMs: number;
  /** The headers worth reading back; the rest are noise for this purpose. */
  headers: { requestId: string | null; replayed: boolean };
  body: unknown;
  /** `data.id` when the answer carries one, so the next call can pick it up. */
  createdId: string | null;
}

/**
 * Fires the request exactly as built, with the browser's own `fetch`, not the
 * app's API client: the client would add the session token and refresh it,
 * and the whole point here is to see what a tool with only a key would see.
 */
export async function runPlaygroundRequest(
  request: PlaygroundRequest,
): Promise<PlaygroundResponse> {
  const started = performance.now();
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body !== null ? { body: request.body } : {}),
  });
  const durationMs = Math.round(performance.now() - started);

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON — a proxy error page, say. Shown as text.
  }

  const data =
    body && typeof body === 'object' && 'data' in body
      ? (body as { data?: unknown }).data
      : undefined;
  const createdId =
    data && typeof data === 'object' && typeof (data as { id?: unknown }).id === 'string'
      ? (data as { id: string }).id
      : null;

  return {
    status: response.status,
    ok: response.ok,
    durationMs,
    headers: {
      requestId: response.headers.get('x-request-id'),
      replayed: response.headers.get('idempotency-replayed') === 'true',
    },
    body,
    createdId,
  };
}

export function usePlaygroundRun() {
  return useMutation({ mutationFn: runPlaygroundRequest });
}
