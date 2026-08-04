import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';

import type { EmailMessage } from './email.service';

/** Refresh a little before the token actually expires, to survive clock skew. */
const EXPIRY_SKEW_SECONDS = 60;

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

/**
 * Sends mail through Microsoft Graph using the client-credentials flow.
 *
 * Implemented against `fetch` rather than `@microsoft/microsoft-graph-client`
 * plus an MSAL dependency: this needs exactly two calls — fetch a token, post a
 * message — and two SDKs to make them would be more surface area than the code
 * they replace.
 *
 * The app registration needs the **application** permission `Mail.Send` with
 * admin consent granted. Delegated `Mail.Send` will not work: there is no signed
 * in user in a background worker.
 */
@Injectable()
export class MicrosoftGraphTransport {
  private readonly logger = new Logger(MicrosoftGraphTransport.name);

  /** Cached because a token is valid for about an hour and every send needs one. */
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: AppConfigService) {}

  async send(message: EmailMessage): Promise<void> {
    const { baseUrl, fromAddress, timeoutMs } = this.config.microsoftGraph;
    const accessToken = await this.accessToken();

    // The mailbox is in the path, not the payload: Graph sends *as* the user the
    // URL names, and the app permission is what authorises acting for them.
    const url = `${baseUrl}/users/${encodeURIComponent(fromAddress as string)}/sendMail`;

    const response = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: message.html
              ? { contentType: 'HTML', content: message.html }
              : { contentType: 'Text', content: message.text },
            toRecipients: [{ emailAddress: { address: message.to } }],
          },
          // The copy is the record that it was sent, which is worth having when
          // someone insists an invitation never arrived.
          saveToSentItems: true,
        }),
      },
      timeoutMs,
    );

    if (!response.ok) {
      // A rejected token is worth discarding: the next attempt should not reuse
      // one Graph has already refused.
      if (response.status === 401) this.token = null;

      throw new Error(
        `Microsoft Graph refused the message (${response.status}): ${await safeBody(response)}`,
      );
    }

    this.logger.log({ to: message.to, subject: message.subject }, 'E-mail sent via Graph');
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now) return this.token.value;

    const { tenantId, clientId, clientSecret, timeoutMs } = this.config.microsoftGraph;
    const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId as string)}/oauth2/v2.0/token`;

    const response = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId as string,
          client_secret: clientSecret as string,
          // `.default` asks for every application permission already consented
          // to, which is how client credentials scopes work — there is no user
          // to narrow them for.
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }).toString(),
      },
      timeoutMs,
    );

    if (!response.ok) {
      throw new Error(
        `Microsoft Graph token request failed (${response.status}): ${await safeBody(response)}`,
      );
    }

    const body = (await response.json()) as TokenResponse;

    this.token = {
      value: body.access_token,
      expiresAt: now + (body.expires_in - EXPIRY_SKEW_SECONDS) * 1000,
    };

    return body.access_token;
  }

  /**
   * `fetch` has no timeout of its own, and a mail send that hangs would occupy a
   * queue worker until the process restarts.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Microsoft Graph did not respond within ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Graph error bodies are the only useful diagnostic when a send fails, but they
 * must never take the process down with a parse error on top of the original
 * failure. Truncated because they can be long and end up in logs.
 */
async function safeBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '<unreadable response body>';
  }
}
