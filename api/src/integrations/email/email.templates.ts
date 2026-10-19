import type { EmailMessage } from './email.service';

/**
 * Plain-text-first templates.
 *
 * Deliberately not a templating engine yet — there is exactly one message. When
 * the second or third arrives, this file is the seam to swap in MJML/Handlebars.
 */
export function welcomeEmail(params: { to: string; name: string; webUrl: string }): EmailMessage {
  const firstName = params.name.split(' ')[0] ?? params.name;

  return {
    to: params.to,
    subject: 'Welcome to CoreTask',
    text: [
      `Hi ${firstName},`,
      '',
      'Your CoreTask account is ready. Create a workspace to start tracking work:',
      params.webUrl,
      '',
      '— The CoreTask team',
    ].join('\n'),
    html: [
      `<p>Hi ${escapeHtml(firstName)},</p>`,
      '<p>Your CoreTask account is ready. Create a workspace to start tracking work:</p>',
      `<p><a href="${escapeHtml(params.webUrl)}">${escapeHtml(params.webUrl)}</a></p>`,
      '<p>— The CoreTask team</p>',
    ].join(''),
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
    html: [
      `<p>${escapeHtml(params.invitedByName)} has invited you to join the <strong>${escapeHtml(params.workspaceName)}</strong> workspace on CoreTask as a ${escapeHtml(role)}${escapeHtml(onTeam)}.</p>`,
      `<p><a href="${escapeHtml(link)}">Accept the invitation</a></p>`,
      `<p>This link expires on ${escapeHtml(expires)}. If you were not expecting it, you can ignore this e-mail.</p>`,
      '<p>— The CoreTask team</p>',
    ].join(''),
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
    html: [
      `<p>Hi ${escapeHtml(firstName)},</p>`,
      '<p>Someone asked to reset the password for your CoreTask account.</p>',
      `<p><a href="${escapeHtml(link)}">Choose a new password</a></p>`,
      `<p>The link works once, until ${escapeHtml(expires)}. Setting a new password signs you out everywhere.</p>`,
      '<p>If you did not ask, ignore this e-mail — your password stays as it is.</p>',
      '<p>— The CoreTask team</p>',
    ].join(''),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
