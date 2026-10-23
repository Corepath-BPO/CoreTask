import { randomBytes, randomUUID } from 'node:crypto';

import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import { StorageService } from '../../src/integrations/storage/storage.service';
import { EmailQueue } from '../../src/jobs/email/email.queue';
import type { MessageEmailJobData } from '../../src/jobs/queue-names';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Deleting a workspace leans on ON DELETE CASCADE for nearly all of it, and a
 * cascade is easy to break without noticing: one new table with RESTRICT, or
 * a SET NULL where CASCADE was meant, and a deletion either fails or leaves
 * rows behind. So the main case here fills a workspace with one of nearly
 * everything, deletes it, and checks that every table in the schema holds
 * exactly what it held before the workspace existed.
 */
describe('Deleting a workspace (e2e)', () => {
  let context: TestContext;
  let storage: StorageService;
  let mail: MessageEmailJobData[];

  beforeAll(async () => {
    context = await createTestContext();
    storage = context.app.get(StorageService);
    jest.spyOn(context.app.get(EmailQueue), 'enqueueMessage').mockImplementation(async (data) => {
      mail.push(data);
    });
  });

  beforeEach(async () => {
    mail = [];
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

  const register = async (name: string): Promise<Actor> => {
    const email = uniqueEmail('wsdel');
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email, password: VALID_PASSWORD })
      .expect(201);
    const userId = response.body.data.user.id as string;
    // API keys and invitations need a confirmed address.
    await context.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), emailVerificationDueAt: null },
    });
    return { token: response.body.data.accessToken as string, userId, email };
  };

  const as = (actor: Actor) => ({
    get: (path: string) =>
      request(server()).get(url(path)).set('Authorization', `Bearer ${actor.token}`),
    post: (path: string, body: object = {}) =>
      request(server()).post(url(path)).set('Authorization', `Bearer ${actor.token}`).send(body),
    delete: (path: string, body: object = {}) =>
      request(server()).delete(url(path)).set('Authorization', `Bearer ${actor.token}`).send(body),
  });

  const createWorkspace = async (owner: Actor, name: string): Promise<string> => {
    const response = await as(owner).post('/workspaces', { name }).expect(201);
    return response.body.data.id as string;
  };

  const addMember = (workspaceId: string, actor: Actor, role: WorkspaceRole) =>
    context.prisma.workspaceMember.create({ data: { workspaceId, userId: actor.userId, role } });

  /** Rows in every table of this schema. */
  const tableCounts = async (): Promise<Record<string, number>> => {
    const tables = await context.prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = current_schema() AND tablename NOT LIKE '_prisma%'
      ORDER BY tablename
    `;
    const counts: Record<string, number> = {};
    for (const { tablename } of tables) {
      const [row] = await context.prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM "${tablename}"`,
      );
      counts[tablename] = Number(row?.count ?? 0);
    }
    return counts;
  };

  /**
   * One of nearly everything a workspace can hold. Through the API where
   * that is short — so the rows are the ones the product really writes — and
   * straight into the database for the rest.
   */
  const fill = async (workspaceId: string, owner: Actor, member: Actor) => {
    const api = as(owner);
    const ws = (path: string) => `/workspaces/${workspaceId}${path}`;
    const db = context.prisma;

    const project = (await api.post(ws('/projects'), { name: 'Doomed project' }).expect(201)).body
      .data;
    const sectionId = project.sections[0].id as string;
    const task = (await api.post(ws('/tasks'), { title: 'Parent', sectionId }).expect(201)).body
      .data;
    const blocker = (await api.post(ws('/tasks'), { title: 'Blocker', sectionId }).expect(201)).body
      .data;
    await api.post(ws('/tasks'), { title: 'Child', sectionId, parentTaskId: task.id }).expect(201);
    await api
      .post(ws(`/tasks/${task.id}/dependencies`), { taskId: blocker.id, direction: 'BLOCKED_BY' })
      .expect(201);
    const comment = (
      await api.post(ws(`/tasks/${task.id}/comments`), { body: '<p>Last words</p>' }).expect(201)
    ).body.data;
    await api.post(ws('/tickets'), { title: 'Something is broken' }).expect(201);

    // A file, really uploaded.
    const bytes = Buffer.from('the minutes of the last meeting');
    const declared = await api
      .post(ws('/attachments'), {
        filename: 'minutes.txt',
        mimeType: 'text/plain',
        sizeBytes: bytes.length,
        taskId: task.id,
      })
      .expect(201);
    const { attachment, uploadUrl, uploadHeaders } = declared.body.data;
    expect(
      (await fetch(uploadUrl, { method: 'PUT', headers: uploadHeaders, body: bytes })).ok,
    ).toBe(true);
    await api.post(ws(`/attachments/${attachment.id}/confirm`)).expect(200);
    const objectKey = (await db.attachment.findUniqueOrThrow({ where: { id: attachment.id } }))
      .objectKey;

    // An API key, and a task its account wrote — tasks hold their creator
    // with RESTRICT, so this is the case that could block deleting it.
    const key = (await api.post(ws('/api-keys'), { name: 'n8n' }).expect(201)).body.data;
    await request(server())
      .post(url(ws('/tasks')))
      .set('X-API-Key', key.secret as string)
      .send({ title: 'Written by a robot', sectionId })
      .expect(201);

    const field = await db.customField.create({
      data: { workspaceId, name: 'Priority', type: 'SINGLE_SELECT', createdById: owner.userId },
    });
    const option = await db.customFieldOption.create({
      data: { customFieldId: field.id, label: 'High' },
    });
    await db.projectCustomField.create({
      data: { projectId: project.id, customFieldId: field.id },
    });
    await db.taskCustomFieldValue.create({
      data: { taskId: task.id, customFieldId: field.id, optionIds: [option.id] },
    });

    const rule = await db.automationRule.create({
      data: {
        workspaceId,
        projectId: project.id,
        name: 'Tidy up',
        triggerType: 'TASK_CREATED',
        createdById: owner.userId,
      },
    });
    const version = await db.automationRuleVersion.create({
      data: { ruleId: rule.id, version: 1, triggerType: 'TASK_CREATED', createdById: owner.userId },
    });
    await db.automationRule.update({
      where: { id: rule.id },
      data: { publishedVersionId: version.id },
    });
    await db.automationExecution.create({
      data: {
        workspaceId,
        projectId: project.id,
        ruleId: rule.id,
        ruleVersionId: version.id,
        triggerType: 'TASK_CREATED',
        correlationId: randomUUID(),
      },
    });

    const goal = await db.goal.create({
      data: { workspaceId, name: 'Ship it', createdById: owner.userId, ownerId: member.userId },
    });
    await db.goalProject.create({ data: { goalId: goal.id, projectId: project.id } });
    const portfolio = await db.portfolio.create({
      data: { workspaceId, name: 'Everything', color: '#336699', ownerId: owner.userId },
    });
    await db.portfolioProject.create({
      data: { portfolioId: portfolio.id, projectId: project.id },
    });
    await db.portfolioStar.create({ data: { portfolioId: portfolio.id, userId: member.userId } });
    const team = await db.team.create({
      data: { workspaceId, name: 'Crew', leadId: member.userId },
    });
    await db.teamMember.create({ data: { teamId: team.id, userId: member.userId } });
    const tag = await db.tag.create({ data: { workspaceId, name: 'Urgent', nameKey: 'urgent' } });
    await db.taskTag.create({ data: { taskId: task.id, tagId: tag.id } });
    await db.projectView.create({
      data: { workspaceId, projectId: project.id, name: 'Board', type: 'BOARD' },
    });
    await db.projectForm.create({
      data: { workspaceId, projectId: project.id, name: 'Intake', token: randomUUID() },
    });
    const endpoint = await db.webhookEndpoint.create({
      data: {
        workspaceId,
        name: 'Hook',
        url: 'https://example.com/hook',
        secret: 'v1.a.b.c',
        createdById: owner.userId,
      },
    });
    await db.webhookDelivery.create({
      data: {
        workspaceId,
        endpointId: endpoint.id,
        eventType: 'task.created',
        eventId: randomUUID(),
        url: endpoint.url,
        payload: {},
        maxAttempts: 3,
      },
    });
    await db.workspaceInvitation.create({
      data: {
        workspaceId,
        email: uniqueEmail('invitee'),
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedById: owner.userId,
      },
    });
    // The token cannot be read, so disconnecting it from Slack fails quietly,
    // as it would for an app already uninstalled there.
    const slack = await db.slackInstallation.create({
      data: {
        workspaceId,
        teamId: 'T0DOOMED',
        teamName: 'Acme Slack',
        botUserId: 'U0BOT',
        botToken: 'v1.not.a.token',
        installedById: owner.userId,
      },
    });
    await db.slackUserLink.create({
      data: { installationId: slack.id, slackUserId: 'U0MEMBER', userId: member.userId },
    });
    const saml = await db.samlConnection.create({
      data: {
        workspaceId,
        idpEntityId: 'https://idp.example.com',
        idpSsoUrl: 'https://idp.example.com/sso',
        idpCertificate: 'MIIC',
      },
    });
    await db.userIdentity.create({
      data: {
        userId: member.userId,
        provider: 'SAML',
        subject: 'member@idp',
        samlConnectionId: saml.id,
        email: member.email,
      },
    });
    await db.workspaceDomain.create({
      data: { workspaceId, domain: 'doomed.test', verificationToken: randomUUID() },
    });

    // The member's own things in it.
    await db.follower.create({ data: { workspaceId, userId: member.userId, taskId: task.id } });
    await db.notification.create({
      data: { userId: member.userId, workspaceId, type: 'TASK_ASSIGNED', title: 'You got one' },
    });
    await db.myTaskPlacement.create({
      data: { userId: member.userId, taskId: task.id, bucket: 'TODAY' },
    });
    await db.savedSearch.create({ data: { workspaceId, userId: member.userId, name: 'Mine' } });
    await db.homeLayout.create({ data: { workspaceId, userId: member.userId } });
    await db.calendarFeed.create({
      data: { workspaceId, userId: member.userId, token: randomBytes(16).toString('hex') },
    });
    await db.notificationPreference.create({ data: { workspaceId, userId: member.userId } });
    await db.projectStar.create({ data: { projectId: project.id, userId: member.userId } });
    await db.taskLike.create({ data: { taskId: task.id, userId: member.userId } });
    await db.commentLike.create({ data: { commentId: comment.id, userId: member.userId } });
    await db.timeEntry.create({
      data: {
        workspaceId,
        taskId: task.id,
        userId: member.userId,
        minutes: 30,
        date: new Date('2026-10-20'),
      },
    });

    await db.projectMessage.create({
      data: { workspaceId, projectId: project.id, title: 'Kickoff', body: 'Hello' },
    });
    await db.reportDashboard.create({ data: { workspaceId, name: 'Numbers' } });
    await db.bundle.create({ data: { workspaceId, name: 'Kit' } });
    await db.taskTemplate.create({
      data: { workspaceId, projectId: project.id, name: 'Bug', title: 'Bug: ' },
    });
    await db.projectTemplate.create({
      data: { workspaceId, name: 'Launch', color: '#336699', blueprint: {} },
    });

    return { objectKey, apiKeySecret: key.secret as string, serviceAccountId: key.key.userId };
  };

  describe('the whole of it', () => {
    it('deletes every row the workspace had, its files and its API keys’ accounts, and nothing else', async () => {
      const owner = await register('Olive Owner');
      const member = await register('Max Member');

      // A workspace that stays, with work in it, before anything is counted.
      const kept = await createWorkspace(owner, 'Kept');
      await addMember(kept, member, WorkspaceRole.MEMBER);
      const keptProject = (
        await as(owner).post(`/workspaces/${kept}/projects`, { name: 'Stays' }).expect(201)
      ).body.data;
      await as(owner)
        .post(`/workspaces/${kept}/tasks`, {
          title: 'Still here',
          sectionId: keptProject.sections[0].id,
        })
        .expect(201);

      const before = await tableCounts();

      const doomed = await createWorkspace(owner, 'Doomed');
      await addMember(doomed, member, WorkspaceRole.ADMIN);
      const filled = await fill(doomed, owner, member);

      // Prove the fill reached what it meant to: each of these grew.
      const during = await tableCounts();
      const grew = Object.keys(during).filter((table) => during[table]! > (before[table] ?? 0));
      expect(grew).toEqual(
        expect.arrayContaining([
          'api_keys',
          'attachments',
          'automation_executions',
          'automation_rule_versions',
          'automation_rules',
          'calendar_feeds',
          'comment_likes',
          'comments',
          'custom_field_options',
          'custom_fields',
          'followers',
          'goal_projects',
          'goals',
          'home_layouts',
          'my_task_placements',
          'notifications',
          'portfolio_projects',
          'portfolios',
          'project_custom_fields',
          'project_forms',
          'project_messages',
          'project_views',
          'projects',
          'saml_connections',
          'saved_searches',
          'sections',
          'slack_installations',
          'slack_user_links',
          'tags',
          'task_custom_field_values',
          'task_dependencies',
          'task_likes',
          'task_tags',
          'tasks',
          'team_members',
          'teams',
          'tickets',
          'time_entries',
          'user_identities',
          'users',
          'webhook_deliveries',
          'webhook_endpoints',
          'workspace_domains',
          'workspace_invitations',
          'workspace_members',
          'workspaces',
        ]),
      );

      await as(owner)
        .delete(`/workspaces/${doomed}`, { confirmation: 'Doomed', password: VALID_PASSWORD })
        .expect(204);

      // Every table exactly as it was before the workspace existed — the API
      // key's account included.
      expect(await tableCounts()).toEqual(before);
      expect(
        await context.prisma.user.findUnique({ where: { id: filled.serviceAccountId } }),
      ).toBeNull();
      expect(await storage.headObject(filled.objectKey)).toBeNull();

      // The key stops working, the workspace is gone for everyone, and the
      // one that stays is untouched.
      await request(server())
        .get(url(`/workspaces/${doomed}/tasks`))
        .set('X-API-Key', filled.apiKeySecret)
        .expect(401);
      await as(member).get(`/workspaces/${doomed}`).expect(403);
      const list = (await as(member).get('/workspaces').expect(200)).body.data as { id: string }[];
      expect(list.map((workspace) => workspace.id)).toEqual([kept]);
      const tasks = await as(owner).get(`/workspaces/${kept}/tasks`).expect(200);
      expect(tasks.body.data.map((task: { title: string }) => task.title)).toEqual(['Still here']);

      // The member hears about it; the owner, who did it, does not.
      expect(mail.map((message) => message.to)).toEqual([member.email]);
      expect(mail[0]?.subject).toContain('Doomed');
      expect(mail[0]?.text).toContain('Olive Owner deleted the workspace');
    });
  });

  describe('refusals', () => {
    const setup = async () => {
      const owner = await register('Olive Owner');
      const workspaceId = await createWorkspace(owner, 'Acme Product');
      return { owner, workspaceId };
    };

    const stillThere = async (workspaceId: string) =>
      expect(await context.prisma.workspace.count({ where: { id: workspaceId } })).toBe(1);

    it('refuses a name that does not match exactly, before asking for the password', async () => {
      const { owner, workspaceId } = await setup();

      for (const confirmation of ['acme product', 'Acme Product ', 'Acme']) {
        const response = await as(owner)
          .delete(`/workspaces/${workspaceId}`, { confirmation, password: 'wrong-password' })
          .expect(400);
        expect(response.body.error.code).toBe('CONFIRMATION_MISMATCH');
      }
      await as(owner).delete(`/workspaces/${workspaceId}`, {}).expect(422);
      await stillThere(workspaceId);
    });

    it('refuses a wrong password, or none', async () => {
      const { owner, workspaceId } = await setup();

      const wrong = await as(owner)
        .delete(`/workspaces/${workspaceId}`, {
          confirmation: 'Acme Product',
          password: 'not-the-password',
        })
        .expect(400);
      expect(wrong.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');

      const none = await as(owner)
        .delete(`/workspaces/${workspaceId}`, { confirmation: 'Acme Product' })
        .expect(400);
      expect(none.body.error.code).toBe('REAUTH_REQUIRED');
      await stillThere(workspaceId);
    });

    it('is the owner’s alone: an admin, a member and an outsider are refused', async () => {
      const { workspaceId } = await setup();
      const admin = await register('Ada Admin');
      const member = await register('Mo Member');
      const outsider = await register('Otto Outsider');
      await addMember(workspaceId, admin, WorkspaceRole.ADMIN);
      await addMember(workspaceId, member, WorkspaceRole.MEMBER);

      for (const actor of [admin, member, outsider]) {
        await as(actor)
          .delete(`/workspaces/${workspaceId}`, {
            confirmation: 'Acme Product',
            password: VALID_PASSWORD,
          })
          .expect(403);
      }
      await stillThere(workspaceId);
    });

    it('never takes an API key, even the owner’s workspace’s own', async () => {
      const { owner, workspaceId } = await setup();
      const key = (
        await as(owner)
          .post(`/workspaces/${workspaceId}/api-keys`, { name: 'n8n', role: 'MEMBER' })
          .expect(201)
      ).body.data;

      const response = await request(server())
        .delete(url(`/workspaces/${workspaceId}`))
        .set('X-API-Key', key.secret as string)
        .send({ confirmation: 'Acme Product', password: VALID_PASSWORD })
        .expect(403);
      expect(response.body.error.code).toBe('API_KEY_NOT_ALLOWED');
      await stillThere(workspaceId);
    });

    it('lets an owner who signs in only with SSO confirm by having signed in recently', async () => {
      const { owner, workspaceId } = await setup();
      await context.prisma.user.update({
        where: { id: owner.userId },
        data: { passwordHash: null },
      });

      await as(owner)
        .delete(`/workspaces/${workspaceId}`, { confirmation: 'Acme Product' })
        .expect(204);
      expect(await context.prisma.workspace.count({ where: { id: workspaceId } })).toBe(0);
    });
  });
});
