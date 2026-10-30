import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  API_PREFIX,
  AutomationTrigger,
  ProjectVisibility,
  SlackAction,
  SlackCallback,
  WebhookDeliveryStatus,
  WorkspaceRole,
} from '@coretask/contracts';
import request from 'supertest';

import { resetEnvCache } from '../../src/config/env';
import { signSlackRequest } from '../../src/modules/slack/lib/slack-signature';
import { WebhookDeliveryService } from '../../src/modules/webhooks/webhook-delivery.service';

import {
  closeTestContext,
  confirmEmail,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

const SIGNING_SECRET = 'test-signing-secret-never-real';
const CLIENT_ID = '1111.2222';
const CLIENT_SECRET = 'test-client-secret-never-real';
const BOT_TOKEN = 'xoxb-test-token-never-real';
const TEAM = { id: 'T0TEST', name: 'Acme Slack', domain: 'acme' };

/** One call Slack's stand-in received. */
interface SlackCall {
  method: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

/**
 * The CoreTask Slack app, both ways, against a stand-in for Slack.
 *
 * Slack's Web API is a small local server that records each call and answers
 * as Slack would; Slack's requests to CoreTask are built here and signed with
 * the test signing secret, exactly as Slack signs them. Nothing leaves the
 * machine. Values are assigned outright because the suite sources the dev
 * `.env`.
 */
describe('Slack app (e2e)', () => {
  let context: TestContext;
  let deliveries: WebhookDeliveryService;
  let slack: Server;
  let calls: SlackCall[];
  /** A method's next answer, when a test wants something other than success. */
  let overrides: Record<string, Record<string, unknown>>;

  const answer = (call: SlackCall): Record<string, unknown> => {
    const override = overrides[call.method];
    if (override) return override;
    switch (call.method) {
      case 'oauth.v2.access':
        return call.body['code'] === 'good-code'
          ? {
              ok: true,
              token_type: 'bot',
              access_token: BOT_TOKEN,
              bot_user_id: 'UBOT',
              scope: 'commands,chat:write,chat:write.public,channels:read,groups:read',
              team: { id: TEAM.id, name: TEAM.name },
              authed_user: { id: 'UADA' },
            }
          : { ok: false, error: 'invalid_code' };
      case 'conversations.list':
        return {
          ok: true,
          channels: [
            { id: 'C0LEASING', name: 'leasing', is_private: false },
            { id: 'G0BOARD', name: 'board', is_private: true },
            { id: 'C0OLD', name: 'old', is_archived: true },
          ],
          response_metadata: { next_cursor: '' },
        };
      case 'conversations.info':
        return call.body['channel'] === 'C0LEASING'
          ? { ok: true, channel: { id: 'C0LEASING', name: 'leasing', is_private: false } }
          : { ok: false, error: 'channel_not_found' };
      case 'chat.postMessage':
        return { ok: true, channel: call.body['channel'], ts: '1760000000.000100' };
      default:
        return { ok: true };
    }
  };

  const readBody = async (incoming: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    if ((incoming.headers['content-type'] ?? '').includes('json')) {
      return JSON.parse(raw || '{}') as Record<string, unknown>;
    }
    return Object.fromEntries(new URLSearchParams(raw));
  };

  beforeAll(async () => {
    slack = createServer((incoming, outgoing) => {
      void readBody(incoming).then((body) => {
        const call: SlackCall = {
          method: (incoming.url ?? '').replace(/^\/api\//, ''),
          authorization: incoming.headers.authorization,
          body,
        };
        calls.push(call);
        outgoing.writeHead(200, { 'Content-Type': 'application/json' });
        outgoing.end(JSON.stringify(answer(call)));
      });
    });
    await new Promise<void>((resolve) => slack.listen(0, '127.0.0.1', resolve));
    const { port } = slack.address() as AddressInfo;

    process.env['SLACK_CLIENT_ID'] = CLIENT_ID;
    process.env['SLACK_CLIENT_SECRET'] = CLIENT_SECRET;
    process.env['SLACK_SIGNING_SECRET'] = SIGNING_SECRET;
    process.env['SLACK_API_BASE_URL'] = `http://127.0.0.1:${port}/api`;
    process.env['SLACK_AUTHORIZE_URL'] = 'https://slack.test/oauth/v2/authorize';
    resetEnvCache();

    context = await createTestContext();
    deliveries = context.app.get(WebhookDeliveryService);
  });

  beforeEach(async () => {
    calls = [];
    overrides = {};
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
    await closeTestContext(context);
    await new Promise<void>((resolve) => slack.close(() => resolve()));
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;
  const callsTo = (method: string) => calls.filter((call) => call.method === method);

  interface Actor {
    token: string;
    userId: string;
  }
  interface Scope {
    owner: Actor;
    member: Actor;
    workspaceId: string;
    projectId: string;
  }

  const registerUser = async (name: string): Promise<Actor> => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    await confirmEmail(context, response.body.data.user.id as string);
    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  };

  const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

  const setupScope = async (): Promise<Scope> => {
    const owner = await registerUser('Ada Owner');
    const member = await registerUser('Bea Member');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(as(owner))
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
    });
    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(as(owner))
      .send({ name: 'Leasing' })
      .expect(201);
    return { owner, member, workspaceId, projectId: project.body.data.id as string };
  };

  /** The admin's install, start to finish, as the browser would make it. */
  const install = async (scope: Scope) => {
    const started = await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/slack/install`))
      .set(as(scope.owner))
      .expect(200);
    const state = new URL(started.body.data.url as string).searchParams.get('state') as string;
    await request(server())
      .post(url('/integrations/slack/install'))
      .set(as(scope.owner))
      .send({ code: 'good-code', state })
      .expect(200);
  };

  /** Slack's signature over the exact bytes sent. */
  const signed = (path: string, body: string, timestamp = Math.floor(Date.now() / 1000)) =>
    request(server())
      .post(url(path))
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('X-Slack-Request-Timestamp', String(timestamp))
      .set('X-Slack-Signature', signSlackRequest(SIGNING_SECRET, timestamp, body))
      .send(body);

  const command = (fields: Record<string, string>) =>
    signed(
      '/integrations/slack/commands',
      new URLSearchParams({
        team_id: TEAM.id,
        team_domain: TEAM.domain,
        channel_id: 'C0LEASING',
        command: '/coretask',
        trigger_id: 'trigger-1',
        ...fields,
      }).toString(),
    );

  const interaction = (payload: Record<string, unknown>) =>
    signed(
      '/integrations/slack/interactions',
      new URLSearchParams({
        payload: JSON.stringify({ team: { id: TEAM.id, domain: TEAM.domain }, ...payload }),
      }).toString(),
    );

  /** Bea links her Slack account through the button's page. */
  const linkBea = async (scope: Scope) => {
    const reply = await command({ user_id: 'UBEA', text: 'link' }).expect(200);
    const button = (reply.body.blocks as { elements?: { url?: string }[] }[])
      .flatMap((block) => block.elements ?? [])
      .find((element) => element.url);
    const token = new URL(button?.url as string).searchParams.get('token') as string;
    await request(server())
      .post(url('/integrations/slack/link'))
      .set(as(scope.member))
      .send({ token })
      .expect(200);
    return token;
  };

  describe('installing', () => {
    it('says what it needs, and lets only an admin start an install', async () => {
      const scope = await setupScope();

      const before = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/slack`))
        .set(as(scope.member))
        .expect(200);
      expect(before.body.data).toEqual({
        configured: true,
        installation: null,
        me: { linked: false, slackUserId: null },
        canManage: false,
      });

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/slack/install`))
        .set(as(scope.member))
        .expect(403);

      const started = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/slack/install`))
        .set(as(scope.owner))
        .expect(200);
      const link = new URL(started.body.data.url as string);
      expect(link.origin + link.pathname).toBe('https://slack.test/oauth/v2/authorize');
      expect(link.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(link.searchParams.get('scope')).toBe(
        'commands,chat:write,chat:write.public,channels:read,groups:read',
      );
      expect(link.searchParams.get('redirect_uri')).toMatch(/\/integrations\/slack\/callback$/);
    });

    it('trades the code for a bot token, kept encrypted, and links the admin who approved it', async () => {
      const scope = await setupScope();
      await install(scope);

      const [exchange] = callsTo('oauth.v2.access');
      expect(exchange?.authorization).toBe(
        `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      );
      expect(exchange?.body['code']).toBe('good-code');

      const row = await context.prisma.slackInstallation.findUniqueOrThrow({
        where: { workspaceId: scope.workspaceId },
      });
      expect(row.teamId).toBe(TEAM.id);
      expect(row.botToken).not.toContain(BOT_TOKEN);
      expect(row.botToken.startsWith('v1.')).toBe(true);

      const status = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/slack`))
        .set(as(scope.owner))
        .expect(200);
      expect(status.body.data).toMatchObject({
        installation: {
          teamId: TEAM.id,
          teamName: TEAM.name,
          installedBy: { id: scope.owner.userId, name: 'Ada Owner' },
          linkedPeople: 1,
        },
        me: { linked: true, slackUserId: 'UADA' },
        canManage: true,
      });
    });

    it('refuses a state that is someone else’s, tampered with, or used with a bad code', async () => {
      const scope = await setupScope();
      const started = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/slack/install`))
        .set(as(scope.owner))
        .expect(200);
      const state = new URL(started.body.data.url as string).searchParams.get('state') as string;

      const someoneElse = await request(server())
        .post(url('/integrations/slack/install'))
        .set(as(scope.member))
        .send({ code: 'good-code', state })
        .expect(400);
      expect(someoneElse.body.error.code).toBe('SLACK_INSTALL_INVALID');

      await request(server())
        .post(url('/integrations/slack/install'))
        .set(as(scope.owner))
        .send({ code: 'good-code', state: `${state}x` })
        .expect(400);

      await request(server())
        .post(url('/integrations/slack/install'))
        .set(as(scope.owner))
        .send({ code: 'spent-code', state })
        .expect(400);

      expect(callsTo('oauth.v2.access')).toHaveLength(1);
      expect(await context.prisma.slackInstallation.count()).toBe(0);
    });

    it('will not connect one Slack workspace to two CoreTask workspaces', async () => {
      const scope = await setupScope();
      await install(scope);

      const second = await request(server())
        .post(url('/workspaces'))
        .set(as(scope.owner))
        .send({ name: 'Second' })
        .expect(201);
      const started = await request(server())
        .post(url(`/workspaces/${second.body.data.id as string}/slack/install`))
        .set(as(scope.owner))
        .expect(200);
      const state = new URL(started.body.data.url as string).searchParams.get('state') as string;
      const refused = await request(server())
        .post(url('/integrations/slack/install'))
        .set(as(scope.owner))
        .send({ code: 'good-code', state })
        .expect(409);
      expect(refused.body.error.code).toBe('SLACK_ALREADY_CONNECTED');
      expect(refused.body.error.message).toContain('Acme');
    });
  });

  describe('requests from Slack', () => {
    it('refuses what Slack did not sign, or signed too long ago', async () => {
      const body = new URLSearchParams({
        team_id: TEAM.id,
        user_id: 'UBEA',
        text: 'help',
      }).toString();
      await request(server())
        .post(url('/integrations/slack/commands'))
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', String(Math.floor(Date.now() / 1000)))
        .set('X-Slack-Signature', 'v0=forged')
        .send(body)
        .expect(401);
      await signed(
        '/integrations/slack/commands',
        body,
        Math.floor(Date.now() / 1000) - 600,
      ).expect(401);
    });

    it('says when this Slack is not connected, and helps when asked', async () => {
      const unknown = await command({ user_id: 'UBEA', text: 'Fix the gate' }).expect(200);
      expect(unknown.body.response_type).toBe('ephemeral');
      expect(unknown.body.text).toContain('not connected to CoreTask');

      const scope = await setupScope();
      await install(scope);
      const help = await command({ user_id: 'UBEA', text: 'help' }).expect(200);
      expect(help.body.text).toContain('/coretask <task name>');
    });

    it('asks someone unlinked to link first, and links them as the person signed in', async () => {
      const scope = await setupScope();
      await install(scope);

      const asked = await command({ user_id: 'UBEA', text: 'Fix the gate' }).expect(200);
      expect(asked.body.response_type).toBe('ephemeral');
      expect(asked.body.text).toContain(
        'To make tasks from Slack, link your CoreTask account first.',
      );
      expect(callsTo('views.open')).toHaveLength(0);

      const reply = await command({ user_id: 'UBEA', text: 'link' }).expect(200);
      const button = (reply.body.blocks as { elements?: { url?: string }[] }[])
        .flatMap((block) => block.elements ?? [])
        .find((element) => element.url);
      const linkUrl = new URL(button?.url as string);
      expect(linkUrl.pathname).toBe('/integrations/slack/link');
      const token = linkUrl.searchParams.get('token') as string;

      const preview = await request(server())
        .post(url('/integrations/slack/link/preview'))
        .set(as(scope.member))
        .send({ token })
        .expect(200);
      expect(preview.body.data).toEqual({
        workspaceId: scope.workspaceId,
        workspaceName: 'Acme',
        teamName: TEAM.name,
        linkedTo: null,
      });

      // Someone outside the workspace cannot claim the Slack account.
      const stranger = await registerUser('Cy Stranger');
      await request(server())
        .post(url('/integrations/slack/link'))
        .set(as(stranger))
        .send({ token })
        .expect(403);

      await request(server())
        .post(url('/integrations/slack/link'))
        .set(as(scope.member))
        .send({ token })
        .expect(200);
      const link = await context.prisma.slackUserLink.findFirstOrThrow({
        where: { slackUserId: 'UBEA' },
      });
      expect(link.userId).toBe(scope.member.userId);

      await request(server())
        .post(url('/integrations/slack/link'))
        .set(as(scope.member))
        .send({ token: `${token}x` })
        .expect(400);
    });
  });

  describe('making a task from Slack', () => {
    it('opens the form prefilled with what followed the command', async () => {
      const scope = await setupScope();
      await install(scope);
      await linkBea(scope);

      const reply = await command({ user_id: 'UBEA', text: 'Fix the gate' }).expect(200);
      expect(reply.text).toBe('');

      const [opened] = callsTo('views.open');
      expect(opened?.authorization).toBe(`Bearer ${BOT_TOKEN}`);
      expect(opened?.body['trigger_id']).toBe('trigger-1');
      const view = opened?.body['view'] as {
        callback_id: string;
        private_metadata: string;
        blocks: { element: { initial_value?: string } }[];
      };
      expect(view.callback_id).toBe(SlackCallback.CREATE_TASK);
      expect(view.blocks[0]?.element.initial_value).toBe('Fix the gate');
      expect(JSON.parse(view.private_metadata)).toEqual({ channelId: 'C0LEASING' });
    });

    it('offers only the projects that person can see, and puts them first among assignees', async () => {
      const scope = await setupScope();
      await install(scope);
      await linkBea(scope);
      const secret = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set(as(scope.owner))
        .send({ name: 'Board pack' })
        .expect(201);
      await context.prisma.project.update({
        where: { id: secret.body.data.id as string },
        data: { visibility: ProjectVisibility.PRIVATE },
      });

      const projects = await interaction({
        type: 'block_suggestion',
        user: { id: 'UBEA' },
        action_id: SlackAction.PROJECT,
        value: '',
      }).expect(200);
      expect(projects.body.options.map((option: { value: string }) => option.value)).toEqual([
        scope.projectId,
      ]);

      const people = await interaction({
        type: 'block_suggestion',
        user: { id: 'UBEA' },
        action_id: SlackAction.ASSIGNEE,
        value: '',
      }).expect(200);
      expect(people.body.options[0]).toMatchObject({
        text: { text: 'Bea Member (you)' },
        value: scope.member.userId,
      });

      const nobody = await interaction({
        type: 'block_suggestion',
        user: { id: 'UNOBODY' },
        action_id: SlackAction.PROJECT,
        value: '',
      }).expect(200);
      expect(nobody.body.options).toEqual([]);
    });

    const submission = (values: Record<string, Record<string, unknown>>, user = 'UBEA') =>
      interaction({
        type: 'view_submission',
        user: { id: user },
        view: {
          callback_id: SlackCallback.CREATE_TASK,
          private_metadata: JSON.stringify({ channelId: 'C0LEASING' }),
          state: { values },
        },
      });

    it('makes the task as the linked person, in the project’s first section', async () => {
      const scope = await setupScope();
      await install(scope);
      await linkBea(scope);

      const reply = await submission({
        title: { [SlackAction.TITLE]: { value: '  Fix the gate  ' } },
        project: { [SlackAction.PROJECT]: { selected_option: { value: scope.projectId } } },
        assignee: { [SlackAction.ASSIGNEE]: { selected_option: { value: scope.owner.userId } } },
        due: { [SlackAction.DUE_DATE]: { selected_date: '2026-11-03' } },
        description: { [SlackAction.DESCRIPTION]: { value: 'Squeaks at night.' } },
      }).expect(200);
      expect(reply.body.response_action).toBe('update');
      expect(reply.body.view.title.text).toBe('Task created');
      expect(JSON.stringify(reply.body.view.blocks)).toContain('Leasing · assigned to Ada Owner');

      const task = await context.prisma.task.findFirstOrThrow({ where: { title: 'Fix the gate' } });
      const firstSection = await context.prisma.section.findFirst({
        where: { projectId: scope.projectId },
        orderBy: { position: 'asc' },
      });
      expect(task).toMatchObject({
        projectId: scope.projectId,
        sectionId: firstSection?.id ?? null,
        assigneeId: scope.owner.userId,
        createdById: scope.member.userId,
      });
      expect(task.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-03');
      expect(task.description).toContain('Squeaks at night.');
    });

    it('answers a bad form beside the field, and refuses a project the person cannot see', async () => {
      const scope = await setupScope();
      await install(scope);
      await linkBea(scope);

      const empty = await submission({ title: { [SlackAction.TITLE]: { value: '  ' } } }).expect(
        200,
      );
      expect(empty.body).toEqual({
        response_action: 'errors',
        errors: { title: 'Give the task a name.' },
      });

      const secret = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set(as(scope.owner))
        .send({ name: 'Board pack' })
        .expect(201);
      await context.prisma.project.update({
        where: { id: secret.body.data.id as string },
        data: { visibility: ProjectVisibility.PRIVATE },
      });
      const hidden = await submission({
        title: { [SlackAction.TITLE]: { value: 'Peek' } },
        project: {
          [SlackAction.PROJECT]: { selected_option: { value: secret.body.data.id as string } },
        },
      }).expect(200);
      expect(hidden.body.response_action).toBe('errors');
      expect(Object.keys(hidden.body.errors)).toEqual(['project']);

      const unlinked = await submission(
        { title: { [SlackAction.TITLE]: { value: 'Sneak' } } },
        'UNOBODY',
      ).expect(200);
      expect(unlinked.body.response_action).toBe('errors');
      expect(await context.prisma.task.count()).toBe(0);
    });

    it('prefills from a message, with a link back to it', async () => {
      const scope = await setupScope();
      await install(scope);
      await linkBea(scope);

      await interaction({
        type: 'message_action',
        callback_id: SlackCallback.CREATE_FROM_MESSAGE,
        trigger_id: 'trigger-2',
        user: { id: 'UBEA' },
        channel: { id: 'C0LEASING' },
        message: { ts: '1760000000.000200', text: 'Gate at <#C1|unit-4> is stuck\nSince Monday' },
      }).expect(200);

      const view = callsTo('views.open')[0]?.body['view'] as {
        blocks: { element: { initial_value?: string } }[];
      };
      expect(view.blocks[0]?.element.initial_value).toBe('Gate at #unit-4 is stuck');
      expect(view.blocks[4]?.element.initial_value).toBe(
        'Gate at #unit-4 is stuck\nSince Monday\n\nFrom Slack: https://acme.slack.com/archives/C0LEASING/p1760000000000200',
      );
    });
  });

  describe('a project posting to a channel as the app', () => {
    const connectChannel = async (scope: Scope) => {
      const created = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/apps`))
        .set(as(scope.owner))
        .send({ app: 'SLACK', slackChannelId: 'C0LEASING' })
        .expect(201);
      return created.body.data as { id: string; urlHint: string; slackChannel: unknown };
    };

    it('lists the channels the bot can post to and connects one, saying hello there', async () => {
      const scope = await setupScope();
      await install(scope);

      const channels = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/slack/channels`))
        .set(as(scope.member))
        .expect(200);
      expect(channels.body.data).toEqual([
        { id: 'G0BOARD', name: 'board', isPrivate: true },
        { id: 'C0LEASING', name: 'leasing', isPrivate: false },
      ]);

      const app = await connectChannel(scope);
      expect(app).toMatchObject({
        urlHint: '#leasing',
        slackChannel: { id: 'C0LEASING', name: 'leasing' },
      });

      const ping = await context.prisma.webhookDelivery.findFirstOrThrow({
        where: { endpointId: app.id },
      });
      await deliveries.deliver(ping.id, 1);
      const [posted] = callsTo('chat.postMessage');
      expect(posted?.authorization).toBe(`Bearer ${BOT_TOKEN}`);
      expect(posted?.body).toMatchObject({ channel: 'C0LEASING', unfurl_links: false });
      expect(posted?.body['text']).toBe('CoreTask will post updates from Leasing here.');
      expect(
        (await context.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: ping.id } })).status,
      ).toBe(WebhookDeliveryStatus.SUCCEEDED);

      const missing = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/apps`))
        .set(as(scope.owner))
        .send({ app: 'SLACK', slackChannelId: 'C0SECRET' })
        .expect(400);
      expect(missing.body.error.message).toContain('cannot see that channel');
    });

    it('posts a task with buttons that complete it and assign it, as whoever pressed them', async () => {
      const scope = await setupScope();
      await install(scope);
      await linkBea(scope);
      await connectChannel(scope);
      // Taking the task means being given it, which only the project's members may be.
      await context.prisma.projectMember.create({
        data: {
          projectId: scope.projectId,
          userId: scope.member.userId,
          workspaceId: scope.workspaceId,
          role: 'EDITOR',
        },
      });

      const created = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set(as(scope.owner))
        .send({ title: 'Replace the gate motor', projectId: scope.projectId })
        .expect(201);
      const taskId = created.body.data.id as string;

      await deliveries.fanOut({
        eventId: randomUUID(),
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        trigger: AutomationTrigger.TASK_CREATED,
        entityType: 'TASK',
        entityId: taskId,
        actorId: scope.owner.userId,
        after: {},
        correlationId: randomUUID(),
        depth: 0,
      });
      const delivery = await context.prisma.webhookDelivery.findFirstOrThrow({
        where: { eventType: 'task.created' },
      });
      await deliveries.deliver(delivery.id, 1);
      const posted = callsTo('chat.postMessage').at(-1);
      const blocks = posted?.body['blocks'] as {
        type: string;
        elements?: { action_id?: string; value?: string }[];
      }[];
      const buttons = blocks.at(-1)?.elements ?? [];
      expect(buttons.map((button) => button.action_id)).toEqual([
        SlackAction.COMPLETE,
        SlackAction.ASSIGN_TO_ME,
        SlackAction.OPEN,
      ]);
      expect(buttons[0]?.value).toBe(taskId);

      const press = (actionId: string, user: string) =>
        interaction({
          type: 'block_actions',
          trigger_id: 'trigger-3',
          user: { id: user },
          container: { channel_id: 'C0LEASING', message_ts: '1760000000.000100' },
          message: { ts: '1760000000.000100', text: posted?.body['text'], blocks },
          actions: [{ action_id: actionId, value: taskId }],
        }).expect(200);

      // Someone unlinked is asked to link, and nothing changes.
      await press(SlackAction.COMPLETE, 'UNOBODY');
      const notice = callsTo('views.open').at(-1)?.body['view'] as { title: { text: string } };
      expect(notice.title.text).toBe('Link your account');
      expect(
        (await context.prisma.task.findUniqueOrThrow({ where: { id: taskId } })).completedAt,
      ).toBeNull();

      await press(SlackAction.ASSIGN_TO_ME, 'UBEA');
      expect(
        (await context.prisma.task.findUniqueOrThrow({ where: { id: taskId } })).assigneeId,
      ).toBe(scope.member.userId);
      const assigned = callsTo('chat.update').at(-1);
      expect(assigned?.body).toMatchObject({ channel: 'C0LEASING', ts: '1760000000.000100' });
      expect(JSON.stringify(assigned?.body['blocks'])).toContain(
        '*Bea Member* took this from Slack',
      );

      await press(SlackAction.COMPLETE, 'UBEA');
      const done = await context.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(done.completedAt).not.toBeNull();
      const completed = callsTo('chat.update').at(-1);
      const after = completed?.body['blocks'] as { type: string; elements?: unknown[] }[];
      expect(JSON.stringify(after)).toContain('Marked complete by *Bea Member* from Slack');
      expect(after.at(-1)?.elements).toHaveLength(1);
    });

    it('fails for good on a channel Slack no longer knows, and retries when Slack is busy', async () => {
      const scope = await setupScope();
      await install(scope);
      const app = await connectChannel(scope);
      const ping = await context.prisma.webhookDelivery.findFirstOrThrow({
        where: { endpointId: app.id },
      });

      overrides['chat.postMessage'] = { ok: false, error: 'ratelimited' };
      await expect(deliveries.deliver(ping.id, 1)).rejects.toThrow('Slack said ratelimited');
      expect(
        (await context.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: ping.id } })).status,
      ).toBe(WebhookDeliveryStatus.PENDING);

      overrides['chat.postMessage'] = { ok: false, error: 'channel_not_found' };
      await expect(deliveries.deliver(ping.id, 2)).rejects.toMatchObject({
        name: 'UnrecoverableError',
      });
      expect(
        (await context.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: ping.id } })).status,
      ).toBe(WebhookDeliveryStatus.FAILED);
    });
  });

  describe('leaving', () => {
    it('unlinks one person, from CoreTask or from Slack', async () => {
      const scope = await setupScope();
      await install(scope);
      await linkBea(scope);

      await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/slack/me`))
        .set(as(scope.member))
        .expect(204);
      expect(await context.prisma.slackUserLink.count({ where: { slackUserId: 'UBEA' } })).toBe(0);

      await linkBea(scope);
      const reply = await command({ user_id: 'UBEA', text: 'unlink' }).expect(200);
      expect(reply.body.text).toContain('no longer linked');
      expect(await context.prisma.slackUserLink.count({ where: { slackUserId: 'UBEA' } })).toBe(0);
    });

    it('disconnects: the token is revoked, links forgotten, channels switched off', async () => {
      const scope = await setupScope();
      await install(scope);
      await linkBea(scope);
      const app = await connectChannel(scope);

      await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/slack`))
        .set(as(scope.member))
        .expect(403);
      await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/slack`))
        .set(as(scope.owner))
        .expect(204);

      expect(callsTo('auth.revoke')[0]?.authorization).toBe(`Bearer ${BOT_TOKEN}`);
      expect(await context.prisma.slackInstallation.count()).toBe(0);
      expect(await context.prisma.slackUserLink.count()).toBe(0);
      const endpoint = await context.prisma.webhookEndpoint.findUniqueOrThrow({
        where: { id: app.id },
      });
      expect(endpoint).toMatchObject({
        enabled: false,
        disabledReason: 'Slack was disconnected from this workspace.',
      });

      const switchedOn = await request(server())
        .patch(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/apps/${app.id}`))
        .set(as(scope.owner))
        .send({ enabled: true })
        .expect(400);
      expect(switchedOn.body.error.code).toBe('SLACK_NOT_CONNECTED');

      const later = await command({ user_id: 'UBEA', text: 'Fix the gate' }).expect(200);
      expect(later.body.text).toContain('not connected to CoreTask');
    });

    const connectChannel = async (scope: Scope) => {
      const created = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/apps`))
        .set(as(scope.owner))
        .send({ app: 'SLACK', slackChannelId: 'C0LEASING' })
        .expect(201);
      return created.body.data as { id: string };
    };
  });
});
