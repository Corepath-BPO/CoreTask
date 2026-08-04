/**
 * Recipient domains that can never receive mail, and must never be attempted.
 *
 * These are reserved by RFC 2606 and RFC 6761 precisely so that examples, tests
 * and documentation have addresses that cannot collide with a real one. No MX
 * record exists for any of them, so every send is guaranteed to bounce.
 *
 * Guaranteed bounces are not harmless. Each one produces a non-delivery report
 * back to the sending mailbox, and a burst of them is exactly the signal a mail
 * provider uses to decide a tenant is compromised or sending spam — at which
 * point *real* mail starts being throttled or blocked. A test suite that
 * registers a few hundred users can generate that burst in seconds.
 *
 * This is a hard block rather than a warning: there is no legitimate reason to
 * post a message to one of these domains, so there is no case to leave open.
 */

/** Reserved TLDs — RFC 2606 §2 and RFC 6761 §6. */
const RESERVED_TLDS = ['test', 'example', 'invalid', 'localhost', 'local'] as const;

/** Second-level names reserved for documentation — RFC 2606 §3. */
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'] as const;

export function isUndeliverableAddress(address: string): boolean {
  const at = address.lastIndexOf('@');
  if (at === -1) return true;

  const domain = address.slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
  if (!domain) return true;

  if (RESERVED_DOMAINS.includes(domain as (typeof RESERVED_DOMAINS)[number])) return true;

  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return RESERVED_TLDS.includes(tld as (typeof RESERVED_TLDS)[number]);
}
