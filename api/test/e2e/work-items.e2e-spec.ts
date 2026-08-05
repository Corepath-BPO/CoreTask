import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * The shared work-item layer, which is what makes List and Board one feature.
 *
 * The cases that carry weight are the ones about *sameness*: a task and a ticket
 * coming back from one query in one ordering, a section from another project
 * being refused, and a type with no model behind it being refused even though
 * the picker would never offer it. Each of those is a boundary that looks fine
 * until something crosses it.
 */
describe('Project work items (e2e)', () => {
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

  interface Scope {
    owner: Actor;
    member: Actor;
    outsider: Actor;
    workspaceId: string;
    projectId: string;
    otherProjectId: string;
    sectionId: string;
    secondSectionId: string;
    otherProjectSectionId: string;
  }

  const registerUser = async (name = 'Test User'): Promise<Actor> => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);

    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  };

  const setupScope = async (): Promise<Scope> => {
    const owner = await registerUser('Owner');
    const member = await registerUser('Member');
    const outsider = await registerUser('Outsider');

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Acme Product' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
    });

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Platform Foundation' })
      .expect(201);

    // A second project in the same workspace, so "belongs to another project"
    // can be tested without the workspace guard catching it first — which would
    // pass for the wrong reason.
    const otherProject = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Something Else' })
      .expect(201);

    const sections = project.body.data.sections as { id: string }[];

    return {
      owner,
      member,
      outsider,
      workspaceId,
      projectId: project.body.data.id as string,
      otherProjectId: otherProject.body.data.id as string,
      sectionId: sections[0]!.id,
      secondSectionId: sections[1]!.id,
      otherProjectSectionId: (otherProject.body.data.sections as { id: string }[])[0]!.id,
    };
  };

  const itemsUrl = (scope: Scope) =>
    url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/work-items`);

  const create = (scope: Scope, body: Record<string, unknown>, actor: Actor = scope.owner) =>
    request(server())
      .post(itemsUrl(scope))
      .set('Authorization', `Bearer ${actor.token}`)
      .send(body);

  // -------------------------------------------------------------------------
  describe('creating', () => {
    it('creates a task through the shared endpoint', async () => {
      const scope = await setupScope();

      const response = await create(scope, {
        type: 'TASK',
        title: 'Ship the thing',
        sectionId: scope.sectionId,
      }).expect(201);

      expect(response.body.data.type).toBe('TASK');
      expect(response.body.data.sectionId).toBe(scope.sectionId);
      expect(response.body.data.details.kind).toBe('TASK');
    });

    it('creates a ticket, in a section, with its key', async () => {
      // The capability that did not exist: a ticket had nowhere to sit inside a
      // project, so "add a ticket to this column" was not expressible at all.
      const scope = await setupScope();

      const response = await create(scope, {
        type: 'TICKET',
        title: 'Login returns a 500',
        sectionId: scope.sectionId,
      }).expect(201);

      expect(response.body.data.type).toBe('TICKET');
      expect(response.body.data.sectionId).toBe(scope.sectionId);
      expect(response.body.data.details.key).toMatch(/^[A-Z]+-\d+$/);
    });

    it('refuses a type that has no model behind it', async () => {
      // The picker disables Milestone and Approval, but a disabled control is
      // presentation. Without this the row would be written as something else
      // wearing a label that lies about what it is.
      const scope = await setupScope();

      for (const type of ['MILESTONE', 'APPROVAL']) {
        await create(scope, { type, title: 'Not yet' }).expect(422);
      }
    });

    it('refuses a section belonging to another project', async () => {
      // Same workspace, so the guard passes and the check that matters is the
      // one in the service. Filing an item into another project's section makes
      // it visible to that project and invisible to its own.
      const scope = await setupScope();

      await create(scope, {
        type: 'TASK',
        title: 'Misfiled',
        sectionId: scope.otherProjectSectionId,
      }).expect(400);
    });

    it('lands in the first section when none is named', async () => {
      // Somewhere visible rather than in a limbo neither view draws.
      const scope = await setupScope();

      const response = await create(scope, { type: 'TASK', title: 'From the toolbar' }).expect(201);

      expect(response.body.data.sectionId).toBe(scope.sectionId);
    });

    it('refuses a ticket as a subtask', async () => {
      const scope = await setupScope();
      const parent = await create(scope, { type: 'TASK', title: 'Parent' }).expect(201);

      await create(scope, {
        type: 'TICKET',
        title: 'Child',
        parentId: parent.body.data.id,
      }).expect(400);
    });

    it('refuses a subtask of a subtask', async () => {
      const scope = await setupScope();
      const parent = await create(scope, { type: 'TASK', title: 'Parent' }).expect(201);
      const child = await create(scope, {
        type: 'TASK',
        title: 'Child',
        parentId: parent.body.data.id,
      }).expect(201);

      await create(scope, {
        type: 'TASK',
        title: 'Grandchild',
        parentId: child.body.data.id,
      }).expect(400);
    });

    it('writes an activity entry naming the type', async () => {
      const scope = await setupScope();
      await create(scope, { type: 'TICKET', title: 'Tracked' }).expect(201);

      const entries = await context.prisma.activityLog.findMany({
        where: { workspaceId: scope.workspaceId, action: 'CREATED' },
      });

      const ticket = entries.find((entry) => entry.summary.includes('ticket'));
      expect(ticket).toBeDefined();
      expect((ticket?.metadata as { workItemType?: string })?.workItemType).toBe('TICKET');
    });
  });

  // -------------------------------------------------------------------------
  describe('listing', () => {
    it('returns tasks and tickets in one ordering', async () => {
      /*
       * The heart of it. Both kinds share a section's position space, so the
       * result has to interleave them — concatenating two lists would put every
       * ticket after every task regardless of where anybody put them.
       */
      const scope = await setupScope();

      const first = await create(scope, {
        type: 'TASK',
        title: 'First',
        sectionId: scope.sectionId,
      }).expect(201);
      const second = await create(scope, {
        type: 'TICKET',
        title: 'Second',
        sectionId: scope.sectionId,
      }).expect(201);
      const third = await create(scope, {
        type: 'TASK',
        title: 'Third',
        sectionId: scope.sectionId,
      }).expect(201);

      const response = await request(server())
        .get(itemsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const items = response.body.data.items as { id: string; title: string; type: string }[];

      expect(items.map((item) => item.title)).toEqual(['First', 'Second', 'Third']);
      expect(items.map((item) => item.type)).toEqual(['TASK', 'TICKET', 'TASK']);
      expect(items.map((item) => item.id)).toEqual([
        first.body.data.id,
        second.body.data.id,
        third.body.data.id,
      ]);
    });

    it('narrows to one kind when asked', async () => {
      const scope = await setupScope();
      await create(scope, { type: 'TASK', title: 'A task' }).expect(201);
      await create(scope, { type: 'TICKET', title: 'A ticket' }).expect(201);

      const response = await request(server())
        .get(`${itemsUrl(scope)}?types=TICKET`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].type).toBe('TICKET');
    });

    it('leaves subtasks out of the top level', async () => {
      // Fetched when a row is expanded. A project of two hundred tasks would
      // otherwise ship every child nobody looked at.
      const scope = await setupScope();
      const parent = await create(scope, { type: 'TASK', title: 'Parent' }).expect(201);
      await create(scope, {
        type: 'TASK',
        title: 'Child',
        parentId: parent.body.data.id,
      }).expect(201);

      const response = await request(server())
        .get(itemsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].subtaskCount).toBe(1);
    });

    it('finds a ticket by its key, which is how people search for one', async () => {
      const scope = await setupScope();
      const ticket = await create(scope, { type: 'TICKET', title: 'Unrelated words' }).expect(201);
      const key = ticket.body.data.details.key as string;

      const response = await request(server())
        .get(`${itemsUrl(scope)}?search=${key}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].details.key).toBe(key);
    });

    it('reports a ticket’s custom field values as none rather than omitting them', async () => {
      // Empty means "no values", which is true. Omitting the key would make a
      // consumer handle two shapes for the same field.
      const scope = await setupScope();
      await create(scope, { type: 'TICKET', title: 'A ticket' }).expect(201);

      const response = await request(server())
        .get(itemsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data.items[0].customFieldValues).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('updating', () => {
    it('accepts back the status id it handed out for a ticket', async () => {
      /*
       * A ticket's status is an enum, not a definition row, so the read model
       * reports `OPEN` as the id. Whatever comes out has to be accepted back —
       * otherwise setting a status from the List fails on every ticket.
       */
      const scope = await setupScope();
      const ticket = await create(scope, { type: 'TICKET', title: 'A ticket' }).expect(201);

      const response = await request(server())
        .patch(`${itemsUrl(scope)}/${ticket.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ statusId: 'RESOLVED' })
        .expect(200);

      expect(response.body.data.status.id).toBe('RESOLVED');
      expect(response.body.data.details.resolvedAt).not.toBeNull();
    });

    it('clears the resolved timestamp when a ticket is reopened', async () => {
      // A ticket that went out and came back must not keep claiming it was
      // resolved on a date it plainly was not.
      const scope = await setupScope();
      const ticket = await create(scope, { type: 'TICKET', title: 'A ticket' }).expect(201);
      const itemUrl = `${itemsUrl(scope)}/${ticket.body.data.id}`;

      await request(server())
        .patch(itemUrl)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ statusId: 'RESOLVED' })
        .expect(200);

      const reopened = await request(server())
        .patch(itemUrl)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ statusId: 'IN_PROGRESS' })
        .expect(200);

      expect(reopened.body.data.details.resolvedAt).toBeNull();
    });

    it('refuses a task status on a ticket', async () => {
      // `BACKLOG` is a task status. Accepting it would store nonsense or, worse,
      // silently pick something adjacent.
      const scope = await setupScope();
      const ticket = await create(scope, { type: 'TICKET', title: 'A ticket' }).expect(201);

      await request(server())
        .patch(`${itemsUrl(scope)}/${ticket.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ statusId: 'BACKLOG' })
        .expect(400);
    });

    it('refuses an assignee who is not a member of the workspace', async () => {
      const scope = await setupScope();
      const task = await create(scope, { type: 'TASK', title: 'A task' }).expect(201);

      await request(server())
        .patch(`${itemsUrl(scope)}/${task.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ assigneeIds: [scope.outsider.userId] })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('moving', () => {
    it('moves a ticket between sections, which a board drag does', async () => {
      const scope = await setupScope();
      const ticket = await create(scope, {
        type: 'TICKET',
        title: 'Drag me',
        sectionId: scope.sectionId,
      }).expect(201);

      const response = await request(server())
        .patch(`${itemsUrl(scope)}/${ticket.body.data.id}/move`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ targetSectionId: scope.secondSectionId })
        .expect(200);

      expect(response.body.data.sectionId).toBe(scope.secondSectionId);
    });

    it('places a moved item among both kinds already there', async () => {
      // The sibling list has to contain tasks *and* tickets, or the newcomer
      // lands on a position another item already holds and the column order
      // becomes a coin toss.
      const scope = await setupScope();

      const anchor = await create(scope, {
        type: 'TICKET',
        title: 'Anchor',
        sectionId: scope.secondSectionId,
      }).expect(201);
      await create(scope, {
        type: 'TASK',
        title: 'Behind the anchor',
        sectionId: scope.secondSectionId,
      }).expect(201);

      const mover = await create(scope, {
        type: 'TASK',
        title: 'Mover',
        sectionId: scope.sectionId,
      }).expect(201);

      await request(server())
        .patch(`${itemsUrl(scope)}/${mover.body.data.id}/move`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ targetSectionId: scope.secondSectionId, afterId: anchor.body.data.id })
        .expect(200);

      const response = await request(server())
        .get(`${itemsUrl(scope)}?sectionId=${scope.secondSectionId}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect((response.body.data.items as { title: string }[]).map((item) => item.title)).toEqual([
        'Anchor',
        'Mover',
        'Behind the anchor',
      ]);
    });

    it('refuses a move into another project’s section', async () => {
      const scope = await setupScope();
      const task = await create(scope, { type: 'TASK', title: 'A task' }).expect(201);

      await request(server())
        .patch(`${itemsUrl(scope)}/${task.body.data.id}/move`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ targetSectionId: scope.otherProjectSectionId })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('authorization', () => {
    it('refuses somebody who is not in the workspace', async () => {
      const scope = await setupScope();

      await request(server())
        .get(itemsUrl(scope))
        .set('Authorization', `Bearer ${scope.outsider.token}`)
        .expect(403);
    });

    it('refuses creation from outside the workspace', async () => {
      const scope = await setupScope();

      await create(scope, { type: 'TASK', title: 'Not yours' }, scope.outsider).expect(403);
    });

    it('lets an ordinary member create, because that is the work', async () => {
      const scope = await setupScope();

      await create(scope, { type: 'TASK', title: 'Mine' }, scope.member).expect(201);
    });

    it('answers 404 for an item in another project rather than confirming it exists', async () => {
      const scope = await setupScope();
      const task = await create(scope, { type: 'TASK', title: 'A task' }).expect(201);

      await request(server())
        .get(
          url(
            `/workspaces/${scope.workspaceId}/projects/${scope.otherProjectId}/work-items/${task.body.data.id}`,
          ),
        )
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(404);
    });
  });
});
