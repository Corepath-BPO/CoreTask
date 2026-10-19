import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** Intake forms: managed by editors, submitted by anyone with the link. */
describe('Forms (e2e)', () => {
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
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  };

  const setup = async () => {
    const owner = await register('Ada Owner');
    const guest = await register('Cy Guest');
    const auth = { Authorization: `Bearer ${owner.token}` };
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: guest.userId, role: WorkspaceRole.GUEST },
    });
    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(auth)
      .send({ name: 'Maintenance' })
      .expect(201);
    const projectId = project.body.data.id as string;
    const sections = project.body.data.sections as { id: string }[];

    const form = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects/${projectId}/forms`))
      .set(auth)
      .send({
        name: 'Maintenance request',
        description: 'Tell us what needs fixing.',
        sectionId: sections[1]?.id ?? sections[0]?.id,
        questions: [
          { id: 'unit', label: 'Unit number', kind: 'SHORT_TEXT', required: true },
          { id: 'email', label: 'Your email', kind: 'EMAIL', required: false },
        ],
      })
      .expect(201);

    return {
      owner,
      guest,
      auth,
      workspaceId,
      projectId,
      sectionId: (sections[1]?.id ?? sections[0]?.id) as string,
      form: form.body.data as { id: string; token: string },
    };
  };

  it('shows the form to anyone with the link, and turns a submission into a task', async () => {
    const scope = await setup();

    const shown = await request(server())
      .get(url(`/public/forms/${scope.form.token}`))
      .expect(200);
    expect(shown.body.data).toMatchObject({
      name: 'Maintenance request',
      projectName: 'Maintenance',
      questions: [
        expect.objectContaining({ label: 'Unit number', required: true }),
        expect.objectContaining({ label: 'Your email', kind: 'EMAIL' }),
      ],
    });
    expect(shown.body.data).not.toHaveProperty('token');

    await request(server())
      .post(url(`/public/forms/${scope.form.token}/submissions`))
      .send({
        title: 'Leaking tap',
        details: 'Kitchen sink, since Monday.\n\nPlease call first.',
        answers: { unit: '4B', email: 'tenant@example.com' },
      })
      .expect(201);

    const task = await context.prisma.task.findFirstOrThrow({ where: { title: 'Leaking tap' } });
    expect(task).toMatchObject({
      projectId: scope.projectId,
      sectionId: scope.sectionId,
      createdById: scope.owner.userId,
    });
    expect(task.description).toContain('Kitchen sink, since Monday.');
    expect(task.description).toMatch(/<strong>Unit number<\/strong><br\s*\/?>4B/);
    expect(task.description).toContain('tenant@example.com');

    const form = await context.prisma.projectForm.findUniqueOrThrow({
      where: { id: scope.form.id },
    });
    expect(form.submissionCount).toBe(1);
  });

  it('refuses a submission missing a required answer, or with a bad email', async () => {
    const scope = await setup();
    const submit = (body: Record<string, unknown>) =>
      request(server())
        .post(url(`/public/forms/${scope.form.token}/submissions`))
        .send(body);

    await submit({ title: 'No unit', answers: {} }).expect(400);
    await submit({ title: 'Bad email', answers: { unit: '1', email: 'not-an-email' } }).expect(400);
    expect(await context.prisma.task.count({ where: { projectId: scope.projectId } })).toBe(0);
  });

  it('closes the link when the form is turned off, and keeps managing to editors', async () => {
    const scope = await setup();
    const forms = url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/forms`);

    await request(server())
      .get(forms)
      .set({ Authorization: `Bearer ${scope.guest.token}` })
      .expect(403);

    await request(server())
      .patch(`${forms}/${scope.form.id}`)
      .set(scope.auth)
      .send({ isActive: false })
      .expect(200);

    await request(server())
      .get(url(`/public/forms/${scope.form.token}`))
      .expect(404);
    await request(server())
      .post(url(`/public/forms/${scope.form.token}/submissions`))
      .send({ title: 'Too late', answers: { unit: '1' } })
      .expect(404);
    await request(server()).get(url('/public/forms/not-a-real-token')).expect(404);
  });

  it('asks choice, date and number questions, and holds answers to them', async () => {
    const scope = await setup();
    const created = await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/forms`))
      .set(scope.auth)
      .send({
        name: 'Move-in checklist',
        questions: [
          {
            id: 'kind',
            label: 'Kind of issue',
            kind: 'SINGLE_SELECT',
            required: true,
            options: ['Plumbing', ' Plumbing ', 'Electrical', ''],
          },
          {
            id: 'rooms',
            label: 'Rooms',
            kind: 'MULTI_SELECT',
            required: false,
            options: ['Kitchen', 'Bath'],
          },
          { id: 'when', label: 'Best day', kind: 'DATE', required: false },
          { id: 'people', label: 'Occupants', kind: 'NUMBER', required: false },
          { id: 'empty', label: 'Choice without options', kind: 'SINGLE_SELECT', required: false },
        ],
      })
      .expect(201);
    const questions = created.body.data.questions as {
      id: string;
      kind: string;
      options?: string[];
    }[];
    expect(questions.find((q) => q.id === 'kind')?.options).toEqual(['Plumbing', 'Electrical']);
    expect(questions.find((q) => q.id === 'empty')?.kind).toBe('SHORT_TEXT');

    const token = created.body.data.token as string;
    const submit = (answers: Record<string, string>) =>
      request(server())
        .post(url(`/public/forms/${token}/submissions`))
        .send({ title: 'Sink drips', answers });
    expect((await submit({ kind: 'Fire' }).expect(400)).body.error.message).toContain('Choose');
    await submit({ kind: 'Plumbing', when: 'soon' }).expect(400);
    await submit({ kind: 'Plumbing', people: 'four' }).expect(400);
    await submit({ kind: 'Plumbing', rooms: 'Kitchen\nGarage' }).expect(400);
    await submit({
      kind: 'Plumbing',
      rooms: 'Kitchen\nBath',
      when: '2026-10-20',
      people: '3',
    }).expect(201);

    const task = await context.prisma.task.findFirstOrThrow({ where: { title: 'Sink drips' } });
    expect(task.description).toContain('Kitchen, Bath');
    expect(task.description).toContain('2026-10-20');
  });
});
