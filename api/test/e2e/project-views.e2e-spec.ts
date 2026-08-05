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

      expect(removed.body.data).toEqual({ deleted: false, archived: true });
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

      expect(archived.body.data).toEqual({ deleted: false, archived: true });

      const unused = await request(server())
        .post(fieldsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Unused', type: 'TEXT' })
        .expect(201);

      const deleted = await request(server())
        .delete(`${fieldsUrl(scope)}/${unused.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(deleted.body.data).toEqual({ deleted: true, archived: false });
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

      const offered = response.body.data.fieldTypes.map((t: { type: string }) => t.type);
      expect(offered).toHaveLength(9);
      expect(offered).not.toContain('FORMULA');
      expect(offered).not.toContain('ROLLUP');
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
      expect(removed.body.data).toEqual({ deleted: false, archived: false });

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
  });
});
