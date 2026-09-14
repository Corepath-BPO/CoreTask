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

  const build = (events: unknown[]) => {
    const runner = {
      handle: jest.fn().mockResolvedValue({ executed: 1, skipped: 0, events, webhooks: [] }),
    };
    const publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const processor = new AutomationProcessor(
      runner as never,
      publisher as never,
      webhooks as never,
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
    expect(result).toEqual({ executed: 1, skipped: 0, published: 2, webhooks: 0 });
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
        return { executed: 1, skipped: 0, events: [event], webhooks: [] };
      }),
    };
    const publisher = {
      publish: jest.fn(async () => {
        order.push('publish');
      }),
    };

    await new AutomationProcessor(runner as never, publisher as never, webhooks as never).process({
      data: event,
    } as never);

    expect(order).toEqual(['run', 'publish']);
  });
});
