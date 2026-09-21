import {
  AUTOMATION_TRIGGERS,
  SUBSCRIBABLE_WEBHOOK_EVENTS,
  UNMAPPED_WEBHOOK_TRIGGERS,
  WEBHOOK_EVENT_GROUPS,
  WEBHOOK_EVENT_LABEL,
  WEBHOOK_EVENT_TYPES,
  WebhookEventType,
  webhookEventTypeFor,
  type AutomationTrigger,
} from '@coretask/contracts';

describe('webhook event mapping', () => {
  /**
   * A trigger that is neither mapped nor listed as deliberately unmapped is a
   * webhook nobody decided about — the quietest way to lose an event.
   */
  it('accounts for every automation trigger, one way or the other', () => {
    const unmapped = new Set<string>(UNMAPPED_WEBHOOK_TRIGGERS);

    for (const trigger of AUTOMATION_TRIGGERS) {
      const mapped = (['TASK', 'TICKET', 'COMMENT'] as const).some(
        (entity) => webhookEventTypeFor(trigger as AutomationTrigger, entity) !== null,
      );

      expect(mapped || unmapped.has(trigger)).toBe(true);
      expect(mapped && unmapped.has(trigger)).toBe(false);
    }
  });

  it('maps by trigger and entity together', () => {
    expect(webhookEventTypeFor('TASK_MOVED_TO_SECTION', 'TASK')).toEqual(
      WebhookEventType.TASK_MOVED,
    );
    // A ticket moved through the work-items route is not a task move.
    expect(webhookEventTypeFor('TASK_MOVED_TO_SECTION', 'TICKET')).toBeNull();
    expect(webhookEventTypeFor('COMMENT_ADDED', 'COMMENT')).toEqual(
      WebhookEventType.COMMENT_CREATED,
    );
    expect(webhookEventTypeFor('TASK_STATUS_CHANGED', 'TASK')).toBeNull();
  });

  it('labels every event type and groups every subscribable one exactly once', () => {
    for (const type of WEBHOOK_EVENT_TYPES) {
      expect(WEBHOOK_EVENT_LABEL[type]).toBeTruthy();
    }

    const grouped = WEBHOOK_EVENT_GROUPS.flatMap((group) => group.events);
    expect([...grouped].sort()).toEqual([...SUBSCRIBABLE_WEBHOOK_EVENTS].sort());
    expect(new Set(grouped).size).toEqual(grouped.length);

    // Sent regardless of subscription, so not offered as one.
    expect(SUBSCRIBABLE_WEBHOOK_EVENTS).not.toContain(WebhookEventType.PING);
    expect(SUBSCRIBABLE_WEBHOOK_EVENTS).not.toContain(WebhookEventType.AUTOMATION_WEBHOOK);
  });
});
