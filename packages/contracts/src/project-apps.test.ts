import { describe, expect, it } from 'vitest';

import { appAcceptsUrl } from './project-apps.js';

describe('appAcceptsUrl', () => {
  it('takes each app’s own webhook hosts, over https only', () => {
    expect(appAcceptsUrl('SLACK', 'https://hooks.slack.com/services/T0/B0/x')).toBe(true);
    expect(appAcceptsUrl('SLACK', 'http://hooks.slack.com/services/T0/B0/x')).toBe(false);
    expect(appAcceptsUrl('SLACK', 'https://hooks.slack.com.evil.example/x')).toBe(false);
    expect(
      appAcceptsUrl('TEAMS', 'https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers'),
    ).toBe(true);
    expect(appAcceptsUrl('GOOGLE_CHAT', 'https://chat.googleapis.com/v1/spaces/AAA/messages')).toBe(
      true,
    );
    expect(appAcceptsUrl('DISCORD', 'https://discord.com/api/webhooks/1/abc')).toBe(true);
    expect(appAcceptsUrl('DISCORD', 'https://hooks.slack.com/services/x')).toBe(false);
    expect(appAcceptsUrl('DISCORD', 'not a url')).toBe(false);
  });
});
