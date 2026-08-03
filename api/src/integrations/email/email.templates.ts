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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
