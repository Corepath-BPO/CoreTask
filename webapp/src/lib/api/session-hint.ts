/**
 * A non-secret marker recording whether this browser is worth asking about a
 * session.
 *
 * The refresh token is HTTP-only, so the app cannot tell whether a cookie exists
 * before calling `/auth/refresh`. Without a hint, every anonymous page load
 * fires a request that can only 401 — harmless, but it costs a round trip and
 * prints a red error in the console on every visit to the login page.
 *
 * Three states, and the distinction matters:
 *
 * - `'1'`  signed in here → try to restore.
 * - `'0'`  known signed out (explicit logout, or a refresh the API refused —
 *          see `isRefreshRefusal`) → skip the call.
 * - absent unknown → **try anyway**.
 *
 * "Unknown" must not mean "signed out". A browser that already held a valid
 * session when this marker was introduced has the cookie but no marker, and
 * treating that as signed out would log those sessions out on their next
 * reload. The cost of guessing wrong is one doomed request, once.
 *
 * This is a hint, never an authorisation: the value is trivially forgeable and
 * the server still validates the cookie on every call.
 */
const SESSION_HINT_KEY = 'coretask.session-hint';

const SIGNED_IN = '1';
const SIGNED_OUT = '0';

/** Storage throws when disabled (private mode, blocked cookies). */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function write(value: string): void {
  try {
    safeStorage()?.setItem(SESSION_HINT_KEY, value);
  } catch {
    // A full or restricted store only costs us the optimisation.
  }
}

export function markSessionStarted(): void {
  write(SIGNED_IN);
}

/** Only for outcomes that prove no usable cookie remains. */
export function markSignedOut(): void {
  write(SIGNED_OUT);
}

/**
 * Whether a failed `/auth/refresh` proves the cookie is unusable.
 *
 * Only the API saying no does: 401 for a missing, expired or replayed token,
 * 403 for a disabled account. A network error or a 5xx — the API still
 * starting after a restart, a proxy timing out — says nothing about the
 * cookie. Recording one of those as signed out skipped every later restore and
 * stranded a live session on /login.
 */
export function isRefreshRefusal(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/**
 * Back to "unknown", so the next load retries.
 *
 * Used when a session ends for a reason that does not prove the cookie is gone
 * — a stray 401 elsewhere in the app should cost a retry, not a sign-out.
 */
export function forgetSessionHint(): void {
  try {
    safeStorage()?.removeItem(SESSION_HINT_KEY);
  } catch {
    // Ignored for the same reason as above.
  }
}

export function shouldAttemptRestore(): boolean {
  try {
    return safeStorage()?.getItem(SESSION_HINT_KEY) !== SIGNED_OUT;
  } catch {
    return true;
  }
}
