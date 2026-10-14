import { escapeHtml } from '../../common/utils/rich-text.util';
import type { MessageEmailJobData, RuleEmailRequest } from '../queue-names';

/**
 * A rule's email as it is sent: the rule's words, then the task they are
 * about with a link to it, then which rule wrote — so a recipient can tell an
 * automated note from a person's, and find the rule to change it.
 */
export function composeRuleEmail(request: RuleEmailRequest, webUrl: string): MessageEmailJobData {
  const link = `${webUrl.replace(/\/$/, '')}/my-tasks?task=${request.taskId}`;
  const footer = `Sent by the rule “${request.ruleName}”.`;
  const text = [request.body, `${request.taskTitle}\n${link}`, footer]
    .filter((part) => part.trim() !== '')
    .join('\n\n');
  const paragraphs = request.body
    .split(/\n{2,}/)
    .filter((part) => part.trim() !== '')
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const html =
    `${paragraphs}` +
    `<p><a href="${escapeHtml(link)}">${escapeHtml(request.taskTitle)}</a></p>` +
    `<p style="color:#6b7280;font-size:12px">${escapeHtml(footer)}</p>`;
  return { to: request.to, subject: request.subject, text, html };
}
