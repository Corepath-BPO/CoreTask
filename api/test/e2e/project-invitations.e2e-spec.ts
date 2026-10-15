import { API_PREFIX, ProjectMemberRole, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import { EmailQueue } from '../../src/jobs/email/email.queue';
import type { InvitationEmailJobData } from '../../src/jobs/queue-names';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Inviting someone outside the workspace from a project's Share dialog. The
 * invitation is a workspace invitation that also names the project; accepting
 * it joins both. The e-mail is the worker's; the queue is watched instead,
 * which is where the raw token is last seen.
 */
describe('Project invitations (e2e)', () => {
  let context: TestContext;
  let sent: InvitationEmailJobData[];

  beforeAll(async () => {
    context = await createTestContext();
    jest
      .spyOn(context.app.get(EmailQueue), 'enqueueInvitation')
      .mockImplementation(async (data) => {
        sent.push(data);
      });
  });

  beforeEach(async () => {
    sent = [];
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
    email: string;
  }

  const registerUser = async (name = 'Test User', email = uniqueEmail()): Promise<Actor> => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email, password: VALID_PASSWORD })
      .expect(201);
    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
      email,
    };
  };
  const auth = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

  /** An owner, their workspace, and a project in it. */
  const setup = async () => {
    const owner = await registerUser('Olive Owner');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(auth(owner))
      .send({ name: 'Acme Product' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(auth(owner))
      .send({ name: 'Website relaunch' })
      .expect(201);
    const projectId = project.body.data.id as string;
    const base = `/workspaces/${workspaceId}/projects/${projectId}`;
    return { owner, workspaceId, projectId, base };
  };

  const invite = (actor: Actor, base: string, body: object) =>
    request(server())
      .post(url(`${base}/invitations`))
      .set(auth(actor))
      .send(body);

  it('invites into the project, and accepting joins the workspace and the project', async () => {
    const { owner, workspaceId, projectId, base } = await setup();
    const email = uniqueEmail('guest');

    const created = await invite(owner, base, {
      email: email.toUpperCase(),
      role: ProjectMemberRole.EDITOR,
    }).expect(201);

    expect(created.body.data).toMatchObject({
      email,
      role: WorkspaceRole.MEMBER,
      project: { id: projectId, name: 'Website relaunch', role: ProjectMemberRole.EDITOR },
    });
    expect(sent).toEqual([
      expect.objectContaining({ email, projectName: 'Website relaunch', role: 'MEMBER' }),
    ]);

    // The Share dialog lists it as waiting.
    const waiting = await request(server())
      .get(url(`${base}/invitations`))
      .set(auth(owner))
      .expect(200);
    expect(waiting.body.data.map((row: { email: string }) => row.email)).toEqual([email]);

    const token = sent[0]!.token;
    const preview = await request(server())
      .get(url(`/invitations/${token}`))
      .expect(200);
    expect(preview.body.data).toMatchObject({ projectName: 'Website relaunch', role: 'MEMBER' });

    const invitee = await registerUser('Ida Invitee', email);
    const accepted = await request(server())
      .post(url(`/invitations/${token}/accept`))
      .set(auth(invitee))
      .expect(200);
    expect(accepted.body.data).toMatchObject({ workspaceId, projectId });

    const roster = await request(server())
      .get(url(`${base}/members`))
      .set(auth(invitee))
      .expect(200);
    expect(roster.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: invitee.userId, role: ProjectMemberRole.EDITOR }),
      ]),
    );

    // Accepted, so no longer waiting.
    const after = await request(server())
      .get(url(`${base}/invitations`))
      .set(auth(owner))
      .expect(200);
    expect(after.body.data).toEqual([]);
  });

  it('invites a viewer as a workspace guest, which is all a viewer acts as', async () => {
    const { owner, base } = await setup();

    const created = await invite(owner, base, {
      email: uniqueEmail('viewer'),
      role: ProjectMemberRole.VIEWER,
    }).expect(201);

    expect(created.body.data.role).toBe(WorkspaceRole.GUEST);
  });

  it('keeps a live invitation’s higher role and team rather than demoting it', async () => {
    const { owner, workspaceId, base } = await setup();
    const email = uniqueEmail('admin-to-be');
    const team = await request(server())
      .post(url(`/workspaces/${workspaceId}/teams`))
      .set(auth(owner))
      .send({ name: 'Platform' })
      .expect(201);
    await request(server())
      .post(url(`/workspaces/${workspaceId}/invitations`))
      .set(auth(owner))
      .send({ email, role: WorkspaceRole.ADMIN, teamId: team.body.data.id })
      .expect(201);

    const created = await invite(owner, base, {
      email,
      role: ProjectMemberRole.VIEWER,
    }).expect(201);

    expect(created.body.data).toMatchObject({
      role: WorkspaceRole.ADMIN,
      team: { id: team.body.data.id },
      project: { role: ProjectMemberRole.VIEWER },
    });
  });

  it('is for workspace admins only, even when the caller runs the project', async () => {
    const { owner, workspaceId, projectId, base } = await setup();
    const lead = await registerUser('Lee Lead');
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: lead.userId, role: WorkspaceRole.MEMBER },
    });
    await request(server())
      .post(url(`${base}/members`))
      .set(auth(owner))
      .send({ userId: lead.userId, role: ProjectMemberRole.ADMIN })
      .expect(201);

    const refused = await invite(lead, base, {
      email: uniqueEmail('outsider'),
      role: ProjectMemberRole.EDITOR,
    }).expect(403);

    expect(refused.body.error.message).toMatch(/workspace admin/i);
    expect(sent).toEqual([]);
    expect(projectId).toBeTruthy();
  });

  it('points someone already in the workspace back at the list', async () => {
    const { owner, base } = await setup();

    const refused = await invite(owner, base, {
      email: owner.email,
      role: ProjectMemberRole.EDITOR,
    }).expect(409);

    expect(refused.body.error.message).toMatch(/already in the workspace/i);
  });

  it('still joins the workspace when the project was deleted in the meantime', async () => {
    const { owner, workspaceId, projectId, base } = await setup();
    const email = uniqueEmail('late');
    await invite(owner, base, { email, role: ProjectMemberRole.EDITOR }).expect(201);
    await context.prisma.project.delete({ where: { id: projectId } });

    const invitee = await registerUser('Lou Late', email);
    const accepted = await request(server())
      .post(url(`/invitations/${sent[0]!.token}/accept`))
      .set(auth(invitee))
      .expect(200);

    expect(accepted.body.data).toMatchObject({ workspaceId, projectId: null });
  });
});
