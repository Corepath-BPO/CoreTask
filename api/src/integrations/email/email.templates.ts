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
  expiresAt: string;
  webUrl: string;
}): EmailMessage {
  const link = `${params.webUrl.replace(/\/$/, '')}/invitations/${params.token}`;
  const expires = new Date(params.expiresAt).toUTCString();
  const role = params.role.toLowerCase();

  return {
    to: params.to,
    subject: `${params.invitedByName} invited you to ${params.workspaceName} on CoreTask`,
    text: [
      `${params.invitedByName} has invited you to join the "${params.workspaceName}" workspace on CoreTask as a ${role}.`,
      '',
      'Accept the invitation:',
      link,
      '',
      `This link expires on ${expires}. If you were not expecting it, you can ignore this e-mail.`,
      '',
      '— The CoreTask team',
    ].join('\n'),
    html: [
      `<p>${escapeHtml(params.invitedByName)} has invited you to join the <strong>${escapeHtml(params.workspaceName)}</strong> workspace on CoreTask as a ${escapeHtml(role)}.</p>`,
      `<p><a href="${escapeHtml(link)}">Accept the invitation</a></p>`,
      `<p>This link expires on ${escapeHtml(expires)}. If you were not expecting it, you can ignore this e-mail.</p>`,
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
