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

    expect(email.html).toContain('<p>Call the tenant &amp; confirm.</p>');
    expect(email.html).toContain('>Renew &lt;12&gt;</a>');
    expect(email.html).not.toContain('<12>');
  });
});
