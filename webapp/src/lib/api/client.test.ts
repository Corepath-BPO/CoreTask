import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  apiClient,
  getAccessToken,
  http,
  setAccessToken,
  setUnauthenticatedHandler,
} from './client';

/** A rejection shaped the way Axios reports an error status from the API. */
function httpError(status: number, code: string, config: InternalAxiosRequestConfig): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    config,
    null,
    {
      status,
      statusText: '',
      headers: {},
      config,
      data: { success: false, error: { code, message: code } },
    },
  );
}

const REFRESH_CONFIG = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;

const originalAdapter = http.defaults.adapter;

/**
 * A refresh that fails without the API refusing it says nothing about the
 * session. Dropping the token there sent the next request out with none, and
 * its UNAUTHORIZED signed the user out over a blip.
 */
describe('apiClient refresh on an expired access token', () => {
  const onUnauthenticated = vi.fn();

  beforeEach(() => {
    setAccessToken('expired-token');
    setUnauthenticatedHandler(onUnauthenticated);
    // Every request answers the way the API does once the access token has
    // expired, which sends the client off to refresh.
    http.defaults.adapter = (config) =>
      Promise.reject(httpError(401, 'ACCESS_TOKEN_EXPIRED', config));
  });

  afterEach(() => {
    http.defaults.adapter = originalAdapter;
    setUnauthenticatedHandler(null);
    setAccessToken(null);
  });

  it.each([
    ['a network error', new AxiosError('Network Error', AxiosError.ERR_NETWORK)],
    ['a 503', httpError(503, 'SERVICE_UNAVAILABLE', REFRESH_CONFIG)],
  ])('keeps the token after %s, so the next request refreshes again', async (_, failure) => {
    const post = vi.spyOn(axios, 'post').mockRejectedValue(failure);

    await expect(apiClient.get('/tasks')).rejects.toMatchObject({ code: 'ACCESS_TOKEN_EXPIRED' });
    expect(getAccessToken()).toBe('expired-token');

    await expect(apiClient.get('/tasks')).rejects.toMatchObject({ code: 'ACCESS_TOKEN_EXPIRED' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('drops the token once the API refuses the refresh', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(
      httpError(401, 'REFRESH_TOKEN_INVALID', REFRESH_CONFIG),
    );

    await expect(apiClient.get('/tasks')).rejects.toMatchObject({ code: 'ACCESS_TOKEN_EXPIRED' });
    expect(getAccessToken()).toBeNull();
  });
});
