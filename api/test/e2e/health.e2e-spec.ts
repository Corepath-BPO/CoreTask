import { API_DOCS_PATH, API_PREFIX, REQUEST_ID_HEADER } from '@coretask/contracts';
import request from 'supertest';

import { closeTestContext, createTestContext, type TestContext } from './test-app';

describe('Health (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });

  afterAll(async () => {
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();

  it('GET /api/v1/health reports every dependency as connected', async () => {
    const response = await request(server()).get(`${API_PREFIX}/health`).expect(200);

    expect(response.body).toMatchObject({
      success: true,
      meta: null,
      data: {
        status: 'ok',
        database: 'connected',
        redis: 'connected',
      },
    });
    expect(typeof response.body.data.uptimeSeconds).toBe('number');
    expect(typeof response.body.data.version).toBe('string');
  });

  it('is reachable without authentication', async () => {
    await request(server())
      .get(`${API_PREFIX}/health`)
      .set('Authorization', 'Bearer definitely-not-a-token')
      .expect(200);
  });

  it('echoes a caller-supplied correlation id', async () => {
    const response = await request(server())
      .get(`${API_PREFIX}/health`)
      .set(REQUEST_ID_HEADER, 'trace-me-123')
      .expect(200);

    expect(response.headers[REQUEST_ID_HEADER]).toBe('trace-me-123');
  });

  it('generates a correlation id when none is supplied', async () => {
    const response = await request(server()).get(`${API_PREFIX}/health`).expect(200);
    expect(response.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('serves the OpenAPI document with the documented routes', async () => {
    const response = await request(server()).get(`${API_DOCS_PATH}-json`).expect(200);

    // Paths carry the global prefix, so the declared server must be the bare
    // origin — otherwise Swagger UI would request /api/v1/api/v1/...
    expect(response.body.servers.map((s: { url: string }) => s.url)).not.toContain(
      expect.stringContaining(`${API_PREFIX}${API_PREFIX}`),
    );

    expect(Object.keys(response.body.paths)).toEqual(
      expect.arrayContaining([
        `${API_PREFIX}/auth/register`,
        `${API_PREFIX}/auth/login`,
        `${API_PREFIX}/auth/refresh`,
        `${API_PREFIX}/auth/logout`,
        `${API_PREFIX}/auth/me`,
        `${API_PREFIX}/workspaces`,
        `${API_PREFIX}/workspaces/{workspaceId}`,
        `${API_PREFIX}/health`,
      ]),
    );
  });

  it('declares the API origin without duplicating the version prefix', async () => {
    const response = await request(server()).get(`${API_DOCS_PATH}-json`).expect(200);
    const servers: { url: string }[] = response.body.servers;

    expect(servers.length).toBeGreaterThan(0);
    for (const server of servers) {
      expect(server.url.endsWith(API_PREFIX)).toBe(false);
    }
  });

  it('renders an unknown route with the standard error envelope', async () => {
    const response = await request(server()).get(`${API_PREFIX}/nope`).expect(404);

    expect(response.body).toEqual({
      success: false,
      error: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
    });
  });
});
