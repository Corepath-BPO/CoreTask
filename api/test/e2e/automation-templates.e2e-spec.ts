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
 * The rule library: saving a rule as a template and starting from it elsewhere.
 *
 * What is being proved is the translation — a template carries ids from the
 * project it was saved in, and a draft started from it in another project has
 * to name *that* project's rows or nothing at all. Everything else here is the
 * plumbing around that: scope, roles, and the draft being a draft.
 */
describe('Automation templates (e2e)', () => {
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

  interface ProjectScope {
    projectId: string;
    /** The first two sections, as `POST /projects` creates them. */
    sectionIds: string[];
  }

  interface Scope {
    owner: Actor;
    member: Actor;
    workspaceId: string;
    source: ProjectScope;
    target: ProjectScope;
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

  const createProject = async (
    owner: Actor,
    workspaceId: string,
    name: string,
  ): Promise<ProjectScope> => {
    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name })
      .expect(201);

    return {
      projectId: project.body.data.id as string,
      sectionIds: (project.body.data.sections as { id: string }[]).map((section) => section.id),
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

    return {
      owner,
      member,
      workspaceId,
      source: await createProject(owner, workspaceId, 'Platform Foundation'),
      target: await createProject(owner, workspaceId, 'Mobile App'),
    };
  };

  const rulesUrl = (scope: Scope, projectId: string) =>
    url(`/workspaces/${scope.workspaceId}/projects/${projectId}/automations`);
  const libraryUrl = (scope: Scope) => url(`/workspaces/${scope.workspaceId}/automation-templates`);

  /** Renames a section so the two projects agree on a name but not an id. */
  const renameSection = (sectionId: string, name: string) =>
    context.prisma.section.update({ where: { id: sectionId }, data: { name } });

  /**
   * A rule with every kind of project-scoped reference the translation handles:
   * the trigger's section, a section condition, a move, a custom-field set.
   */
  const createSourceRule = async (
    scope: Scope,
    options: { fieldId?: string; optionId?: string } = {},
  ) => {
    const [incoming, done] = scope.source.sectionIds as [string, string];

    const nodes: Record<string, unknown>[] = [
      {
        id: 't',
        nodeType: 'TRIGGER',
        subtype: 'TASK_MOVED_TO_SECTION',
        configuration: { sectionId: incoming },
      },
      {
        id: 'c',
        nodeType: 'CONDITION',
        subtype: 'FIELD_COMPARISON',
        configuration: { field: 'sectionId', operator: 'IS', value: incoming },
        parentId: 't',
        order: 1,
      },
      {
        id: 'a1',
        nodeType: 'ACTION',
        subtype: 'ASSIGN_USER',
        configuration: { userId: scope.owner.userId },
        parentId: 'c',
        order: 2,
      },
      {
        id: 'a2',
        nodeType: 'ACTION',
        subtype: 'MOVE_TO_SECTION',
        configuration: { sectionId: done },
        parentId: 'a1',
        order: 3,
      },
    ];

    if (options.fieldId) {
      nodes.push({
        id: 'a3',
        nodeType: 'ACTION',
        subtype: 'SET_CUSTOM_FIELD',
        configuration: { fieldId: options.fieldId, value: options.optionId ?? 'Large' },
        parentId: 'a2',
        order: 4,
      });
    }

    const created = await request(server())
      .post(rulesUrl(scope, scope.source.projectId))
      .set('Authorization', `Bearer ${scope.owner.token}`)
      .send({
        name: 'Triage incoming work',
        description: 'Assign and move whatever lands in Incoming.',
        triggerType: 'TASK_MOVED_TO_SECTION',
        triggerConfig: { sectionId: incoming },
        nodes,
      })
      .expect(201);

    return created.body.data as { id: string; name: string };
  };

  const saveTemplate = async (
    scope: Scope,
    ruleId: string,
    extra: Record<string, unknown> = {},
  ) => {
    const response = await request(server())
      .post(libraryUrl(scope))
      .set('Authorization', `Bearer ${scope.owner.token}`)
      .send({ projectId: scope.source.projectId, ruleId, ...extra })
      .expect(201);

    return response.body.data as {
      id: string;
      name: string;
      description: string | null;
      triggerType: string;
      triggerConfig: Record<string, unknown>;
      nodes: { nodeType: string; subtype: string; configuration: Record<string, unknown> }[];
      sourceRuleId: string | null;
      sourceProject: { id: string; name: string } | null;
      useCount: number;
    };
  };

  const applyTemplate = async (
    scope: Scope,
    templateId: string,
    body: Record<string, unknown> = { projectId: scope.target.projectId },
  ) => {
    const response = await request(server())
      .post(`${libraryUrl(scope)}/${templateId}/apply`)
      .set('Authorization', `Bearer ${scope.owner.token}`)
      .send(body)
      .expect(201);

    return response.body.data as {
      rule: {
        id: string;
        projectId: string;
        name: string;
        status: string;
        triggerConfig: Record<string, unknown>;
        allowChaining: boolean;
        nodes: {
          id: string;
          nodeType: string;
          subtype: string;
          configuration: Record<string, unknown>;
          parentNodeId: string | null;
        }[];
      };
      unresolved: { nodeType: string; subtype: string; kind: string; name: string }[];
    };
  };

  const configurationOf = (
    nodes: { subtype: string; configuration: Record<string, unknown> }[],
    subtype: string,
  ) => nodes.find((node) => node.subtype === subtype)?.configuration ?? {};

  describe('saving', () => {
    it('snapshots the rule with its graph and where it came from', async () => {
      const scope = await setupScope();
      const rule = await createSourceRule(scope);

      const template = await saveTemplate(scope, rule.id);

      expect(template.name).toBe('Triage incoming work');
      expect(template.description).toBe('Assign and move whatever lands in Incoming.');
      expect(template.triggerType).toBe('TASK_MOVED_TO_SECTION');
      expect(template.nodes.map((node) => node.subtype)).toEqual([
        'TASK_MOVED_TO_SECTION',
        'FIELD_COMPARISON',
        'ASSIGN_USER',
        'MOVE_TO_SECTION',
      ]);
      expect(template.sourceRuleId).toBe(rule.id);
      expect(template.sourceProject).toEqual({
        id: scope.source.projectId,
        name: 'Platform Foundation',
      });
      expect(template.useCount).toBe(0);
    });

    it('takes a name and description of its own when given', async () => {
      const scope = await setupScope();
      const rule = await createSourceRule(scope);

      const template = await saveTemplate(scope, rule.id, {
        name: 'Standard triage',
        description: 'Use on every intake project.',
      });

      expect(template.name).toBe('Standard triage');
      expect(template.description).toBe('Use on every intake project.');
    });

    it('leaves project-specific choices blank when asked, and keeps people', async () => {
      const scope = await setupScope();
      const [sourceIncoming, sourceDone] = scope.source.sectionIds as [string, string];
      const [targetIncoming, targetDone] = scope.target.sectionIds as [string, string];
      for (const [id, name] of [
        [sourceIncoming, 'Incoming'],
        [sourceDone, 'Done'],
        [targetIncoming, 'Incoming'],
        [targetDone, 'Done'],
      ] as const) {
        await renameSection(id, name);
      }

      const rule = await createSourceRule(scope);
      const template = await saveTemplate(scope, rule.id, { clearReferences: true });

      // The shape is kept; the answers that belonged to this project are not.
      expect(template.triggerConfig).toEqual({});
      expect(configurationOf(template.nodes, 'TASK_MOVED_TO_SECTION')).toEqual({});
      expect(configurationOf(template.nodes, 'FIELD_COMPARISON')).toEqual({
        field: 'sectionId',
        operator: 'IS',
      });
      expect(configurationOf(template.nodes, 'MOVE_TO_SECTION')).toEqual({});
      // A person is workspace-wide, not a choice this project made.
      expect(configurationOf(template.nodes, 'ASSIGN_USER')).toEqual({
        userId: scope.owner.userId,
      });

      // Even where the names would have matched, the blanks stay blank: that
      // is what was asked for, and the builder asks the person instead.
      const applied = await applyTemplate(scope, template.id);
      expect(applied.rule.status).toBe('DRAFT');
      expect(applied.unresolved).toEqual([]);
      expect(applied.rule.triggerConfig).toEqual({});
      expect(configurationOf(applied.rule.nodes, 'MOVE_TO_SECTION')).toEqual({});

      await request(server())
        .post(`${rulesUrl(scope, scope.target.projectId)}/${applied.rule.id}/publish`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(400);
    });

    it('does not follow the rule after it is saved', async () => {
      const scope = await setupScope();
      const rule = await createSourceRule(scope);
      const template = await saveTemplate(scope, rule.id);

      await request(server())
        .delete(`${rulesUrl(scope, scope.source.projectId)}/${rule.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const list = await request(server())
        .get(libraryUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toBe(template.id);
      // The link is gone; the template is not.
      expect(list.body.data[0].sourceRuleId).toBeNull();
      expect(list.body.data[0].nodes).toHaveLength(4);
    });

    it('refuses a rule from another workspace', async () => {
      const scope = await setupScope();
      const other = await setupScope();
      const rule = await createSourceRule(other);

      await request(server())
        .post(libraryUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ projectId: other.source.projectId, ruleId: rule.id })
        .expect(404);
    });

    it('requires the manager role to save, and lets any member browse', async () => {
      const scope = await setupScope();
      const rule = await createSourceRule(scope);

      await request(server())
        .post(libraryUrl(scope))
        .set('Authorization', `Bearer ${scope.member.token}`)
        .send({ projectId: scope.source.projectId, ruleId: rule.id })
        .expect(403);

      await saveTemplate(scope, rule.id);

      const list = await request(server())
        .get(libraryUrl(scope))
        .set('Authorization', `Bearer ${scope.member.token}`)
        .expect(200);

      expect(list.body.data).toHaveLength(1);
    });
  });

  describe('applying', () => {
    it('creates a draft in the target project and counts the use', async () => {
      const scope = await setupScope();
      const rule = await createSourceRule(scope);
      const template = await saveTemplate(scope, rule.id);

      const applied = await applyTemplate(scope, template.id);

      expect(applied.rule.projectId).toBe(scope.target.projectId);
      expect(applied.rule.status).toBe('DRAFT');
      expect(applied.rule.name).toBe('Triage incoming work');
      // The graph keeps its shape: four steps, each parented to the last.
      expect(applied.rule.nodes).toHaveLength(4);
      expect(applied.rule.nodes.filter((node) => node.parentNodeId === null)).toHaveLength(1);

      const list = await request(server())
        .get(libraryUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(list.body.data[0].useCount).toBe(1);
      expect(list.body.data[0].lastUsedAt).not.toBeNull();
    });

    it('matches sections by name in the project it lands in', async () => {
      const scope = await setupScope();
      const [sourceIncoming, sourceDone] = scope.source.sectionIds as [string, string];
      const [targetIncoming, targetDone] = scope.target.sectionIds as [string, string];

      await renameSection(sourceIncoming, 'Incoming');
      await renameSection(sourceDone, 'Done');
      // Same names, different ids — and a different case, which must not matter.
      await renameSection(targetIncoming, 'incoming');
      await renameSection(targetDone, 'DONE');

      const rule = await createSourceRule(scope);
      const template = await saveTemplate(scope, rule.id);
      const applied = await applyTemplate(scope, template.id);

      expect(applied.unresolved).toEqual([]);
      expect(applied.rule.triggerConfig).toEqual({ sectionId: targetIncoming });
      expect(configurationOf(applied.rule.nodes, 'TASK_MOVED_TO_SECTION')).toEqual({
        sectionId: targetIncoming,
      });
      expect(configurationOf(applied.rule.nodes, 'FIELD_COMPARISON')['value']).toBe(targetIncoming);
      expect(configurationOf(applied.rule.nodes, 'MOVE_TO_SECTION')).toEqual({
        sectionId: targetDone,
      });
      // A member is workspace-wide and travels as it is.
      expect(configurationOf(applied.rule.nodes, 'ASSIGN_USER')).toEqual({
        userId: scope.owner.userId,
      });
    });

    it('still matches after the source project renamed the section', async () => {
      const scope = await setupScope();
      const [sourceIncoming, sourceDone] = scope.source.sectionIds as [string, string];
      const [targetIncoming, targetDone] = scope.target.sectionIds as [string, string];

      await renameSection(sourceIncoming, 'Incoming');
      await renameSection(sourceDone, 'Done');
      await renameSection(targetIncoming, 'Incoming');
      await renameSection(targetDone, 'Done');

      const rule = await createSourceRule(scope);
      const template = await saveTemplate(scope, rule.id);

      // The names were recorded when the template was saved, so what the
      // source project does to its sections afterwards changes nothing.
      await renameSection(sourceDone, 'Finished');
      await context.prisma.section.delete({ where: { id: sourceIncoming } });

      const applied = await applyTemplate(scope, template.id);

      expect(applied.unresolved).toEqual([]);
      expect(configurationOf(applied.rule.nodes, 'MOVE_TO_SECTION')).toEqual({
        sectionId: targetDone,
      });
    });

    it('leaves a choice blank and says so when nothing matches', async () => {
      const scope = await setupScope();
      const [sourceIncoming, sourceDone] = scope.source.sectionIds as [string, string];
      const [targetIncoming] = scope.target.sectionIds as [string, string];

      await renameSection(sourceIncoming, 'Incoming');
      // No project is created with a "Shipped" section, so the target has none.
      await renameSection(sourceDone, 'Shipped');
      await renameSection(targetIncoming, 'Incoming');

      const rule = await createSourceRule(scope);
      const template = await saveTemplate(scope, rule.id);
      const applied = await applyTemplate(scope, template.id);

      expect(applied.rule.status).toBe('DRAFT');
      expect(applied.rule.triggerConfig).toEqual({ sectionId: targetIncoming });
      // Cleared, not carried: a foreign id would be refused at publish and
      // means nothing on this board.
      expect(configurationOf(applied.rule.nodes, 'MOVE_TO_SECTION')).toEqual({});
      expect(applied.unresolved).toEqual([
        { nodeType: 'ACTION', subtype: 'MOVE_TO_SECTION', kind: 'SECTION', name: 'Shipped' },
      ]);

      // And the draft is exactly as unpublishable as it looks.
      const publish = await request(server())
        .post(`${rulesUrl(scope, scope.target.projectId)}/${applied.rule.id}/publish`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(400);
      expect(publish.body.error.details.problems.join(' ')).toMatch(/section/i);
    });

    it('keeps a shared field and translates its option; blanks a field the project lacks', async () => {
      const scope = await setupScope();
      const [sourceIncoming, sourceDone] = scope.source.sectionIds as [string, string];
      const [targetIncoming, targetDone] = scope.target.sectionIds as [string, string];
      for (const [id, name] of [
        [sourceIncoming, 'Incoming'],
        [sourceDone, 'Done'],
        [targetIncoming, 'Incoming'],
        [targetDone, 'Done'],
      ] as const) {
        await renameSection(id, name);
      }

      // Two fields called "Size" — one per project — whose options share labels.
      const sourceField = await context.prisma.customField.create({
        data: {
          workspaceId: scope.workspaceId,
          name: 'Size',
          type: 'SINGLE_SELECT',
          projects: { create: { projectId: scope.source.projectId, position: 0 } },
          options: { create: [{ label: 'Large', position: 0, colorToken: 'gray' }] },
        },
        include: { options: true },
      });
      const targetField = await context.prisma.customField.create({
        data: {
          workspaceId: scope.workspaceId,
          name: 'size',
          type: 'SINGLE_SELECT',
          projects: { create: { projectId: scope.target.projectId, position: 0 } },
          options: { create: [{ label: 'large', position: 0, colorToken: 'gray' }] },
        },
        include: { options: true },
      });

      const rule = await createSourceRule(scope, {
        fieldId: sourceField.id,
        optionId: sourceField.options[0]?.id,
      });
      const template = await saveTemplate(scope, rule.id);
      const applied = await applyTemplate(scope, template.id);

      expect(applied.unresolved).toEqual([]);
      expect(configurationOf(applied.rule.nodes, 'SET_CUSTOM_FIELD')).toEqual({
        fieldId: targetField.id,
        value: targetField.options[0]?.id,
      });

      // A third project with no such field: the step is left for the builder.
      const bare = await createProject(scope.owner, scope.workspaceId, 'Bare');
      const [bareIncoming, bareDone] = bare.sectionIds as [string, string];
      await renameSection(bareIncoming, 'Incoming');
      await renameSection(bareDone, 'Done');

      const blank = await applyTemplate(scope, template.id, { projectId: bare.projectId });

      expect(configurationOf(blank.rule.nodes, 'SET_CUSTOM_FIELD')).toEqual({});
      expect(blank.unresolved).toEqual([
        { nodeType: 'ACTION', subtype: 'SET_CUSTOM_FIELD', kind: 'CUSTOM_FIELD', name: 'Size' },
      ]);
    });

    it('watches the section the caller names instead of the remembered one', async () => {
      const scope = await setupScope();
      const [, targetDone] = scope.target.sectionIds as [string, string];

      const rule = await createSourceRule(scope);
      const template = await saveTemplate(scope, rule.id);

      const applied = await applyTemplate(scope, template.id, {
        projectId: scope.target.projectId,
        sectionId: targetDone,
      });

      expect(applied.rule.triggerConfig).toEqual({ sectionId: targetDone });
      expect(configurationOf(applied.rule.nodes, 'TASK_MOVED_TO_SECTION')).toEqual({
        sectionId: targetDone,
      });
      // The remembered trigger section is not reported: it was replaced, not lost.
      expect(applied.unresolved.some((entry) => entry.nodeType === 'TRIGGER')).toBe(false);
    });

    it('refuses a section from another project as the trigger', async () => {
      const scope = await setupScope();
      const rule = await createSourceRule(scope);
      const template = await saveTemplate(scope, rule.id);

      await request(server())
        .post(`${libraryUrl(scope)}/${template.id}/apply`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ projectId: scope.target.projectId, sectionId: scope.source.sectionIds[0] })
        .expect(404);
    });

    it('does not reach across workspaces', async () => {
      const scope = await setupScope();
      const other = await setupScope();
      const rule = await createSourceRule(scope);
      const template = await saveTemplate(scope, rule.id);

      // A template from one workspace applied into a project of another.
      await request(server())
        .post(`${libraryUrl(scope)}/${template.id}/apply`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ projectId: other.target.projectId })
        .expect(404);

      // And the other workspace cannot see it at all.
      const list = await request(server())
        .get(libraryUrl(other))
        .set('Authorization', `Bearer ${other.owner.token}`)
        .expect(200);
      expect(list.body.data).toEqual([]);
    });

    it('requires the manager role', async () => {
      const scope = await setupScope();
      const rule = await createSourceRule(scope);
      const template = await saveTemplate(scope, rule.id);

      await request(server())
        .post(`${libraryUrl(scope)}/${template.id}/apply`)
        .set('Authorization', `Bearer ${scope.member.token}`)
        .send({ projectId: scope.target.projectId })
        .expect(403);
    });
  });

  describe('managing', () => {
    it('renames and describes a template', async () => {
      const scope = await setupScope();
      const rule = await createSourceRule(scope);
      const template = await saveTemplate(scope, rule.id);

      const updated = await request(server())
        .patch(`${libraryUrl(scope)}/${template.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Intake triage', description: 'For every intake board.' })
        .expect(200);

      expect(updated.body.data.name).toBe('Intake triage');
      expect(updated.body.data.description).toBe('For every intake board.');
    });

    it('deletes a template without touching the drafts started from it', async () => {
      const scope = await setupScope();
      const rule = await createSourceRule(scope);
      const template = await saveTemplate(scope, rule.id);
      const applied = await applyTemplate(scope, template.id);

      await request(server())
        .delete(`${libraryUrl(scope)}/${template.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const list = await request(server())
        .get(libraryUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(list.body.data).toEqual([]);

      await request(server())
        .get(`${rulesUrl(scope, scope.target.projectId)}/${applied.rule.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
    });

    it('refuses a member the manager role for writes', async () => {
      const scope = await setupScope();
      const rule = await createSourceRule(scope);
      const template = await saveTemplate(scope, rule.id);

      await request(server())
        .patch(`${libraryUrl(scope)}/${template.id}`)
        .set('Authorization', `Bearer ${scope.member.token}`)
        .send({ name: 'Nope' })
        .expect(403);

      await request(server())
        .delete(`${libraryUrl(scope)}/${template.id}`)
        .set('Authorization', `Bearer ${scope.member.token}`)
        .expect(403);
    });
  });
});
