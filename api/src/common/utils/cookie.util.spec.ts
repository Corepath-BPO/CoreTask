import { API_PREFIX } from '@coretask/contracts';

import type { AppConfigService } from '../../config/app-config.service';

import {
  buildClearCookieOptions,
  buildRefreshCookieOptions,
  durationToMs,
  REFRESH_COOKIE_PATH,
} from './cookie.util';

function fakeConfig(overrides: Partial<AppConfigService['cookie']> = {}): AppConfigService {
  return {
    cookie: {
      domain: undefined,
      sameSite: 'lax' as const,
      secure: false,
      ...overrides,
    },
  } as AppConfigService;
}

describe('durationToMs', () => {
  it.each([
    ['15m', 900_000],
    ['30d', 2_592_000_000],
    ['1h', 3_600_000],
    ['500ms', 500],
    ['2w', 1_209_600_000],
  ])('parses %s', (input, expected) => {
    expect(durationToMs(input)).toBe(expected);
  });

  it('treats a bare number as seconds, matching jsonwebtoken', () => {
    expect(durationToMs('3600')).toBe(3_600_000);
  });

  it('tolerates surrounding whitespace', () => {
    expect(durationToMs('  15m ')).toBe(900_000);
  });

  it('throws on an unparseable value rather than silently defaulting', () => {
    expect(() => durationToMs('soon')).toThrow(/Unsupported duration format/);
    expect(() => durationToMs('')).toThrow();
  });
});

describe('refresh cookie options', () => {
  it('is scoped to the auth routes only', () => {
    expect(REFRESH_COOKIE_PATH).toBe(`${API_PREFIX}/auth`);
    expect(buildRefreshCookieOptions(fakeConfig(), 1000).path).toBe(`${API_PREFIX}/auth`);
  });

  it('is always HTTP-only so script cannot read it', () => {
    expect(buildRefreshCookieOptions(fakeConfig(), 1000).httpOnly).toBe(true);
    expect(buildClearCookieOptions(fakeConfig()).httpOnly).toBe(true);
  });

  it('carries the requested lifetime', () => {
    expect(buildRefreshCookieOptions(fakeConfig(), 60_000).maxAge).toBe(60_000);
  });

  it('omits the domain attribute when none is configured', () => {
    expect(buildRefreshCookieOptions(fakeConfig(), 1000)).not.toHaveProperty('domain');
    expect(buildRefreshCookieOptions(fakeConfig({ domain: 'coretask.app' }), 1000).domain).toBe(
      'coretask.app',
    );
  });

  it('propagates the secure and sameSite policy', () => {
    const options = buildRefreshCookieOptions(fakeConfig({ secure: true, sameSite: 'none' }), 1000);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('none');
  });

  it('clears with the same attributes it set, or the browser keeps the cookie', () => {
    const config = fakeConfig({ domain: 'coretask.app', secure: true, sameSite: 'strict' });
    const set = buildRefreshCookieOptions(config, 1000);
    const clear = buildClearCookieOptions(config);

    expect(clear.path).toBe(set.path);
    expect(clear.domain).toBe(set.domain);
    expect(clear.secure).toBe(set.secure);
    expect(clear.sameSite).toBe(set.sameSite);
  });
});
