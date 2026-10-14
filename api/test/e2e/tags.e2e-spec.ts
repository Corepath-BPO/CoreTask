import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** Tags: workspace labels, on tasks, in views, in search. */
describe('Tags (e2e)', () => {
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

  const register = async (name: string) => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    return {
      auth: { Authorization: `Bearer ${response.body.data.accessToken as string}` },
      userId: response.body.data.user.id as string,
    };
  };

  it('labels tasks, and filters and searches by label', async () => {
    const owner = await register('Ada Owner');
    const member = await register('Bea Member');
    const guest = await register('Gus Guest');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(owner.auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
        { workspaceId, userId: guest.userId, role: WorkspaceRole.GUEST },
      ],
    });
    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(owner.auth)
      .send({ name: 'Maintenance' })
      .expect(201);
    const projectId = project.body.data.id as string;
    const tags = url(`/workspaces/${workspaceId}/tags`);
    const task = async (title: string) =>
      (
        await request(server())
          .post(url(`/workspaces/${workspaceId}/tasks`))
          .set(owner.auth)
          .send({ title, projectId })
          .expect(201)
      ).body.data.id as string;
    const leak = await task('Leak under the sink');
    const bulb = await task('Replace the bulb');
    const onTask = (taskId: string) => url(`/workspaces/${workspaceId}/tasks/${taskId}/tags`);

    // Made by a member, unique whatever the case, never by a guest.
    const urgent = await request(server())
      .post(tags)
      .set(member.auth)
      .send({ name: '  Urgent  ' })
      .expect(201);
    expect(urgent.body.data).toMatchObject({ name: 'Urgent', taskCount: 0 });
    expect(urgent.body.data.color).toEqual(expect.any(String));
    const urgentId = urgent.body.data.id as string;
    await request(server()).post(tags).set(owner.auth).send({ name: 'urgent' }).expect(409);
    await request(server()).post(tags).set(guest.auth).send({ name: 'Mine' }).expect(403);

    // On a task by id, or by a new name, which makes the tag; twice is once.
    await request(server())
      .post(onTask(leak))
      .set(member.auth)
      .send({ tagId: urgentId })
      .expect(201);
    const tagged = await request(server())
      .post(onTask(leak))
      .set(member.auth)
      .send({ name: 'Plumbing' })
      .expect(201);
    expect(tagged.body.data.map((tag: { name: string }) => tag.name)).toEqual([
      'Plumbing',
      'Urgent',
    ]);
    await request(server())
      .post(onTask(leak))
      .set(member.auth)
      .send({ tagId: urgentId })
      .expect(201);
    await request(server())
      .post(onTask(leak))
      .set(guest.auth)
      .send({ tagId: urgentId })
      .expect(403);

    const detail = await request(server())
      .get(url(`/workspaces/${workspaceId}/tasks/${leak}`))
      .set(owner.auth)
      .expect(200);
    expect(detail.body.data.tags).toHaveLength(2);

    // The List filters on them, and its rows carry them; they do not sort.
    const items = url(`/workspaces/${workspaceId}/projects/${projectId}/work-items`);
    const titles = async (filters: unknown[]) =>
      (
        await request(server())
          .get(items)
          .set(owner.auth)
          .query({ filters: JSON.stringify(filters) })
          .expect(200)
      ).body.data.items.map((item: { title: string }) => item.title);
    expect(await titles([{ field: 'tags', operator: 'IN', value: [urgentId] }])).toEqual([
      'Leak under the sink',
    ]);
    expect(await titles([{ field: 'tags', operator: 'NOT_IN', value: [urgentId] }])).toEqual([
      'Replace the bulb',
    ]);
    expect(await titles([{ field: 'tags', operator: 'IS_EMPTY' }])).toEqual(['Replace the bulb']);
    const rows = await request(server()).get(items).set(owner.auth).expect(200);
    const leakRow = rows.body.data.items.find((item: { id: string }) => item.id === leak);
    expect(leakRow.tags.map((tag: { name: string }) => tag.name)).toEqual(['Plumbing', 'Urgent']);
    await request(server())
      .get(items)
      .set(owner.auth)
      .query({ sorts: JSON.stringify([{ field: 'tags', direction: 'ASC' }]) })
      .expect(400);

    const metadata = await request(server())
      .get(url(`/workspaces/${workspaceId}/projects/${projectId}/field-metadata`))
      .set(owner.auth)
      .expect(200);
    expect(metadata.body.data.tags.map((tag: { name: string }) => tag.name)).toEqual([
      'Plumbing',
      'Urgent',
    ]);

    const found = await request(server())
      .post(url(`/workspaces/${workspaceId}/search/tasks`))
      .set(owner.auth)
      .send({ filters: { tagIds: [urgentId] } })
      .expect(200);
    expect(found.body.data.items.map((item: { id: string }) => item.id)).toEqual([leak]);

    // Renamed and recoloured by anyone who edits; a clash is refused.
    await request(server())
      .patch(`${tags}/${urgentId}`)
      .set(owner.auth)
      .send({ name: 'Plumbing' })
      .expect(409);
    const renamed = await request(server())
      .patch(`${tags}/${urgentId}`)
      .set(owner.auth)
      .send({ name: 'Urgent!', color: 'red' })
      .expect(200);
    expect(renamed.body.data).toMatchObject({ name: 'Urgent!', color: 'red', taskCount: 1 });

    // Off one task; deleted by its maker or a manager only.
    const left = await request(server())
      .delete(`${onTask(leak)}/${urgentId}`)
      .set(owner.auth)
      .expect(200);
    expect(left.body.data.map((tag: { name: string }) => tag.name)).toEqual(['Plumbing']);
    await request(server())
      .post(onTask(bulb))
      .set(owner.auth)
      .send({ tagId: urgentId })
      .expect(201);
    const plumbing = (await request(server()).get(tags).set(guest.auth).expect(200)).body.data.find(
      (tag: { name: string }) => tag.name === 'Plumbing',
    );
    await request(server()).delete(`${tags}/${urgentId}`).set(guest.auth).expect(403);
    await request(server()).delete(`${tags}/${urgentId}`).set(member.auth).expect(204);
    await request(server())
      .delete(`${tags}/${plumbing.id as string}`)
      .set(owner.auth)
      .expect(204);
    const bulbDetail = await request(server())
      .get(url(`/workspaces/${workspaceId}/tasks/${bulb}`))
      .set(owner.auth)
      .expect(200);
    expect(bulbDetail.body.data.tags).toEqual([]);
  });
});
