/**
 * Outbound HTTP helpers shared by everything that calls another server.
 *
 * `fetch` has no timeout of its own, and a request that hangs would occupy a
 * queue worker until the process restarts.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  /** Names the other side in the timeout error: "Microsoft Graph", "The endpoint". */
  describe = 'The server',
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${describe} did not respond within ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Error bodies are the only useful diagnostic when a call fails, but they must
 * never take the process down with a parse error on top of the original
 * failure. Truncated because they can be long and end up in logs.
 */
export async function safeBody(response: Response, limit = 500): Promise<string> {
  try {
    return (await response.text()).slice(0, limit);
  } catch {
    return '<unreadable response body>';
  }
}
