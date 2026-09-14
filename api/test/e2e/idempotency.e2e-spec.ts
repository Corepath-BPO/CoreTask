import { randomUUID } from 'node:crypto';

import { API_PREFIX } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * `Idempotency-Key` on the create routes a machine caller retries.
 *
 * The store is Redis, shared with the queues, so the app under test talks to
 * the real thing; keys and callers are fresh per test so nothing bleeds
 * between runs.
 */
describe('Idempotent creates (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });

  beforeEach(async () => {
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;

  interface Scope {
    token: string;
    workspaceId: string;
    projectId: string;
    sectionId: string;
  }

  const register = async (): Promise<string> => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name: 'Caller', email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    return response.body.data.accessToken as string;
  };

  const setupScope = async (): Promise<Scope> => {
    const token = await register();
    const auth = { Authorization: `Bearer ${token}` };

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(auth)
      .send({ name: 'Platform' })
      .expect(201);

    return {
      token,
      workspaceId,
      projectId: project.body.data.id as string,
      sectionId: project.body.data.sections[0].id as string,
    };
  };

  const tasksUrl = (scope: Scope) => url(`/workspaces/${scope.workspaceId}/tasks`);

  const createTask = (
    scope: Scope,
    token: string,
    key: string | null,
    body: Record<string, unknown>,
  ) => {
    const req = request(server()).post(tasksUrl(scope)).set('Authorization', `Bearer ${token}`);
    return key ? req.set('Idempotency-Key', key).send(body) : req.send(body);
  };

  const taskCount = (scope: Scope) =>
    context.prisma.task.count({ where: { workspaceId: scope.workspaceId } });

  it('replays the first answer for a repeated key and creates nothing twice', async () => {
    const scope = await setupScope();
    const key = randomUUID();
    const body = { title: 'Filed once', sectionId: scope.sectionId };

    const first = await createTask(scope, scope.token, key, body).expect(201);
    expect(first.headers['idempotency-replayed']).toBeUndefined();

    const second = await createTask(scope, scope.token, key, body).expect(201);
    expect(second.headers['idempotency-replayed']).toEqual('true');
    expect(second.body).toEqual(first.body);

    expect(await taskCount(scope)).toEqual(1);
  });

  it('refuses the same key with a different request', async () => {
    const scope = await setupScope();
    const key = randomUUID();

    await createTask(scope, scope.token, key, { title: 'One', sectionId: scope.sectionId }).expect(
      201,
    );
    const reused = await createTask(scope, scope.token, key, {
      title: 'Two',
      sectionId: scope.sectionId,
    }).expect(422);

    expect(reused.body.error.code).toEqual('IDEMPOTENCY_KEY_REUSED');
    expect(await taskCount(scope)).toEqual(1);
  });

  it('keys belong to the caller, and a request without one is never deduplicated', async () => {
    const scope = await setupScope();
    const key = randomUUID();
    const body = { title: 'Same key, other person', sectionId: scope.sectionId };

    // A second member of the same workspace.
    const otherToken = await register();
    const me = await request(server())
      .get(url('/auth/me'))
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: me.body.data.id as string, role: 'MEMBER' },
    });

    await createTask(scope, scope.token, key, body).expect(201);
    const theirs = await createTask(scope, otherToken, key, body).expect(201);
    expect(theirs.headers['idempotency-replayed']).toBeUndefined();

    await createTask(scope, scope.token, null, body).expect(201);
    await createTask(scope, scope.token, null, body).expect(201);

    expect(await taskCount(scope)).toEqual(4);
  });

  it('does not remember a request that failed, so the retry runs for real', async () => {
    const scope = await setupScope();
    const key = randomUUID();

    // No title: refused by validation, after the key was claimed.
    await createTask(scope, scope.token, key, { sectionId: scope.sectionId }).expect(422);

    const retried = await createTask(scope, scope.token, key, {
      title: 'Fixed',
      sectionId: scope.sectionId,
    }).expect(201);
    expect(retried.headers['idempotency-replayed']).toBeUndefined();
    expect(await taskCount(scope)).toEqual(1);
  });

  it('covers comments as well', async () => {
    const scope = await setupScope();
    const task = await createTask(scope, scope.token, null, {
      title: 'Discussed',
      sectionId: scope.sectionId,
    }).expect(201);
    const commentsUrl = url(`/workspaces/${scope.workspaceId}/tasks/${task.body.data.id}/comments`);
    const key = randomUUID();

    const first = await request(server())
      .post(commentsUrl)
      .set('Authorization', `Bearer ${scope.token}`)
      .set('Idempotency-Key', key)
      .send({ body: 'Only once, please.' })
      .expect(201);
    const second = await request(server())
      .post(commentsUrl)
      .set('Authorization', `Bearer ${scope.token}`)
      .set('Idempotency-Key', key)
      .send({ body: 'Only once, please.' })
      .expect(201);

    expect(second.body.data.id).toEqual(first.body.data.id);
    expect(await context.prisma.comment.count()).toEqual(1);
  });

  it('caps the key length', async () => {
    const scope = await setupScope();

    const refused = await createTask(scope, scope.token, 'k'.repeat(256), {
      title: 'Too long',
      sectionId: scope.sectionId,
    }).expect(422);
    expect(refused.body.error.message).toMatch(/at most 255/);
    expect(await taskCount(scope)).toEqual(0);
  });
});
