import { API_PREFIX, ProjectMemberRole, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Subtasks under a ticket. They are tasks with a ticket for a parent: in the
 * ticket's project, in no section, listed under the ticket rather than as
 * rows of their own, and moving with it.
 */
describe('Ticket subtasks (e2e)', () => {
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

  interface Actor {
    token: string;
    userId: string;
  }

  const registerUser = async (name: string): Promise<Actor> => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  };
  const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

  const setup = async () => {
    const owner = await registerUser('Olive Owner');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(as(owner))
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    const project = async (name: string, body: object = {}) =>
      (
        await request(server())
          .post(url(`/workspaces/${workspaceId}/projects`))
          .set(as(owner))
          .send({ name, ...body })
          .expect(201)
      ).body.data.id as string;
    const projectId = await project('Support');
    const ticket = await request(server())
      .post(url(`/workspaces/${workspaceId}/tickets`))
      .set(as(owner))
      .send({ title: 'Login page is down', projectId })
      .expect(201);
    return {
      owner,
      workspaceId,
      projectId,
      project,
      ticketId: ticket.body.data.id as string,
      ticketKey: ticket.body.data.key as string,
    };
  };

  const addSubtask = (scope: { owner: Actor; workspaceId: string }, body: object) =>
    request(server())
      .post(url(`/workspaces/${scope.workspaceId}/tasks`))
      .set(as(scope.owner))
      .send(body);

  it('adds a subtask in the ticket’s project, in no section, and lists it under the ticket', async () => {
    const scope = await setup();

    const created = await addSubtask(scope, {
      title: 'Check the load balancer',
      parentTicketId: scope.ticketId,
      // Ignored: a ticket's subtask goes where the ticket is.
      projectId: await scope.project('Elsewhere'),
    }).expect(201);
    expect(created.body.data).toMatchObject({
      parentTicketId: scope.ticketId,
      parentTaskId: null,
      projectId: scope.projectId,
      sectionId: null,
    });

    // The List's expander, and the ticket panel, read it from here.
    const listed = await request(server())
      .get(
        url(
          `/workspaces/${scope.workspaceId}/projects/${scope.projectId}/tasks/${scope.ticketId}/subtasks`,
        ),
      )
      .set(as(scope.owner))
      .expect(200);
    expect(listed.body.data.map((row: { title: string }) => row.title)).toEqual([
      'Check the load balancer',
    ]);

    // A line under the ticket, not a row of the project's own.
    const rows = await request(server())
      .get(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/work-items`))
      .set(as(scope.owner))
      .expect(200);
    const items = rows.body.data.items as { id: string; subtaskCount: number }[];
    expect(items.map((item) => item.id)).toEqual([scope.ticketId]);
    expect(items[0]).toMatchObject({ subtaskCount: 1, completedSubtaskCount: 0 });

    // The subtask links back to its ticket.
    const detail = await request(server())
      .get(url(`/workspaces/${scope.workspaceId}/tasks/${created.body.data.id}`))
      .set(as(scope.owner))
      .expect(200);
    expect(detail.body.data.parentTicket).toEqual({
      id: scope.ticketId,
      key: scope.ticketKey,
      title: 'Login page is down',
    });
  });

  it('keeps its own order, and counts the finished ones', async () => {
    const scope = await setup();
    const first = await addSubtask(scope, { title: 'One', parentTicketId: scope.ticketId });
    await addSubtask(scope, { title: 'Two', parentTicketId: scope.ticketId }).expect(201);
    await request(server())
      .patch(url(`/workspaces/${scope.workspaceId}/tasks/${first.body.data.id}`))
      .set(as(scope.owner))
      .send({ status: 'DONE' })
      .expect(200);

    const listed = await request(server())
      .get(
        url(
          `/workspaces/${scope.workspaceId}/projects/${scope.projectId}/tasks/${scope.ticketId}/subtasks`,
        ),
      )
      .set(as(scope.owner))
      .expect(200);
    expect(listed.body.data.map((row: { title: string }) => row.title)).toEqual(['One', 'Two']);

    const rows = await request(server())
      .get(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/work-items`))
      .set(as(scope.owner))
      .expect(200);
    expect(rows.body.data.items[0]).toMatchObject({ subtaskCount: 2, completedSubtaskCount: 1 });
  });

  it('moves its subtasks along when the ticket changes project', async () => {
    const scope = await setup();
    const created = await addSubtask(scope, {
      title: 'Check the load balancer',
      parentTicketId: scope.ticketId,
    }).expect(201);
    const next = await scope.project('Escalations');

    await request(server())
      .patch(url(`/workspaces/${scope.workspaceId}/tickets/${scope.ticketId}`))
      .set(as(scope.owner))
      .send({ projectId: next })
      .expect(200);

    const moved = await context.prisma.task.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(moved.projectId).toBe(next);
  });

  it('takes one parent, and only a ticket the caller may add work to', async () => {
    const scope = await setup();
    const parentTask = await addSubtask(scope, { title: 'A task', projectId: scope.projectId });

    await addSubtask(scope, {
      title: 'Both',
      parentTicketId: scope.ticketId,
      parentTaskId: parentTask.body.data.id,
    }).expect(400);

    // A private project's ticket looks like no ticket to an outsider.
    const privateProject = await scope.project('Secret', { visibility: 'PRIVATE' });
    const hidden = await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/tickets`))
      .set(as(scope.owner))
      .send({ title: 'Quiet', projectId: privateProject })
      .expect(201);
    const outsider = await registerUser('Ola Outsider');
    await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: outsider.userId, role: WorkspaceRole.MEMBER },
    });
    await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/tasks`))
      .set(as(outsider))
      .send({ title: 'Peek', parentTicketId: hidden.body.data.id })
      .expect(404);

    // A viewer of the project reads the ticket but adds nothing under it.
    const viewer = await registerUser('Vic Viewer');
    await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: viewer.userId, role: WorkspaceRole.MEMBER },
    });
    await context.prisma.projectMember.create({
      data: {
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        userId: viewer.userId,
        role: ProjectMemberRole.VIEWER,
      },
    });
    await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/tasks`))
      .set(as(viewer))
      .send({ title: 'Try', parentTicketId: scope.ticketId })
      .expect(403);
  });
});
