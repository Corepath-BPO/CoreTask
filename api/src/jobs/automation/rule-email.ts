import { escapeHtml } from '../../common/utils/rich-text.util';
import { paragraph, renderEmailHtml } from '../../integrations/email/email.layout';
import type { MessageEmailJobData, RuleEmailRequest } from '../queue-names';

/**
 * A rule's email as it is sent: the rule's words, then the task they are
 * about with a link to it, then which rule wrote — so a recipient can tell an
 * automated note from a person's, and find the rule to change it.
 */
export function composeRuleEmail(request: RuleEmailRequest, webUrl: string): MessageEmailJobData {
  const link = `${webUrl.replace(/\/$/, '')}${request.path ?? `/my-tasks?task=${request.taskId}`}`;
  const footer = `Sent by the rule “${request.ruleName}”.`;
  const text = [request.body, `${request.taskTitle}\n${link}`, footer]
    .filter((part) => part.trim() !== '')
    .join('\n\n');
  const paragraphs = request.body
    .split(/\n{2,}/)
    .filter((part) => part.trim() !== '')
    .map((part) => paragraph(escapeHtml(part).replace(/\n/g, '<br>')))
    .join('');
  const html = renderEmailHtml({
    preheader: request.body.trim() || request.taskTitle,
    heading: request.subject,
    bodyHtml: paragraphs,
    cta: { label: request.taskTitle, href: link },
    footnote: escapeHtml(footer),
  });
  return { to: request.to, subject: request.subject, text, html };
}
