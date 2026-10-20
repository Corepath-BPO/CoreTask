import { composeRuleEmail } from './rule-email';

describe('composeRuleEmail', () => {
  const request = {
    to: 'ada@example.com',
    subject: 'Lease <ending>',
    body: 'Unit 12 renews soon.\n\nCall the tenant & confirm.',
    taskId: 't-1',
    taskTitle: 'Renew <12>',
    ruleName: 'Renewal nudge',
  };

  it('writes the rule’s words, the task link and the rule’s name', () => {
    const email = composeRuleEmail(request, 'http://localhost:5173/');

    expect(email).toMatchObject({ to: 'ada@example.com', subject: 'Lease <ending>' });
    expect(email.text).toBe(
      'Unit 12 renews soon.\n\nCall the tenant & confirm.\n\nRenew <12>\nhttp://localhost:5173/my-tasks?task=t-1\n\nSent by the rule “Renewal nudge”.',
    );
  });

  it('escapes what people wrote in the HTML part', () => {
    const email = composeRuleEmail(request, 'http://localhost:5173');

    // Matched on the text and its closing tag rather than the whole opening
    // tag: the paragraph carries the layout's inline styles, and this test is
    // about escaping, not about what the shell looks like this month.
    expect(email.html).toContain('>Call the tenant &amp; confirm.</p>');
    expect(email.html).toContain('>Renew &lt;12&gt;</a>');
    expect(email.html).not.toContain('<12>');
  });

  it('renders into the branded shell', () => {
    const html = composeRuleEmail(request, 'http://localhost:5173').html ?? '';

    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('>CoreTask</td>');
    // The rule's name belongs below the card, not in the body.
    expect(html).toContain('Sent by the rule “Renewal nudge”.');
    // Every `<tr>` the shell emits has to sit inside a table — a loose row is
    // invalid markup that Outlook silently drops.
    expect(html.split('<table').length).toBe(html.split('</table>').length);
  });
});
