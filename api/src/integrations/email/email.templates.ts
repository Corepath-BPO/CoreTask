import { escapeHtml } from '../../common/utils/rich-text.util';

import type { EmailMessage } from './email.service';
import { paragraph, renderEmailHtml } from './email.layout';

/**
 * The transactional templates.
 *
 * Each one writes its plain-text part by hand and hands the HTML part a
 * heading, a few paragraphs and at most one call to action; `email.layout`
 * turns that into the branded shell. The text part is not a fallback nobody
 * reads — it is what a screen reader and a plain-text client get, so it carries
 * the same words and the same link.
 */
/**
 * "Confirm your e-mail address". Sent once on sign-up, where it is also the
 * welcome — one message rather than two — and again whenever the person asks
 * for a new link.
 */
export function emailVerificationEmail(params: {
  to: string;
  name: string;
  token: string;
  expiresAt: string;
  webUrl: string;
  /** True for the message sent on sign-up. */
  welcome: boolean;
}): EmailMessage {
  const firstName = params.name.split(' ')[0] ?? params.name;
  const link = `${params.webUrl.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(params.token)}`;
  const expires = new Date(params.expiresAt).toUTCString();
  const opening = params.welcome
    ? 'Your CoreTask account is ready. Confirm that this is your e-mail address:'
    : 'Confirm that this is the e-mail address for your CoreTask account:';

  return {
    to: params.to,
    subject: params.welcome
      ? 'Welcome to CoreTask — confirm your e-mail address'
      : 'Confirm your e-mail address for CoreTask',
    text: [
      `Hi ${firstName},`,
      '',
      opening,
      link,
      '',
      `The link works once, until ${expires}. If you did not sign up, ignore this e-mail.`,
      '',
      '— The CoreTask team',
    ].join('\n'),
    html: renderEmailHtml({
      preheader: params.welcome
        ? 'Confirm your address and your CoreTask account is ready.'
        : 'Confirm your e-mail address for CoreTask.',
      heading: params.welcome ? `Welcome to CoreTask, ${firstName}` : 'Confirm your e-mail address',
      bodyHtml: [
        params.welcome ? '' : paragraph(`Hi ${escapeHtml(firstName)},`),
        paragraph(escapeHtml(opening)),
      ].join(''),
      cta: { label: 'Confirm my e-mail address', href: link },
      note: `The link works once, until ${expires}. If you did not sign up, ignore this e-mail.`,
    }),
  };
}

/**
 * The invitation link points at the **web** app, not the API: the recipient
 * lands on a page that can explain who invited them and offer sign-in, rather
 * than on a JSON endpoint.
 */
export function invitationEmail(params: {
  to: string;
  token: string;
  workspaceName: string;
  invitedByName: string;
  role: string;
  teamName?: string | null;
  /** From a project's Share dialog: the project they will land in. */
  projectName?: string | null;
  expiresAt: string;
  webUrl: string;
}): EmailMessage {
  const link = `${params.webUrl.replace(/\/$/, '')}/invitations/${params.token}`;
  const expires = new Date(params.expiresAt).toUTCString();
  const role = params.role.toLowerCase();

  // Named in the message rather than only on the accept page: joining a team is
  // part of what is being offered, and somebody deciding whether to accept
  // should not have to click through to find out.
  const onTeam = params.teamName ? ` on the ${params.teamName} team` : '';

  if (params.projectName) {
    return {
      to: params.to,
      subject: `${params.invitedByName} invited you to ${params.projectName} on CoreTask`,
      text: [
        `${params.invitedByName} has invited you to the "${params.projectName}" project in the "${params.workspaceName}" workspace on CoreTask.`,
        '',
        'Accept the invitation:',
        link,
        '',
        `This link expires on ${expires}. If you were not expecting it, you can ignore this e-mail.`,
        '',
        '— The CoreTask team',
      ].join('\n'),
      html: renderEmailHtml({
        preheader: `${params.invitedByName} invited you to ${params.projectName}.`,
        heading: `${params.invitedByName} invited you to ${params.projectName}`,
        bodyHtml: paragraph(
          `You have been invited to the <strong style="color:#18181b;">${escapeHtml(params.projectName)}</strong> project in the <strong style="color:#18181b;">${escapeHtml(params.workspaceName)}</strong> workspace on CoreTask.`,
        ),
        cta: { label: 'Accept the invitation', href: link },
        note: `This link expires on ${expires}. If you were not expecting it, you can ignore this e-mail.`,
      }),
    };
  }

  return {
    to: params.to,
    subject: `${params.invitedByName} invited you to ${params.workspaceName} on CoreTask`,
    text: [
      `${params.invitedByName} has invited you to join the "${params.workspaceName}" workspace on CoreTask as a ${role}${onTeam}.`,
      '',
      'Accept the invitation:',
      link,
      '',
      `This link expires on ${expires}. If you were not expecting it, you can ignore this e-mail.`,
      '',
      '— The CoreTask team',
    ].join('\n'),
    html: renderEmailHtml({
      preheader: `${params.invitedByName} invited you to ${params.workspaceName}.`,
      heading: `${params.invitedByName} invited you to ${params.workspaceName}`,
      bodyHtml: paragraph(
        `You have been invited to join the <strong style="color:#18181b;">${escapeHtml(params.workspaceName)}</strong> workspace on CoreTask as a ${escapeHtml(role)}${escapeHtml(onTeam)}.`,
      ),
      cta: { label: 'Accept the invitation', href: link },
      note: `This link expires on ${expires}. If you were not expecting it, you can ignore this e-mail.`,
    }),
  };
}

/**
 * The "forgot password" link. Points at the web app's reset page; says how
 * long it works and what to do if the reader did not ask.
 */
export function passwordResetEmail(params: {
  to: string;
  name: string;
  token: string;
  expiresAt: string;
  webUrl: string;
}): EmailMessage {
  const firstName = params.name.split(' ')[0] ?? params.name;
  const link = `${params.webUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(params.token)}`;
  const expires = new Date(params.expiresAt).toUTCString();

  return {
    to: params.to,
    subject: 'Reset your CoreTask password',
    text: [
      `Hi ${firstName},`,
      '',
      'Someone asked to reset the password for your CoreTask account. To choose a new one:',
      link,
      '',
      `The link works once, until ${expires}. Setting a new password signs you out everywhere.`,
      'If you did not ask, ignore this e-mail — your password stays as it is.',
      '',
      '— The CoreTask team',
    ].join('\n'),
    html: renderEmailHtml({
      preheader: 'Choose a new password for your CoreTask account.',
      heading: 'Reset your password',
      bodyHtml: [
        paragraph(`Hi ${escapeHtml(firstName)},`),
        paragraph('Someone asked to reset the password for your CoreTask account.'),
      ].join(''),
      cta: { label: 'Choose a new password', href: link },
      note: `The link works once, until ${expires}. Setting a new password signs you out everywhere. If you did not ask, ignore this e-mail — your password stays as it is.`,
    }),
  };
}

/**
 * "Confirm your new address". Sent to the *new* address: the change happens
 * only when that inbox proves it is theirs. The old address hears about it
 * separately, from `securityNoticeEmail`.
 */
export function emailChangeEmail(params: {
  to: string;
  name: string;
  token: string;
  expiresAt: string;
  webUrl: string;
}): EmailMessage {
  const firstName = params.name.split(' ')[0] ?? params.name;
  const link = `${params.webUrl.replace(/\/$/, '')}/confirm-email-change?token=${encodeURIComponent(params.token)}`;
  const expires = new Date(params.expiresAt).toUTCString();

  return {
    to: params.to,
    subject: 'Confirm your new e-mail address for CoreTask',
    text: [
      `Hi ${firstName},`,
      '',
      'You asked to sign in to CoreTask with this address from now on. Confirm it:',
      link,
      '',
      `The link works once, until ${expires}. Until then your account keeps its old address.`,
      'If you did not ask, ignore this e-mail.',
      '',
      '— The CoreTask team',
    ].join('\n'),
    html: renderEmailHtml({
      preheader: 'Confirm the new address for your CoreTask account.',
      heading: 'Confirm your new e-mail address',
      bodyHtml: [
        paragraph(`Hi ${escapeHtml(firstName)},`),
        paragraph('You asked to sign in to CoreTask with this address from now on.'),
      ].join(''),
      cta: { label: 'Confirm this address', href: link },
      note: `The link works once, until ${expires}. Until then your account keeps its old address. If you did not ask, ignore this e-mail.`,
    }),
  };
}

/**
 * Something changed about how the account is protected: the address, two-step
 * verification, the account itself. Always to the address that was on the
 * account before the change, and always with what to do if it was not them.
 */
export function securityNoticeEmail(params: {
  to: string;
  name: string;
  subject: string;
  heading: string;
  /** Plain sentences; escaped here. */
  lines: string[];
  webUrl: string;
  /** Leave out when the account no longer exists to sign in to. */
  showSettingsLink?: boolean;
}): EmailMessage {
  const firstName = params.name.split(' ')[0] ?? params.name;
  const settings = `${params.webUrl.replace(/\/$/, '')}/settings`;
  const warning =
    'If this was not you, reset your password straight away and contact your workspace admin.';
  const showLink = params.showSettingsLink ?? true;

  return {
    to: params.to,
    subject: params.subject,
    text: [
      `Hi ${firstName},`,
      '',
      ...params.lines,
      '',
      ...(showLink ? [`Review your account: ${settings}`, ''] : []),
      warning,
      '',
      '— The CoreTask team',
    ].join('\n'),
    html: renderEmailHtml({
      preheader: params.lines[0] ?? params.heading,
      heading: params.heading,
      bodyHtml: [
        paragraph(`Hi ${escapeHtml(firstName)},`),
        ...params.lines.map((line) => paragraph(escapeHtml(line))),
      ].join(''),
      ...(showLink ? { cta: { label: 'Review your account', href: settings } } : {}),
      note: warning,
    }),
  };
}
