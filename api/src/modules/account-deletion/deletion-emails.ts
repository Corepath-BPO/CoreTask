import { escapeHtml } from '../../common/utils/rich-text.util';
import type { EmailMessage } from '../../integrations/email/email.service';
import { paragraph, renderEmailHtml } from '../../integrations/email/email.layout';

/**
 * To the people left in a workspace its owner deleted. Not a security notice:
 * nothing about their own account changed, so it says what happened and who
 * did it, and points them at nothing they could fix.
 */
export function workspaceDeletedEmail(params: {
  to: string;
  name: string;
  workspaceName: string;
  deletedBy: string;
  webUrl: string;
}): EmailMessage {
  const firstName = params.name.split(' ')[0] ?? params.name;
  const lines = [
    `${params.deletedBy} deleted the workspace “${params.workspaceName}”, with its projects, tasks, comments and files.`,
    'It cannot be restored. Your account and your other workspaces are as they were.',
  ];

  return {
    to: params.to,
    subject: `The workspace “${params.workspaceName}” was deleted`,
    text: [`Hi ${firstName},`, '', ...lines, '', '— The CoreTask team'].join('\n'),
    html: renderEmailHtml({
      webUrl: params.webUrl,
      preheader: lines[0] as string,
      heading: 'A workspace was deleted',
      bodyHtml: [
        paragraph(`Hi ${escapeHtml(firstName)},`),
        ...lines.map((line) => paragraph(escapeHtml(line))),
      ].join(''),
      cta: { label: 'Open CoreTask', href: params.webUrl.replace(/\/$/, '') },
    }),
  };
}
