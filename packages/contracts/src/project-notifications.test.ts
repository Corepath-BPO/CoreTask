import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROJECT_NOTIFICATIONS,
  ProjectNotificationKind,
  readProjectNotifications,
} from './project-notifications.js';

describe('readProjectNotifications', () => {
  it('keeps known kinds once each, in a stable order', () => {
    expect(
      readProjectNotifications(['TASKS_COMPLETED', 'MESSAGES', 'MESSAGES', 'SOMETHING_ELSE']),
    ).toEqual([ProjectNotificationKind.MESSAGES, ProjectNotificationKind.TASKS_COMPLETED]);
  });

  it('reads an empty choice as none, and anything unreadable as the defaults', () => {
    expect(readProjectNotifications([])).toEqual([]);
    expect(readProjectNotifications(null)).toEqual([...DEFAULT_PROJECT_NOTIFICATIONS]);
  });
});
