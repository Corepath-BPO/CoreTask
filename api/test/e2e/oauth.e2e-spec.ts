import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { API_PREFIX, AutomationTrigger, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import type { AutomationEvent } from '../../src/modules/automations/automation-event.publisher';
import { WebhookDeliveryService } from '../../src/modules/webhooks/webhook-delivery.service';

import {
  closeTestContext,
  confirmEmail,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * OAuth 2.0 for connectors, and the webhook subscriptions they make.
 *
 * A developer (the workspace owner here) registers an app; a member allows it
 * on the consent endpoints; the app trades the code for tokens and calls the
 * API as that member — except where only a signed-in person may go.
 */
describe('OAuth apps and webhook subscriptions (e2e)', () => {
  let context: TestContext;
  let deliveries: WebhookDeliveryService;
  /**
   * The subscriber's server. It answers the X-Hook-Secret handshake by
   * echoing the header, unless a test says how it should answer instead.
   */
  let listener: Server;
  let HOOK = '';
  let handshake: 'echo' | 'ignore' | 'refuse' = 'echo';
  let handshakes: string[] = [];

  beforeAll(async () => {
    context = await createTestContext();
    deliveries = context.app.get(WebhookDeliveryService);
    listener = createServer((req, res) => {
      const secret = req.headers['x-hook-secret'];
      if (typeof secret === 'string') {
        handshakes.push(secret);
        if (handshake === 'refuse') {
          res.writeHead(410).end();
          return;
        }
        res.writeHead(200, handshake === 'echo' ? { 'X-Hook-Secret': secret } : {}).end();
        return;
      }
      res.writeHead(204).end();
    });
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const address = listener.address();
    HOOK = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/catch/1`;
  });

  beforeEach(async () => {
    handshake = 'echo';
    handshakes = [];
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;
  const REDIRECT = 'https://tool.example/oauth/callback';

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
  interface App {
    id: string;
    clientId: string;
    clientSecret: string;
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

  const as = (actor: Actor | string) => ({
    Authorization: `Bearer ${typeof actor === 'string' ? actor : actor.token}`,
  });

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

  const registerApp = async (developer: Actor, redirectUris = [REDIRECT]): Promise<App> => {
    const created = await request(server())
      .post(url('/users/me/oauth-apps'))
      .set(as(developer))
      .send({ name: 'Leasing sync', redirectUris })
      .expect(201);
    return {
      id: created.body.data.app.id as string,
      clientId: created.body.data.app.clientId as string,
      clientSecret: created.body.data.clientSecret as string,
    };
  };

  /** The member allows the app; answers the code from the redirect. */
  const allow = async (person: Actor, app: App, extra: Record<string, unknown> = {}) => {
    const answer = await request(server())
      .post(url('/oauth/authorize'))
      .set(as(person))
      .send({
        clientId: app.clientId,
        redirectUri: REDIRECT,
        state: 'st-1',
        approve: true,
        ...extra,
      })
      .expect(200);
    const redirect = new URL(answer.body.data.redirectTo as string);
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT);
    expect(redirect.searchParams.get('state')).toBe('st-1');
    return redirect.searchParams.get('code') as string;
  };

  const exchange = (app: App, code: string, extra: Record<string, unknown> = {}) =>
    request(server())
      .post(url('/oauth/token'))
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: app.clientId,
        client_secret: app.clientSecret,
        ...extra,
      });

  /** Allowed and exchanged: the token response. */
  const connect = async (person: Actor, app: App) => {
    const response = await exchange(app, await allow(person, app)).expect(200);
    return response.body as { access_token: string; refresh_token: string };
  };

  describe('registering an app', () => {
    it('shows the secret once and accepts only https or localhost redirect URIs', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner, [REDIRECT, 'http://localhost:5678/cb']);
      expect(app.clientId).toMatch(/^ctc_/);
      expect(app.clientSecret).toMatch(/^cts_/);

      const listed = await request(server())
        .get(url('/users/me/oauth-apps'))
        .set(as(scope.owner))
        .expect(200);
      expect(listed.body.data).toEqual([
        expect.objectContaining({
          clientId: app.clientId,
          secretHint: app.clientSecret.slice(0, 10),
          redirectUris: [REDIRECT, 'http://localhost:5678/cb'],
          connections: 0,
        }),
      ]);
      expect(JSON.stringify(listed.body)).not.toContain(app.clientSecret);

      for (const redirectUris of [['http://tool.example/cb'], ['https://tool.example/cb#x'], []]) {
        await request(server())
          .post(url('/users/me/oauth-apps'))
          .set(as(scope.owner))
          .send({ name: 'Bad', redirectUris })
          .expect(422);
      }

      // Another person does not see it.
      const theirs = await request(server())
        .get(url('/users/me/oauth-apps'))
        .set(as(scope.member))
        .expect(200);
      expect(theirs.body.data).toEqual([]);
    });
  });

  describe('the authorization-code flow', () => {
    it('describes the request, then trades the code for tokens that act as the person', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);

      const consent = await request(server())
        .post(url('/oauth/consent'))
        .set(as(scope.member))
        .send({ clientId: app.clientId, redirectUri: REDIRECT, scope: 'default' })
        .expect(200);
      expect(consent.body.data).toMatchObject({
        app: { name: 'Leasing sync', publisher: 'Ada Owner' },
        scopes: [{ scope: 'default' }],
        redirectHost: 'tool.example',
      });

      const code = await allow(scope.member, app);
      const token = await exchange(app, code).expect(200);
      expect(token.headers['cache-control']).toBe('no-store');
      expect(token.body).toMatchObject({
        access_token: expect.stringMatching(/^cto_/),
        refresh_token: expect.stringMatching(/^ctr_/),
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'default',
        user: { id: scope.member.userId, name: 'Bea Member' },
      });

      const whoami = await request(server())
        .get(url('/integration/whoami'))
        .set(as(token.body.access_token as string))
        .expect(200);
      expect(whoami.body.data).toMatchObject({
        principal: 'oauth_app',
        user: { id: scope.member.userId },
        oauthApp: { id: app.id, name: 'Leasing sync' },
      });

      // It can work: create a task in the member's workspace.
      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set(as(token.body.access_token as string))
        .send({ title: 'From the connector', projectId: scope.projectId })
        .expect(201);

      // It cannot manage people, keys or apps.
      const keys = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/api-keys`))
        .set(as(token.body.access_token as string))
        .expect(403);
      expect(keys.body.error.code).toBe('OAUTH_TOKEN_NOT_ALLOWED');
      await request(server())
        .post(url('/oauth/authorize'))
        .set(as(token.body.access_token as string))
        .send({ clientId: app.clientId, redirectUri: REDIRECT, approve: true })
        .expect(403);
    });

    it('accepts JSON and HTTP Basic client credentials, and refreshes', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const code = await allow(scope.member, app);

      const token = await request(server())
        .post(url('/oauth/token'))
        .send({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT,
          client_id: app.clientId,
          client_secret: app.clientSecret,
        })
        .expect(200);

      const refreshed = await request(server())
        .post(url('/oauth/token'))
        .auth(app.clientId, app.clientSecret)
        .type('form')
        .send({ grant_type: 'refresh_token', refresh_token: token.body.refresh_token })
        .expect(200);
      expect(refreshed.body.access_token).toMatch(/^cto_/);
      expect(refreshed.body.access_token).not.toBe(token.body.access_token);
      expect(refreshed.body.refresh_token).toBeUndefined();
      await request(server())
        .get(url('/integration/whoami'))
        .set(as(refreshed.body.access_token as string))
        .expect(200);
    });

    it('sends a refusal back to the app, with its state', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const answer = await request(server())
        .post(url('/oauth/authorize'))
        .set(as(scope.member))
        .send({ clientId: app.clientId, redirectUri: REDIRECT, state: 'abc', approve: false })
        .expect(200);
      const redirect = new URL(answer.body.data.redirectTo as string);
      expect(redirect.searchParams.get('error')).toBe('access_denied');
      expect(redirect.searchParams.get('state')).toBe('abc');
      expect(redirect.searchParams.get('code')).toBeNull();
    });

    it('never redirects for an unknown app or an unregistered redirect URI', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const unknown = await request(server())
        .post(url('/oauth/consent'))
        .set(as(scope.member))
        .send({ clientId: 'ctc_nope', redirectUri: REDIRECT })
        .expect(400);
      expect(unknown.body.error.code).toBe('OAUTH_UNKNOWN_CLIENT');
      const elsewhere = await request(server())
        .post(url('/oauth/authorize'))
        .set(as(scope.member))
        .send({ clientId: app.clientId, redirectUri: 'https://evil.example/cb', approve: true })
        .expect(400);
      expect(elsewhere.body.error.code).toBe('OAUTH_REDIRECT_URI_MISMATCH');
    });

    it('refuses a wrong secret, a wrong redirect URI and a replayed code — which revokes it', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);

      const wrongSecret = await exchange(app, await allow(scope.member, app), {
        client_secret: 'cts_wrong',
      }).expect(401);
      expect(wrongSecret.body.error).toBe('invalid_client');
      expect(wrongSecret.headers['www-authenticate']).toContain('Basic');

      const wrongUri = await exchange(app, await allow(scope.member, app), {
        redirect_uri: 'https://tool.example/other',
      }).expect(400);
      expect(wrongUri.body.error).toBe('invalid_grant');

      const code = await allow(scope.member, app);
      const first = await exchange(app, code).expect(200);
      const replay = await exchange(app, code).expect(400);
      expect(replay.body).toEqual({
        error: 'invalid_grant',
        error_description: 'The code was already used.',
      });
      // What the first exchange bought is gone too.
      await request(server())
        .get(url('/integration/whoami'))
        .set(as(first.body.access_token as string))
        .expect(401);
    });

    it('checks the PKCE verifier when the app sent a challenge', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const verifier = 'v'.repeat(20) + randomUUID().replace(/-/g, '');
      const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
      const pkce = { codeChallenge, codeChallengeMethod: 'S256' };

      const missing = await exchange(app, await allow(scope.member, app, pkce)).expect(400);
      expect(missing.body.error).toBe('invalid_grant');
      await exchange(app, await allow(scope.member, app, pkce), {
        code_verifier: verifier,
      }).expect(200);
    });

    it('turns away an expired access token', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connect(scope.member, app);
      await context.prisma.oAuthAccessToken.updateMany({ data: { expiresAt: new Date(0) } });

      const expired = await request(server())
        .get(url('/integration/whoami'))
        .set(as(token.access_token))
        .expect(401);
      expect(expired.body.error.code).toBe('OAUTH_TOKEN_EXPIRED');
    });
  });

  describe('public clients (mobile and desktop apps)', () => {
    const APP_REDIRECT = 'com.example.leasing:/oauth/callback';
    const verifier = 'v'.repeat(20) + randomUUID().replace(/-/g, '');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const registerPublic = async (developer: Actor) => {
      const created = await request(server())
        .post(url('/users/me/oauth-apps'))
        .set(as(developer))
        .send({ name: 'Leasing mobile', redirectUris: [APP_REDIRECT], clientType: 'public' })
        .expect(201);
      return created.body.data as {
        app: { id: string; clientId: string; clientType: string; secretHint: string | null };
        clientSecret: string | null;
      };
    };

    const allowPublic = (person: Actor, clientId: string, pkce = true) =>
      request(server())
        .post(url('/oauth/authorize'))
        .set(as(person))
        .send({
          clientId,
          redirectUri: APP_REDIRECT,
          state: 'st-1',
          approve: true,
          ...(pkce ? { codeChallenge: challenge, codeChallengeMethod: 'S256' } : {}),
        });

    const tokenFor = (fields: Record<string, string>) =>
      request(server()).post(url('/oauth/token')).type('form').send(fields);

    it('is given no secret, and only it may register an app scheme', async () => {
      const scope = await setupScope();
      const registered = await registerPublic(scope.owner);
      expect(registered.clientSecret).toBeNull();
      expect(registered.app).toMatchObject({ clientType: 'public', secretHint: null });

      await request(server())
        .post(url(`/users/me/oauth-apps/${registered.app.id}/rotate-secret`))
        .set(as(scope.owner))
        .expect(400);

      // A server-side app may not claim an app scheme.
      await request(server())
        .post(url('/users/me/oauth-apps'))
        .set(as(scope.owner))
        .send({ name: 'Leasing sync', redirectUris: [APP_REDIRECT] })
        .expect(422);
    });

    it('must use PKCE, and exchanges with its id and the verifier alone', async () => {
      const scope = await setupScope();
      const { app } = await registerPublic(scope.owner);

      const refused = await allowPublic(scope.member, app.clientId, false).expect(400);
      expect(refused.body.error.code).toBe('OAUTH_INVALID_REQUEST');

      const allowed = await allowPublic(scope.member, app.clientId).expect(200);
      const redirect = new URL(allowed.body.data.redirectTo as string);
      expect(redirect.protocol).toBe('com.example.leasing:');
      const code = redirect.searchParams.get('code') as string;

      const base = {
        grant_type: 'authorization_code',
        code,
        redirect_uri: APP_REDIRECT,
        client_id: app.clientId,
      };
      const missing = await tokenFor(base).expect(400);
      expect(missing.body.error).toBe('invalid_grant');

      // The code was spent by the failed attempt; a fresh one with the verifier works.
      const again = await allowPublic(scope.member, app.clientId).expect(200);
      const fresh = new URL(again.body.data.redirectTo as string).searchParams.get(
        'code',
      ) as string;
      const token = await tokenFor({ ...base, code: fresh, code_verifier: verifier }).expect(200);
      expect(token.body).toMatchObject({ access_token: expect.stringMatching(/^cto_/) });

      await request(server())
        .get(url('/workspaces'))
        .set(as(token.body.access_token as string))
        .expect(200);
    });

    it('gets a new refresh token each time, and the old one stops working', async () => {
      const scope = await setupScope();
      const { app } = await registerPublic(scope.owner);
      const allowed = await allowPublic(scope.member, app.clientId).expect(200);
      const code = new URL(allowed.body.data.redirectTo as string).searchParams.get(
        'code',
      ) as string;
      const first = await tokenFor({
        grant_type: 'authorization_code',
        code,
        redirect_uri: APP_REDIRECT,
        client_id: app.clientId,
        code_verifier: verifier,
      }).expect(200);

      const refreshed = await tokenFor({
        grant_type: 'refresh_token',
        refresh_token: first.body.refresh_token as string,
        client_id: app.clientId,
      }).expect(200);
      expect(refreshed.body.refresh_token).toEqual(expect.stringMatching(/^ctr_/));
      expect(refreshed.body.refresh_token).not.toBe(first.body.refresh_token);

      const replayed = await tokenFor({
        grant_type: 'refresh_token',
        refresh_token: first.body.refresh_token as string,
        client_id: app.clientId,
      }).expect(400);
      expect(replayed.body.error).toBe('invalid_grant');
    });

    it('still asks a confidential client for its secret', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const code = await allow(scope.member, app);

      const refused = await exchange(app, code, { client_secret: '' }).expect(401);
      expect(refused.body.error).toBe('invalid_client');
    });
  });

  describe('the read scope', () => {
    const connectFor = async (person: Actor, app: App, scope: string) => {
      const code = await allow(person, app, { scope });
      const response = await exchange(app, code).expect(200);
      return response.body as { access_token: string; scope: string };
    };

    it('reads and listens, and is refused every other change', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const consent = await request(server())
        .post(url('/oauth/consent'))
        .set(as(scope.member))
        .send({ clientId: app.clientId, redirectUri: REDIRECT, scope: 'read' })
        .expect(200);
      expect(consent.body.data.scopes).toEqual([
        { scope: 'read', description: expect.stringMatching(/cannot change anything/) },
      ]);

      const token = await connectFor(scope.member, app, 'read');
      expect(token.scope).toBe('read');

      await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/projects`))
        .set(as(token.access_token))
        .expect(200);
      const refused = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set(as(token.access_token))
        .send({ title: 'Should not exist', projectId: scope.projectId })
        .expect(403);
      expect(refused.body.error.code).toBe('OAUTH_SCOPE_INSUFFICIENT');
      expect(await context.prisma.task.count({ where: { title: 'Should not exist' } })).toBe(0);

      // Subscribing to hear about changes is reading.
      const subscribed = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/webhook-subscriptions`))
        .set(as(token.access_token))
        .send({ projectId: scope.projectId, url: HOOK, events: ['task.created'] })
        .expect(201);
      await request(server())
        .delete(
          url(
            `/workspaces/${scope.workspaceId}/webhook-subscriptions/${subscribed.body.data.subscription.id}`,
          ),
        )
        .set(as(token.access_token))
        .expect(204);

      const listed = await request(server())
        .get(url('/users/me/connected-apps'))
        .set(as(scope.member))
        .expect(200);
      expect(listed.body.data[0].scopes).toEqual(['read']);
    });

    it('takes read and default together as default', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connectFor(scope.member, app, 'read default');
      expect(token.scope).toBe('default');

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set(as(token.access_token))
        .send({ title: 'Allowed', projectId: scope.projectId })
        .expect(201);
    });
  });

  describe('the app directory', () => {
    const directoryUrl = (scope: Scope) => url(`/workspaces/${scope.workspaceId}/app-directory`);
    const projectsUrl = (scope: Scope) => url(`/workspaces/${scope.workspaceId}/projects`);
    const setPolicy = (scope: Scope, policy: string) =>
      request(server()).patch(directoryUrl(scope)).set(as(scope.owner)).send({ policy });
    const blockedFor = async (person: Actor, app: App) => {
      const consent = await request(server())
        .post(url('/oauth/consent'))
        .set(as(person))
        .send({ clientId: app.clientId, redirectUri: REDIRECT })
        .expect(200);
      return consent.body.data.blockedWorkspaces as { id: string; name: string }[];
    };

    it('lets admins allow only approved apps, and refuses the rest there', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connect(scope.member, app);

      // Any app, to begin with; a member sees the directory but not what knocks.
      await request(server()).get(projectsUrl(scope)).set(as(token.access_token)).expect(200);
      const asMember = await request(server())
        .get(directoryUrl(scope))
        .set(as(scope.member))
        .expect(200);
      expect(asMember.body.data).toEqual({ policy: 'ANY', apps: [], unapproved: [] });
      const notAdmin = await request(server())
        .patch(directoryUrl(scope))
        .set(as(scope.member))
        .send({ policy: 'APPROVED' })
        .expect(403);
      expect(notAdmin.body.error.code).toBe('INSUFFICIENT_WORKSPACE_ROLE');

      const asOwner = await request(server())
        .get(directoryUrl(scope))
        .set(as(scope.owner))
        .expect(200);
      expect(asOwner.body.data.unapproved).toEqual([
        {
          app: expect.objectContaining({
            id: app.id,
            clientId: app.clientId,
            name: 'Leasing sync',
            publisher: 'Ada Owner',
          }),
          members: 1,
        },
      ]);

      // Approved apps only: this one is refused here, and does not see the workspace.
      const switched = await setPolicy(scope, 'APPROVED').expect(200);
      expect(switched.body.data.policy).toBe('APPROVED');
      const refused = await request(server())
        .get(projectsUrl(scope))
        .set(as(token.access_token))
        .expect(403);
      expect(refused.body.error.code).toBe('OAUTH_APP_NOT_APPROVED');
      const listed = await request(server())
        .get(url('/workspaces'))
        .set(as(token.access_token))
        .expect(200);
      expect(listed.body.data).toEqual([]);
      expect(await blockedFor(scope.member, app)).toEqual([
        { id: scope.workspaceId, name: 'Acme' },
      ]);

      // Approved by client id: the app reaches the workspace again.
      const approved = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/app-directory/apps`))
        .set(as(scope.owner))
        .send({ clientId: app.clientId })
        .expect(201);
      expect(approved.body.data).toMatchObject({
        app: { id: app.id, name: 'Leasing sync' },
        approvedBy: { id: scope.owner.userId, name: 'Ada Owner' },
        connectedByMe: false,
      });
      await request(server()).get(projectsUrl(scope)).set(as(token.access_token)).expect(200);
      expect(await blockedFor(scope.member, app)).toEqual([]);
      const mine = await request(server())
        .get(directoryUrl(scope))
        .set(as(scope.member))
        .expect(200);
      expect(mine.body.data.apps).toEqual([
        expect.objectContaining({
          app: expect.objectContaining({ id: app.id }),
          connectedByMe: true,
        }),
      ]);

      // Taken out again: refused again. Nobody was disconnected.
      await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/app-directory/apps/${app.id}`))
        .set(as(scope.owner))
        .expect(204);
      await request(server()).get(projectsUrl(scope)).set(as(token.access_token)).expect(403);
      await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/app-directory/apps/${app.id}`))
        .set(as(scope.owner))
        .expect(404);
      expect(
        await context.prisma.oAuthGrant.count({ where: { appId: app.id, revokedAt: null } }),
      ).toBe(1);
    });

    it('is for people: an app cannot read or approve itself, nor an unknown app be added', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connect(scope.owner, app);

      const asApp = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/app-directory/apps`))
        .set(as(token.access_token))
        .send({ clientId: app.clientId })
        .expect(403);
      expect(asApp.body.error.code).toBe('OAUTH_TOKEN_NOT_ALLOWED');
      await request(server()).get(directoryUrl(scope)).set(as(token.access_token)).expect(403);

      const unknown = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/app-directory/apps`))
        .set(as(scope.owner))
        .send({ clientId: 'ctc_nobody' })
        .expect(404);
      expect(unknown.body.error.code).toBe('OAUTH_UNKNOWN_CLIENT');
      await setPolicy(scope, 'SOMETIMES').expect(422);
    });

    it('silences an unapproved app’s webhook subscriptions until it is approved', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connect(scope.member, app);
      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/webhook-subscriptions`))
        .set(as(token.access_token))
        .send({ projectId: scope.projectId, url: HOOK, events: ['task.created'] })
        .expect(201);
      const event = (): AutomationEvent => ({
        eventId: randomUUID(),
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        trigger: AutomationTrigger.TASK_CREATED,
        entityType: 'TASK',
        entityId: randomUUID(),
        actorId: scope.owner.userId,
        after: {},
        correlationId: randomUUID(),
        depth: 0,
      });

      expect(await deliveries.fanOut(event())).toEqual({ deliveries: 1 });
      await setPolicy(scope, 'APPROVED').expect(200);
      expect(await deliveries.fanOut(event())).toEqual({ deliveries: 0 });
      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/app-directory/apps`))
        .set(as(scope.owner))
        .send({ clientId: app.clientId })
        .expect(201);
      expect(await deliveries.fanOut(event())).toEqual({ deliveries: 1 });
    });
  });

  describe('ending a connection', () => {
    it('lets the app revoke its refresh token, ending its access too', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connect(scope.member, app);

      await request(server())
        .post(url('/oauth/revoke'))
        .type('form')
        .send({
          token: token.refresh_token,
          client_id: app.clientId,
          client_secret: app.clientSecret,
        })
        .expect(200);

      await request(server())
        .get(url('/integration/whoami'))
        .set(as(token.access_token))
        .expect(401);
      const again = await request(server())
        .post(url('/oauth/token'))
        .auth(app.clientId, app.clientSecret)
        .type('form')
        .send({ grant_type: 'refresh_token', refresh_token: token.refresh_token })
        .expect(400);
      expect(again.body.error).toBe('invalid_grant');
    });

    it('lets the person disconnect it from Connected apps', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connect(scope.member, app);
      await connect(scope.member, app);

      const connected = await request(server())
        .get(url('/users/me/connected-apps'))
        .set(as(scope.member))
        .expect(200);
      expect(connected.body.data).toEqual([
        expect.objectContaining({
          app: expect.objectContaining({
            id: app.id,
            name: 'Leasing sync',
            publisher: 'Ada Owner',
          }),
          connections: 2,
        }),
      ]);

      await request(server())
        .delete(url(`/users/me/connected-apps/${app.id}`))
        .set(as(scope.member))
        .expect(204);
      await request(server())
        .get(url('/integration/whoami'))
        .set(as(token.access_token))
        .expect(401);
      const after = await request(server())
        .get(url('/users/me/connected-apps'))
        .set(as(scope.member))
        .expect(200);
      expect(after.body.data).toEqual([]);
    });

    it('ends every connection when the developer deletes the app', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connect(scope.member, app);

      await request(server())
        .delete(url(`/users/me/oauth-apps/${app.id}`))
        .set(as(scope.owner))
        .expect(204);
      await request(server())
        .get(url('/integration/whoami'))
        .set(as(token.access_token))
        .expect(401);
    });
  });

  describe('webhook subscriptions', () => {
    const subscriptionsUrl = (scope: Scope) =>
      url(`/workspaces/${scope.workspaceId}/webhook-subscriptions`);

    const taskEvent = (scope: Scope, projectId: string): AutomationEvent => ({
      eventId: randomUUID(),
      workspaceId: scope.workspaceId,
      projectId,
      trigger: AutomationTrigger.TASK_CREATED,
      entityType: 'TASK',
      entityId: randomUUID(),
      actorId: scope.owner.userId,
      after: {},
      correlationId: randomUUID(),
      depth: 0,
    });

    const subscribe = (scope: Scope, credential: Record<string, string>, projectId: string) =>
      request(server())
        .post(subscriptionsUrl(scope))
        .set(credential)
        .send({ projectId, url: HOOK, events: ['task.created'] });

    it('sends the new secret in the X-Hook-Secret handshake before saving anything', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connect(scope.member, app);

      const created = await subscribe(scope, as(token.access_token), scope.projectId).expect(201);
      expect(handshakes).toEqual([created.body.data.secret]);
    });

    it('refuses a URL that does not echo the handshake, or turns it away', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connect(scope.member, app);

      for (const answer of ['ignore', 'refuse'] as const) {
        handshake = answer;
        const refused = await subscribe(scope, as(token.access_token), scope.projectId).expect(422);
        expect(refused.body.error.code).toBe('WEBHOOK_HANDSHAKE_FAILED');
      }
      expect(await context.prisma.webhookEndpoint.count()).toBe(0);
    });

    it('lets an app subscribe to a project it can see, and hears what happens there', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connect(scope.member, app);

      const created = await subscribe(scope, as(token.access_token), scope.projectId).expect(201);
      expect(created.body.data).toMatchObject({
        subscription: {
          project: { id: scope.projectId, name: 'Leasing' },
          name: 'Leasing sync · Leasing',
          url: HOOK,
          events: ['task.created'],
        },
        secret: expect.any(String),
      });

      expect(await deliveries.fanOut(taskEvent(scope, scope.projectId))).toEqual({
        deliveries: 1,
      });

      // The admin sees it in Settings, marked as the app's.
      const hooks = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/webhooks`))
        .set(as(scope.owner))
        .expect(200);
      expect(hooks.body.data).toEqual([
        expect.objectContaining({ source: { kind: 'OAUTH_APP', name: 'Leasing sync' } }),
      ]);
    });

    it('keeps each integration to its own, and people to Settings', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connect(scope.member, app);
      const key = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/api-keys`))
        .set(as(scope.owner))
        .send({ name: 'n8n', role: 'MEMBER' })
        .expect(201);
      const keyAuth = { 'X-API-Key': key.body.data.secret as string };

      const appSub = await subscribe(scope, as(token.access_token), scope.projectId).expect(201);
      await subscribe(scope, keyAuth, scope.projectId).expect(201);

      const byApp = await request(server())
        .get(subscriptionsUrl(scope))
        .set(as(token.access_token))
        .expect(200);
      expect(byApp.body.data.map((row: { id: string }) => row.id)).toEqual([
        appSub.body.data.subscription.id,
      ]);
      await request(server())
        .delete(`${subscriptionsUrl(scope)}/${appSub.body.data.subscription.id as string}`)
        .set(keyAuth)
        .expect(404);

      const asPerson = await subscribe(scope, as(scope.member), scope.projectId).expect(403);
      expect(asPerson.body.error.code).toBe('INTEGRATION_ONLY');

      // Revoking the key takes its subscription with it.
      await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/api-keys/${key.body.data.key.id as string}`))
        .set(as(scope.owner))
        .expect(200);
      expect(await context.prisma.webhookEndpoint.count()).toBe(1);
    });

    it('never hears about a private project its person cannot open', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connect(scope.member, app);
      const secret = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set(as(scope.owner))
        .send({ name: 'Board only', visibility: 'PRIVATE' })
        .expect(201);

      await subscribe(scope, as(token.access_token), secret.body.data.id as string).expect(404);

      // Subscribed while it could see the project; then the project goes private.
      await subscribe(scope, as(token.access_token), scope.projectId).expect(201);
      await context.prisma.project.update({
        where: { id: scope.projectId },
        data: { visibility: 'PRIVATE' },
      });
      expect(await deliveries.fanOut(taskEvent(scope, scope.projectId))).toEqual({
        deliveries: 0,
      });
    });

    it('goes when the app is disconnected, and is never workspace-wide', async () => {
      const scope = await setupScope();
      const app = await registerApp(scope.owner);
      const token = await connect(scope.member, app);
      await subscribe(scope, as(token.access_token), scope.projectId).expect(201);

      // Its project deleted, it must not fall back to hearing every project.
      const other = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set(as(scope.owner))
        .send({ name: 'Elsewhere' })
        .expect(201);
      await context.prisma.webhookEndpoint.updateMany({ data: { projectId: null } });
      expect(await deliveries.fanOut(taskEvent(scope, other.body.data.id as string))).toEqual({
        deliveries: 0,
      });

      await request(server())
        .delete(url(`/users/me/connected-apps/${app.id}`))
        .set(as(scope.member))
        .expect(204);
      expect(await context.prisma.webhookEndpoint.count()).toBe(0);
    });
  });
});
