import type { AppConfigService } from '../../config/app-config.service';

import { AsanaApiClient, AsanaApiError, RequestGate } from './asana-api.client';

const TOKEN = 'test-token-not-a-real-one';

function makeClient(overrides: Partial<AppConfigService['asana']> = {}): AsanaApiClient {
  const config = {
    asana: {
      accessToken: TOKEN,
      workspaceGid: '100',
      apiBaseUrl: 'https://asana.test/api/1.0',
      timeoutMs: 5_000,
      maxRequestsPerMinute: 1_500,
      concurrency: 4,
      enabled: true,
      ...overrides,
    },
  } as unknown as AppConfigService;
  const client = new AsanaApiClient(config);
  client.wait = jest.fn(() => Promise.resolve());
  return client;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('AsanaApiClient', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('reads every page, with the token in the header and the fields asked for', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ data: [{ gid: '1' }, { gid: '2' }], next_page: { offset: 'abc' } }),
      )
      .mockResolvedValueOnce(json({ data: [{ gid: '3' }], next_page: null }));

    const items = await makeClient().list<{ gid: string }>('/projects', {
      workspace: '100',
      archived: false,
      opt_fields: 'name',
    });

    expect(items.map((item) => item.gid)).toEqual(['1', '2', '3']);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(firstUrl);
    expect(url.pathname).toBe('/api/1.0/projects');
    expect(url.searchParams.get('opt_fields')).toBe('name');
    expect(url.searchParams.get('archived')).toBe('false');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.has('offset')).toBe(false);
    expect(firstInit.headers).toEqual(
      expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
    );
    expect(new URL(fetchMock.mock.calls[1]?.[0] as string).searchParams.get('offset')).toBe('abc');
  });

  it('only ever sends GET', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ data: [] })));
    const client = makeClient();

    await client.list('/tasks', { project: '1' });
    await client.get('/workspaces/100');

    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(init.method).toBe('GET');
    }
  });

  it('waits out a 429 for as long as Asana says, then tries again', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ errors: [{ message: 'Too many' }] }, 429, { 'retry-after': '7' }),
      )
      .mockResolvedValueOnce(json({ data: { gid: '100', name: 'Acme' } }));
    const client = makeClient();

    const workspace = await client.get<{ name: string }>('/workspaces/100');

    expect(workspace.name).toBe('Acme');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The pause is the gate's: the retry waits about Retry-After seconds.
    const waits = (client.wait as jest.Mock).mock.calls.map(([ms]) => ms as number);
    expect(Math.max(...waits)).toBeGreaterThan(6_000);
    expect(client.requestCount).toBe(2);
  });

  it('retries a server error, and gives up on a refusal with Asana’s own message', async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ data: { gid: '1' } }));
    await expect(makeClient().get('/tasks/1')).resolves.toEqual({ gid: '1' });

    fetchMock.mockResolvedValueOnce(json({ errors: [{ message: 'Not Authorized' }] }, 401));
    const failure = makeClient().get('/workspaces/100');
    await expect(failure).rejects.toBeInstanceOf(AsanaApiError);
    await expect(makeClient().get('/workspaces/100')).rejects.not.toThrow(TOKEN);
  });

  it('downloads a file without the token, and refuses one over the limit', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(Buffer.from('png-bytes'), { headers: { 'content-type': 'image/png' } }),
    );
    const client = makeClient();

    const file = await client.download('https://files.asana.test/signed?x=1', 1_000);

    expect(file.body.toString()).toBe('png-bytes');
    expect(file.contentType).toBe('image/png');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toBeUndefined();

    fetchMock.mockResolvedValueOnce(
      new Response(Buffer.alloc(10), { headers: { 'content-length': '5000' } }),
    );
    await expect(client.download('https://files.asana.test/big', 1_000)).rejects.toThrow(
      'larger than',
    );
    await expect(client.download('http://files.asana.test/plain', 1_000)).rejects.toThrow('https');
  });

  it('says plainly when no token is set', async () => {
    await expect(makeClient({ accessToken: null }).get('/users/me')).rejects.toThrow(
      'ASANA_ACCESS_TOKEN is not set.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('RequestGate', () => {
  it('never has more than its limit in flight', async () => {
    const gate = new RequestGate(2, 0, () => Promise.resolve());
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];

    const tasks = Array.from({ length: 5 }, () =>
      gate.run(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => release.push(resolve));
        inFlight -= 1;
      }),
    );

    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      release.shift()?.();
    }
    await Promise.all(tasks);
    expect(peak).toBe(2);
  });

  it('spaces starts and holds them all after a pause', async () => {
    let now = 1_000;
    const waits: number[] = [];
    const gate = new RequestGate(
      10,
      50,
      (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      () => now,
    );

    await gate.run(() => Promise.resolve());
    await gate.run(() => Promise.resolve());
    expect(waits).toEqual([50]);

    // Ten milliseconds into a two-second pause, the next start waits out the rest.
    gate.pause(2_000);
    now += 10;
    await gate.run(() => Promise.resolve());
    expect(waits.at(-1)).toBe(1_990);
  });
});
