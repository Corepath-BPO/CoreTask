import { API_PREFIX, REFRESH_TOKEN_COOKIE } from '@coretask/contracts';
import request from 'supertest';

import { EmailQueue } from '../../src/jobs/email/email.queue';
import type { MessageEmailJobData } from '../../src/jobs/queue-names';
import { base32Decode, hotp, totpStep } from '../../src/modules/auth/lib/totp';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Two-step verification: setting it up, signing in with it, recovery codes,
 * and turning it off. Codes are computed here from the secret the setup
 * answers, exactly as an authenticator app would.
 */
describe('Two-step verification (e2e)', () => {
  let context: TestContext;
  let notices: MessageEmailJobData[];

  beforeAll(async () => {
    context = await createTestContext();
    jest
      .spyOn(context.app.get(EmailQueue), 'enqueueEmailVerification')
      .mockResolvedValue(undefined);
    jest.spyOn(context.app.get(EmailQueue), 'enqueueMessage').mockImplementation(async (data) => {
      notices.push(data);
    });
  });

  beforeEach(async () => {
    notices = [];
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** A code for `offset` steps from now; setting up spends the current step. */
  const codeFor = (secret: string, offset = 0) => hotp(base32Decode(secret), totpStep() + offset);

  const register = async () => {
    const email = uniqueEmail('two-factor');
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name: 'Ada Lovelace', email, password: VALID_PASSWORD })
      .expect(201);
    return {
      email,
      userId: response.body.data.user.id as string,
      token: response.body.data.accessToken as string,
    };
  };

  /** Registers and turns two-step verification on; answers the secret and the codes. */
  const withTwoFactor = async () => {
    const account = await register();
    const setup = await request(server())
      .post(url('/auth/two-factor/setup'))
      .set(bearer(account.token))
      .expect(200);
    const secret = setup.body.data.secret as string;
    const enabled = await request(server())
      .post(url('/auth/two-factor/enable'))
      .set(bearer(account.token))
      .send({ setupToken: setup.body.data.setupToken, code: codeFor(secret) })
      .expect(200);
    return { ...account, secret, recoveryCodes: enabled.body.data.recoveryCodes as string[] };
  };

  const login = (email: string) =>
    request(server()).post(url('/auth/login')).send({ email, password: VALID_PASSWORD });

  const verify = (challenge: string, code: string) =>
    request(server()).post(url('/auth/two-factor/verify')).send({ challenge, code });

  /** Lets the next code from the app be accepted, as if the clock had moved on. */
  const forgetLastStep = (userId: string) =>
    context.prisma.user.update({ where: { id: userId }, data: { totpLastStep: null } });

  describe('setting up', () => {
    it('shows a QR code, and saves nothing until a code from it checks out', async () => {
      const account = await register();

      const setup = await request(server())
        .post(url('/auth/two-factor/setup'))
        .set(bearer(account.token))
        .expect(200);
      expect(setup.body.data.qrSvg).toContain('<svg');
      expect(setup.body.data.otpauthUrl).toContain(`secret=${setup.body.data.secret}`);
      expect(
        await context.prisma.user.findUniqueOrThrow({ where: { id: account.userId } }),
      ).toMatchObject({ totpSecret: null, totpEnabledAt: null });

      const wrong = await request(server())
        .post(url('/auth/two-factor/enable'))
        .set(bearer(account.token))
        .send({ setupToken: setup.body.data.setupToken, code: '000000' })
        .expect(400);
      expect(wrong.body.error.code).toBe('TWO_FACTOR_CODE_INVALID');

      const enabled = await request(server())
        .post(url('/auth/two-factor/enable'))
        .set(bearer(account.token))
        .send({ setupToken: setup.body.data.setupToken, code: codeFor(setup.body.data.secret) })
        .expect(200);
      expect(enabled.body.data.recoveryCodes).toHaveLength(10);

      const stored = await context.prisma.user.findUniqueOrThrow({ where: { id: account.userId } });
      expect(stored.totpEnabledAt).not.toBeNull();
      // Encrypted at rest, never the secret itself.
      expect(stored.totpSecret).not.toContain(setup.body.data.secret);

      const me = await request(server()).get(url('/auth/me')).set(bearer(account.token));
      expect(me.body.data.twoFactorEnabled).toBe(true);
      const status = await request(server())
        .get(url('/auth/two-factor'))
        .set(bearer(account.token))
        .expect(200);
      expect(status.body.data).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });
      expect(notices.map((notice) => notice.subject)).toContain(
        'Two-step verification is on for your CoreTask account',
      );
    });

    it('refuses a setup token made for someone else, and a second setup', async () => {
      const ada = await register();
      const grace = await register();
      const setup = await request(server())
        .post(url('/auth/two-factor/setup'))
        .set(bearer(ada.token))
        .expect(200);

      const stolen = await request(server())
        .post(url('/auth/two-factor/enable'))
        .set(bearer(grace.token))
        .send({ setupToken: setup.body.data.setupToken, code: codeFor(setup.body.data.secret) })
        .expect(400);
      expect(stolen.body.error.code).toBe('TWO_FACTOR_SETUP_INVALID');

      const account = await withTwoFactor();
      const again = await request(server())
        .post(url('/auth/two-factor/setup'))
        .set(bearer(account.token))
        .expect(409);
      expect(again.body.error.code).toBe('TWO_FACTOR_ALREADY_ENABLED');
    });
  });

  describe('signing in', () => {
    it('answers a challenge instead of a session, and the code finishes it', async () => {
      const account = await withTwoFactor();

      const first = await login(account.email).expect(200);
      expect(first.body.data).toMatchObject({ twoFactorRequired: true, expiresIn: 300 });
      expect(first.body.data.accessToken).toBeUndefined();
      expect(String(first.headers['set-cookie'] ?? '')).not.toContain(REFRESH_TOKEN_COOKIE);

      const done = await verify(first.body.data.challenge, codeFor(account.secret, 1)).expect(200);
      expect(done.body.data.user.email).toBe(account.email);
      expect(String(done.headers['set-cookie'])).toContain(`${REFRESH_TOKEN_COOKIE}=`);
      await request(server())
        .get(url('/auth/me'))
        .set(bearer(done.body.data.accessToken))
        .expect(200);
    });

    it('accepts each code once', async () => {
      const account = await withTwoFactor();
      const code = codeFor(account.secret, 1);

      const first = await login(account.email).expect(200);
      await verify(first.body.data.challenge, code).expect(200);

      const second = await login(account.email).expect(200);
      const replay = await verify(second.body.data.challenge, code).expect(400);
      expect(replay.body.error.code).toBe('TWO_FACTOR_CODE_INVALID');
    });

    it('takes a recovery code once, in any case and spacing', async () => {
      const account = await withTwoFactor();
      const recovery = account.recoveryCodes[0] as string;

      const first = await login(account.email).expect(200);
      await verify(first.body.data.challenge, recovery.toUpperCase().replace(/-/g, ' ')).expect(
        200,
      );

      const second = await login(account.email).expect(200);
      await verify(second.body.data.challenge, recovery).expect(400);

      const status = await request(server())
        .get(url('/auth/two-factor'))
        .set(bearer(account.token))
        .expect(200);
      expect(status.body.data.recoveryCodesRemaining).toBe(9);
    });

    it('ends the challenge after five wrong codes', async () => {
      const account = await withTwoFactor();
      const { challenge } = (await login(account.email).expect(200)).body.data;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await verify(challenge, '000000').expect(400);
      }
      const locked = await verify(challenge, codeFor(account.secret, 1)).expect(401);
      expect(locked.body.error.code).toBe('TWO_FACTOR_CHALLENGE_INVALID');
    });

    it('refuses a challenge that has been tampered with', async () => {
      const account = await withTwoFactor();
      const { challenge } = (await login(account.email).expect(200)).body.data;
      const [payload, mac] = (challenge as string).split('.');
      const forged = `${payload}x.${mac}`;

      const response = await verify(forged, codeFor(account.secret, 1)).expect(401);
      expect(response.body.error.code).toBe('TWO_FACTOR_CHALLENGE_INVALID');
    });
  });

  describe('managing it', () => {
    it('turns off only with the password, after which the password alone signs in', async () => {
      const account = await withTwoFactor();
      const disable = (body: object) =>
        request(server())
          .post(url('/auth/two-factor/disable'))
          .set(bearer(account.token))
          .send(body);

      expect((await disable({}).expect(400)).body.error.code).toBe('REAUTH_REQUIRED');
      expect((await disable({ password: 'Wrong-pass-2026' }).expect(400)).body.error.code).toBe(
        'CURRENT_PASSWORD_INCORRECT',
      );
      await disable({ password: VALID_PASSWORD }).expect(204);

      const signedIn = await login(account.email).expect(200);
      expect(signedIn.body.data.accessToken).toEqual(expect.any(String));
      expect(await context.prisma.twoFactorRecoveryCode.count()).toBe(0);
      expect(notices.map((notice) => notice.subject)).toContain(
        'Two-step verification is off for your CoreTask account',
      );
    });

    it('makes new recovery codes, and the old ones stop working', async () => {
      const account = await withTwoFactor();

      const fresh = await request(server())
        .post(url('/auth/two-factor/recovery-codes'))
        .set(bearer(account.token))
        .send({ password: VALID_PASSWORD })
        .expect(200);
      expect(fresh.body.data.recoveryCodes).toHaveLength(10);

      const { challenge } = (await login(account.email).expect(200)).body.data;
      await verify(challenge, account.recoveryCodes[0] as string).expect(400);
      await verify(challenge, fresh.body.data.recoveryCodes[0] as string).expect(200);
    });

    it('asks an account with no password for a code instead', async () => {
      const account = await withTwoFactor();
      await context.prisma.user.update({
        where: { id: account.userId },
        data: { passwordHash: null },
      });
      await forgetLastStep(account.userId);

      const noCode = await request(server())
        .post(url('/auth/two-factor/disable'))
        .set(bearer(account.token))
        .send({})
        .expect(400);
      expect(noCode.body.error.message).toMatch(/authenticator app/);

      await request(server())
        .post(url('/auth/two-factor/disable'))
        .set(bearer(account.token))
        .send({ code: codeFor(account.secret) })
        .expect(204);
    });
  });
});
