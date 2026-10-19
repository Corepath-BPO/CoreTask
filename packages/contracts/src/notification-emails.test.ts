import { describe, expect, it } from 'vitest';

import { emailGroupOf, readEmailGroups } from './notification-emails.js';

describe('notification emails', () => {
  it('groups notification types the way people choose them', () => {
    expect(emailGroupOf('TASK_ASSIGNED')).toBe('ASSIGNED');
    expect(emailGroupOf('TICKET_ASSIGNED')).toBe('ASSIGNED');
    expect(emailGroupOf('FIELD_CHANGED')).toBe('TASK_CHANGES');
    expect(emailGroupOf('WORKSPACE_INVITE')).toBeNull();
  });

  it('defaults to assignments and mentions, and keeps only known groups', () => {
    expect(readEmailGroups(null)).toEqual(['ASSIGNED', 'MENTIONED']);
    expect(readEmailGroups(['COMMENTS', 'NOPE', 'COMMENTS'])).toEqual(['COMMENTS']);
    expect(readEmailGroups([])).toEqual([]);
  });
});
