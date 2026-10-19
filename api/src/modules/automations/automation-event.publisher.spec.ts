import { AutomationEventPublisher } from './automation-event.publisher';

describe('AutomationEventPublisher', () => {
  const build = () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const webhooks = { enqueueFanOut: jest.fn().mockResolvedValue(undefined) };
    return {
      queue,
      webhooks,
      publisher: new AutomationEventPublisher(queue as never, webhooks as never),
    };
  };

  const moved = {
    workspaceId: 'ws',
    projectId: 'p',
    trigger: 'TASK_MOVED_TO_SECTION' as const,
    entityType: 'TASK' as const,
    entityId: 't',
  };

  it('queues the event for rules and tells the webhooks about it', async () => {
    const { queue, webhooks, publisher } = build();

    await publisher.publish(moved);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(webhooks.enqueueFanOut).toHaveBeenCalledTimes(1);
  });

  it('sends no webhooks for a run resuming after a Wait step — it is the same event, later', async () => {
    const { queue, webhooks, publisher } = build();

    await publisher.publish({ ...moved, ruleId: 'r', resumeFromNodeId: 'n' });

    expect(queue.add).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resumeFromNodeId: 'n', ruleId: 'r' }),
      expect.anything(),
    );
    expect(webhooks.enqueueFanOut).not.toHaveBeenCalled();
  });
});
