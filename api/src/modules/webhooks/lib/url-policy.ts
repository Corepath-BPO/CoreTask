import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { AppException } from '../../../common/exceptions/app.exception';

export interface UrlPolicyOptions {
  /** Permit localhost and private ranges — a developer's n8n on the same laptop. */
  allowPrivate: boolean;
}

const BLOCKED_HOST_SUFFIXES = ['localhost', '.localhost', '.local', '.internal'];

/**
 * Whether an address is one CoreTask must not be talked into calling: loopback,
 * link-local, private ranges, multicast, "this host". Covers the IPv4-mapped
 * IPv6 form too, since `::ffff:127.0.0.1` is still loopback.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);

  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return false;
}

function isPrivateIpv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number) as [number, number, number, number];

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();

  if (lower === '::' || lower === '::1') return true;

  // IPv4-mapped, in either spelling: `::ffff:10.0.0.1` as typed, or
  // `::ffff:a00:1` as the URL parser normalises it.
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return isPrivateIpv4(dotted[1] as string);

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const high = parseInt(hex[1] as string, 16);
    const low = parseInt(hex[2] as string, 16);
    return isPrivateIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }

  // fc00::/7 (unique local) and fe80::/10 (link-local).
  return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

function hostIsBlocked(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return BLOCKED_HOST_SUFFIXES.some(
    (suffix) => lower === suffix || (suffix.startsWith('.') && lower.endsWith(suffix)),
  );
}

/**
 * Checks a URL an admin typed. Throws the 422 the settings form shows.
 *
 * Syntax first, then the address policy — an address that fails the policy is
 * a deliberate refusal, so its message says so rather than "invalid URL".
 */
export function assertDeliverableUrl(raw: string, options: UrlPolicyOptions): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw AppException.unprocessable(
      'WEBHOOK_URL_NOT_ALLOWED',
      'Enter a full URL, starting with https:// or http://.',
    );
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw AppException.unprocessable(
      'WEBHOOK_URL_NOT_ALLOWED',
      'Webhooks are sent over https:// or http:// only.',
    );
  }
  if (url.username || url.password) {
    throw AppException.unprocessable(
      'WEBHOOK_URL_NOT_ALLOWED',
      'Do not put credentials in the URL; use the signing secret instead.',
    );
  }

  if (!options.allowPrivate) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (hostIsBlocked(hostname) || isPrivateAddress(hostname)) {
      throw AppException.unprocessable(
        'WEBHOOK_URL_NOT_ALLOWED',
        'Local and private network addresses are not allowed here. Use a public URL, or ask an administrator to enable private addresses for this deployment.',
      );
    }
  }

  return url;
}

/**
 * The delivery-time check: the hostname passed when it was saved, but DNS may
 * answer differently now. Resolves it and refuses if any answer is private.
 * Plain `Error`, not an `AppException` — nobody is holding an HTTP request.
 */
export async function assertResolvesToAllowedAddress(
  url: URL,
  options: UrlPolicyOptions,
): Promise<void> {
  if (options.allowPrivate) return;

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('The endpoint resolves to a private address.');
    return;
  }

  const answers = await lookup(hostname, { all: true });
  if (answers.some((answer) => isPrivateAddress(answer.address))) {
    throw new Error('The endpoint resolves to a private address.');
  }
}
