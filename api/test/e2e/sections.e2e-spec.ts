import { API_PREFIX, DEFAULT_SECTION_NAMES, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

describe('Sections (e2e)', () => {
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
    workspaceId: string;
    projectId: string;
    sections: { id: string; name: string; position: number }[];
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

  /** Owner + workspace + project with the four default sections. */
  const setupScope = async (): Promise<Scope> => {
    const owner = await registerUser();

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Acme Product' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Platform Foundation' })
      .expect(201);

    return {
      owner,
      workspaceId,
      projectId: project.body.data.id as string,
      sections: project.body.data.sections,
    };
  };

  const sectionsUrl = (scope: Scope) =>
    url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/sections`);

  const listNames = async (scope: Scope, actor: Actor = scope.owner): Promise<string[]> => {
    const response = await request(server())
      .get(sectionsUrl(scope))
      .set('Authorization', `Bearer ${actor.token}`)
      .expect(200);

    return response.body.data.map((section: { name: string }) => section.name);
  };

  describe('listing', () => {
    it('returns the default sections in order', async () => {
      const scope = await setupScope();
      expect(await listNames(scope)).toEqual([...DEFAULT_SECTION_NAMES]);
    });

    it('404s for a project in another workspace', async () => {
      const scope = await setupScope();

      const other = await request(server())
        .post(url('/workspaces'))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Other Workspace' })
        .expect(201);

      await request(server())
        .get(url(`/workspaces/${other.body.data.id}/projects/${scope.projectId}/sections`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(404);
    });
  });

  describe('default status', () => {
    /*
     * The column existed and was read by the move logic, but nothing could ever
     * set it — so it only ever held null and the feature was dead. These cover
     * the write side that makes it real.
     */
    const firstStatusId = async (scope: Scope): Promise<string> => {
      const response = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/field-metadata`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      return response.body.data.statuses[0].id as string;
    };

    it('is null unless somebody asks for one', async () => {
      // A section is a workflow column and a status is task state. Coupling them
      // by default is how "drag a card" becomes an unexplained status change.
      const scope = await setupScope();

      const response = await request(server())
        .post(sectionsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Archive' })
        .expect(201);

      expect(response.body.data.defaultStatusId).toBeNull();
    });

    it('is stored and returned when one is chosen', async () => {
      const scope = await setupScope();
      const statusId = await firstStatusId(scope);

      const created = await request(server())
        .post(sectionsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Ready for QA', defaultStatusId: statusId })
        .expect(201);

      expect(created.body.data.defaultStatusId).toBe(statusId);

      const listed = await request(server())
        .get(sectionsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const section = (listed.body.data as { name: string; defaultStatusId: string | null }[]).find(
        (entry) => entry.name === 'Ready for QA',
      );

      expect(section?.defaultStatusId).toBe(statusId);
    });

    it('can be set and cleared afterwards', async () => {
      const scope = await setupScope();
      const statusId = await firstStatusId(scope);
      const sectionId = scope.sections[0]!.id;
      const sectionUrl = `${sectionsUrl(scope)}/${sectionId}`;

      const set = await request(server())
        .patch(sectionUrl)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ defaultStatusId: statusId })
        .expect(200);
      expect(set.body.data.defaultStatusId).toBe(statusId);

      const cleared = await request(server())
        .patch(sectionUrl)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ defaultStatusId: null })
        .expect(200);
      expect(cleared.body.data.defaultStatusId).toBeNull();
    });

    it('refuses a status this project cannot use', async () => {
      /*
       * Otherwise a section could point at another project's status, and every
       * task dragged in would silently take a state its own project does not
       * define — showing a status nobody there can select.
       */
      const scope = await setupScope();

      await request(server())
        .post(sectionsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Bad', defaultStatusId: '019fc8d5-0000-7000-8000-000000000000' })
        .expect(400);
    });

    it('still renames without touching the status', async () => {
      const scope = await setupScope();
      const statusId = await firstStatusId(scope);
      const sectionUrl = `${sectionsUrl(scope)}/${scope.sections[0]!.id}`;

      await request(server())
        .patch(sectionUrl)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ defaultStatusId: statusId })
        .expect(200);

      const renamed = await request(server())
        .patch(sectionUrl)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Renamed' })
        .expect(200);

      expect(renamed.body.data.name).toBe('Renamed');
      expect(renamed.body.data.defaultStatusId).toBe(statusId);
    });
  });

  describe('creation', () => {
    it('appends by default', async () => {
      const scope = await setupScope();

      await request(server())
        .post(sectionsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Archive' })
        .expect(201);

      expect(await listNames(scope)).toEqual([...DEFAULT_SECTION_NAMES, 'Archive']);
    });

    it('inserts after a named sibling', async () => {
      const scope = await setupScope();
      const backlog = scope.sections[0]!;

      await request(server())
        .post(sectionsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Triage', afterSectionId: backlog.id })
        .expect(201);

      expect(await listNames(scope)).toEqual([
        'Backlog',
        'Triage',
        'In Progress',
        'In Review',
        'Done',
      ]);
    });

    it('places a section first when afterSectionId is null', async () => {
      const scope = await setupScope();

      await request(server())
        .post(sectionsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Intake', afterSectionId: null })
        .expect(201);

      expect((await listNames(scope))[0]).toBe('Intake');
    });

    it('rejects an anchor from a different project', async () => {
      const scope = await setupScope();

      const otherProject = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Second Project' })
        .expect(201);
      const foreignSection = otherProject.body.data.sections[0].id as string;

      const response = await request(server())
        .post(sectionsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Sneaky', afterSectionId: foreignSection })
        .expect(400);

      expect(response.body.error.message).toMatch(/does not belong to this project/i);
    });

    it('rejects a blank name', async () => {
      const scope = await setupScope();

      await request(server())
        .post(sectionsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: '   ' })
        .expect(422);
    });
  });

  describe('rename', () => {
    it('renames a section', async () => {
      const scope = await setupScope();
      const target = scope.sections[1]!;

      const response = await request(server())
        .patch(`${sectionsUrl(scope)}/${target.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Doing' })
        .expect(200);

      expect(response.body.data.name).toBe('Doing');
      expect(await listNames(scope)).toContain('Doing');
    });

    it('404s for a section belonging to a different project', async () => {
      const scope = await setupScope();

      const otherProject = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Second Project' })
        .expect(201);
      const foreignSection = otherProject.body.data.sections[0].id as string;

      // The URL claims this section is in `scope.projectId`; the service checks
      // rather than trusting the path.
      await request(server())
        .patch(`${sectionsUrl(scope)}/${foreignSection}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Hijacked' })
        .expect(404);
    });
  });

  describe('reordering', () => {
    const move = async (scope: Scope, sectionId: string, afterSectionId: string | null) =>
      request(server())
        .patch(`${sectionsUrl(scope)}/${sectionId}/move`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ afterSectionId })
        .expect(200);

    it('moves a section to the front', async () => {
      const scope = await setupScope();
      const done = scope.sections[3]!;

      const response = await move(scope, done.id, null);

      expect(response.body.data.map((s: { name: string }) => s.name)).toEqual([
        'Done',
        'Backlog',
        'In Progress',
        'In Review',
      ]);
    });

    it('moves a section to the end', async () => {
      const scope = await setupScope();
      const backlog = scope.sections[0]!;
      const done = scope.sections[3]!;

      const response = await move(scope, backlog.id, done.id);

      expect(response.body.data.map((s: { name: string }) => s.name)).toEqual([
        'In Progress',
        'In Review',
        'Done',
        'Backlog',
      ]);
    });

    it('moves a section into the middle', async () => {
      const scope = await setupScope();
      const done = scope.sections[3]!;
      const backlog = scope.sections[0]!;

      await move(scope, done.id, backlog.id);
      expect(await listNames(scope)).toEqual(['Backlog', 'Done', 'In Progress', 'In Review']);
    });

    it('treats moving a section after itself as a no-op', async () => {
      const scope = await setupScope();
      const inProgress = scope.sections[1]!;

      const response = await move(scope, inProgress.id, inProgress.id);
      expect(response.body.data.map((s: { name: string }) => s.name)).toEqual([
        ...DEFAULT_SECTION_NAMES,
      ]);
    });

    it('returns the full ordered list so the client need not guess', async () => {
      const scope = await setupScope();
      const response = await move(scope, scope.sections[2]!.id, null);
      expect(response.body.data).toHaveLength(DEFAULT_SECTION_NAMES.length);
    });

    it('rejects an anchor outside the project', async () => {
      const scope = await setupScope();

      const otherProject = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Second Project' })
        .expect(201);

      await request(server())
        .patch(`${sectionsUrl(scope)}/${scope.sections[0]!.id}/move`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ afterSectionId: otherProject.body.data.sections[0].id })
        .expect(400);
    });

    /**
     * Repeated drops into the same slot halve the gap each time. This is the
     * scenario the rebalancing exists for — without it, positions collapse to
     * equality and the order silently scrambles.
     */
    it('keeps a stable order across many moves into the same slot', async () => {
      const scope = await setupScope();
      const anchor = scope.sections[0]!;
      const movers = [scope.sections[1]!, scope.sections[2]!, scope.sections[3]!];

      for (let round = 0; round < 25; round += 1) {
        const mover = movers[round % movers.length]!;
        await move(scope, mover.id, anchor.id);
      }

      const rows = await context.prisma.section.findMany({
        where: { projectId: scope.projectId },
        orderBy: { position: 'asc' },
      });

      expect(rows).toHaveLength(4);
      expect(new Set(rows.map((row) => row.position)).size).toBe(4);
      expect(rows[0]?.name).toBe('Backlog');
    });
  });

  describe('deletion', () => {
    it('deletes a section', async () => {
      const scope = await setupScope();

      const response = await request(server())
        .delete(`${sectionsUrl(scope)}/${scope.sections[2]!.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data).toEqual({ deleted: true, reassignedTaskCount: 0 });
      expect(await listNames(scope)).toEqual(['Backlog', 'In Progress', 'Done']);
    });

    it('moves the section’s tasks to the leftmost remaining column instead of orphaning them', async () => {
      const scope = await setupScope();
      const doomed = scope.sections[1]!;
      const first = scope.sections[0]!;

      await context.prisma.task.createMany({
        data: [1, 2, 3].map((n) => ({
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          sectionId: doomed.id,
          title: `Task ${n}`,
          createdById: scope.owner.userId,
        })),
      });

      const response = await request(server())
        .delete(`${sectionsUrl(scope)}/${doomed.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data.reassignedTaskCount).toBe(3);

      const orphaned = await context.prisma.task.count({
        where: { projectId: scope.projectId, sectionId: null },
      });
      expect(orphaned).toBe(0);

      const moved = await context.prisma.task.count({ where: { sectionId: first.id } });
      expect(moved).toBe(3);
    });

    it('reports the remaining task counts per section', async () => {
      const scope = await setupScope();

      await context.prisma.task.create({
        data: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          sectionId: scope.sections[0]!.id,
          title: 'Only task',
          createdById: scope.owner.userId,
        },
      });

      const response = await request(server())
        .get(sectionsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data[0].taskCount).toBe(1);
      expect(response.body.data[1].taskCount).toBe(0);
    });
  });

  describe('authorisation', () => {
    const addMember = async (scope: Scope, actor: Actor, role: WorkspaceRole) => {
      await context.prisma.workspaceMember.create({
        data: { workspaceId: scope.workspaceId, userId: actor.userId, role },
      });
    };

    it('hides sections from a non-member', async () => {
      const scope = await setupScope();
      const outsider = await registerUser('Outsider');

      await request(server())
        .get(sectionsUrl(scope))
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(403);
    });

    it('lets a MEMBER create, rename and reorder but not delete', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      const created = await request(server())
        .post(sectionsUrl(scope))
        .set('Authorization', `Bearer ${member.token}`)
        .send({ name: 'Member Section' })
        .expect(201);

      await request(server())
        .patch(`${sectionsUrl(scope)}/${created.body.data.id}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ name: 'Renamed By Member' })
        .expect(200);

      await request(server())
        .patch(`${sectionsUrl(scope)}/${created.body.data.id}/move`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ afterSectionId: null })
        .expect(200);

      const denied = await request(server())
        .delete(`${sectionsUrl(scope)}/${created.body.data.id}`)
        .set('Authorization', `Bearer ${member.token}`)
        .expect(403);

      expect(denied.body.error.code).toBe('INSUFFICIENT_WORKSPACE_ROLE');
    });

    it('lets a GUEST read but not create', async () => {
      const scope = await setupScope();
      const guest = await registerUser('Guest');
      await addMember(scope, guest, WorkspaceRole.GUEST);

      expect(await listNames(scope, guest)).toEqual([...DEFAULT_SECTION_NAMES]);

      await request(server())
        .post(sectionsUrl(scope))
        .set('Authorization', `Bearer ${guest.token}`)
        .send({ name: 'Guest Section' })
        .expect(403);
    });
  });
});
