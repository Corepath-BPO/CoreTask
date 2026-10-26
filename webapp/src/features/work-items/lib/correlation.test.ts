import { beforeEach, describe, expect, it } from 'vitest';

import { isOwnChange, nextCorrelationId, resetCorrelationIds } from './correlation';

beforeEach(() => {
  resetCorrelationIds();
});

describe('recognising your own write', () => {
  it('knows an id it just issued', () => {
    const id = nextCorrelationId();

    expect(isOwnChange(id)).toBe(true);
  });

  it('does not claim somebody else’s', () => {
    nextCorrelationId();

    expect(isOwnChange(crypto.randomUUID())).toBe(false);
  });

  it('treats a missing id as somebody else’s', () => {
    // An event without one came from a path that does not stamp them — an
    // automation, or an older client. Refetching is the safe answer.
    expect(isOwnChange(undefined)).toBe(false);
  });

  it('still recognises an id the second time it arrives', () => {
    /*
     * A create emits both `work-item:created` and the legacy `task:created`
     * with the same id. Consuming it on the first would make the second look
     * like a change from elsewhere and trigger the refetch this exists to avoid.
     */
    const id = nextCorrelationId();

    expect(isOwnChange(id)).toBe(true);
    expect(isOwnChange(id)).toBe(true);
  });

  it('forgets the oldest rather than growing without bound', () => {
    // A tab left open all week would otherwise accumulate one id per edit, and
    // ids stop being interesting the moment their broadcast has arrived.
    const first = nextCorrelationId();

    for (let index = 0; index < 64; index += 1) nextCorrelationId();

    expect(isOwnChange(first)).toBe(false);
  });

  it('issues a different id each time', () => {
    const ids = new Set(Array.from({ length: 10 }, () => nextCorrelationId()));

    expect(ids.size).toBe(10);
  });
});
