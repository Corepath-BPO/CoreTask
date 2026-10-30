import { AutomationProcessor } from './automation.processor';

/**
 * The half of chaining that lives in the worker.
 *
 * The runner hands back the events its actions raised; this is what puts them
 * on the queue — every one, in order, and only once the run is over. Pinned
 * here because it is the one link between a rule's write and the next rule's
 * turn, and a processor that dropped the list would leave every rule working
 * alone again with nothing failing.
 */
describe('AutomationProcessor', () => {
  const event = {
    workspaceId: 'workspace',
    projectId: 'project',
    trigger: 'TASK_MOVED_TO_SECTION',
    entityType: 'TASK',
    entityId: 'task',
    correlationId: 'correlation',
    depth: 0,
  };

  const webhooks = { enqueueRuleSend: jest.fn().mockResolvedValue(undefined) };
  const emails = { enqueueMessage: jest.fn().mockResolvedValue(undefined) };
  const config = { webOrigin: 'http://localhost:5173' };

  const build = (events: unknown[]) => {
    const runner = {
      handle: jest
        .fn()
        .mockResolvedValue({ executed: 1, skipped: 0, events, webhooks: [], emails: [] }),
    };
    const publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const processor = new AutomationProcessor(
      runner as never,
      publisher as never,
      webhooks as never,
      emails as never,
      config as never,
    );

    return { runner, publisher, processor };
  };

  it('publishes every event the run raised, in order', async () => {
    const raised = [
      { ...event, depth: 1, causedByRuleId: 'rule' },
      { ...event, trigger: 'TASK_CREATED', entityId: 'subtask', depth: 1, causedByRuleId: 'rule' },
    ];
    const { runner, publisher, processor } = build(raised);

    const result = await processor.process({ data: event } as never);

    expect(runner.handle).toHaveBeenCalledWith(event);
    expect(publisher.publish.mock.calls.map(([published]) => published)).toEqual(raised);
    expect(result).toEqual({ executed: 1, skipped: 0, published: 2, webhooks: 0, emails: 0 });
  });

  it('publishes nothing when the run raised nothing', async () => {
    const { publisher, processor } = build([]);

    await processor.process({ data: event } as never);

    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('publishes only once the run has finished', async () => {
    const order: string[] = [];
    const runner = {
      handle: jest.fn(async () => {
        order.push('run');
        return { executed: 1, skipped: 0, events: [event], webhooks: [], emails: [] };
      }),
    };
    const publisher = {
      publish: jest.fn(async () => {
        order.push('publish');
      }),
    };

    await new AutomationProcessor(
      runner as never,
      publisher as never,
      webhooks as never,
      emails as never,
      config as never,
    ).process({
      data: event,
    } as never);

    expect(order).toEqual(['run', 'publish']);
  });

  it('queues a rule’s emails, composed with a link to the task', async () => {
    emails.enqueueMessage.mockClear();
    const runner = {
      handle: jest.fn().mockResolvedValue({
        executed: 1,
        skipped: 0,
        events: [],
        webhooks: [],
        emails: [
          {
            to: 'ada@example.com',
            subject: 'Renew',
            body: 'Unit 12.',
            taskId: 't-1',
            taskTitle: 'Renew the lease',
            ruleName: 'Nudge',
          },
        ],
      }),
    };
    const processor = new AutomationProcessor(
      runner as never,
      { publish: jest.fn() } as never,
      webhooks as never,
      emails as never,
      config as never,
    );

    await processor.process({ data: event } as never);

    expect(emails.enqueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ada@example.com',
        subject: 'Renew',
        text: expect.stringContaining('http://localhost:5173/my-tasks?task=t-1'),
      }),
    );
  });
});
