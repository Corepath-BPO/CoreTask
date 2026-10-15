import {
  AutomationEventPublisher,
  automationJobId,
  derivedEventId,
} from './automation-event.publisher';

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

  it('queues each event as its own job, so publishing it again is a no-op', async () => {
    const { queue, publisher } = build();

    await publisher.publish({ ...moved, eventId: 'e-1' });

    expect(queue.add).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ jobId: 'event-e-1' }),
    );
  });

  it('gives a resumed run a job of its own — it is the same event, but not the same run', () => {
    expect(automationJobId({ eventId: 'e-1', resumeFromNodeId: 'n-1' })).toBe('event-e-1-from-n-1');
    expect(automationJobId({ eventId: 'e-1', resumeFromNodeId: 'n-1' })).not.toContain(':');
  });

  it('starts a chain at an event nothing came before, and keeps one it inherits', async () => {
    const { queue, publisher } = build();

    await publisher.publish({ ...moved, eventId: 'root' });
    await publisher.publish({ ...moved, eventId: 'hop', chainId: 'root', depth: 1 });

    const payloads = queue.add.mock.calls.map((call: unknown[]) => call[1]);
    expect(payloads).toEqual([
      expect.objectContaining({ eventId: 'root', chainId: 'root' }),
      expect.objectContaining({ eventId: 'hop', chainId: 'root' }),
    ]);
  });

  it('derives the same uuid for the same occurrence, and a different one otherwise', () => {
    const id = derivedEventId('source', 'rollup:parent');

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(derivedEventId('source', 'rollup:parent')).toBe(id);
    expect(derivedEventId('source', 'rollup:other')).not.toBe(id);
  });
});
