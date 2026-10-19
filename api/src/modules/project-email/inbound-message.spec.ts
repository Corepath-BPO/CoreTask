import { normalizeInbound } from './inbound-message';

describe('normalizeInbound', () => {
  it('reads the plain shape', () => {
    const message = normalizeInbound({
      from: 'Ada Owner <Ada@Example.org>',
      to: 'abc@in.example.org',
      cc: 'bea@example.org, "Cy" <cy@example.org>',
      subject: '  Leak in 4B ',
      text: 'Under the sink.',
      messageId: '<m1@example.org>',
      attachments: [{ filename: 'leak.png', contentType: 'image/png', content: 'aGk=' }],
    });
    expect(message).toMatchObject({
      from: 'ada@example.org',
      to: ['abc@in.example.org'],
      cc: ['bea@example.org', 'cy@example.org'],
      recipients: ['abc@in.example.org', 'bea@example.org', 'cy@example.org'],
      subject: 'Leak in 4B',
      text: 'Under the sink.',
      messageId: '<m1@example.org>',
    });
    expect(message.attachments[0]).toMatchObject({ filename: 'leak.png', mimeType: 'image/png' });
    expect(message.attachments[0]?.content.toString()).toBe('hi');
  });

  it('reads Postmark, with the original Message-ID from its headers', () => {
    const message = normalizeInbound({
      From: 'ada@example.org',
      FromFull: { Email: 'ada@example.org' },
      To: 'abc@in.example.org',
      OriginalRecipient: 'abc+urgent@in.example.org',
      Subject: 'Hello',
      HtmlBody: '<p>First</p><p>Second</p>',
      MessageID: 'postmark-own-id',
      Headers: [{ Name: 'Message-ID', Value: '<m2@example.org>' }],
      Attachments: [{ Name: 'a.txt', ContentType: 'text/plain', Content: 'aGk=' }],
    });
    expect(message.recipients).toContain('abc+urgent@in.example.org');
    expect(message.text).toContain('First');
    expect(message.messageId).toBe('<m2@example.org>');
    expect(message.attachments).toHaveLength(1);
  });

  it('reads SendGrid and Mailgun form fields and their files', () => {
    const sendgrid = normalizeInbound(
      {
        from: 'Ada <ada@example.org>',
        to: 'Team <abc@in.example.org>',
        subject: 'Form',
        text: 'Body',
        envelope: JSON.stringify({ to: ['abc@in.example.org', 'bcc@in.example.org'] }),
        headers: 'Received: x\nMessage-ID: <m3@example.org>\nSubject: Form',
      },
      [
        {
          fieldname: 'attachment1',
          originalname: 'b.pdf',
          mimetype: 'application/pdf',
          buffer: Buffer.from('x'),
        },
      ],
    );
    expect(sendgrid.recipients).toEqual(['abc@in.example.org', 'bcc@in.example.org']);
    expect(sendgrid.messageId).toBe('<m3@example.org>');
    expect(sendgrid.attachments[0]?.filename).toBe('b.pdf');

    const mailgun = normalizeInbound({
      sender: 'ada@example.org',
      recipient: 'abc@in.example.org',
      subject: 'Mailgun',
      'body-plain': 'Plain',
      'Message-Id': '<m4@example.org>',
    });
    expect(mailgun).toMatchObject({
      from: 'ada@example.org',
      text: 'Plain',
      messageId: '<m4@example.org>',
    });
  });
});
