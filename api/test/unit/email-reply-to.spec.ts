import type { AppConfigService } from '../../src/config/app-config.service';
import { EmailService, type EmailMessage } from '../../src/integrations/email/email.service';
import type { MicrosoftGraphTransport } from '../../src/integrations/email/microsoft-graph.transport';

/**
 * Mail goes out as a no-reply mailbox, so MAIL_REPLY_TO decides where an answer
 * to an invitation or a password reset lands. A task's update e-mail carries
 * its own reply address, which must survive: it threads the answer back into
 * the task.
 */
function setup(replyTo: string | undefined) {
  const sent: EmailMessage[] = [];
  const config = {
    nodeEnv: 'production',
    microsoftGraph: { enabled: true, replyTo },
  } as unknown as AppConfigService;
  const graph = {
    send: jest.fn(async (message: EmailMessage) => {
      sent.push(message);
    }),
  } as unknown as MicrosoftGraphTransport;
  return { service: new EmailService(config, graph), sent };
}

const invitation: EmailMessage = {
  to: 'new.member@coretask.org',
  subject: 'You are invited to CoreTask',
  text: 'Join the workspace.',
};

describe('EmailService reply address', () => {
  it('replies to MAIL_REPLY_TO when the message names no address', async () => {
    const { service, sent } = setup('support@coretask.org');
    await service.send(invitation);
    expect(sent).toEqual([{ ...invitation, replyTo: 'support@coretask.org' }]);
  });

  it("keeps a message's own reply address", async () => {
    const { service, sent } = setup('support@coretask.org');
    const update = { ...invitation, replyTo: 'task+abc@inbound.coretask.org' };
    await service.send(update);
    expect(sent).toEqual([update]);
  });

  it('adds nothing when MAIL_REPLY_TO is not set', async () => {
    const { service, sent } = setup(undefined);
    await service.send(invitation);
    expect(sent).toEqual([invitation]);
  });
});
