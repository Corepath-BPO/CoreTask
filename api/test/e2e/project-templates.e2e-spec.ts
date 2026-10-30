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
 * Starting a project from another: a duplicate right away, a template any
 * number of times — sections always, the rest as chosen, dates counted from
 * the new project's start.
 */
describe('Project templates and duplicates (e2e)', () => {
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
    const guest = await register('Cy Guest');
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

    const created = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(owner.auth)
      .send({ name: 'Leasing', startDate: '2026-11-02' })
      .expect(201);
    const projectId = created.body.data.id as string;
    const base = `/workspaces/${workspaceId}/projects/${projectId}`;
    // Bea works on Leasing, so its tasks may be hers — and a copy that brings
    // the members along brings her assignment with them.
    await context.prisma.projectMember.create({
      data: { projectId, userId: member.userId, workspaceId, role: 'EDITOR' },
    });

    const legal = await request(server())
      .post(url(`${base}/sections`))
      .set(owner.auth)
      .send({ name: 'Legal review' })
      .expect(201);
    const legalId = legal.body.data.id as string;

    const field = await request(server())
      .post(url(`${base}/custom-fields`))
      .set(owner.auth)
      .send({ name: 'Lease ref', type: 'TEXT' })
      .expect(201);
    const fieldId = field.body.data.id as string;

    const rules = url(`${base}/automations`);
    const rule = await request(server())
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
      .post(`${rules}/${rule.body.data.id as string}/publish`)
      .set(owner.auth)
      .expect(200);

    await request(server())
      .post(url(`${base}/task-templates`))
      .set(owner.auth)
      .send({ name: 'Renewal', title: 'Renew lease' })
      .expect(201);

    // A task five days into the project, in Legal review, with a subtask, an
    // assignee and a field value; and a finished one.
    const items = url(`${base}/work-items`);
    const draft = await request(server())
      .post(items)
      .set(owner.auth)
      .send({
        type: 'TASK',
        title: 'Draft the lease',
        sectionId: legalId,
        dueDate: '2026-11-07T00:00:00.000Z',
        assigneeIds: [member.userId],
      })
      .expect(201);
    const draftId = draft.body.data.id as string;
    const clauses = await request(server())
      .post(items)
      .set(owner.auth)
      .send({ type: 'TASK', title: 'Check the clauses', parentId: draftId })
      .expect(201);
    // And a subtask of that subtask: they nest to any depth.
    await request(server())
      .post(items)
      .set(owner.auth)
      .send({ type: 'TASK', title: 'Check the break clause', parentId: clauses.body.data.id })
      .expect(201);
    await request(server())
      .put(url(`/workspaces/${workspaceId}/tasks/${draftId}/custom-fields/${fieldId}`))
      .set(owner.auth)
      .send({ text: 'L-204' })
      .expect(200);
    const done = await request(server())
      .post(items)
      .set(owner.auth)
      .send({ type: 'TASK', title: 'Collect deposit' })
      .expect(201);
    await request(server())
      .patch(url(`/workspaces/${workspaceId}/tasks/${done.body.data.id as string}`))
      .set(owner.auth)
      .send({ status: 'DONE' })
      .expect(200);

    return { owner, member, guest, workspaceId, projectId, fieldId };
  };

  const projectTasks = (projectId: string) =>
    context.prisma.task.findMany({
      where: { projectId },
      include: { section: true, customFieldValues: true },
      orderBy: { createdAt: 'asc' },
    });

  it('duplicates a project: sections, tasks as they were, fields, rules, templates, members', async () => {
    const scope = await setup();

    const copied = await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/duplicate`))
      .set(scope.owner.auth)
      .send({ name: 'Leasing (copy)' })
      .expect(201);
    expect(copied.body.data).toMatchObject({ rulesNeedingAttention: [], rulesSkipped: 0 });
    const copyId = copied.body.data.projectId as string;

    const sections = await context.prisma.section.findMany({
      where: { projectId: copyId },
      orderBy: { position: 'asc' },
    });
    expect(sections.map((section) => section.name)).toContain('Legal review');

    const tasks = await projectTasks(copyId);
    const draft = tasks.find((task) => task.title === 'Draft the lease');
    expect(draft).toMatchObject({ assigneeId: scope.member.userId });
    expect(draft?.section?.name).toBe('Legal review');
    expect(draft?.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-07');
    expect(draft?.customFieldValues).toEqual([
      expect.objectContaining({ customFieldId: scope.fieldId, textValue: 'L-204' }),
    ]);
    const clauses = tasks.find((task) => task.title === 'Check the clauses');
    expect(clauses?.parentTaskId).toBe(draft?.id);
    expect(tasks.find((task) => task.title === 'Check the break clause')?.parentTaskId).toBe(
      clauses?.id,
    );
    expect(tasks.find((task) => task.title === 'Collect deposit')?.status).toBe('DONE');

    // The rule watches the copy's own Legal review, and is live.
    const rule = await context.prisma.automationRule.findFirstOrThrow({
      where: { projectId: copyId },
    });
    const legal = sections.find((section) => section.name === 'Legal review');
    expect(rule.status).toBe('ACTIVE');
    expect(rule.triggerConfig).toEqual({ sectionId: legal?.id });

    expect(await context.prisma.taskTemplate.count({ where: { projectId: copyId } })).toBe(1);
    expect(await context.prisma.projectCustomField.count({ where: { projectId: copyId } })).toBe(1);

    // Only what is asked for.
    const lean = await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/duplicate`))
      .set(scope.owner.auth)
      .send({ name: 'Leasing (structure)', parts: ['FIELDS'] })
      .expect(201);
    const leanId = lean.body.data.projectId as string;
    expect(await context.prisma.task.count({ where: { projectId: leanId } })).toBe(0);
    expect(await context.prisma.automationRule.count({ where: { projectId: leanId } })).toBe(0);
    expect(
      (await context.prisma.section.findMany({ where: { projectId: leanId } })).map(
        (section) => section.name,
      ),
    ).toContain('Legal review');
  });

  it('keeps a template, and starts projects from it with dates counted from their start', async () => {
    const scope = await setup();
    const templates = url(`/workspaces/${scope.workspaceId}/project-templates`);

    const saved = await request(server())
      .post(templates)
      .set(scope.member.auth)
      .send({ projectId: scope.projectId, name: 'Lease renewal' })
      .expect(201);
    expect(saved.body.data).toMatchObject({
      name: 'Lease renewal',
      taskCount: 3,
      ruleCount: 1,
      fieldCount: 1,
    });
    // A template leaves people out by default.
    expect(saved.body.data.parts).not.toContain('ASSIGNEES');
    const templateId = saved.body.data.id as string;

    const started = await request(server())
      .post(`${templates}/${templateId}/use`)
      .set(scope.owner.auth)
      .send({ name: '12 Elm St renewal', startDate: '2027-01-04' })
      .expect(201);
    const projectId = started.body.data.projectId as string;

    const tasks = await projectTasks(projectId);
    const draft = tasks.find((task) => task.title === 'Draft the lease');
    // Five days in, counted from the new start.
    expect(draft?.dueDate?.toISOString().slice(0, 10)).toBe('2027-01-09');
    expect(draft?.assigneeId).toBeNull();
    // Every task starts open.
    expect(tasks.find((task) => task.title === 'Collect deposit')?.status).toBe('TODO');

    const project = await context.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.startDate?.toISOString().slice(0, 10)).toBe('2027-01-04');

    // Guests read the list, but start nothing; only its creator or a manager deletes it.
    const listed = await request(server()).get(templates).set(scope.guest.auth).expect(200);
    expect(listed.body.data).toHaveLength(1);
    await request(server())
      .post(`${templates}/${templateId}/use`)
      .set(scope.guest.auth)
      .send({ name: 'Nope' })
      .expect(403);

    const other = await register('Dee Other');
    await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: other.userId, role: WorkspaceRole.MEMBER },
    });
    await request(server()).delete(`${templates}/${templateId}`).set(other.auth).expect(403);
    await request(server()).delete(`${templates}/${templateId}`).set(scope.owner.auth).expect(204);
  });

  it('copies rules only for someone who may manage them, and says so', async () => {
    const scope = await setup();

    const copied = await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/duplicate`))
      .set(scope.member.auth)
      .send({ name: 'Leasing (member copy)' })
      .expect(201);
    expect(copied.body.data.rulesSkipped).toBe(1);
    expect(
      await context.prisma.automationRule.count({
        where: { projectId: copied.body.data.projectId as string },
      }),
    ).toBe(0);
  });
});
