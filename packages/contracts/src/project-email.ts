/**
 * Email to a project — Asana's "Add tasks via email".
 *
 * Every project has an address, `<token>@<domain>`. Mail sent to it becomes a
 * task; mail sent to `<token>+<task>@<domain>` — the reply address on a task's
 * update emails — becomes a comment on that task. The token is lowercase hex
 * because mail systems are allowed to fold the case of an address.
 */

export const InboundEmailSender = {
  /** Only mail from workspace members' addresses is taken. */
  MEMBERS: 'MEMBERS',
  /** Anyone with the address; a stranger's task is credited to the inbox's owner. */
  ANYONE: 'ANYONE',
} as const;
export type InboundEmailSender = (typeof InboundEmailSender)[keyof typeof InboundEmailSender];
export const INBOUND_EMAIL_SENDERS = Object.values(InboundEmailSender);

export const INBOUND_EMAIL_SENDER_LABEL: Record<InboundEmailSender, string> = {
  MEMBERS: 'Members of this workspace',
  ANYONE: 'Anyone with the address',
};

export const InboundEmailOutcome = {
  TASK_CREATED: 'TASK_CREATED',
  COMMENTED: 'COMMENTED',
  REJECTED: 'REJECTED',
} as const;
export type InboundEmailOutcome = (typeof InboundEmailOutcome)[keyof typeof InboundEmailOutcome];

/** Random bytes behind an address; twice as many hex characters. */
export const INBOUND_TOKEN_BYTES = 10;
/** How many received messages the Emails panel lists. */
export const INBOUND_EMAIL_RECENT = 10;
/** Files kept from one message; the rest are named in the task instead. */
export const MAX_INBOUND_ATTACHMENTS = 10;
/** Characters of a message body kept in a task's description or a comment. */
export const INBOUND_EMAIL_BODY_MAX = 20_000;
/** Outside addresses one task's thread will write to. */
export const MAX_TASK_EMAIL_RECIPIENTS = 20;

const TOKEN_PATTERN = new RegExp(`^[0-9a-f]{${INBOUND_TOKEN_BYTES * 2}}$`);

/** A task's id as it rides in an address: the UUID's hex, without dashes. */
export function taskRef(taskId: string): string {
  return taskId.replace(/-/g, '').toLowerCase();
}

/** Back from {@link taskRef}; null when it is not one. */
export function taskIdFromRef(ref: string): string | null {
  const hex = ref.toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The project's address, or a task's reply address when `taskId` is given. */
export function inboundAddress(token: string, domain: string, taskId?: string): string {
  return taskId ? `${token}+${taskRef(taskId)}@${domain}` : `${token}@${domain}`;
}

/**
 * Reads one recipient against the inbound domain: the project token and,
 * from a reply address, the task. Null for any other address. A suffix that
 * names no task is ignored, so `token+anything@` still reaches the project.
 */
export function readInboundAddress(
  address: string,
  domain: string,
): { token: string; taskId: string | null } | null {
  const lower = address.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at <= 0 || lower.slice(at + 1) !== domain.trim().toLowerCase()) return null;
  const local = lower.slice(0, at);
  const plus = local.indexOf('+');
  const token = plus < 0 ? local : local.slice(0, plus);
  if (!TOKEN_PATTERN.test(token)) return null;
  return { token, taskId: plus < 0 ? null : taskIdFromRef(local.slice(plus + 1)) };
}

/**
 * Every address in a header — `"Doe, Jane" <jane@x.com>, bob@y.org` — as
 * lowercase, deduplicated, in order. Several headers may be passed at once.
 */
export function parseAddressList(...values: (string | string[] | null | undefined)[]): string[] {
  const found: string[] = [];
  for (const value of values.flat()) {
    if (!value) continue;
    for (const match of value.matchAll(
      /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[^\s<>,;:"'()[\]]+/g,
    )) {
      const address = match[0].toLowerCase();
      if (!found.includes(address)) found.push(address);
    }
  }
  return found;
}

/**
 * A reply without the message it quotes: cut at "On … wrote:", an Outlook
 * header block, "-----Original Message-----", the first quoted line, or a
 * signature delimiter. If nothing is left, the whole text is kept — someone
 * who only forwarded something still said that.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let end = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const next = lines[index + 1] ?? '';
    const trimmed = line.trim();
    const cut =
      /^On\b.{0,300}\bwrote:$/.test(trimmed) ||
      (/^On\b.{0,300}$/.test(trimmed) &&
        /^.{0,300}\bwrote:$/.test(next.trim()) &&
        trimmed !== '') ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed) ||
      (/^From:\s/.test(trimmed) &&
        lines.slice(index + 1, index + 4).some((later) => /^(Sent|Date):\s/.test(later.trim()))) ||
      trimmed.startsWith('>') ||
      line === '-- ';
    if (cut) {
      end = index;
      break;
    }
  }

  const kept = lines.slice(0, end).join('\n').trim();
  return kept || text.trim();
}
