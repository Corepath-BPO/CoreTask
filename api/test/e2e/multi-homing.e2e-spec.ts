import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import { randomUUID } from 'node:crypto';

import request from 'supertest';

import type { AutomationEvent } from '../../src/modules/automations/automation-event.publisher';
import { AutomationRunnerService } from '../../src/modules/automations/automation-runner.service';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Multi-homing: one task in several projects, in its own section and place in
 * each, visible through any of them, and never listed twice.
 */
describe('Multi-homing (e2e)', () => {
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

  const setup = async () => {
    const owner = await register('Ada Owner');
    const member = await register('Bea Member');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(owner.auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
    });

    const project = async (name: string, visibility?: 'PRIVATE') => {
      const created = await request(server())
        .post(url(`/workspaces/${workspaceId}/projects`))
        .set(owner.auth)
        .send({ name, ...(visibility ? { visibility } : {}) })
        .expect(201);
      return {
        id: created.body.data.id as string,
        sections: (created.body.data.sections as { id: string; name: string }[]).map(
          (section) => section.id,
        ),
      };
    };
    // The home is private and the member is not in it; the other is public.
    const home = await project('Board pack', 'PRIVATE');
    const other = await project('Leasing');

    const items = (projectId: string) =>
      url(`/workspaces/${workspaceId}/projects/${projectId}/work-items`);
    const task = await request(server())
      .post(items(home.id))
      .set(owner.auth)
      .send({ type: 'TASK', title: 'Approve the budget', sectionId: home.sections[0] })
      .expect(201);

    return {
      owner,
      member,
      workspaceId,
      home,
      other,
      items,
      taskId: task.body.data.id as string,
      projectsUrl: url(`/workspaces/${workspaceId}/tasks/${task.body.data.id as string}/projects`),
    };
  };

  it('adds a task to another project, where it sits in its own section', async () => {
    const scope = await setup();

    const added = await request(server())
      .post(scope.projectsUrl)
      .set(scope.owner.auth)
      .send({ projectId: scope.other.id, sectionId: scope.other.sections[1] })
      .expect(201);
    expect(added.body.data.otherProjects).toEqual([
      expect.objectContaining({
        project: expect.objectContaining({ id: scope.other.id, name: 'Leasing' }),
        section: expect.objectContaining({ id: scope.other.sections[1] }),
      }),
    ]);

    // Listed in the other project, in its section there, once.
    const there = await request(server())
      .get(scope.items(scope.other.id))
      .set(scope.owner.auth)
      .expect(200);
    expect(there.body.data.items).toEqual([
      expect.objectContaining({
        id: scope.taskId,
        projectId: scope.other.id,
        sectionId: scope.other.sections[1],
        homeProjectId: scope.home.id,
      }),
    ]);

    // Still at home, untouched, and not listed twice there.
    const home = await request(server())
      .get(scope.items(scope.home.id))
      .set(scope.owner.auth)
      .expect(200);
    expect(home.body.data.items).toEqual([
      expect.objectContaining({ id: scope.taskId, sectionId: scope.home.sections[0] }),
    ]);
    expect(home.body.data.items[0].homeProjectId).toBeUndefined();

    // A section filter and a sort both see it in its place there.
    const filtered = await request(server())
      .get(`${scope.items(scope.other.id)}?sectionId=${scope.other.sections[1]}`)
      .set(scope.owner.auth)
      .expect(200);
    expect(filtered.body.data.items.map((item: { id: string }) => item.id)).toEqual([scope.taskId]);

    // Twice is refused, and so is its own home.
    await request(server())
      .post(scope.projectsUrl)
      .set(scope.owner.auth)
      .send({ projectId: scope.other.id })
      .expect(409);
    await request(server())
      .post(scope.projectsUrl)
      .set(scope.owner.auth)
      .send({ projectId: scope.home.id })
      .expect(409);
  });

  it('moves on each board without disturbing the other', async () => {
    const scope = await setup();
    await request(server())
      .post(scope.projectsUrl)
      .set(scope.owner.auth)
      .send({ projectId: scope.other.id })
      .expect(201);

    await request(server())
      .patch(`${scope.items(scope.other.id)}/${scope.taskId}/move`)
      .set(scope.owner.auth)
      .send({ targetSectionId: scope.other.sections[2] })
      .expect(200);

    const task = await context.prisma.task.findUniqueOrThrow({ where: { id: scope.taskId } });
    expect(task.sectionId).toBe(scope.home.sections[0]);
    const link = await context.prisma.taskProject.findUniqueOrThrow({
      where: { taskId_projectId: { taskId: scope.taskId, projectId: scope.other.id } },
    });
    expect(link.sectionId).toBe(scope.other.sections[2]);

    // The older move route does the same from the List.
    await request(server())
      .patch(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/move`))
      .set(scope.owner.auth)
      .send({ sectionId: scope.other.sections[0], afterTaskId: null })
      .expect(200);
    expect(
      (
        await context.prisma.taskProject.findUniqueOrThrow({
          where: { taskId_projectId: { taskId: scope.taskId, projectId: scope.other.id } },
        })
      ).sectionId,
    ).toBe(scope.other.sections[0]);
    expect(
      (await context.prisma.task.findUniqueOrThrow({ where: { id: scope.taskId } })).sectionId,
    ).toBe(scope.home.sections[0]);

    // And the pane's section picker.
    await request(server())
      .patch(`${scope.projectsUrl}/${scope.other.id}`)
      .set(scope.owner.auth)
      .send({ sectionId: scope.other.sections[1] })
      .expect(200);
    expect(
      (
        await context.prisma.taskProject.findUniqueOrThrow({
          where: { taskId_projectId: { taskId: scope.taskId, projectId: scope.other.id } },
        })
      ).sectionId,
    ).toBe(scope.other.sections[1]);
  });

  it('is visible, and editable, through any project the reader can open', async () => {
    const scope = await setup();
    const detail = url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}`);

    // Only in a private project the member is not in: not theirs to see.
    await request(server()).get(detail).set(scope.member.auth).expect(404);

    await request(server())
      .post(scope.projectsUrl)
      .set(scope.owner.auth)
      .send({ projectId: scope.other.id })
      .expect(201);

    const seen = await request(server()).get(detail).set(scope.member.auth).expect(200);
    expect(seen.body.data.title).toBe('Approve the budget');
    await request(server())
      .patch(`${scope.items(scope.other.id)}/${scope.taskId}`)
      .set(scope.member.auth)
      .send({ title: 'Approve the 2027 budget' })
      .expect(200);
    await request(server())
      .patch(detail)
      .set(scope.member.auth)
      .send({ priority: 'HIGH' })
      .expect(200);

    // The member sees the task's other project, not the private home's name
    // anywhere they should not.
    const home = await request(server()).get(detail).set(scope.owner.auth).expect(200);
    expect(home.body.data.otherProjects).toHaveLength(1);
  });

  it('leaves a project, and promotes another to home when the home is left', async () => {
    const scope = await setup();
    await request(server())
      .post(scope.projectsUrl)
      .set(scope.owner.auth)
      .send({ projectId: scope.other.id, sectionId: scope.other.sections[1] })
      .expect(201);

    const left = await request(server())
      .delete(`${scope.projectsUrl}/${scope.home.id}`)
      .set(scope.owner.auth)
      .expect(200);
    expect(left.body.data).toMatchObject({
      projectId: scope.other.id,
      sectionId: scope.other.sections[1],
      otherProjects: [],
    });
    expect(await context.prisma.taskProject.count()).toBe(0);

    const home = await request(server())
      .get(scope.items(scope.home.id))
      .set(scope.owner.auth)
      .expect(200);
    expect(home.body.data.items).toEqual([]);

    // A subtask lives with its parent and is not added on its own.
    const subtask = await request(server())
      .post(scope.items(scope.other.id))
      .set(scope.owner.auth)
      .send({ type: 'TASK', title: 'Check figures', parentId: scope.taskId })
      .expect(201);
    await request(server())
      .post(
        url(`/workspaces/${scope.workspaceId}/tasks/${subtask.body.data.id as string}/projects`),
      )
      .set(scope.owner.auth)
      .send({ projectId: scope.home.id })
      .expect(400);
  });

  it('counts linked tasks in the project and section, and keeps them through a section delete', async () => {
    const scope = await setup();
    await request(server())
      .post(scope.projectsUrl)
      .set(scope.owner.auth)
      .send({ projectId: scope.other.id, sectionId: scope.other.sections[1] })
      .expect(201);
    await request(server())
      .patch(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}`))
      .set(scope.owner.auth)
      .send({ status: 'DONE' })
      .expect(200);

    const project = await request(server())
      .get(url(`/workspaces/${scope.workspaceId}/projects/${scope.other.id}`))
      .set(scope.owner.auth)
      .expect(200);
    expect(project.body.data).toMatchObject({ taskCount: 1, completedTaskCount: 1 });
    const section = (project.body.data.sections as { id: string; taskCount: number }[]).find(
      (entry) => entry.id === scope.other.sections[1],
    );
    expect(section?.taskCount).toBe(1);

    // Its section there goes; the link moves to the first remaining one.
    await request(server())
      .delete(
        url(
          `/workspaces/${scope.workspaceId}/projects/${scope.other.id}/sections/${scope.other.sections[1]}`,
        ),
      )
      .set(scope.owner.auth)
      .expect(200);
    const link = await context.prisma.taskProject.findUniqueOrThrow({
      where: { taskId_projectId: { taskId: scope.taskId, projectId: scope.other.id } },
    });
    expect(link.sectionId).toBe(scope.other.sections[0]);
  });

  it('lets a linked project’s rules answer, acting on its own board', async () => {
    const scope = await setup();
    await request(server())
      .post(scope.projectsUrl)
      .set(scope.owner.auth)
      .send({ projectId: scope.other.id })
      .expect(201);

    const rules = url(`/workspaces/${scope.workspaceId}/projects/${scope.other.id}/automations`);
    const rule = await request(server())
      .post(rules)
      .set(scope.owner.auth)
      .send({
        name: 'Done goes to the last column',
        triggerType: 'TASK_COMPLETED',
        triggerConfig: {},
        nodes: [
          { nodeType: 'TRIGGER', subtype: 'TASK_COMPLETED', configuration: {} },
          {
            nodeType: 'ACTION',
            subtype: 'MOVE_TO_SECTION',
            configuration: { sectionId: scope.other.sections[2] },
          },
        ],
      })
      .expect(201);
    await request(server())
      .post(`${rules}/${rule.body.data.id as string}/publish`)
      .set(scope.owner.auth)
      .expect(200);

    // The completion happened at home; the other project's rule still hears it.
    const runner = new AutomationRunnerService(context.prisma, {
      toProject: async () => undefined,
    } as never);
    const event: AutomationEvent = {
      eventId: randomUUID(),
      workspaceId: scope.workspaceId,
      projectId: scope.home.id,
      trigger: 'TASK_COMPLETED',
      entityType: 'TASK',
      entityId: scope.taskId,
      actorId: scope.owner.userId,
      correlationId: randomUUID(),
      depth: 0,
    };
    expect((await runner.handle(event)).executed).toBe(1);

    const link = await context.prisma.taskProject.findUniqueOrThrow({
      where: { taskId_projectId: { taskId: scope.taskId, projectId: scope.other.id } },
    });
    expect(link.sectionId).toBe(scope.other.sections[2]);
    // Home untouched.
    expect(
      (await context.prisma.task.findUniqueOrThrow({ where: { id: scope.taskId } })).sectionId,
    ).toBe(scope.home.sections[0]);
  });

  it('carries its projects to the next occurrence, and takes a linked project’s field', async () => {
    const scope = await setup();
    await request(server())
      .post(scope.projectsUrl)
      .set(scope.owner.auth)
      .send({ projectId: scope.other.id, sectionId: scope.other.sections[1] })
      .expect(201);

    // A field only the other project shows can still be set on the task.
    const field = await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.other.id}/custom-fields`))
      .set(scope.owner.auth)
      .send({ name: 'Lease ref', type: 'TEXT' })
      .expect(201);
    await request(server())
      .put(
        url(
          `/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/custom-fields/${field.body.data.id as string}`,
        ),
      )
      .set(scope.owner.auth)
      .send({ text: 'L-204' })
      .expect(200);

    const task = url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}`);
    await request(server())
      .patch(task)
      .set(scope.owner.auth)
      .send({
        dueDate: '2030-01-07',
        recurrence: { frequency: 'WEEKLY', interval: 1, weekdays: [1] },
      })
      .expect(200);
    await request(server()).patch(task).set(scope.owner.auth).send({ status: 'DONE' }).expect(200);

    const next = await context.prisma.task.findFirstOrThrow({
      where: { title: 'Approve the budget', completedAt: null },
      include: { projectLinks: true },
    });
    expect(next.projectId).toBe(scope.home.id);
    expect(next.projectLinks).toEqual([
      expect.objectContaining({ projectId: scope.other.id, sectionId: scope.other.sections[1] }),
    ]);
  });

  it('expands a linked task’s subtasks, and lists it in the view query in its place there', async () => {
    const scope = await setup();
    await request(server())
      .post(scope.projectsUrl)
      .set(scope.owner.auth)
      .send({ projectId: scope.other.id, sectionId: scope.other.sections[1] })
      .expect(201);
    await request(server())
      .post(scope.items(scope.home.id))
      .set(scope.owner.auth)
      .send({ type: 'TASK', title: 'Check figures', parentId: scope.taskId })
      .expect(201);

    const base = url(`/workspaces/${scope.workspaceId}/projects/${scope.other.id}`);
    const subtasks = await request(server())
      .get(`${base}/tasks/${scope.taskId}/subtasks`)
      .set(scope.owner.auth)
      .expect(200);
    expect(subtasks.body.data.map((task: { title: string }) => task.title)).toEqual([
      'Check figures',
    ]);

    const view = await request(server())
      .post(`${base}/tasks/query`)
      .set(scope.owner.auth)
      .send({})
      .expect(200);
    expect(view.body.data).toEqual([
      expect.objectContaining({ id: scope.taskId, sectionId: scope.other.sections[1] }),
    ]);
  });
});
