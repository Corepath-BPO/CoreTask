import { normalizeGraphBaseUrl } from '../../src/config/app-config.service';

/**
 * `MICROSOFT_GRAPH_BASE_URL` is the one Graph setting where a reasonable value
 * produces a failure that only shows up at the first send — a 404, long after
 * boot. Both forms appear in Microsoft's own documentation, so both must work.
 */
describe('normalizeGraphBaseUrl', () => {
  it('appends the version when given the service root', () => {
    expect(normalizeGraphBaseUrl('https://graph.microsoft.com')).toBe(
      'https://graph.microsoft.com/v1.0',
    );
  });

  it('leaves an explicit version alone rather than doubling it', () => {
    expect(normalizeGraphBaseUrl('https://graph.microsoft.com/v1.0')).toBe(
      'https://graph.microsoft.com/v1.0',
    );
  });

  it('respects beta', () => {
    expect(normalizeGraphBaseUrl('https://graph.microsoft.com/beta')).toBe(
      'https://graph.microsoft.com/beta',
    );
  });

  it('tolerates a trailing slash in either form', () => {
    expect(normalizeGraphBaseUrl('https://graph.microsoft.com/')).toBe(
      'https://graph.microsoft.com/v1.0',
    );
    expect(normalizeGraphBaseUrl('https://graph.microsoft.com/v1.0/')).toBe(
      'https://graph.microsoft.com/v1.0',
    );
  });

  it('works against a sovereign cloud endpoint', () => {
    expect(normalizeGraphBaseUrl('https://graph.microsoft.us')).toBe(
      'https://graph.microsoft.us/v1.0',
    );
  });
});
