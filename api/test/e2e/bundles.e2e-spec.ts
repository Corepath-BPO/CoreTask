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
 * Bundles: one project's sections, fields, rules and task templates, applied
 * to others and kept in step — added, never taken away, and replaced rather
 * than piled up.
 */
describe('Bundles (e2e)', () => {
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

    const project = async (name: string) => {
      const created = await request(server())
        .post(url(`/workspaces/${workspaceId}/projects`))
        .set(owner.auth)
        .send({ name })
        .expect(201);
      return created.body.data.id as string;
    };
    const source = await project('Leasing');
    const target = await project('Renewals');

    // The source's own workflow: a section the target lacks, a field, a live
    // rule that watches that section, a draft rule, and a task template.
    const legal = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects/${source}/sections`))
      .set(owner.auth)
      .send({ name: 'Legal review' })
      .expect(201);
    const legalId = legal.body.data.id as string;

    const field = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects/${source}/custom-fields`))
      .set(owner.auth)
      .send({ name: 'Lease ends', type: 'DATE' })
      .expect(201);

    const rules = url(`/workspaces/${workspaceId}/projects/${source}/automations`);
    const live = await request(server())
      .post(rules)
      .set(owner.auth)
      .send({
        name: 'Note legal review',
        triggerType: 'TASK_MOVED_TO_SECTION',
        triggerConfig: { sectionId: legalId },
        nodes: [
          {
            nodeType: 'TRIGGER',
            subtype: 'TASK_MOVED_TO_SECTION',
            configuration: { sectionId: legalId },
          },
          { nodeType: 'ACTION', subtype: 'ADD_COMMENT', configuration: { body: 'With legal' } },
        ],
      })
      .expect(201);
    await request(server())
      .post(`${rules}/${live.body.data.id as string}/publish`)
      .set(owner.auth)
      .expect(200);
    await request(server())
      .post(rules)
      .set(owner.auth)
      .send({
        name: 'Draft idea',
        triggerType: 'TASK_CREATED',
        triggerConfig: {},
        nodes: [
          { nodeType: 'TRIGGER', subtype: 'TASK_CREATED', configuration: {} },
          { nodeType: 'ACTION', subtype: 'ADD_COMMENT', configuration: { body: 'Hi' } },
        ],
      })
      .expect(201);

    await request(server())
      .post(url(`/workspaces/${workspaceId}/projects/${source}/task-templates`))
      .set(owner.auth)
      .send({ name: 'Renewal', title: 'Renew lease', subtasks: [{ title: 'Send notice' }] })
      .expect(201);

    return {
      owner,
      member,
      workspaceId,
      source,
      target,
      fieldId: field.body.data.id as string,
      bundles: url(`/workspaces/${workspaceId}/bundles`),
    };
  };

  it('takes a project’s workflow and writes it into another, translated', async () => {
    const scope = await setup();

    const made = await request(server())
      .post(scope.bundles)
      .set(scope.owner.auth)
      .send({ name: 'Lease workflow', sourceProjectId: scope.source })
      .expect(201);
    const bundle = made.body.data;
    expect(bundle).toMatchObject({
      name: 'Lease workflow',
      version: 1,
      sourceProject: { id: scope.source, name: 'Leasing' },
      fields: [{ id: scope.fieldId, name: 'Lease ends' }],
      rules: [
        { name: 'Note legal review', live: true },
        { name: 'Draft idea', live: false },
      ],
      taskTemplates: [{ name: 'Renewal' }],
      projects: [],
    });
    expect(bundle.sections).toContain('Legal review');

    const applied = await request(server())
      .put(`${scope.bundles}/${bundle.id as string}/projects/${scope.target}`)
      .set(scope.owner.auth)
      .expect(200);
    expect(applied.body.data).toMatchObject({
      sectionsAdded: 1,
      fieldsAdded: 1,
      rulesWritten: 2,
      rulesLive: 1,
      rulesNeedingAttention: [],
      templatesWritten: 1,
    });

    // The live rule watches the target's own "Legal review", not the source's.
    const targetLegal = await context.prisma.section.findFirstOrThrow({
      where: { projectId: scope.target, name: 'Legal review' },
    });
    const written = await context.prisma.automationRule.findMany({
      where: { projectId: scope.target },
      orderBy: { name: 'asc' },
    });
    expect(written.map((rule) => [rule.name, rule.status, rule.bundleId])).toEqual([
      ['Draft idea', 'DRAFT', bundle.id],
      ['Note legal review', 'ACTIVE', bundle.id],
    ]);
    expect(written[1]?.triggerConfig).toEqual({ sectionId: targetLegal.id });

    // Applying again replaces; nothing doubles.
    await request(server())
      .put(`${scope.bundles}/${bundle.id as string}/projects/${scope.target}`)
      .set(scope.owner.auth)
      .expect(200);
    expect(await context.prisma.automationRule.count({ where: { projectId: scope.target } })).toBe(
      2,
    );
    expect(await context.prisma.taskTemplate.count({ where: { projectId: scope.target } })).toBe(1);
    expect(
      await context.prisma.section.count({
        where: { projectId: scope.target, name: 'Legal review' },
      }),
    ).toBe(1);

    const listed = await request(server()).get(scope.bundles).set(scope.member.auth).expect(200);
    expect(listed.body.data[0].projects).toEqual([
      { id: scope.target, name: 'Renewals', appliedVersion: 1 },
    ]);
  });

  it('sends a refresh out, and comes off a project leaving its sections behind', async () => {
    const scope = await setup();
    const made = await request(server())
      .post(scope.bundles)
      .set(scope.owner.auth)
      .send({
        name: 'Templates only',
        sourceProjectId: scope.source,
        parts: ['SECTIONS', 'TASK_TEMPLATES'],
      })
      .expect(201);
    const id = made.body.data.id as string;
    expect(made.body.data).toMatchObject({ rules: [], fields: [] });

    await request(server())
      .put(`${scope.bundles}/${id}/projects/${scope.target}`)
      .set(scope.owner.auth)
      .expect(200);

    await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.source}/task-templates`))
      .set(scope.owner.auth)
      .send({ name: 'Move-out', title: 'Inspect unit' })
      .expect(201);

    const refreshed = await request(server())
      .post(`${scope.bundles}/${id}/refresh`)
      .set(scope.owner.auth)
      .expect(201);
    expect(refreshed.body.data).toMatchObject({
      version: 2,
      skipped: 0,
      applied: [expect.objectContaining({ projectId: scope.target, templatesWritten: 2 })],
    });
    expect(
      (
        await context.prisma.taskTemplate.findMany({
          where: { projectId: scope.target },
          orderBy: { name: 'asc' },
        })
      ).map((template) => template.name),
    ).toEqual(['Move-out', 'Renewal']);

    await request(server())
      .delete(`${scope.bundles}/${id}/projects/${scope.target}`)
      .set(scope.owner.auth)
      .expect(204);
    expect(await context.prisma.taskTemplate.count({ where: { projectId: scope.target } })).toBe(0);
    expect(
      await context.prisma.section.count({
        where: { projectId: scope.target, name: 'Legal review' },
      }),
    ).toBe(1);
  });

  it('refuses the source project, a non-manager, and leaves rules behind when deleted', async () => {
    const scope = await setup();

    await request(server())
      .post(scope.bundles)
      .set(scope.member.auth)
      .send({ name: 'Mine', sourceProjectId: scope.source })
      .expect(403);

    const made = await request(server())
      .post(scope.bundles)
      .set(scope.owner.auth)
      .send({ name: 'Lease workflow', sourceProjectId: scope.source })
      .expect(201);
    const id = made.body.data.id as string;

    await request(server())
      .put(`${scope.bundles}/${id}/projects/${scope.source}`)
      .set(scope.owner.auth)
      .expect(400);

    await request(server())
      .put(`${scope.bundles}/${id}/projects/${scope.target}`)
      .set(scope.owner.auth)
      .expect(200);
    await request(server()).delete(`${scope.bundles}/${id}`).set(scope.member.auth).expect(403);
    await request(server()).delete(`${scope.bundles}/${id}`).set(scope.owner.auth).expect(204);

    // The rules it wrote are the project's own now, still running.
    const left = await context.prisma.automationRule.findMany({
      where: { projectId: scope.target },
    });
    expect(left).toHaveLength(2);
    expect(left.every((rule) => rule.bundleId === null)).toBe(true);
    expect(left.some((rule) => rule.status === 'ACTIVE')).toBe(true);
  });
});
