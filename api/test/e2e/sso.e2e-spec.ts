import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  API_PREFIX,
  REFRESH_TOKEN_COOKIE,
  SignInMethod,
  WORKSPACE_DOMAIN_LIMIT,
  WorkspaceRole,
} from '@coretask/contracts';
import request from 'supertest';

import { resetEnvCache } from '../../src/config/env';
import { AppConfigService } from '../../src/config/app-config.service';
import { base32Decode, generateTotpSecret, hotp, totpStep } from '../../src/modules/auth/lib/totp';
import { DomainTxtResolver } from '../../src/modules/sso/domain-txt-resolver';
import { MICROSOFT_CONSUMER_TENANT } from '../../src/modules/sso/lib/oidc';
import { deriveKey, encryptSecret } from '../../src/modules/webhooks/lib/secret-cipher';

import {
  authnRequestId,
  createTestIdp,
  signedResponse,
  strangerKey,
  type TestIdp,
} from './saml-idp';
import {
  closeTestContext,
  confirmEmail,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

const GOOGLE = { clientId: 'google-client.test', clientSecret: 'google-secret-never-real' };
const MICROSOFT = { clientId: 'ms-client-test', clientSecret: 'ms-secret-never-real' };
const WORK_TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const IDP_ENTITY = 'https://idp.example.test/entity';
const IDP_SSO_URL = 'https://idp.example.test/sso';
const SSO_COOKIE = 'coretask_sso';

type Provider = 'google' | 'microsoft';

/** What the stand-in token endpoint will answer for one code. */
interface Grant {
  provider: Provider;
  claims: Record<string, unknown>;
  challenge: string;
}

/**
 * Single sign-on, against stand-ins for Google, Microsoft and a SAML
 * identity provider.
 *
 * Google's and Microsoft's token endpoints are one small local server that
 * checks the client secret and the PKCE verifier as they would and answers
 * with an ID token for whoever the test says signed in. The SAML provider
 * is a key pair and a self-signed certificate made here, signing responses
 * the way Okta and Entra sign them. DNS is stubbed. Nothing leaves the
 * machine. Values are assigned outright because the suite sources the dev
 * `.env`.
 */
describe('Single sign-on (e2e)', () => {
  let context: TestContext;
  let config: AppConfigService;
  let providers: Server;
  let msLoginUrl: string;
  let idp: TestIdp;
  let resolveTxt: jest.SpyInstance<Promise<string[][]>, [string]>;
  let grants: Map<string, Grant>;
  let tokenCalls: { provider: Provider; body: Record<string, string> }[];

  const readForm = async (incoming: IncomingMessage): Promise<Record<string, string>> => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
  };

  /** An unsigned JWT: CoreTask trusts the token endpoint over TLS, not the signature. */
  const idToken = (claims: Record<string, unknown>) =>
    [
      Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
      'not-checked',
    ].join('.');

  beforeAll(async () => {
    providers = createServer((incoming, outgoing) => {
      void readForm(incoming).then((body) => {
        const provider: Provider | null =
          incoming.url === '/google/token'
            ? 'google'
            : incoming.url === '/ms/common/oauth2/v2.0/token'
              ? 'microsoft'
              : null;
        const reply = (status: number, payload: unknown) => {
          outgoing.writeHead(status, { 'Content-Type': 'application/json' });
          outgoing.end(JSON.stringify(payload));
        };
        if (!provider) return reply(404, { error: 'not_found' });
        tokenCalls.push({ provider, body });

        const app = provider === 'google' ? GOOGLE : MICROSOFT;
        const grant = grants.get(body['code'] ?? '');
        const verifier = body['code_verifier'] ?? '';
        if (
          !grant ||
          grant.provider !== provider ||
          body['grant_type'] !== 'authorization_code' ||
          body['client_id'] !== app.clientId ||
          body['client_secret'] !== app.clientSecret ||
          body['redirect_uri'] !== config.sso[provider].redirectUri ||
          createHash('sha256').update(verifier).digest('base64url') !== grant.challenge
        ) {
          return reply(400, { error: 'invalid_grant' });
        }
        grants.delete(body['code'] ?? '');
        return reply(200, {
          access_token: 'not-used',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken(grant.claims),
        });
      });
    });
    await new Promise<void>((resolve) => providers.listen(0, '127.0.0.1', resolve));
    const { port } = providers.address() as AddressInfo;
    msLoginUrl = `http://127.0.0.1:${port}/ms`;

    process.env['GOOGLE_SSO_CLIENT_ID'] = GOOGLE.clientId;
    process.env['GOOGLE_SSO_CLIENT_SECRET'] = GOOGLE.clientSecret;
    process.env['GOOGLE_SSO_ISSUER'] = 'https://accounts.google.com';
    process.env['GOOGLE_SSO_AUTHORIZE_URL'] = 'https://accounts.google.test/o/oauth2/v2/auth';
    process.env['GOOGLE_SSO_TOKEN_URL'] = `http://127.0.0.1:${port}/google/token`;
    process.env['MICROSOFT_SSO_CLIENT_ID'] = MICROSOFT.clientId;
    process.env['MICROSOFT_SSO_CLIENT_SECRET'] = MICROSOFT.clientSecret;
    process.env['MICROSOFT_SSO_TENANT'] = 'common';
    process.env['MICROSOFT_SSO_LOGIN_URL'] = msLoginUrl;
    resetEnvCache();

    context = await createTestContext();
    config = context.app.get(AppConfigService);
    resolveTxt = jest.spyOn(context.app.get(DomainTxtResolver), 'resolveTxt');
    idp = createTestIdp();
  });

  beforeEach(async () => {
    grants = new Map();
    tokenCalls = [];
    resolveTxt.mockReset();
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
    await closeTestContext(context);
    await new Promise<void>((resolve) => providers.close(() => resolve()));
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;
  const web = (path: string) => `${config.webOrigin}${path}`;

  interface Actor {
    token: string;
    userId: string;
    email: string;
  }

  const registerUser = async (name: string, email = uniqueEmail()): Promise<Actor> => {
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

  const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

  /** `name=value` of a cookie the response set, or null; an empty value means cleared. */
  const cookieFrom = (response: request.Response, name: string): string | null => {
    const raw = response.headers['set-cookie'] as unknown;
    const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
    const found = list.find((cookie) => cookie.startsWith(`${name}=`));
    return found ? (found.split(';')[0] as string) : null;
  };
  const rawCookie = (response: request.Response, name: string): string => {
    const raw = response.headers['set-cookie'] as unknown;
    const list = Array.isArray(raw) ? (raw as string[]) : [String(raw)];
    return list.find((cookie) => cookie.startsWith(`${name}=`)) ?? '';
  };

  /** Exchanges the refresh cookie a sign-in set, proving it is a real session. */
  const sessionFrom = async (response: request.Response) => {
    const cookie = cookieFrom(response, REFRESH_TOKEN_COOKIE);
    expect(cookie).toBeTruthy();
    const refreshed = await request(server())
      .post(url('/auth/refresh'))
      .set('Cookie', cookie as string)
      .expect(200);
    return refreshed.body.data as {
      accessToken: string;
      user: {
        id: string;
        email: string;
        name: string;
        hasPassword: boolean;
        emailVerified: boolean;
      };
    };
  };

  // -------------------------------------------------------------------------
  // Google and Microsoft

  const now = () => Math.floor(Date.now() / 1000);

  const googleClaims = (over: Record<string, unknown> = {}) => ({
    iss: 'https://accounts.google.com',
    aud: GOOGLE.clientId,
    sub: `g-${randomUUID()}`,
    email: uniqueEmail('google'),
    email_verified: true,
    name: 'Grace Google',
    iat: now(),
    exp: now() + 3_600,
    ...over,
  });

  const microsoftClaims = (over: Record<string, unknown> = {}) => {
    const tid = (over['tid'] as string | undefined) ?? WORK_TENANT;
    return {
      iss: `${msLoginUrl}/${tid}/v2.0`,
      aud: MICROSOFT.clientId,
      tid,
      oid: randomUUID(),
      sub: `pairwise-${randomUUID()}`,
      email: uniqueEmail('microsoft'),
      name: 'Mia Microsoft',
      iat: now(),
      exp: now() + 3_600,
      ...over,
    };
  };

  interface Started {
    location: URL;
    cookie: string;
    state: string;
    nonce: string;
    challenge: string;
  }

  const started = (response: request.Response, location: string): Started => {
    const parsed = new URL(location);
    return {
      location: parsed,
      cookie: cookieFrom(response, SSO_COOKIE) as string,
      state: parsed.searchParams.get('state') as string,
      nonce: parsed.searchParams.get('nonce') as string,
      challenge: parsed.searchParams.get('code_challenge') as string,
    };
  };

  const startSocial = async (provider: Provider, redirect = '/inbox'): Promise<Started> => {
    const response = await request(server())
      .get(url(`/auth/sso/${provider}/start`))
      .query({ redirect })
      .expect(302);
    return started(response, response.headers['location'] as string);
  };

  const startLink = async (provider: Provider, actor: Actor): Promise<Started> => {
    const response = await request(server())
      .post(url(`/auth/sso/${provider}/link`))
      .set(as(actor))
      .expect(200);
    return started(response, response.body.data.url as string);
  };

  /** The provider sends the browser back with a code for `claims`. */
  const callback = (
    provider: Provider,
    flow: Started,
    claims: Record<string, unknown>,
    over: { state?: string; cookie?: string | null } = {},
  ) => {
    const code = `code-${randomUUID()}`;
    grants.set(code, {
      provider,
      claims: { nonce: flow.nonce, ...claims },
      challenge: flow.challenge,
    });
    const call = request(server())
      .get(url(`/auth/sso/${provider}/callback`))
      .query({ code, state: over.state ?? flow.state });
    const cookie = over.cookie === undefined ? flow.cookie : over.cookie;
    return (cookie ? call.set('Cookie', cookie) : call).expect(302);
  };

  const signInWith = async (
    provider: Provider,
    claims: Record<string, unknown>,
    redirect = '/inbox',
  ) => callback(provider, await startSocial(provider, redirect), claims);

  describe('Google and Microsoft', () => {
    it('says which providers are offered', async () => {
      const response = await request(server()).get(url('/auth/sso/providers')).expect(200);
      expect(response.body.data).toEqual({ google: true, microsoft: true, saml: true });
    });

    it('starts with PKCE, a state and a nonce, kept in an HTTP-only cookie on the SSO path', async () => {
      const response = await request(server())
        .get(url('/auth/sso/google/start'))
        .query({ redirect: '/projects' })
        .expect(302);
      const location = new URL(response.headers['location'] as string);

      expect(`${location.origin}${location.pathname}`).toBe(
        'https://accounts.google.test/o/oauth2/v2/auth',
      );
      expect(Object.fromEntries(location.searchParams)).toMatchObject({
        client_id: GOOGLE.clientId,
        response_type: 'code',
        redirect_uri: `${config.sso.apiBase}/auth/sso/google/callback`,
        scope: 'openid email profile',
        code_challenge_method: 'S256',
      });
      expect(location.searchParams.get('state')).toMatch(/^[\w-]{43}$/);
      expect(location.searchParams.get('nonce')).toMatch(/^[\w-]{43}$/);
      expect(location.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);

      const cookie = rawCookie(response, SSO_COOKIE);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain(`Path=${API_PREFIX}/auth/sso`);
      expect(cookie).toMatch(/SameSite=Lax/i);
      // Encrypted: none of what it carries can be read off it.
      expect(cookie).not.toContain(location.searchParams.get('state') as string);
    });

    it('sends an unknown provider back to sign-in, saying it is not offered', async () => {
      const response = await request(server()).get(url('/auth/sso/facebook/start')).expect(302);
      expect(response.headers['location']).toBe(web('/login?ssoError=SSO_NOT_CONFIGURED'));
    });

    it('makes an account for a first Google sign-in, with no password and the address confirmed', async () => {
      const claims = googleClaims({ email: uniqueEmail('Grace').toUpperCase() });
      const response = await signInWith('google', claims, '/projects?view=list');

      expect(response.headers['location']).toBe(
        web(`/sso/complete?redirect=${encodeURIComponent('/projects?view=list')}`),
      );
      const session = await sessionFrom(response);
      expect(session.user).toMatchObject({
        email: (claims.email as string).toLowerCase(),
        name: 'Grace Google',
        hasPassword: false,
        emailVerified: true,
      });

      const identities = await request(server())
        .get(url('/auth/sso/identities'))
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);
      expect(identities.body.data).toEqual([
        expect.objectContaining({
          provider: 'GOOGLE',
          email: (claims.email as string).toLowerCase(),
          workspace: null,
        }),
      ]);

      // The session list says how it began.
      const sessions = await request(server())
        .get(url('/auth/sessions'))
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);
      expect(sessions.body.data[0].method).toBe(SignInMethod.GOOGLE);
      // The code went to the token endpoint once, with the verifier.
      expect(tokenCalls).toHaveLength(1);
    });

    it('signs the same person in again by subject, even after their address changed', async () => {
      const claims = googleClaims();
      const first = await sessionFrom(await signInWith('google', claims));
      const renamed = uniqueEmail('renamed');
      const again = await sessionFrom(await signInWith('google', { ...claims, email: renamed }));

      expect(again.user.id).toBe(first.user.id);
      const identity = await context.prisma.userIdentity.findFirstOrThrow({
        where: { userId: first.user.id },
      });
      expect(identity.email).toBe(renamed);
      expect(identity.lastUsedAt).not.toBeNull();
      expect(await context.prisma.user.count()).toBe(1);
    });

    it('connects an existing account by an address Google has verified', async () => {
      const ada = await registerUser('Ada Password');
      await confirmEmail(context, ada.userId);
      const response = await signInWith('google', googleClaims({ email: ada.email }));
      const session = await sessionFrom(response);

      expect(session.user.id).toBe(ada.userId);
      expect(session.user.hasPassword).toBe(true);
      expect(
        await context.prisma.userIdentity.count({
          where: { userId: ada.userId, provider: 'GOOGLE' },
        }),
      ).toBe(1);
    });

    it('will not hand over an account that never confirmed its address', async () => {
      // Whoever registered it may not own the address: the person Google
      // vouches for would be sharing an account with them.
      const squatted = await registerUser('Someone Else', uniqueEmail('victim'));
      const response = await signInWith('google', googleClaims({ email: squatted.email }));

      expect(response.headers['location']).toBe(web('/login?ssoError=SSO_ACCOUNT_UNCONFIRMED'));
      expect(cookieFrom(response, REFRESH_TOKEN_COOKIE)).toBeNull();
      expect(await context.prisma.userIdentity.count()).toBe(0);
    });

    it('hands over an account nobody can sign in to yet, as an import makes', async () => {
      // No password and nothing connected: there is no way in for anyone to
      // have kept, so its owner may have it as they would a new account.
      const imported = await context.prisma.user.create({
        data: { email: uniqueEmail('imported'), name: 'Ivy Imported', passwordHash: null },
      });
      const session = await sessionFrom(
        await signInWith('google', googleClaims({ email: imported.email })),
      );

      expect(session.user.id).toBe(imported.id);
      expect(session.user.hasPassword).toBe(false);
      const after = await context.prisma.user.findUniqueOrThrow({ where: { id: imported.id } });
      expect(after.emailVerifiedAt).not.toBeNull();
      expect(
        await context.prisma.userIdentity.count({
          where: { userId: imported.id, provider: 'GOOGLE' },
        }),
      ).toBe(1);
    });

    it('still refuses an unconfirmed account that has another sign-in connected', async () => {
      const connected = await context.prisma.user.create({
        data: { email: uniqueEmail('connected'), name: 'Cal Connected', passwordHash: null },
      });
      await context.prisma.userIdentity.create({
        data: {
          userId: connected.id,
          provider: 'MICROSOFT',
          subject: `${WORK_TENANT}:${randomUUID()}`,
          email: connected.email,
        },
      });
      const response = await signInWith('google', googleClaims({ email: connected.email }));

      expect(response.headers['location']).toBe(web('/login?ssoError=SSO_ACCOUNT_UNCONFIRMED'));
      expect(cookieFrom(response, REFRESH_TOKEN_COOKIE)).toBeNull();
      expect(await context.prisma.userIdentity.count({ where: { userId: connected.id } })).toBe(1);
    });

    it('opens nothing for an address Google has not verified', async () => {
      const ada = await registerUser('Ada Password');
      const response = await signInWith(
        'google',
        googleClaims({ email: ada.email, email_verified: false }),
      );

      expect(response.headers['location']).toBe(web('/login?ssoError=SSO_EMAIL_UNVERIFIED'));
      expect(cookieFrom(response, REFRESH_TOKEN_COOKIE)).toBeNull();
      expect(await context.prisma.userIdentity.count()).toBe(0);
    });

    it('refuses a Microsoft work address the tenant has not verified, and accepts one it has', async () => {
      const bea = await registerUser('Bea Password');
      await confirmEmail(context, bea.userId);

      const refused = await signInWith('microsoft', microsoftClaims({ email: bea.email }));
      expect(refused.headers['location']).toBe(web('/login?ssoError=SSO_EMAIL_UNVERIFIED'));
      expect(await context.prisma.userIdentity.count()).toBe(0);
      expect(await context.prisma.user.count()).toBe(1);

      const oid = randomUUID();
      const accepted = await signInWith(
        'microsoft',
        microsoftClaims({ email: bea.email, oid, xms_edov: true }),
      );
      expect((await sessionFrom(accepted)).user.id).toBe(bea.userId);
      const identity = await context.prisma.userIdentity.findFirstOrThrow({
        where: { userId: bea.userId },
      });
      expect(identity).toMatchObject({ provider: 'MICROSOFT', subject: `${WORK_TENANT}:${oid}` });
    });

    it('trusts a personal Microsoft account’s address', async () => {
      const response = await signInWith(
        'microsoft',
        microsoftClaims({ tid: MICROSOFT_CONSUMER_TENANT }),
      );
      expect((await sessionFrom(response)).user.hasPassword).toBe(false);
    });

    it('refuses a callback whose state or cookie is not the one this browser started with', async () => {
      const flow = await startSocial('google');
      const claims = googleClaims();

      const wrongState = await callback('google', flow, claims, { state: 'forged-state' });
      expect(wrongState.headers['location']).toBe(web('/login?ssoError=SSO_FAILED'));
      // The cookie is spent either way.
      expect(cookieFrom(wrongState, SSO_COOKIE)).toBe(`${SSO_COOKIE}=`);

      const noCookie = await callback('google', flow, claims, { cookie: null });
      expect(noCookie.headers['location']).toBe(web('/login?ssoError=SSO_FAILED'));

      // Another browser's cookie, with this browser's code and state.
      const other = await startSocial('google');
      const crossed = await callback('google', flow, claims, { cookie: other.cookie });
      expect(crossed.headers['location']).toBe(web('/login?ssoError=SSO_FAILED'));

      // None of them got as far as spending a code.
      expect(tokenCalls).toHaveLength(0);
      expect(await context.prisma.user.count()).toBe(0);
    });

    it('refuses an ID token minted for another sign-in (nonce) or another app', async () => {
      const replayed = await callback('google', await startSocial('google'), {
        ...googleClaims(),
        nonce: 'someone-elses-nonce',
      });
      expect(replayed.headers['location']).toBe(web('/login?ssoError=SSO_FAILED'));

      const otherApp = await signInWith('google', googleClaims({ aud: 'another-client' }));
      expect(otherApp.headers['location']).toBe(web('/login?ssoError=SSO_FAILED'));
      expect(await context.prisma.user.count()).toBe(0);
    });

    it('lands on / when the redirect would leave the web app', async () => {
      const response = await signInWith('google', googleClaims(), '//evil.example/steal');
      expect(response.headers['location']).toBe(web('/sso/complete?redirect=%2F'));
    });

    it('asks an account with two-step verification for its code, in the fragment', async () => {
      const ada = await registerUser('Ada Two-Step');
      const secret = generateTotpSecret();
      const key = deriveKey(`${config.webhooks.encryptionKeyMaterial}:two-factor-secrets`);
      await context.prisma.user.update({
        where: { id: ada.userId },
        data: {
          totpSecret: encryptSecret(secret, key),
          totpEnabledAt: new Date(),
          emailVerifiedAt: new Date(),
        },
      });

      const response = await signInWith('google', googleClaims({ email: ada.email }), '/inbox');
      const location = new URL(response.headers['location'] as string);
      expect(`${location.origin}${location.pathname}${location.search}`).toBe(
        web('/sso/complete?redirect=%2Finbox'),
      );
      expect(location.hash).toMatch(/^#challenge=/);
      // No session until the code.
      expect(cookieFrom(response, REFRESH_TOKEN_COOKIE)).toBeNull();

      const challenge = decodeURIComponent(location.hash.slice('#challenge='.length));
      const verified = await request(server())
        .post(url('/auth/two-factor/verify'))
        .send({ challenge, code: hotp(base32Decode(secret), totpStep()) })
        .expect(200);
      expect(verified.body.data.user.id).toBe(ada.userId);
      expect(cookieFrom(verified, REFRESH_TOKEN_COOKIE)).toBeTruthy();
    });

    it('turns away a disabled account', async () => {
      const ada = await registerUser('Ada Disabled');
      await context.prisma.user.update({ where: { id: ada.userId }, data: { isActive: false } });
      const response = await signInWith('google', googleClaims({ email: ada.email }));
      expect(response.headers['location']).toBe(web('/login?ssoError=ACCOUNT_DISABLED'));
    });
  });

  describe('connecting and disconnecting', () => {
    it('connects Google from Settings, matched by subject whatever the address', async () => {
      const ada = await registerUser('Ada Linker');
      const flow = await startLink('google', ada);
      expect(flow.location.searchParams.get('client_id')).toBe(GOOGLE.clientId);

      const response = await callback(
        'google',
        flow,
        // Not her CoreTask address, and not verified: connecting needs neither.
        googleClaims({ email: 'ada.personal@gmail.test', email_verified: false }),
      );
      expect(response.headers['location']).toBe(web('/settings?ssoLinked=google'));
      expect(cookieFrom(response, REFRESH_TOKEN_COOKIE)).toBeNull();

      const identities = await request(server())
        .get(url('/auth/sso/identities'))
        .set(as(ada))
        .expect(200);
      expect(identities.body.data).toEqual([
        expect.objectContaining({ provider: 'GOOGLE', email: 'ada.personal@gmail.test' }),
      ]);
    });

    it('replaces the account’s earlier connection to the same provider', async () => {
      const ada = await registerUser('Ada Linker');
      await callback('google', await startLink('google', ada), googleClaims());
      const second = googleClaims();
      await callback('google', await startLink('google', ada), second);

      const identities = await context.prisma.userIdentity.findMany({
        where: { userId: ada.userId },
      });
      expect(identities).toEqual([expect.objectContaining({ subject: second.sub })]);
    });

    it('refuses to connect an account already connected to someone else', async () => {
      const claims = googleClaims();
      const owner = await sessionFrom(await signInWith('google', claims));
      const bea = await registerUser('Bea Taker');

      const response = await callback('google', await startLink('google', bea), claims);
      expect(response.headers['location']).toBe(web('/settings?ssoError=SSO_IDENTITY_IN_USE'));
      const identity = await context.prisma.userIdentity.findFirstOrThrow({});
      expect(identity.userId).toBe(owner.user.id);
    });

    it('disconnects, but never the only way into an account without a password', async () => {
      const session = await sessionFrom(await signInWith('google', googleClaims()));
      const sso: Actor = {
        token: session.accessToken,
        userId: session.user.id,
        email: session.user.email,
      };
      const [google] = (
        await request(server()).get(url('/auth/sso/identities')).set(as(sso)).expect(200)
      ).body.data as { id: string }[];

      const refused = await request(server())
        .delete(url(`/auth/sso/identities/${google!.id}`))
        .set(as(sso))
        .expect(409);
      expect(refused.body.error.code).toBe('SSO_LAST_SIGN_IN_METHOD');

      // With Microsoft connected as well, Google can go.
      await callback('microsoft', await startLink('microsoft', sso), microsoftClaims());
      await request(server())
        .delete(url(`/auth/sso/identities/${google!.id}`))
        .set(as(sso))
        .expect(204);
      const left = (
        await request(server()).get(url('/auth/sso/identities')).set(as(sso)).expect(200)
      ).body.data as { provider: string }[];
      expect(left.map((identity) => identity.provider)).toEqual(['MICROSOFT']);
    });

    it('lets an account with a password disconnect its only provider, and not someone else’s', async () => {
      const ada = await registerUser('Ada Linker');
      await callback('google', await startLink('google', ada), googleClaims());
      const identity = await context.prisma.userIdentity.findFirstOrThrow({
        where: { userId: ada.userId },
      });

      const bea = await registerUser('Bea Stranger');
      await request(server())
        .delete(url(`/auth/sso/identities/${identity.id}`))
        .set(as(bea))
        .expect(404);
      await request(server())
        .delete(url(`/auth/sso/identities/${identity.id}`))
        .set(as(ada))
        .expect(204);
    });

    it('sends a failed connection back to Settings', async () => {
      const ada = await registerUser('Ada Linker');
      const flow = await startLink('google', ada);
      const response = await callback('google', flow, googleClaims(), { state: 'not-it' });
      expect(response.headers['location']).toBe(web('/settings?ssoError=SSO_FAILED'));
    });
  });

  // -------------------------------------------------------------------------
  // SAML

  interface SamlSetup {
    owner: Actor;
    workspaceId: string;
    slug: string;
    connectionId: string;
    entityId: string;
    acsUrl: string;
  }

  const setupSaml = async (options: { enabled?: boolean } = {}): Promise<SamlSetup> => {
    const owner = await registerUser('Olive Owner');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(as(owner))
      .send({ name: `Acme ${randomUUID().slice(0, 6)}` })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    const saved = await request(server())
      .put(url(`/workspaces/${workspaceId}/saml`))
      .set(as(owner))
      .send({
        idpEntityId: IDP_ENTITY,
        idpSsoUrl: IDP_SSO_URL,
        // Bare base64, as many providers show it: wrapped to PEM on the way in.
        idpCertificate: idp.certificateBase64,
        enabled: options.enabled ?? true,
      })
      .expect(200);
    return {
      owner,
      workspaceId,
      slug: workspace.body.data.slug as string,
      connectionId: saved.body.data.id as string,
      entityId: saved.body.data.serviceProvider.entityId as string,
      acsUrl: saved.body.data.serviceProvider.acsUrl as string,
    };
  };

  /** Claims a domain and publishes its record, as the admin would. */
  const verifyDomain = async (setup: SamlSetup, domain: string) => {
    const added = await request(server())
      .post(url(`/workspaces/${setup.workspaceId}/domains`))
      .set(as(setup.owner))
      .send({ domain })
      .expect(201);
    const record = added.body.data.txtRecord as string;
    resolveTxt.mockResolvedValueOnce([['v=spf1 -all'], [record.slice(0, 10), record.slice(10)]]);
    await request(server())
      .post(url(`/workspaces/${setup.workspaceId}/domains/${added.body.data.id}/verify`))
      .set(as(setup.owner))
      .expect(200);
  };

  interface SamlStarted {
    cookie: string;
    requestId: string;
    relayState: string;
  }

  const samlStart = async (query: Record<string, string>): Promise<SamlStarted> => {
    const response = await request(server())
      .get(url('/auth/sso/saml/start'))
      .query(query)
      .expect(302);
    const location = response.headers['location'] as string;
    expect(location.startsWith(`${IDP_SSO_URL}?`)).toBe(true);
    return {
      cookie: cookieFrom(response, SSO_COOKIE) as string,
      requestId: authnRequestId(location),
      relayState: new URL(location).searchParams.get('RelayState') as string,
    };
  };

  const samlLinkStart = async (setup: SamlSetup, actor: Actor): Promise<SamlStarted> => {
    const response = await request(server())
      .post(url(`/auth/sso/saml/link/${setup.workspaceId}`))
      .set(as(actor))
      .expect(200);
    const location = response.body.data.url as string;
    return {
      cookie: cookieFrom(response, SSO_COOKIE) as string,
      requestId: authnRequestId(location),
      relayState: new URL(location).searchParams.get('RelayState') as string,
    };
  };

  interface Person {
    nameId: string;
    email?: string;
    firstName?: string;
    lastName?: string;
  }

  const responseFor = (
    setup: SamlSetup,
    flow: SamlStarted,
    person: Person,
    over: { signingKey?: string; issuer?: string; tamper?: (xml: string) => string } = {},
  ) =>
    signedResponse({
      idp,
      issuer: over.issuer ?? IDP_ENTITY,
      acsUrl: setup.acsUrl,
      audience: setup.entityId,
      inResponseTo: flow.requestId,
      nameId: person.nameId,
      attributes: {
        ...(person.email ? { email: person.email } : {}),
        ...(person.firstName ? { firstName: person.firstName } : {}),
        ...(person.lastName ? { lastName: person.lastName } : {}),
      },
      ...(over.signingKey ? { signingKey: over.signingKey } : {}),
      ...(over.tamper ? { tamper: over.tamper } : {}),
    });

  /** The identity provider's form post to the ACS, then the browser following the 303. */
  const postAndFinish = async (
    setup: SamlSetup,
    flow: SamlStarted,
    samlResponse: string,
    cookie: string | null = flow.cookie,
  ) => {
    const acs = await request(server())
      .post(new URL(setup.acsUrl).pathname)
      .type('form')
      .send({ SAMLResponse: samlResponse, RelayState: flow.relayState })
      .expect(303);
    const finish = new URL(acs.headers['location'] as string);
    expect(`${finish.origin}${finish.pathname}`).toBe(`${config.sso.apiBase}/auth/sso/saml/finish`);
    const call = request(server()).get(`${finish.pathname}${finish.search}`);
    return (cookie ? call.set('Cookie', cookie) : call).expect(302);
  };

  const samlSignIn = async (setup: SamlSetup, person: Person, redirect = '/projects') => {
    const flow = await samlStart({ workspace: setup.slug, redirect });
    return postAndFinish(setup, flow, responseFor(setup, flow, person));
  };

  describe('SAML', () => {
    it('serves the service provider metadata at its own address, the entity ID', async () => {
      const setup = await setupSaml({ enabled: false });
      const response = await request(server()).get(new URL(setup.entityId).pathname).expect(200);
      expect(response.headers['content-type']).toContain('application/samlmetadata+xml');
      expect(response.text).toContain(`entityID="${setup.entityId}"`);
      expect(response.text).toContain(`Location="${setup.acsUrl}"`);
      expect(response.text).toContain('WantAssertionsSigned="true"');
    });

    it('sends a workspace without enabled single sign-on back to the SSO page', async () => {
      const setup = await setupSaml({ enabled: false });
      for (const query of [
        { workspace: setup.slug },
        { workspace: 'no-such-workspace' },
        { email: 'a@nowhere.test' },
      ]) {
        const response = await request(server())
          .get(url('/auth/sso/saml/start'))
          .query(query)
          .expect(302);
        expect(response.headers['location']).toBe(web('/sso?error=SAML_NOT_CONFIGURED'));
      }
    });

    it('signs in a new person at a verified domain, as a member, and lands where they asked', async () => {
      const setup = await setupSaml();
      const domain = `acme-${randomUUID().slice(0, 8)}.test`;
      await verifyDomain(setup, domain);
      const email = `jit@${domain}`;

      // By address, as the SSO page asks for it.
      const flow = await samlStart({ email: email.toUpperCase(), redirect: '/projects' });
      const response = await postAndFinish(
        setup,
        flow,
        responseFor(setup, flow, {
          nameId: 'okta|00u1',
          email,
          firstName: 'Jules',
          lastName: 'Ito',
        }),
      );

      expect(response.headers['location']).toBe(web('/sso/complete?redirect=%2Fprojects'));
      const session = await sessionFrom(response);
      expect(session.user).toMatchObject({
        email,
        name: 'Jules Ito',
        hasPassword: false,
        emailVerified: true,
      });
      const membership = await context.prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: setup.workspaceId, userId: session.user.id } },
      });
      expect(membership.role).toBe(WorkspaceRole.MEMBER);
      const identity = await context.prisma.userIdentity.findFirstOrThrow({
        where: { userId: session.user.id },
      });
      expect(identity).toMatchObject({
        provider: 'SAML',
        subject: `${setup.connectionId}:okta|00u1`,
        samlConnectionId: setup.connectionId,
      });

      // And again, by NameID now.
      const again = await sessionFrom(await samlSignIn(setup, { nameId: 'okta|00u1', email }));
      expect(again.user.id).toBe(session.user.id);
    });

    it('connects an existing account at a verified domain, and adds it to the workspace', async () => {
      const setup = await setupSaml();
      const domain = `acme-${randomUUID().slice(0, 8)}.test`;
      await verifyDomain(setup, domain);
      const kim = await registerUser('Kim Password', `kim@${domain}`);

      // Not before the address is confirmed: whoever registered it may not own it.
      const refused = await samlSignIn(setup, { nameId: 'kim-1', email: kim.email });
      expect(refused.headers['location']).toBe(web('/login?ssoError=SSO_ACCOUNT_UNCONFIRMED'));
      expect(
        await context.prisma.workspaceMember.count({
          where: { workspaceId: setup.workspaceId, userId: kim.userId },
        }),
      ).toBe(0);

      await confirmEmail(context, kim.userId);
      const session = await sessionFrom(
        await samlSignIn(setup, { nameId: 'kim-1', email: kim.email }),
      );
      expect(session.user.id).toBe(kim.userId);
      expect(
        await context.prisma.workspaceMember.count({
          where: { workspaceId: setup.workspaceId, userId: kim.userId },
        }),
      ).toBe(1);
    });

    it('hands over an account nobody can sign in to yet at a verified domain', async () => {
      const setup = await setupSaml();
      const domain = `acme-${randomUUID().slice(0, 8)}.test`;
      await verifyDomain(setup, domain);
      const imported = await context.prisma.user.create({
        data: { email: `ivy@${domain}`, name: 'Ivy Imported', passwordHash: null },
      });

      const session = await sessionFrom(
        await samlSignIn(setup, { nameId: 'ivy-1', email: imported.email }),
      );
      expect(session.user.id).toBe(imported.id);
      expect(
        await context.prisma.workspaceMember.count({
          where: { workspaceId: setup.workspaceId, userId: imported.id },
        }),
      ).toBe(1);
    });

    it('turns away an address at a domain the workspace has not verified', async () => {
      const setup = await setupSaml();
      const response = await samlSignIn(setup, { nameId: 'x-1', email: uniqueEmail('stranger') });
      expect(response.headers['location']).toBe(web('/login?ssoError=SSO_ACCOUNT_NOT_FOUND'));
      expect(cookieFrom(response, REFRESH_TOKEN_COOKIE)).toBeNull();
      expect(await context.prisma.user.count()).toBe(1);
    });

    it('signs in a member who connected it themselves, whatever their domain', async () => {
      const setup = await setupSaml();
      const flow = await samlLinkStart(setup, setup.owner);
      const linked = await postAndFinish(
        setup,
        flow,
        responseFor(setup, flow, { nameId: 'olive-at-idp', email: 'olive@unverified.test' }),
      );
      expect(linked.headers['location']).toBe(web('/settings?ssoLinked=saml'));

      const identities = (
        await request(server()).get(url('/auth/sso/identities')).set(as(setup.owner)).expect(200)
      ).body.data as { provider: string; workspace: { id: string } | null }[];
      expect(identities).toEqual([
        expect.objectContaining({
          provider: 'SAML',
          workspace: expect.objectContaining({ id: setup.workspaceId }),
        }),
      ]);

      const session = await sessionFrom(
        await samlSignIn(setup, { nameId: 'olive-at-idp', email: 'olive@unverified.test' }),
      );
      expect(session.user.id).toBe(setup.owner.userId);

      // Out of the workspace, the provider no longer speaks for them.
      await context.prisma.workspaceMember.deleteMany({
        where: { workspaceId: setup.workspaceId, userId: setup.owner.userId },
      });
      const removed = await samlSignIn(setup, { nameId: 'olive-at-idp' });
      expect(removed.headers['location']).toBe(web('/login?ssoError=SSO_ACCOUNT_NOT_FOUND'));
    });

    it('accepts each response once', async () => {
      const setup = await setupSaml();
      const domain = `acme-${randomUUID().slice(0, 8)}.test`;
      await verifyDomain(setup, domain);
      const flow = await samlStart({ workspace: setup.slug });
      const samlResponse = responseFor(setup, flow, { nameId: 'r-1', email: `r@${domain}` });
      await sessionFrom(await postAndFinish(setup, flow, samlResponse));

      // The same response again, carried by a fresh sign-in in the same browser.
      const fresh = await samlStart({ workspace: setup.slug });
      const replayed = await postAndFinish(setup, { ...fresh }, samlResponse);
      expect(replayed.headers['location']).toBe(web('/login?ssoError=SSO_FAILED'));
      expect(cookieFrom(replayed, REFRESH_TOKEN_COOKIE)).toBeNull();
    });

    it('refuses a response it did not ask for', async () => {
      const setup = await setupSaml();
      const flow = await samlStart({ workspace: setup.slug });
      const unsolicited = responseFor(
        setup,
        { ...flow, requestId: '_made-up-request' },
        { nameId: 'u-1' },
      );
      const response = await postAndFinish(setup, flow, unsolicited);
      expect(response.headers['location']).toBe(web('/login?ssoError=SSO_FAILED'));
    });

    it('refuses a forged signature, a tampered assertion, and another issuer', async () => {
      const setup = await setupSaml();
      const domain = `acme-${randomUUID().slice(0, 8)}.test`;
      await verifyDomain(setup, domain);
      const person = { nameId: 'f-1', email: `f@${domain}` };

      const forgedFlow = await samlStart({ workspace: setup.slug });
      const forged = await postAndFinish(
        setup,
        forgedFlow,
        responseFor(setup, forgedFlow, person, { signingKey: strangerKey() }),
      );
      expect(forged.headers['location']).toBe(web('/login?ssoError=SSO_FAILED'));

      const tamperedFlow = await samlStart({ workspace: setup.slug });
      const tampered = await postAndFinish(
        setup,
        tamperedFlow,
        responseFor(setup, tamperedFlow, person, {
          tamper: (xml) => xml.replace(`f@${domain}`, `boss@${domain}`),
        }),
      );
      expect(tampered.headers['location']).toBe(web('/login?ssoError=SSO_FAILED'));

      const issuerFlow = await samlStart({ workspace: setup.slug });
      const otherIssuer = await postAndFinish(
        setup,
        issuerFlow,
        responseFor(setup, issuerFlow, person, { issuer: 'https://another-idp.test' }),
      );
      expect(otherIssuer.headers['location']).toBe(web('/login?ssoError=SSO_FAILED'));

      expect(await context.prisma.user.count()).toBe(1);
    });

    it('finishes only in the browser that started, holding its cookie', async () => {
      const setup = await setupSaml();
      const domain = `acme-${randomUUID().slice(0, 8)}.test`;
      await verifyDomain(setup, domain);
      const flow = await samlStart({ workspace: setup.slug });
      const other = await samlStart({ workspace: setup.slug });

      const response = await postAndFinish(
        setup,
        flow,
        responseFor(setup, flow, { nameId: 'c-1', email: `c@${domain}` }),
        other.cookie,
      );
      expect(response.headers['location']).toBe(web('/login?ssoError=SSO_FAILED'));
      expect(await context.prisma.user.count()).toBe(1);
    });

    it('asks a two-step account for its code', async () => {
      const setup = await setupSaml();
      const domain = `acme-${randomUUID().slice(0, 8)}.test`;
      await verifyDomain(setup, domain);
      const kim = await registerUser('Kim Two-Step', `kim@${domain}`);
      await context.prisma.user.update({
        where: { id: kim.userId },
        data: { totpSecret: 'v1.x.y.z', totpEnabledAt: new Date(), emailVerifiedAt: new Date() },
      });

      const response = await samlSignIn(setup, { nameId: 'k-2', email: kim.email }, '/inbox');
      expect(response.headers['location']).toMatch(
        new RegExp(`^${web('/sso/complete?redirect=%2Finbox').replace(/[?]/g, '\\?')}#challenge=`),
      );
      expect(cookieFrom(response, REFRESH_TOKEN_COOKIE)).toBeNull();
    });
  });

  describe('workspace settings', () => {
    it('lets admins set up, change and remove the connection, and members do none of it', async () => {
      const setup = await setupSaml({ enabled: false });
      const member = await registerUser('Max Member');
      await context.prisma.workspaceMember.create({
        data: { workspaceId: setup.workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
      });

      const saml = url(`/workspaces/${setup.workspaceId}/saml`);
      const read = await request(server()).get(saml).set(as(setup.owner)).expect(200);
      expect(read.body.data).toMatchObject({
        enabled: false,
        idpEntityId: IDP_ENTITY,
        idpSsoUrl: IDP_SSO_URL,
        serviceProvider: {
          entityId: `${config.sso.apiBase}/auth/sso/saml/${setup.connectionId}/metadata`,
          acsUrl: `${config.sso.apiBase}/auth/sso/saml/${setup.connectionId}/acs`,
          metadataUrl: `${config.sso.apiBase}/auth/sso/saml/${setup.connectionId}/metadata`,
        },
      });
      expect(read.body.data.idpCertificate).toMatch(/^-----BEGIN CERTIFICATE-----\n/);

      await request(server()).get(saml).set(as(member)).expect(403);
      await request(server())
        .put(saml)
        .set(as(member))
        .send({
          idpEntityId: 'x',
          idpSsoUrl: IDP_SSO_URL,
          idpCertificate: idp.certificate,
          enabled: true,
        })
        .expect(403);

      const badCertificate = await request(server())
        .put(saml)
        .set(as(setup.owner))
        .send({
          idpEntityId: IDP_ENTITY,
          idpSsoUrl: IDP_SSO_URL,
          idpCertificate: `-----BEGIN CERTIFICATE-----\n${'A'.repeat(200)}\n-----END CERTIFICATE-----`,
          enabled: true,
        })
        .expect(422);
      expect(badCertificate.body.error.code).toBe('VALIDATION_FAILED');

      await request(server()).delete(saml).set(as(setup.owner)).expect(204);
      const gone = await request(server()).get(saml).set(as(setup.owner)).expect(200);
      expect(gone.body.data).toBeNull();
      await request(server()).delete(saml).set(as(setup.owner)).expect(404);
    });

    it('saves an empty draft, switched off, for the addresses the provider asks for first', async () => {
      const owner = await registerUser('Olive Owner');
      const workspace = await request(server())
        .post(url('/workspaces'))
        .set(as(owner))
        .send({ name: 'Draft Co' })
        .expect(201);
      const saml = url(`/workspaces/${workspace.body.data.id}/saml`);
      const empty = { idpEntityId: '', idpSsoUrl: '', idpCertificate: '' };

      const refused = await request(server())
        .put(saml)
        .set(as(owner))
        .send({ ...empty, enabled: true })
        .expect(422);
      expect(
        (refused.body.error.details.issues as { path: string }[]).map((issue) => issue.path).sort(),
      ).toEqual(['idpCertificate', 'idpEntityId', 'idpSsoUrl']);

      const draft = await request(server())
        .put(saml)
        .set(as(owner))
        .send({ ...empty, enabled: false })
        .expect(200);
      expect(draft.body.data).toMatchObject({ enabled: false, idpCertificate: '' });
      const metadata = await request(server())
        .get(new URL(draft.body.data.serviceProvider.metadataUrl as string).pathname)
        .expect(200);
      expect(metadata.text).toContain(`entityID="${draft.body.data.serviceProvider.entityId}"`);

      // Nobody signs in through a draft.
      const start = await request(server())
        .get(url('/auth/sso/saml/start'))
        .query({ workspace: workspace.body.data.slug as string })
        .expect(302);
      expect(start.headers['location']).toBe(web('/sso?error=SAML_NOT_CONFIGURED'));
    });

    it('verifies a domain by its TXT record, once across all workspaces', async () => {
      const setup = await setupSaml();
      const domains = url(`/workspaces/${setup.workspaceId}/domains`);

      const added = await request(server())
        .post(domains)
        .set(as(setup.owner))
        .send({ domain: 'Example-Corp.TEST.' })
        .expect(201);
      expect(added.body.data).toMatchObject({ domain: 'example-corp.test', verified: false });
      expect(added.body.data.txtRecord).toMatch(/^coretask-verification=[0-9a-f]{32}$/);
      const verify = url(`/workspaces/${setup.workspaceId}/domains/${added.body.data.id}/verify`);

      await request(server())
        .post(domains)
        .set(as(setup.owner))
        .send({ domain: 'example-corp.test' })
        .expect(409);
      await request(server())
        .post(domains)
        .set(as(setup.owner))
        .send({ domain: 'https://x.test/' })
        .expect(422);

      resolveTxt.mockRejectedValueOnce(
        Object.assign(new Error('queryTxt ENODATA'), { code: 'ENODATA' }),
      );
      const missing = await request(server()).post(verify).set(as(setup.owner)).expect(400);
      expect(missing.body.error.code).toBe('DOMAIN_VERIFICATION_FAILED');

      resolveTxt.mockResolvedValueOnce([['coretask-verification=not-the-token']]);
      await request(server()).post(verify).set(as(setup.owner)).expect(400);

      resolveTxt.mockResolvedValueOnce([[added.body.data.txtRecord as string]]);
      const verified = await request(server()).post(verify).set(as(setup.owner)).expect(200);
      expect(verified.body.data).toMatchObject({ verified: true, verifiedAt: expect.any(String) });
      expect(resolveTxt).toHaveBeenCalledWith('example-corp.test');

      // A second workspace may claim it, but not prove it.
      const rival = await setupSaml();
      const claimed = await request(server())
        .post(url(`/workspaces/${rival.workspaceId}/domains`))
        .set(as(rival.owner))
        .send({ domain: 'example-corp.test' })
        .expect(201);
      resolveTxt.mockResolvedValueOnce([[claimed.body.data.txtRecord as string]]);
      const refused = await request(server())
        .post(url(`/workspaces/${rival.workspaceId}/domains/${claimed.body.data.id}/verify`))
        .set(as(rival.owner))
        .expect(409);
      expect(refused.body.error.code).toBe('DOMAIN_ALREADY_VERIFIED');

      const listed = await request(server()).get(domains).set(as(setup.owner)).expect(200);
      expect(listed.body.data).toHaveLength(1);
      await request(server())
        .delete(url(`/workspaces/${setup.workspaceId}/domains/${added.body.data.id}`))
        .set(as(setup.owner))
        .expect(204);
      expect(
        (await request(server()).get(domains).set(as(setup.owner)).expect(200)).body.data,
      ).toEqual([]);
    });

    it(`holds a workspace to ${WORKSPACE_DOMAIN_LIMIT} domains`, async () => {
      const setup = await setupSaml();
      await context.prisma.workspaceDomain.createMany({
        data: Array.from({ length: WORKSPACE_DOMAIN_LIMIT }, (_, index) => ({
          workspaceId: setup.workspaceId,
          domain: `d${index}.test`,
          verificationToken: randomUUID().replace(/-/g, ''),
        })),
      });
      await request(server())
        .post(url(`/workspaces/${setup.workspaceId}/domains`))
        .set(as(setup.owner))
        .send({ domain: 'one-more.test' })
        .expect(400);
    });
  });
});
