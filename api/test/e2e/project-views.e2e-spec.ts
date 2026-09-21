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
 * Saved views and custom fields.
 *
 * The isolation cases carry the most weight here: a personal view is one
 * person's, and a custom field belongs to one project. Both are the kind of
 * boundary that looks fine until someone crosses it.
 */
describe('Project views and custom fields (e2e)', () => {
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
    workspaceId: string;
    projectId: string;
    taskId: string;
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

    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'A task', sectionId: project.body.data.sections[0].id })
      .expect(201);

    return {
      owner,
      member,
      workspaceId,
      projectId: project.body.data.id as string,
      taskId: task.body.data.id as string,
    };
  };

  const viewsUrl = (scope: Scope) =>
    url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/views`);
  const fieldsUrl = (scope: Scope) =>
    url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/custom-fields`);

  /** Shared by every field suite below, so they all create fields the same way. */
  const createField = (scope: Scope, body: Record<string, unknown>) =>
    request(server())
      .post(fieldsUrl(scope))
      .set('Authorization', `Bearer ${scope.owner.token}`)
      .send(body);

  // -------------------------------------------------------------------------
  describe('views', () => {
    it('creates the List and Board defaults on first read', async () => {
      const scope = await setupScope();

      const response = await request(server())
        .get(viewsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data.map((view: { type: string }) => view.type).sort()).toEqual([
        'BOARD',
        'LIST',
      ]);
    });

    it('does not create them twice', async () => {
      const scope = await setupScope();

      await request(server())
        .get(viewsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const second = await request(server())
        .get(viewsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(second.body.data).toHaveLength(2);
    });

    it('creates and updates a view', async () => {
      const scope = await setupScope();

      const created = await request(server())
        .post(viewsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'By assignee', type: 'LIST' })
        .expect(201);

      const updated = await request(server())
        .patch(`${viewsUrl(scope)}/${created.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Renamed' })
        .expect(200);

      expect(updated.body.data.name).toBe('Renamed');
    });

    /*
     * A personal view is one person's. Returned as 404 rather than 403 because
     * confirming it exists is already more than a stranger should learn.
     */
    it('hides a personal view from everyone else', async () => {
      const scope = await setupScope();

      const personal = await request(server())
        .post(viewsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Mine', type: 'LIST', scope: 'PERSONAL' })
        .expect(201);

      const theirList = await request(server())
        .get(viewsUrl(scope))
        .set('Authorization', `Bearer ${scope.member.token}`)
        .expect(200);

      expect(
        theirList.body.data.some((view: { id: string }) => view.id === personal.body.data.id),
      ).toBe(false);

      await request(server())
        .get(`${viewsUrl(scope)}/${personal.body.data.id}`)
        .set('Authorization', `Bearer ${scope.member.token}`)
        .expect(404);
    });

    it('shows a shared view to every project member', async () => {
      const scope = await setupScope();

      const shared = await request(server())
        .post(viewsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Everyone', type: 'LIST' })
        .expect(201);

      const theirs = await request(server())
        .get(`${viewsUrl(scope)}/${shared.body.data.id}`)
        .set('Authorization', `Bearer ${scope.member.token}`)
        .expect(200);

      expect(theirs.body.data.name).toBe('Everyone');
    });

    it('refuses a view from another workspace', async () => {
      const scope = await setupScope();
      const other = await setupScope();

      const theirs = await request(server())
        .post(viewsUrl(other))
        .set('Authorization', `Bearer ${other.owner.token}`)
        .send({ name: 'Theirs', type: 'LIST' })
        .expect(201);

      await request(server())
        .get(`${viewsUrl(scope)}/${theirs.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(404);
    });

    /*
     * Two states with no correct answer: a project with no default has nowhere
     * to land, and a personal view cannot be everyone's default.
     */
    it('refuses to delete the default until another takes over', async () => {
      const scope = await setupScope();

      const views = await request(server())
        .get(viewsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const list = views.body.data.find((view: { type: string }) => view.type === 'LIST');

      await request(server())
        .delete(`${viewsUrl(scope)}/${list.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(400);
    });

    it('refuses to make a personal view the default', async () => {
      const scope = await setupScope();

      const personal = await request(server())
        .post(viewsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Mine', type: 'LIST', scope: 'PERSONAL' })
        .expect(201);

      await request(server())
        .post(`${viewsUrl(scope)}/${personal.body.data.id}/set-default`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(400);
    });

    it('rejects settings that are not valid', async () => {
      const scope = await setupScope();

      await request(server())
        .post(viewsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({
          name: 'Broken',
          type: 'LIST',
          settings: {
            filters: {
              combinator: 'AND',
              conditions: [{ field: 'title', operator: 'NOT_AN_OPERATOR' }],
            },
          },
        })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('custom fields', () => {
    it('creates a select field with its options', async () => {
      const scope = await setupScope();

      const response = await createField(scope, {
        name: 'Department',
        type: 'SINGLE_SELECT',
        options: [{ label: 'Support', colorToken: 'blue' }, { label: 'Platform' }],
      }).expect(201);

      expect(response.body.data.options).toHaveLength(2);
      expect(response.body.data.options[0].colorToken).toBe('blue');
    });

    it('refuses a select field with no options', async () => {
      const scope = await setupScope();

      await createField(scope, { name: 'Empty', type: 'SINGLE_SELECT' }).expect(400);
    });

    it('refuses options on a field type that has none', async () => {
      const scope = await setupScope();

      await createField(scope, {
        name: 'Notes',
        type: 'TEXT',
        options: [{ label: 'nope' }],
      }).expect(400);
    });

    /*
     * Names are no longer unique, and that is the point of the library.
     *
     * A field is a workspace definition now, and two projects may each already
     * have a "Status" with different options — a unique name would have forced
     * the migration to merge or rename them, losing one. Duplicates are allowed
     * and the field picker warns before creating one.
     */
    it('allows a duplicate name, as two distinct definitions', async () => {
      const scope = await setupScope();

      const first = await createField(scope, {
        name: 'Notes',
        type: 'TEXT',
      }).expect(201);
      const second = await createField(scope, {
        name: 'Notes',
        type: 'TEXT',
      }).expect(201);

      expect(second.body.data.id).not.toBe(first.body.data.id);
    });

    it('refuses to attach the same field to a project twice', async () => {
      // The association is what is unique. Attaching twice would either
      // duplicate the column or silently do nothing; it is a conflict.
      const scope = await setupScope();
      const field = await createField(scope, {
        name: 'Notes',
        type: 'TEXT',
      }).expect(201);

      await request(server())
        .post(`${fieldsUrl(scope)}/${field.body.data.id}/attach`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect((response) => {
          // The attach route arrives in the next milestone; until then the
          // uniqueness is enforced by the database constraint alone.
          if (![404, 409].includes(response.status)) {
            throw new Error(`Expected 404 or 409, received ${response.status}`);
          }
        });
    });

    it('keeps a field and its values when another project stops using it', async () => {
      /*
       * The library's whole risk: removing a column from one project must not
       * take another project's data with it. With one project attached the old
       * behaviour still holds — the definition is archived because it holds
       * values — which is what this asserts until multi-project attachment
       * lands.
       */
      const scope = await setupScope();
      const field = await createField(scope, {
        name: 'Notes',
        type: 'TEXT',
      }).expect(201);

      await request(server())
        .put(
          url(
            `/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/custom-fields/${field.body.data.id}`,
          ),
        )
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ text: 'worth keeping' })
        .expect(200);

      const removed = await request(server())
        .delete(`${fieldsUrl(scope)}/${field.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(removed.body.data).toEqual({ deleted: false, archived: true, detachedProjects: 1 });
    });

    /* Managing the shape of a project's data is a MANAGER decision. */
    it('refuses a member without the role', async () => {
      const scope = await setupScope();

      await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.member.token}`)
        .send({ name: 'Sneaky', type: 'TEXT' })
        .expect(403);
    });

    it('does not reach across workspaces', async () => {
      const scope = await setupScope();
      const other = await setupScope();

      const theirs = await request(server())
        .post(fieldsUrl(other))
        .set('Authorization', `Bearer ${other.owner.token}`)
        .send({ name: 'Theirs', type: 'TEXT' })
        .expect(201);

      await request(server())
        .get(`${fieldsUrl(scope)}/${theirs.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('custom field values', () => {
    const valueUrl = (scope: Scope, fieldId: string) =>
      url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/custom-fields/${fieldId}`);

    it('stores and returns a value', async () => {
      const scope = await setupScope();

      const field = await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Notes', type: 'TEXT' })
        .expect(201);

      const response = await request(server())
        .put(valueUrl(scope, field.body.data.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ text: 'Needs review' })
        .expect(200);

      expect(response.body.data.text).toBe('Needs review');
    });

    /*
     * The check that stops a custom field being a way to store arbitrary ids:
     * a select value must name a live option *of that field*.
     */
    it('refuses an option that does not belong to the field', async () => {
      const scope = await setupScope();

      const field = await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({
          name: 'Department',
          type: 'SINGLE_SELECT',
          options: [{ label: 'Support' }],
        })
        .expect(201);

      const otherField = await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({
          name: 'Region',
          type: 'SINGLE_SELECT',
          options: [{ label: 'EMEA' }],
        })
        .expect(201);

      // A real option id, but from the wrong field.
      await request(server())
        .put(valueUrl(scope, field.body.data.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ optionIds: [otherField.body.data.options[0].id] })
        .expect(400);
    });

    it('refuses two choices on a single-select', async () => {
      const scope = await setupScope();

      const field = await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({
          name: 'Department',
          type: 'SINGLE_SELECT',
          options: [{ label: 'Support' }, { label: 'Platform' }],
        })
        .expect(201);

      await request(server())
        .put(valueUrl(scope, field.body.data.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({
          optionIds: field.body.data.options.map((o: { id: string }) => o.id),
        })
        .expect(400);
    });

    it('refuses a person who is not a workspace member', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      const field = await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Reviewer', type: 'PEOPLE' })
        .expect(201);

      await request(server())
        .put(valueUrl(scope, field.body.data.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userIds: [stranger.userId] })
        .expect(400);
    });

    /*
     * A field is easy to recreate; its data is not. One holding values archives,
     * an unused one is deleted outright.
     */
    it('archives a field that holds values, deletes one that does not', async () => {
      const scope = await setupScope();

      const used = await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Used', type: 'TEXT' })
        .expect(201);

      await request(server())
        .put(valueUrl(scope, used.body.data.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ text: 'something' })
        .expect(200);

      const archived = await request(server())
        .delete(`${fieldsUrl(scope)}/${used.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(archived.body.data).toEqual({ deleted: false, archived: true, detachedProjects: 1 });

      const unused = await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Unused', type: 'TEXT' })
        .expect(201);

      const deleted = await request(server())
        .delete(`${fieldsUrl(scope)}/${unused.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(deleted.body.data).toEqual({ deleted: true, archived: false, detachedProjects: 1 });
    });
  });
  // -------------------------------------------------------------------------
  describe('subtasks', () => {
    const subtasksUrl = (scope: Scope, taskId: string) =>
      url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/tasks/${taskId}/subtasks`);

    const addSubtask = async (scope: Scope, title: string, status?: string) => {
      const created = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title, parentTaskId: scope.taskId, projectId: scope.projectId })
        .expect(201);

      if (status) {
        await request(server())
          .patch(url(`/workspaces/${scope.workspaceId}/tasks/${created.body.data.id}`))
          .set('Authorization', `Bearer ${scope.owner.token}`)
          .send({ status })
          .expect(200);
      }

      return created.body.data.id as string;
    };

    it('returns a parent’s children shaped like view rows', async () => {
      const scope = await setupScope();
      await addSubtask(scope, 'First child');
      await addSubtask(scope, 'Second child');

      const response = await request(server())
        .get(subtasksUrl(scope, scope.taskId))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      // The List view renders these through the same cells as their parent, so
      // the field-value array has to be there even when it is empty.
      for (const row of response.body.data) {
        expect(Array.isArray(row.customFieldValues)).toBe(true);
        expect(row.parentTaskId).toBe(scope.taskId);
      }
    });

    it('carries custom field values, so a subtask row is not blank', async () => {
      const scope = await setupScope();
      const childId = await addSubtask(scope, 'Child with a field');

      const field = await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Notes', type: 'TEXT' })
        .expect(201);

      await request(server())
        .put(
          url(
            `/workspaces/${scope.workspaceId}/tasks/${childId}/custom-fields/${field.body.data.id}`,
          ),
        )
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ text: 'on the subtask' })
        .expect(200);

      const response = await request(server())
        .get(subtasksUrl(scope, scope.taskId))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data[0].customFieldValues).toEqual([
        expect.objectContaining({
          customFieldId: field.body.data.id,
          text: 'on the subtask',
        }),
      ]);
    });

    it('keeps subtasks out of the top level of the view', async () => {
      const scope = await setupScope();
      await addSubtask(scope, 'Hidden child');

      const view = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/tasks/query`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ filters: [], sorts: [] })
        .expect(200);

      expect(view.body.data).toHaveLength(1);
      expect(view.body.data[0].id).toBe(scope.taskId);
      expect(view.body.data[0].subtaskCount).toBe(1);
    });

    it('counts only subtasks that still exist', async () => {
      const scope = await setupScope();
      await addSubtask(scope, 'Still here');
      const doomed = await addSubtask(scope, 'Archived later', 'DONE');

      await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/tasks/${doomed}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const view = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/tasks/query`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ filters: [], sorts: [] })
        .expect(200);

      const rows = await request(server())
        .get(subtasksUrl(scope, scope.taskId))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      // The badge on a collapsed row and the rows it expands into have to agree.
      // They did not: the count included archived children while the completed
      // count beside it did not, so "1/2" expanded into a single row.
      expect(view.body.data[0].subtaskCount).toBe(rows.body.data.length);
      expect(view.body.data[0].completedSubtaskCount).toBe(0);
    });

    it('refuses a task that belongs to another project', async () => {
      const scope = await setupScope();
      await addSubtask(scope, 'A child');

      const other = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Another Project' })
        .expect(201);

      // The guard proves the caller belongs to the workspace, never that the
      // task id in the path belongs to the project in the path.
      await request(server())
        .get(
          url(
            `/workspaces/${scope.workspaceId}/projects/${other.body.data.id}/tasks/${scope.taskId}/subtasks`,
          ),
        )
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(404);
    });

    it('refuses a task from another workspace entirely', async () => {
      const scope = await setupScope();
      const outsider = await setupScope();

      await request(server())
        .get(subtasksUrl(scope, outsider.taskId))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(404);
    });
  });
  // -------------------------------------------------------------------------
  describe('field catalog', () => {
    const catalogUrl = (scope: Scope) =>
      url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/field-catalog`);

    it('answers with all four groups at once', async () => {
      const scope = await setupScope();
      await createField(scope, { name: 'Risk', type: 'TEXT' }).expect(201);

      const response = await request(server())
        .get(catalogUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const catalog = response.body.data;
      expect(catalog.fieldTypes.length).toBeGreaterThan(0);
      expect(catalog.systemFields.length).toBeGreaterThan(0);
      expect(catalog.projectFields.map((f: { name: string }) => f.name)).toContain('Risk');
      expect(catalog.libraryFields).toEqual([]);
    });

    it('offers only field types that actually work', async () => {
      // A type in the picker is one somebody can choose, and choosing a type
      // whose cells cannot hold a value is worse than not seeing it.
      const scope = await setupScope();

      const response = await request(server())
        .get(catalogUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const types = response.body.data.fieldTypes as { type: string; isComputed: boolean }[];
      const offered = types.map((t) => t.type);
      expect(offered).toHaveLength(11);
      expect(offered).toContain('RATING');
      expect(offered).not.toContain('ROLLUP');
      // A formula is offered, and flagged: it is chosen like any type but
      // never typed into, so every editor hides it by this one flag.
      expect(types.find((t) => t.type === 'FORMULA')).toMatchObject({ isComputed: true });
      expect(types.find((t) => t.type === 'NUMBER')).toMatchObject({ isComputed: false });
    });

    it('searches types, system fields and custom fields together', async () => {
      const scope = await setupScope();
      await createField(scope, { name: 'Delivery date', type: 'DATE' }).expect(201);

      const response = await request(server())
        .get(`${catalogUrl(scope)}?search=date`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const catalog = response.body.data;
      expect(catalog.fieldTypes.map((t: { type: string }) => t.type)).toContain('DATE');
      expect(catalog.systemFields.map((f: { label: string }) => f.label)).toContain('Due date');
      expect(catalog.projectFields.map((f: { name: string }) => f.name)).toContain('Delivery date');
    });

    it('still finds a field when its whole name is typed', async () => {
      /*
       * The moment somebody finishes typing "Delivery date", the field they are
       * looking at has to still be there. Matching the whole query against each
       * word meant it vanished on the space — no single word starts with two —
       * and the picker then offered to create a duplicate of it.
       */
      const scope = await setupScope();
      await createField(scope, { name: 'Delivery date', type: 'DATE' }).expect(201);

      const search = async (term: string) => {
        const response = await request(server())
          .get(`${catalogUrl(scope)}?search=${encodeURIComponent(term)}`)
          .set('Authorization', `Bearer ${scope.owner.token}`)
          .expect(200);

        return response.body.data.projectFields.map((f: { name: string }) => f.name);
      };

      expect(await search('Delivery date')).toContain('Delivery date');
      expect(await search('delivery dat')).toContain('Delivery date');

      // Order-independent, because the words are matched rather than the string.
      expect(await search('date delivery')).toContain('Delivery date');

      // And still not a substring match: "very" is inside "Delivery", not a word.
      expect(await search('very')).not.toContain('Delivery date');
    });

    it('marks a custom field already in the view rather than hiding it', async () => {
      /*
       * Hiding it was worse than useless: the picker saw no field by that name
       * and offered to create a second one, so the way to end up with two
       * identical fields was to search for the one you already had.
       */
      const scope = await setupScope();
      const created = await createField(scope, {
        name: 'Exposure',
        type: 'TEXT',
      }).expect(201);
      const fieldId = created.body.data.id;

      const response = await request(server())
        .get(`${catalogUrl(scope)}?search=Exposure&visible=title,custom:${fieldId}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const field = response.body.data.projectFields.find((f: { id: string }) => f.id === fieldId);

      expect(field).toBeDefined();
      expect(field.isInView).toBe(true);
    });

    it('marks a system field already in the view rather than hiding it', async () => {
      // Silently omitting it reads as the search having failed to find it.
      const scope = await setupScope();

      const response = await request(server())
        .get(`${catalogUrl(scope)}?visible=title,status`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const status = response.body.data.systemFields.find(
        (f: { key: string }) => f.key === 'status',
      );
      expect(status.isInView).toBe(true);
    });

    it('carries the metadata that decides filters, sorts and grouping', async () => {
      const scope = await setupScope();

      const response = await request(server())
        .get(catalogUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const assignee = response.body.data.systemFields.find(
        (f: { key: string }) => f.key === 'assigneeId',
      );
      expect(assignee).toMatchObject({
        label: 'Assignee',
        dataType: 'PEOPLE',
        isSortable: true,
        isFilterable: true,
        isGroupable: true,
        isEditable: true,
      });

      // Derived values are shown but never edited from the grid.
      const createdAt = response.body.data.systemFields.find(
        (f: { key: string }) => f.key === 'createdAt',
      );
      expect(createdAt.isEditable).toBe(false);
    });

    it('never shows another workspace’s fields', async () => {
      const scope = await setupScope();
      const outsider = await setupScope();
      await createField(outsider, { name: 'Secret', type: 'TEXT' }).expect(201);

      const response = await request(server())
        .get(catalogUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const everyName = [
        ...response.body.data.projectFields,
        ...response.body.data.libraryFields,
      ].map((f: { name: string }) => f.name);
      expect(everyName).not.toContain('Secret');
    });
  });

  // -------------------------------------------------------------------------
  describe('field library', () => {
    const secondProject = async (scope: Scope): Promise<string> => {
      const created = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Second Project' })
        .expect(201);

      return created.body.data.id as string;
    };

    it('reuses one definition across two projects', async () => {
      const scope = await setupScope();
      const field = await createField(scope, {
        name: 'Risk',
        type: 'TEXT',
      }).expect(201);
      const otherId = await secondProject(scope);

      const attached = await request(server())
        .post(
          url(
            `/workspaces/${scope.workspaceId}/projects/${otherId}/custom-fields/${field.body.data.id}/attach`,
          ),
        )
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(201);

      // The same definition, not a copy — that is what makes it reusable.
      expect(attached.body.data.id).toBe(field.body.data.id);

      const catalog = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/projects/${otherId}/field-catalog`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const risk = catalog.body.data.projectFields.find((f: { name: string }) => f.name === 'Risk');
      expect(risk.usageCount).toBe(2);
    });

    it('offers a field the project does not have as a library field', async () => {
      const scope = await setupScope();
      await createField(scope, { name: 'Risk', type: 'TEXT' }).expect(201);
      const otherId = await secondProject(scope);

      const catalog = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/projects/${otherId}/field-catalog`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(catalog.body.data.projectFields).toEqual([]);
      expect(catalog.body.data.libraryFields.map((f: { name: string }) => f.name)).toContain(
        'Risk',
      );
    });

    it('leaves the definition alone when one project stops using it', async () => {
      /*
       * The library's whole risk: removing a column from one project must never
       * take another project's data with it.
       */
      const scope = await setupScope();
      const field = await createField(scope, {
        name: 'Risk',
        type: 'TEXT',
      }).expect(201);
      const otherId = await secondProject(scope);

      await request(server())
        .post(
          url(
            `/workspaces/${scope.workspaceId}/projects/${otherId}/custom-fields/${field.body.data.id}/attach`,
          ),
        )
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(201);

      const removed = await request(server())
        .delete(`${fieldsUrl(scope)}/${field.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      // Detached here, neither deleted nor archived, because it is still in use.
      expect(removed.body.data).toEqual({ deleted: false, archived: false, detachedProjects: 1 });

      const stillThere = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/projects/${otherId}/custom-fields`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(stillThere.body.data.map((f: { name: string }) => f.name)).toContain('Risk');
    });

    it('refuses to attach the same field twice', async () => {
      const scope = await setupScope();
      const field = await createField(scope, {
        name: 'Risk',
        type: 'TEXT',
      }).expect(201);

      await request(server())
        .post(`${fieldsUrl(scope)}/${field.body.data.id}/attach`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(409);
    });

    it('refuses to attach a field from another workspace', async () => {
      const scope = await setupScope();
      const outsider = await setupScope();
      const theirs = await createField(outsider, {
        name: 'Secret',
        type: 'TEXT',
      }).expect(201);

      await request(server())
        .post(`${fieldsUrl(scope)}/${theirs.body.data.id}/attach`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(404);
    });

    it('refuses a member without the role', async () => {
      const scope = await setupScope();
      const field = await createField(scope, {
        name: 'Risk',
        type: 'TEXT',
      }).expect(201);
      const otherId = await secondProject(scope);

      await request(server())
        .post(
          url(
            `/workspaces/${scope.workspaceId}/projects/${otherId}/custom-fields/${field.body.data.id}/attach`,
          ),
        )
        .set('Authorization', `Bearer ${scope.member.token}`)
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('field settings', () => {
    it('stores type-specific settings and fills in the defaults', async () => {
      const scope = await setupScope();

      const created = await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Notes', type: 'TEXT', settings: { textMode: 'LONG' } })
        .expect(201);

      expect(created.body.data.settings).toEqual({ textMode: 'LONG' });

      const plain = await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Points', type: 'NUMBER' })
        .expect(201);

      // A field always carries a complete document, so no reader has to know
      // what a missing key used to mean.
      expect(plain.body.data.settings).toEqual({
        numberFormat: 'PLAIN',
        decimalPlaces: 0,
      });
    });

    it('rejects a setting that is not valid for the type', async () => {
      const scope = await setupScope();

      await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Notes', type: 'TEXT', settings: { textMode: 'MEDIUM' } })
        .expect(422);
    });

    it('rejects a number range that cannot contain anything', async () => {
      const scope = await setupScope();

      await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({
          name: 'Points',
          type: 'NUMBER',
          settings: { minValue: 10, maxValue: 1 },
        })
        .expect(422);
    });

    it('stores a currency and a custom unit, and refuses either without its half', async () => {
      const scope = await setupScope();

      const currency = await createField(scope, {
        name: 'Budget',
        type: 'NUMBER',
        settings: { numberFormat: 'CURRENCY', currencyCode: 'EUR', decimalPlaces: 2 },
      }).expect(201);
      expect(currency.body.data.settings).toEqual({
        numberFormat: 'CURRENCY',
        currencyCode: 'EUR',
        decimalPlaces: 2,
      });

      const unit = await createField(scope, {
        name: 'Effort',
        type: 'NUMBER',
        settings: { numberFormat: 'CUSTOM_UNIT', unitLabel: 'pts', unitPosition: 'SUFFIX' },
      }).expect(201);
      expect(unit.body.data.settings).toMatchObject({ unitLabel: 'pts', unitPosition: 'SUFFIX' });

      await createField(scope, {
        name: 'No code',
        type: 'NUMBER',
        settings: { numberFormat: 'CURRENCY' },
      }).expect(422);
      await createField(scope, {
        name: 'No label',
        type: 'NUMBER',
        settings: { numberFormat: 'CUSTOM_UNIT' },
      }).expect(422);
    });
  });

  // -------------------------------------------------------------------------
  describe('rating and formula fields', () => {
    const valueUrl = (scope: Scope, fieldId: string, taskId = scope.taskId) =>
      url(`/workspaces/${scope.workspaceId}/tasks/${taskId}/custom-fields/${fieldId}`);
    const setValue = (
      scope: Scope,
      fieldId: string,
      body: Record<string, unknown>,
      taskId = scope.taskId,
    ) =>
      request(server())
        .put(valueUrl(scope, fieldId, taskId))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send(body);
    const queryRows = async (scope: Scope, body: Record<string, unknown> = {}) => {
      const response = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/tasks/query`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ filters: [], sorts: [], ...body });
      return response;
    };
    const valueOf = (
      row: { customFieldValues: { customFieldId: string; number: number | null }[] },
      fieldId: string,
    ) => row.customFieldValues.find((value) => value.customFieldId === fieldId);
    const ref = (fieldId: string) => `{field:${fieldId}}`;

    const numberField = async (scope: Scope, name: string): Promise<string> => {
      const created = await createField(scope, { name, type: 'NUMBER' }).expect(201);
      return created.body.data.id as string;
    };
    const formulaField = (scope: Scope, name: string, expression: string) =>
      createField(scope, { name, type: 'FORMULA', settings: { expression } });

    it('stores a rating within its bounds and refuses one outside them', async () => {
      const scope = await setupScope();

      const field = await createField(scope, {
        name: 'Confidence',
        type: 'RATING',
        settings: { maxRating: 7 },
      }).expect(201);
      const fieldId = field.body.data.id as string;
      expect(field.body.data.settings).toEqual({ maxRating: 7 });

      const stored = await setValue(scope, fieldId, { number: 5 }).expect(200);
      expect(stored.body.data.number).toBe(5);

      await setValue(scope, fieldId, { number: 8 }).expect(400);
      await setValue(scope, fieldId, { number: 0 }).expect(400);
      await setValue(scope, fieldId, { number: 2.5 }).expect(400);
    });

    it('defaults a rating to five stars, inside the allowed range', async () => {
      const scope = await setupScope();

      const field = await createField(scope, { name: 'Stars', type: 'RATING' }).expect(201);
      expect(field.body.data.settings).toEqual({ maxRating: 5 });

      await createField(scope, {
        name: 'Too many',
        type: 'RATING',
        settings: { maxRating: 11 },
      }).expect(422);
    });

    it('works a formula out on read, and blanks it while an operand is empty', async () => {
      const scope = await setupScope();
      const effort = await numberField(scope, 'Effort');
      const rate = await numberField(scope, 'Rate');
      const total = await formulaField(scope, 'Total', `${ref(effort)} * ${ref(rate)}`).expect(201);
      const totalId = total.body.data.id as string;

      // Nothing set yet: the formula is present and blank, never zero.
      const blank = await queryRows(scope).then((r) => r.body.data[0]);
      expect(valueOf(blank, totalId)).toMatchObject({ number: null });

      await setValue(scope, effort, { number: 3 }).expect(200);
      await setValue(scope, rate, { number: 2.5 }).expect(200);

      const computed = await queryRows(scope).then((r) => r.body.data[0]);
      expect(valueOf(computed, totalId)).toMatchObject({ number: 7.5 });

      // Nothing is stored for it, so there is nothing to get stale.
      const rows = await context.prisma.taskCustomFieldValue.count({
        where: { customFieldId: totalId },
      });
      expect(rows).toBe(0);

      await request(server())
        .delete(valueUrl(scope, rate))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(204);

      const again = await queryRows(scope).then((r) => r.body.data[0]);
      expect(valueOf(again, totalId)).toMatchObject({ number: null });
    });

    it('subtracts dates with days_between, and follows one formula into another', async () => {
      const scope = await setupScope();
      const start = await createField(scope, { name: 'Start', type: 'DATE' }).expect(201);
      const end = await createField(scope, { name: 'End', type: 'DATE' }).expect(201);
      const startId = start.body.data.id as string;
      const endId = end.body.data.id as string;

      const days = await formulaField(
        scope,
        'Days',
        `days_between(${ref(startId)}, ${ref(endId)})`,
      ).expect(201);
      const weeks = await formulaField(scope, 'Weeks', `${ref(days.body.data.id)} / 7`).expect(201);

      await setValue(scope, startId, { date: '2026-01-01T00:00:00.000Z' }).expect(200);
      await setValue(scope, endId, { date: '2026-01-15T00:00:00.000Z' }).expect(200);

      const row = await queryRows(scope).then((r) => r.body.data[0]);
      expect(valueOf(row, days.body.data.id)).toMatchObject({ number: 14 });
      expect(valueOf(row, weeks.body.data.id)).toMatchObject({ number: 2 });
    });

    it('carries computed values on subtask rows too', async () => {
      const scope = await setupScope();
      const effort = await numberField(scope, 'Effort');
      const doubled = await formulaField(scope, 'Doubled', `${ref(effort)} * 2`).expect(201);

      const child = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: 'Child', parentTaskId: scope.taskId, projectId: scope.projectId })
        .expect(201);
      await setValue(scope, effort, { number: 4 }, child.body.data.id).expect(200);

      const subtasks = await request(server())
        .get(
          url(
            `/workspaces/${scope.workspaceId}/projects/${scope.projectId}/tasks/${scope.taskId}/subtasks`,
          ),
        )
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(valueOf(subtasks.body.data[0], doubled.body.data.id)).toMatchObject({ number: 8 });
    });

    it('refuses a formula that names a field the project lacks, or one of the wrong type', async () => {
      const scope = await setupScope();
      const notes = await createField(scope, { name: 'Notes', type: 'TEXT' }).expect(201);

      await formulaField(scope, 'Missing', `${ref(crypto.randomUUID())} + 1`).expect(422);
      await formulaField(scope, 'Text', `${ref(notes.body.data.id)} + 1`).expect(422);
      await formulaField(scope, 'Broken', '1 +').expect(422);
    });

    it('refuses a formula that names itself, or loops through another formula', async () => {
      const scope = await setupScope();
      const a = await formulaField(scope, 'A', '1').expect(201);
      const aId = a.body.data.id as string;

      const patch = (fieldId: string, expression: string) =>
        request(server())
          .patch(`${fieldsUrl(scope)}/${fieldId}`)
          .set('Authorization', `Bearer ${scope.owner.token}`)
          .send({ settings: { expression } });

      await patch(aId, `${ref(aId)} + 1`).expect(422);

      const b = await formulaField(scope, 'B', `${ref(aId)} * 2`).expect(201);
      await patch(aId, ref(b.body.data.id)).expect(422);

      // A change that keeps the graph acyclic still goes through.
      await patch(aId, '2').expect(200);
    });

    it('cannot be required, and cannot be set by hand', async () => {
      const scope = await setupScope();

      await createField(scope, {
        name: 'Required',
        type: 'FORMULA',
        isRequired: true,
        settings: { expression: '1' },
      }).expect(422);

      const formula = await formulaField(scope, 'Fixed', '42').expect(201);
      await setValue(scope, formula.body.data.id, { number: 1 }).expect(422);
      await request(server())
        .patch(`${fieldsUrl(scope)}/${formula.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ isRequired: true })
        .expect(422);
    });

    it('is refused as a filter, by name', async () => {
      const scope = await setupScope();
      const formula = await formulaField(scope, 'Fixed', '42').expect(201);

      const refused = await queryRows(scope, {
        filters: [{ field: `custom:${formula.body.data.id}`, operator: 'IS_EMPTY' }],
      });
      expect(refused.status).toBe(400);
      expect(refused.body.error.message).toMatch(/calculated/i);
    });

    it('keeps a field a formula reads on the project until the formula lets go', async () => {
      const scope = await setupScope();
      const effort = await numberField(scope, 'Effort');
      const formula = await formulaField(scope, 'Doubled', `${ref(effort)} * 2`).expect(201);

      const remove = (fieldId: string) =>
        request(server())
          .delete(`${fieldsUrl(scope)}/${fieldId}`)
          .set('Authorization', `Bearer ${scope.owner.token}`);

      const refused = await remove(effort).expect(422);
      expect(refused.body.error.message).toContain('Doubled');

      await remove(formula.body.data.id).expect(200);
      await remove(effort).expect(200);
    });

    it('comes to a second project only where its operands already are', async () => {
      const scope = await setupScope();
      const effort = await numberField(scope, 'Effort');
      const formula = await formulaField(scope, 'Doubled', `${ref(effort)} * 2`).expect(201);

      const other = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Second Project' })
        .expect(201);
      const attach = (fieldId: string) =>
        request(server())
          .post(
            url(
              `/workspaces/${scope.workspaceId}/projects/${other.body.data.id}/custom-fields/${fieldId}/attach`,
            ),
          )
          .set('Authorization', `Bearer ${scope.owner.token}`);

      const refused = await attach(formula.body.data.id).expect(422);
      expect(refused.body.error.message).toContain('Doubled');

      await attach(effort).expect(201);
      await attach(formula.body.data.id).expect(201);
    });
  });

  // -------------------------------------------------------------------------
  describe('field change stories and notifications', () => {
    const setValue = (scope: Scope, fieldId: string, body: Record<string, unknown>) =>
      request(server())
        .put(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/custom-fields/${fieldId}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send(body);

    interface Story {
      action: string;
      summary: string;
      metadata: {
        fieldName: string;
        before: { label: string } | null;
        after: { label: string } | null;
        source: string;
      } | null;
    }

    const fieldStories = async (scope: Scope): Promise<Story[]> => {
      const response = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/activity/item`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .query({ entity: 'TASK', entityId: scope.taskId })
        .expect(200);
      return (response.body.data.items as Story[]).filter(
        (story) => story.action === 'FIELD_CHANGED',
      );
    };

    it('files one story per change under the task, with the words a person reads', async () => {
      const scope = await setupScope();
      const field = await createField(scope, {
        name: 'Severity',
        type: 'SINGLE_SELECT',
        options: [{ label: 'Low' }, { label: 'High' }],
      }).expect(201);
      const [low, high] = field.body.data.options as { id: string }[];
      const fieldId = field.body.data.id as string;

      await setValue(scope, fieldId, { optionIds: [low!.id] }).expect(200);
      await setValue(scope, fieldId, { optionIds: [high!.id] }).expect(200);
      await request(server())
        .delete(
          url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/custom-fields/${fieldId}`),
        )
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(204);

      // Newest first.
      const stories = await fieldStories(scope);
      expect(stories.map((story) => story.summary)).toEqual([
        'Cleared Severity',
        'Changed Severity from Low to High',
        'Set Severity to Low',
      ]);
      expect(stories[1]?.metadata).toMatchObject({
        fieldName: 'Severity',
        before: { label: 'Low' },
        after: { label: 'High' },
        source: 'USER',
      });
      expect(stories[0]?.metadata?.after).toBeNull();
    });

    it('names people in the story rather than their ids', async () => {
      const scope = await setupScope();
      const field = await createField(scope, { name: 'Reviewer', type: 'PEOPLE' }).expect(201);

      await setValue(scope, field.body.data.id, { userIds: [scope.member.userId] }).expect(200);

      const [story] = await fieldStories(scope);
      expect(story?.metadata?.after).toMatchObject({ label: 'Member' });
    });

    it('writes nothing for a change that changed nothing', async () => {
      const scope = await setupScope();
      const field = await createField(scope, { name: 'Notes', type: 'TEXT' }).expect(201);

      await setValue(scope, field.body.data.id, { text: '' }).expect(200);

      expect(await fieldStories(scope)).toHaveLength(0);
    });

    it('notifies the task’s collaborators only when the project asked, and never the actor', async () => {
      const scope = await setupScope();

      // Assigning makes the member a collaborator; the owner already is one.
      await request(server())
        .patch(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ assigneeId: scope.member.userId })
        .expect(200);

      const loud = await createField(scope, {
        name: 'Launch',
        type: 'DATE',
        notifyOnChange: true,
      }).expect(201);
      expect(loud.body.data.notifyOnChange).toBe(true);
      const quiet = await createField(scope, { name: 'Points', type: 'NUMBER' }).expect(201);
      expect(quiet.body.data.notifyOnChange).toBe(false);

      await setValue(scope, loud.body.data.id, { date: '2026-10-01T00:00:00.000Z' }).expect(200);
      await setValue(scope, quiet.body.data.id, { number: 3 }).expect(200);

      const notifications = await context.prisma.notification.findMany({
        where: { workspaceId: scope.workspaceId, type: 'FIELD_CHANGED' },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        userId: scope.member.userId,
        entityId: scope.taskId,
        actionUrl: `/my-tasks?task=${scope.taskId}`,
      });
      expect(notifications[0]?.title).toBe(
        'Owner changed Launch to 2026-10-01T00:00:00.000Z on “A task”',
      );
    });

    it('turns the notification on and off per project', async () => {
      const scope = await setupScope();
      const field = await createField(scope, { name: 'Points', type: 'NUMBER' }).expect(201);

      const on = await request(server())
        .patch(`${fieldsUrl(scope)}/${field.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ notifyOnChange: true })
        .expect(200);
      expect(on.body.data.notifyOnChange).toBe(true);

      const link = await context.prisma.projectCustomField.findUniqueOrThrow({
        where: {
          projectId_customFieldId: {
            projectId: scope.projectId,
            customFieldId: field.body.data.id,
          },
        },
      });
      expect(link.notifyOnChange).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('field library modes', () => {
    const remove = (scope: Scope, fieldId: string, mode?: string) =>
      request(server())
        .delete(`${fieldsUrl(scope)}/${fieldId}${mode ? `?mode=${mode}` : ''}`)
        .set('Authorization', `Bearer ${scope.owner.token}`);
    const setValue = (scope: Scope, fieldId: string, body: Record<string, unknown>) =>
      request(server())
        .put(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/custom-fields/${fieldId}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send(body);
    const libraryUrl = (scope: Scope, fieldId: string) =>
      url(`/workspaces/${scope.workspaceId}/custom-fields/${fieldId}`);
    const secondProject = async (scope: Scope): Promise<string> => {
      const created = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Second Project' })
        .expect(201);
      return created.body.data.id as string;
    };
    const attach = (scope: Scope, projectId: string, fieldId: string) =>
      request(server())
        .post(
          url(
            `/workspaces/${scope.workspaceId}/projects/${projectId}/custom-fields/${fieldId}/attach`,
          ),
        )
        .set('Authorization', `Bearer ${scope.owner.token}`);

    it('`?mode=detach` keeps the definition even when nobody else uses it', async () => {
      const scope = await setupScope();
      const field = await createField(scope, { name: 'Points', type: 'NUMBER' }).expect(201);
      const fieldId = field.body.data.id as string;
      await setValue(scope, fieldId, { number: 3 }).expect(200);

      const removed = await remove(scope, fieldId, 'detach').expect(200);
      expect(removed.body.data).toEqual({ deleted: false, archived: false, detachedProjects: 1 });

      const definition = await context.prisma.customField.findUnique({ where: { id: fieldId } });
      expect(definition?.isArchived).toBe(false);

      // Back it comes, values intact.
      await attach(scope, scope.projectId, fieldId).expect(201);
      const value = await context.prisma.taskCustomFieldValue.findUnique({
        where: { taskId_customFieldId: { taskId: scope.taskId, customFieldId: fieldId } },
      });
      expect(Number(value?.numberValue)).toBe(3);
    });

    it('`?mode=delete` takes the field off every project, archiving it while values exist', async () => {
      const scope = await setupScope();
      const field = await createField(scope, { name: 'Points', type: 'NUMBER' }).expect(201);
      const fieldId = field.body.data.id as string;
      const other = await secondProject(scope);
      await attach(scope, other, fieldId).expect(201);
      await setValue(scope, fieldId, { number: 3 }).expect(200);

      const removed = await remove(scope, fieldId, 'delete').expect(200);
      expect(removed.body.data).toEqual({ deleted: false, archived: true, detachedProjects: 2 });

      const elsewhere = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/projects/${other}/custom-fields`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(elsewhere.body.data).toEqual([]);

      const definition = await context.prisma.customField.findUnique({ where: { id: fieldId } });
      expect(definition?.isArchived).toBe(true);
    });

    it('`?mode=delete` removes an unused field outright', async () => {
      const scope = await setupScope();
      const field = await createField(scope, { name: 'Points', type: 'NUMBER' }).expect(201);
      const fieldId = field.body.data.id as string;

      const removed = await remove(scope, fieldId, 'delete').expect(200);
      expect(removed.body.data).toEqual({ deleted: true, archived: false, detachedProjects: 1 });
      expect(await context.prisma.customField.findUnique({ where: { id: fieldId } })).toBeNull();
    });

    it('refuses a mode it does not know', async () => {
      const scope = await setupScope();
      const field = await createField(scope, { name: 'Points', type: 'NUMBER' }).expect(201);

      await remove(scope, field.body.data.id, 'purge').expect(422);
    });

    it('restores an archived field through the workspace route, values and all', async () => {
      const scope = await setupScope();
      const field = await createField(scope, { name: 'Points', type: 'NUMBER' }).expect(201);
      const fieldId = field.body.data.id as string;
      await setValue(scope, fieldId, { number: 3 }).expect(200);
      await remove(scope, fieldId, 'delete').expect(200);

      // Archived and attached nowhere: no project route can reach it now.
      await attach(scope, scope.projectId, fieldId).expect(400);

      const restored = await request(server())
        .patch(libraryUrl(scope, fieldId))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ isArchived: false, name: 'Story points' })
        .expect(200);
      expect(restored.body.data).toMatchObject({
        id: fieldId,
        name: 'Story points',
        isArchived: false,
      });

      await attach(scope, scope.projectId, fieldId).expect(201);

      const rows = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/tasks/query`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ filters: [], sorts: [] })
        .expect(200);
      expect(rows.body.data[0].customFieldValues).toEqual([
        expect.objectContaining({ customFieldId: fieldId, number: 3 }),
      ]);
    });

    it('keeps the workspace route to managers, and inside the workspace', async () => {
      const scope = await setupScope();
      const field = await createField(scope, { name: 'Points', type: 'NUMBER' }).expect(201);
      const fieldId = field.body.data.id as string;

      await request(server())
        .patch(libraryUrl(scope, fieldId))
        .set('Authorization', `Bearer ${scope.member.token}`)
        .send({ name: 'Mine now' })
        .expect(403);

      const stranger = await setupScope();
      await request(server())
        .patch(libraryUrl(stranger, fieldId))
        .set('Authorization', `Bearer ${stranger.owner.token}`)
        .send({ name: 'Mine now' })
        .expect(404);

      await request(server())
        .patch(libraryUrl(scope, fieldId))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({})
        .expect(400);
    });

    it('hides an option from the choices while cells holding it keep their label', async () => {
      const scope = await setupScope();
      const field = await createField(scope, {
        name: 'Severity',
        type: 'SINGLE_SELECT',
        options: [{ label: 'Low' }, { label: 'High' }],
      }).expect(201);
      const fieldId = field.body.data.id as string;
      const high = (field.body.data.options as { id: string; label: string }[])[1]!;
      await setValue(scope, fieldId, { optionIds: [high.id] }).expect(200);

      const hidden = await request(server())
        .patch(`${fieldsUrl(scope)}/${fieldId}/options/${high.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ isArchived: true })
        .expect(200);

      // Still listed, flagged, so a cell holding it can say "High" greyed out.
      expect(hidden.body.data.options).toEqual([
        expect.objectContaining({ label: 'Low', isArchived: false }),
        expect.objectContaining({ id: high.id, label: 'High', isArchived: true }),
      ]);

      // No longer a choice.
      await setValue(scope, fieldId, { optionIds: [high.id] }).expect(400);

      // The value it was already holding is untouched.
      const value = await context.prisma.taskCustomFieldValue.findUnique({
        where: { taskId_customFieldId: { taskId: scope.taskId, customFieldId: fieldId } },
      });
      expect(value?.optionIds).toEqual([high.id]);

      await request(server())
        .patch(`${fieldsUrl(scope)}/${fieldId}/options/${high.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ isArchived: false })
        .expect(200);
      await setValue(scope, fieldId, { optionIds: [high.id] }).expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('work-item query settings', () => {
    const itemsUrl = (scope: Scope) =>
      url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/work-items`);
    const auth = (scope: Scope) => `Bearer ${scope.owner.token}`;

    const listItems = (scope: Scope, params: Record<string, unknown> = {}) =>
      request(server()).get(itemsUrl(scope)).set('Authorization', auth(scope)).query(params);

    const createItem = async (scope: Scope, body: Record<string, unknown>): Promise<string> => {
      const response = await request(server())
        .post(itemsUrl(scope))
        .set('Authorization', auth(scope))
        .send({ type: 'TASK', ...body })
        .expect(201);
      return response.body.data.id as string;
    };

    const patchItem = (scope: Scope, id: string, body: Record<string, unknown>) =>
      request(server())
        .patch(`${itemsUrl(scope)}/${id}`)
        .set('Authorization', auth(scope))
        .send(body)
        .expect(200);

    const setValue = (
      scope: Scope,
      taskId: string,
      fieldId: string,
      body: Record<string, unknown>,
    ) =>
      request(server())
        .put(url(`/workspaces/${scope.workspaceId}/tasks/${taskId}/custom-fields/${fieldId}`))
        .set('Authorization', auth(scope))
        .send(body)
        .expect(200);

    const titlesOf = (response: { body: { data: { items: { title: string }[] } } }) =>
      response.body.data.items.map((item) => item.title);

    const sorts = (...entries: { field: string; direction: 'ASC' | 'DESC' }[]) =>
      JSON.stringify(entries);
    const filters = (...entries: Record<string, unknown>[]) => JSON.stringify(entries);

    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10) + 'T00:00:00.000Z';

    describe('sorting', () => {
      it('orders by a number field, empties last in both directions', async () => {
        const scope = await setupScope();
        const field = await createField(scope, { name: 'Effort', type: 'NUMBER' }).expect(201);
        const fieldId = field.body.data.id as string;

        const three = await createItem(scope, { title: 'Three' });
        const one = await createItem(scope, { title: 'One' });
        await createItem(scope, { title: 'Blank' });
        await setValue(scope, three, fieldId, { number: 3 });
        await setValue(scope, one, fieldId, { number: 1 });

        const descending = await listItems(scope, {
          sorts: sorts({ field: `custom:${fieldId}`, direction: 'DESC' }),
        }).expect(200);
        expect(titlesOf(descending)).toEqual(['Three', 'One', 'A task', 'Blank']);

        const ascending = await listItems(scope, {
          sorts: sorts({ field: `custom:${fieldId}`, direction: 'ASC' }),
        }).expect(200);
        expect(titlesOf(ascending)).toEqual(['One', 'Three', 'A task', 'Blank']);
      });

      it('orders a single-select by the option’s position, not its label', async () => {
        const scope = await setupScope();
        const field = await createField(scope, {
          name: 'Size',
          type: 'SINGLE_SELECT',
          options: [{ label: 'Zebra' }, { label: 'Apple' }],
        }).expect(201);
        const [zebra, apple] = field.body.data.options as { id: string }[];
        const fieldId = field.body.data.id as string;

        const a = await createItem(scope, { title: 'Apple-sized' });
        const z = await createItem(scope, { title: 'Zebra-sized' });
        await setValue(scope, a, fieldId, { optionIds: [apple!.id] });
        await setValue(scope, z, fieldId, { optionIds: [zebra!.id] });

        const response = await listItems(scope, {
          sorts: sorts({ field: `custom:${fieldId}`, direction: 'ASC' }),
        }).expect(200);
        expect(titlesOf(response).slice(0, 2)).toEqual(['Zebra-sized', 'Apple-sized']);
      });

      it('interleaves tickets on a date sort and puts them last on a custom one', async () => {
        const scope = await setupScope();
        const field = await createField(scope, { name: 'Effort', type: 'NUMBER' }).expect(201);
        const fieldId = field.body.data.id as string;

        const later = await createItem(scope, { title: 'Later task', dueDate: day(3) });
        await createItem(scope, { type: 'TICKET', title: 'Middle ticket', dueDate: day(2) });
        const soon = await createItem(scope, { title: 'Soon task', dueDate: day(1) });
        await setValue(scope, later, fieldId, { number: 5 });
        await setValue(scope, soon, fieldId, { number: 7 });

        const byDate = await listItems(scope, {
          sorts: sorts({ field: 'dueDate', direction: 'ASC' }),
        }).expect(200);
        expect(titlesOf(byDate)).toEqual(['Soon task', 'Middle ticket', 'Later task', 'A task']);

        const byEffort = await listItems(scope, {
          sorts: sorts({ field: `custom:${fieldId}`, direction: 'DESC' }),
        }).expect(200);
        // Valued tasks, then the unvalued task and the ticket by position.
        expect(titlesOf(byEffort).slice(0, 2)).toEqual(['Soon task', 'Later task']);
        expect(titlesOf(byEffort)).toContain('Middle ticket');
        expect(titlesOf(byEffort).indexOf('Middle ticket')).toBeGreaterThan(1);
      });

      it('leads with the group key, so groups never fragment', async () => {
        const scope = await setupScope();
        await createItem(scope, { title: 'Busy', statusId: 'IN_PROGRESS' });
        await createItem(scope, { title: 'Alpha todo' });
        await createItem(scope, { title: 'Zulu todo' });

        const response = await listItems(scope, {
          groupBy: 'status',
          sorts: sorts({ field: 'title', direction: 'DESC' }),
        }).expect(200);

        // TODO before IN_PROGRESS in the enum's order; inside TODO, Z before A.
        expect(titlesOf(response)).toEqual(['Zulu todo', 'Alpha todo', 'A task', 'Busy']);
      });

      it('orders people by name on both kinds', async () => {
        const scope = await setupScope();
        await createItem(scope, { title: 'Owner’s task', assigneeIds: [scope.owner.userId] });
        await createItem(scope, {
          type: 'TICKET',
          title: 'Member’s ticket',
          assigneeIds: [scope.member.userId],
        });

        const response = await listItems(scope, {
          sorts: sorts({ field: 'assigneeId', direction: 'ASC' }),
        }).expect(200);
        // "Member" before "Owner"; the unassigned row last.
        expect(titlesOf(response)).toEqual(['Member’s ticket', 'Owner’s task', 'A task']);
      });

      it('answers the same way twice when keys tie', async () => {
        const scope = await setupScope();
        for (const title of ['One', 'Two', 'Three']) await createItem(scope, { title });

        const first = await listItems(scope, {
          sorts: sorts({ field: 'dueDate', direction: 'ASC' }),
        }).expect(200);
        const second = await listItems(scope, {
          sorts: sorts({ field: 'dueDate', direction: 'ASC' }),
        }).expect(200);

        expect(titlesOf(first)).toEqual(titlesOf(second));
        expect(titlesOf(first)).toHaveLength(4);
      });

      it('refuses a field this project does not have, and a formula', async () => {
        const scope = await setupScope();
        const other = await setupScope();
        const theirs = await createField(other, { name: 'Theirs', type: 'NUMBER' }).expect(201);
        const formula = await createField(scope, {
          name: 'Fixed',
          type: 'FORMULA',
          settings: { expression: '1' },
        }).expect(201);

        await listItems(scope, {
          sorts: sorts({ field: `custom:${theirs.body.data.id}`, direction: 'ASC' }),
        }).expect(400);
        await listItems(scope, {
          sorts: sorts({ field: `custom:${formula.body.data.id}`, direction: 'ASC' }),
        }).expect(400);
        // A well-formed reference that names nothing is the compiler's to refuse.
        await listItems(scope, { sorts: sorts({ field: 'wibble', direction: 'ASC' }) }).expect(400);
      });
    });

    describe('filtering', () => {
      it('applies a filter with no sort at all', async () => {
        const scope = await setupScope();
        await createItem(scope, { title: 'Mine', assigneeIds: [scope.member.userId] });
        await createItem(scope, {
          type: 'TICKET',
          title: 'My ticket',
          assigneeIds: [scope.member.userId],
        });
        await createItem(scope, { title: 'Nobody’s' });

        const response = await listItems(scope, {
          filters: filters({ field: 'assigneeId', operator: 'IN', value: [scope.member.userId] }),
        }).expect(200);
        expect(titlesOf(response).sort()).toEqual(['Mine', 'My ticket']);
      });

      it('hides done tasks and resolved tickets when asked', async () => {
        const scope = await setupScope();
        const done = await createItem(scope, { title: 'Done' });
        const resolved = await createItem(scope, { type: 'TICKET', title: 'Resolved' });
        await createItem(scope, { type: 'TICKET', title: 'Open' });
        await patchItem(scope, done, { statusId: 'DONE' });
        await patchItem(scope, resolved, { statusId: 'RESOLVED' });

        const hidden = await listItems(scope, { showCompleted: 'false' }).expect(200);
        expect(titlesOf(hidden).sort()).toEqual(['A task', 'Open']);

        const shown = await listItems(scope, { showCompleted: 'true' }).expect(200);
        expect(titlesOf(shown)).toHaveLength(4);
      });

      it('resolves a relative date at query time', async () => {
        const scope = await setupScope();
        await createItem(scope, { title: 'Due today', dueDate: day(0) });
        await createItem(scope, { title: 'Due in a month', dueDate: day(30) });

        const response = await listItems(scope, {
          filters: filters({
            field: 'dueDate',
            operator: 'LESS_THAN_OR_EQUAL',
            value: '@endOfNextWeek',
          }),
        }).expect(200);
        expect(titlesOf(response)).toEqual(['Due today']);
      });

      it('keeps a ticket only for IS_EMPTY on a field it does not hold', async () => {
        const scope = await setupScope();
        const field = await createField(scope, { name: 'Notes', type: 'TEXT' }).expect(201);
        const fieldId = field.body.data.id as string;
        const filled = await createItem(scope, { title: 'Filled' });
        await createItem(scope, { title: 'Unfilled' });
        await createItem(scope, { type: 'TICKET', title: 'Ticket' });
        await setValue(scope, filled, fieldId, { text: 'something' });

        const notEmpty = await listItems(scope, {
          filters: filters({ field: `custom:${fieldId}`, operator: 'IS_NOT_EMPTY' }),
        }).expect(200);
        expect(titlesOf(notEmpty)).toEqual(['Filled']);

        const empty = await listItems(scope, {
          filters: filters({ field: `custom:${fieldId}`, operator: 'IS_EMPTY' }),
        }).expect(200);
        expect(titlesOf(empty).sort()).toEqual(['A task', 'Ticket', 'Unfilled']);
      });

      it('leaves tickets out of a task-status filter', async () => {
        const scope = await setupScope();
        await createItem(scope, { type: 'TICKET', title: 'Ticket' });

        const response = await listItems(scope, {
          filters: filters({ field: 'status', operator: 'EQUALS', value: 'TODO' }),
        }).expect(200);
        expect(titlesOf(response)).toEqual(['A task']);
      });

      it('combines a filter with a sort', async () => {
        const scope = await setupScope();
        await createItem(scope, { title: 'B mine', assigneeIds: [scope.owner.userId] });
        await createItem(scope, { title: 'A mine', assigneeIds: [scope.owner.userId] });
        await createItem(scope, { title: 'Not mine' });

        const response = await listItems(scope, {
          filters: filters({ field: 'assigneeId', operator: 'IN', value: [scope.owner.userId] }),
          sorts: sorts({ field: 'title', direction: 'ASC' }),
        }).expect(200);
        expect(titlesOf(response)).toEqual(['A mine', 'B mine']);
      });

      it('refuses a field the project lacks, and malformed JSON', async () => {
        const scope = await setupScope();
        const other = await setupScope();
        const theirs = await createField(other, { name: 'Theirs', type: 'TEXT' }).expect(201);

        await listItems(scope, {
          filters: filters({ field: `custom:${theirs.body.data.id}`, operator: 'IS_EMPTY' }),
        }).expect(400);
        await listItems(scope, { filters: '{nope' }).expect(422);
      });
    });
  });
});
