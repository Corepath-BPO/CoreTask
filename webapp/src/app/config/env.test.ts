import { describe, expect, it } from 'vitest';

import { apiOriginFor, withOrigin } from './env';

const STAGING = 'staging.coretask.org=https://staging-api.coretask.org';

describe('apiOriginFor', () => {
  it('finds the API origin for the host the page is on', () => {
    expect(apiOriginFor('staging.coretask.org', STAGING)).toBe('https://staging-api.coretask.org');
    expect(
      apiOriginFor(
        'b.example.org',
        ` a.example.org = https://a-api.example.org , b.example.org=https://b-api.example.org`,
      ),
    ).toBe('https://b-api.example.org');
  });

  it('has none for any other host, so the built-in URL stands', () => {
    expect(apiOriginFor('localhost:5173', STAGING)).toBeNull();
    expect(apiOriginFor('staging.coretask.org', '')).toBeNull();
  });
});

describe('withOrigin', () => {
  it('moves the URL to the other origin and keeps its path', () => {
    expect(withOrigin('http://localhost:3000/api/v1', 'https://staging-api.coretask.org')).toBe(
      'https://staging-api.coretask.org/api/v1',
    );
  });

  it('leaves the URL alone without one', () => {
    expect(withOrigin('http://localhost:3000/api/v1', null)).toBe('http://localhost:3000/api/v1');
  });
});
