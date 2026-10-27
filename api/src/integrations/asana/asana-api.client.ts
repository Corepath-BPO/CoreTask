import { Injectable, Logger } from '@nestjs/common';

import { fetchWithTimeout } from '../../common/utils/http.util';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Asana said no. `status` is the HTTP status; the message is Asana's own,
 * which never echoes the token.
 */
export class AsanaApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    message: string,
  ) {
    super(`Asana ${path} failed (${status}): ${message}`);
    this.name = 'AsanaApiError';
  }
}

/** Query parameters; `opt_fields` above all, which decides what comes back. */
export type AsanaParams = Record<string, string | number | boolean | undefined>;

/** Asana's page size ceiling. */
const PAGE_SIZE = 100;
/** Retries for a 429, which Asana answers with how long to wait. */
const MAX_RATE_LIMIT_RETRIES = 8;
/** Retries for a 5xx or a dropped connection, with doubling waits. */
const MAX_SERVER_RETRIES = 3;
const SERVER_RETRY_BASE_MS = 2_000;
/** When a 429 carries no Retry-After, which Asana's docs say it always does. */
const DEFAULT_RETRY_AFTER_S = 30;

/**
 * Spaces request starts and caps how many are in flight.
 *
 * Asana counts per token per minute and refuses more than 50 concurrent reads,
 * so both limits matter: a minute's budget spent in the first ten seconds is a
 * wall of 429s for the next fifty. A 429 pauses every request, not only the
 * one refused — the budget is the token's, shared by all of them.
 */
export class RequestGate {
  private inFlight = 0;
  private nextStartAt = 0;
  private pausedUntil = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly spacingMs: number,
    private readonly wait: (ms: number) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  /** Holds every request that has not started yet for `ms`. */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }

  private async acquire(): Promise<void> {
    while (this.inFlight >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.inFlight += 1;

    const now = this.now();
    const start = Math.max(now, this.nextStartAt, this.pausedUntil);
    this.nextStartAt = start + this.spacingMs;
    if (start > now) await this.wait(start - now);
  }

  private release(): void {
    this.inFlight -= 1;
    this.waiters.shift()?.();
  }
}

/**
 * Asana's REST API, read-only by construction: every request this class can
 * make is a GET. The importer treats Asana as the source of truth, and the
 * surest way to never change it is to have no method that could.
 *
 * The token goes in the Authorization header of Asana calls and nowhere else —
 * not into logs, errors or the attachment downloads, whose URLs are already
 * signed by Asana's storage and must not receive it.
 */
@Injectable()
export class AsanaApiClient {
  private readonly logger = new Logger(AsanaApiClient.name);
  private readonly gate: RequestGate;
  /** Calls made since the process started — the import's progress shows it. */
  requestCount = 0;
  /** Replaced in tests so a retry does not really wait. */
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  constructor(private readonly config: AppConfigService) {
    const { concurrency, maxRequestsPerMinute } = config.asana;
    this.gate = new RequestGate(concurrency, Math.ceil(60_000 / maxRequestsPerMinute), (ms) =>
      this.wait(ms),
    );
  }

  get enabled(): boolean {
    return this.config.asana.enabled;
  }

  /** One object: `data` of the response. */
  async get<T>(path: string, params: AsanaParams = {}): Promise<T> {
    const body = await this.request<{ data: T }>(path, params);
    return body.data;
  }

  /** Every page of a collection, in Asana's order. */
  async list<T>(path: string, params: AsanaParams = {}): Promise<T[]> {
    const items: T[] = [];
    let offset: string | undefined;

    do {
      const body = await this.request<{ data: T[]; next_page?: { offset?: string } | null }>(path, {
        ...params,
        limit: PAGE_SIZE,
        offset,
      });
      items.push(...body.data);
      offset = body.next_page?.offset ?? undefined;
    } while (offset);

    return items;
  }

  /**
   * The bytes of a file Asana stores, from the short-lived `download_url` an
   * attachment carries. No Authorization header: the URL is signed already,
   * and it points at Asana's storage provider, not at Asana.
   */
  async download(url: string, maxBytes: number): Promise<{ body: Buffer; contentType: string }> {
    if (!url.startsWith('https://')) {
      throw new AsanaApiError('download', 0, 'The file address is not https.');
    }

    const response = await this.gate.run(() =>
      fetchWithTimeout(url, { method: 'GET' }, this.config.asana.timeoutMs * 4, 'Asana storage'),
    );
    if (!response.ok) {
      throw new AsanaApiError('download', response.status, 'The file could not be downloaded.');
    }

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) {
      throw new AsanaApiError('download', 413, `The file is larger than ${maxBytes} bytes.`);
    }

    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxBytes) {
      throw new AsanaApiError('download', 413, `The file is larger than ${maxBytes} bytes.`);
    }

    return { body, contentType: response.headers.get('content-type') ?? '' };
  }

  private async request<T>(path: string, params: AsanaParams): Promise<T> {
    const { accessToken, apiBaseUrl, timeoutMs } = this.config.asana;
    if (!accessToken) throw new AsanaApiError(path, 0, 'ASANA_ACCESS_TOKEN is not set.');

    const url = new URL(`${apiBaseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let rateLimited = 0;
    let failed = 0;

    for (;;) {
      let response: Response;
      try {
        response = await this.gate.run(() => {
          this.requestCount += 1;
          return fetchWithTimeout(
            url.toString(),
            {
              method: 'GET',
              headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
            },
            timeoutMs,
            'Asana',
          );
        });
      } catch (error) {
        if (failed >= MAX_SERVER_RETRIES) throw error;
        failed += 1;
        await this.wait(SERVER_RETRY_BASE_MS * 2 ** (failed - 1));
        continue;
      }

      if (response.status === 429 && rateLimited < MAX_RATE_LIMIT_RETRIES) {
        rateLimited += 1;
        const seconds = Number(response.headers.get('retry-after') ?? DEFAULT_RETRY_AFTER_S);
        const ms = (Number.isFinite(seconds) ? seconds : DEFAULT_RETRY_AFTER_S) * 1_000;
        this.logger.warn({ path, waitMs: ms }, 'Asana rate limit reached; pausing');
        await discard(response);
        this.gate.pause(ms);
        continue;
      }

      if (response.status >= 500 && failed < MAX_SERVER_RETRIES) {
        failed += 1;
        await discard(response);
        await this.wait(SERVER_RETRY_BASE_MS * 2 ** (failed - 1));
        continue;
      }

      if (!response.ok) {
        throw new AsanaApiError(path, response.status, await errorMessage(response));
      }

      return (await response.json()) as T;
    }
  }
}

/** Lets go of a body nobody will read, so its connection can be reused. */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { errors?: { message?: string }[] };
    return body.errors?.[0]?.message ?? response.statusText;
  } catch {
    return response.statusText || 'No details.';
  }
}
