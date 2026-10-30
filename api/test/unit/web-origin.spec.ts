import { AppConfigService } from '../../src/config/app-config.service';
import { EnvValidationError, parseEnv, resetEnvCache } from '../../src/config/env';
import { NotificationDispatcher } from '../../src/integrations/notifications/notification.dispatcher';
import { EmailProcessor } from '../../src/jobs/email/email.processor';
import { EmailJob } from '../../src/jobs/queue-names';
import { SecurityNotices } from '../../src/modules/auth/security-notices';

/**
 * `WEB_URL` may list several origins — the dev stack lets in both localhost
 * and staging — but a link goes to one place. Every link CoreTask builds
 * starts at the first origin, never at the whole list.
 */
describe('links when WEB_URL lists several origins', () => {
  const original = process.env['WEB_URL'];
  let config: AppConfigService;

  beforeAll(() => {
    // Assigned, not defaulted: the dev .env carries a list of its own.
    process.env['WEB_URL'] = 'https://app.coretask.org/, https://staging.coretask.org';
    resetEnvCache();
    config = new AppConfigService();
  });

  afterAll(() => {
    if (original === undefined) delete process.env['WEB_URL'];
    else process.env['WEB_URL'] = original;
    resetEnvCache();
  });

  /** Every address in a message that is not a plain link into the first origin. */
  const strayLinks = (content: string | undefined): string[] =>
    (content?.match(/https?:\/\/[^\s"'<>]+/g) ?? []).filter(
      (link) => !/^https:\/\/app\.coretask\.org(\/[^,]*)?$/.test(link),
    );

  it('admits every origin but links to the first, without its trailing slash', () => {
    expect(config.corsOrigins).toEqual([
      'https://app.coretask.org',
      'https://staging.coretask.org',
    ]);
    expect(config.webOrigin).toBe('https://app.coretask.org');
    expect(config.slack.redirectUri).toBe('https://app.coretask.org/integrations/slack/callback');
  });

  it('refuses a WEB_URL that names no origin', () => {
    expect(() => parseEnv({ ...process.env, WEB_URL: ' , / ' })).toThrow(EnvValidationError);
  });

  describe('e-mails from the queue', () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const processor = () => new EmailProcessor({ send } as never, config);
    const expiresAt = '2026-11-07T12:00:00.000Z';

    it.each([
      [
        EmailJob.INVITATION,
        {
          email: 'ada@example.com',
          token: 'invite-token',
          workspaceName: 'Acme',
          invitedByName: 'Grace',
          role: 'MEMBER',
          teamName: null,
          projectName: null,
          expiresAt,
        },
        'https://app.coretask.org/invitations/invite-token',
      ],
      [
        EmailJob.PASSWORD_RESET,
        { email: 'ada@example.com', name: 'Ada', token: 'reset-token', expiresAt },
        'https://app.coretask.org/reset-password?token=reset-token',
      ],
      [
        EmailJob.EMAIL_VERIFICATION,
        {
          userId: 'user',
          email: 'ada@example.com',
          name: 'Ada',
          token: 'verify-token',
          expiresAt,
          welcome: true,
        },
        'https://app.coretask.org/verify-email?token=verify-token',
      ],
      [
        EmailJob.EMAIL_CHANGE,
        { userId: 'user', email: 'ada@example.org', name: 'Ada', token: 'change-token', expiresAt },
        'https://app.coretask.org/confirm-email-change?token=change-token',
      ],
    ])('%s links to the first origin only', async (name, data, link) => {
      send.mockClear();
      await processor().process({ name, data } as never);

      const [message] = send.mock.calls[0] as [{ text: string; html?: string }];
      expect(message.text).toContain(link);
      expect(message.html).toContain(link);
      expect(strayLinks(message.text)).toEqual([]);
      expect(strayLinks(message.html)).toEqual([]);
    });
  });

  it('notification e-mails link to the task and to Settings at the first origin', async () => {
    const enqueueMessage = jest.fn().mockResolvedValue(undefined);
    const dispatcher = new NotificationDispatcher(
      { create: jest.fn().mockResolvedValue({ createdAt: new Date() }) } as never,
      { emitToUser: jest.fn() } as never,
      { wantsEmail: jest.fn().mockResolvedValue(true) } as never,
      {
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ email: 'ada@example.com', name: 'Ada', isServiceAccount: false }),
        },
      } as never,
      { enqueueMessage } as never,
      config,
    );

    await dispatcher.dispatch({
      userId: 'user',
      workspaceId: 'workspace',
      type: 'TASK_ASSIGNED' as never,
      title: 'You were assigned a task',
      body: 'Renew the lease',
      actionUrl: '/my-tasks?task=t-1',
    });

    const [message] = enqueueMessage.mock.calls[0] as [{ text: string; html: string }];
    expect(message.text).toContain('Open in CoreTask: https://app.coretask.org/my-tasks?task=t-1');
    expect(message.text).toContain('https://app.coretask.org/settings');
    expect(strayLinks(message.text)).toEqual([]);
    expect(strayLinks(message.html)).toEqual([]);
  });

  it('security notices link to Settings at the first origin', async () => {
    const enqueueMessage = jest.fn().mockResolvedValue(undefined);
    const notices = new SecurityNotices({} as never, { enqueueMessage } as never, config);

    await notices.send('user', {
      subject: 'Two-step verification is on',
      heading: 'Two-step verification is on',
      lines: ['You turned on two-step verification.'],
      to: { email: 'ada@example.com', name: 'Ada' },
    });

    const [message] = enqueueMessage.mock.calls[0] as [{ text: string; html: string }];
    expect(message.text).toContain('Review your account: https://app.coretask.org/settings');
    expect(strayLinks(message.text)).toEqual([]);
    expect(strayLinks(message.html)).toEqual([]);
  });
});
