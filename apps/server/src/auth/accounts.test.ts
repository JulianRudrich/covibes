import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from 'node:crypto';

import { betterAuth } from 'better-auth';
import { describe, expect, it, vi } from 'vitest';

import { authOptions, createAuth } from '@server/auth/auth';
import { requireBetaAccess } from '@server/auth/beta-access';
import { inviteBetaEmail } from '@server/auth/beta-invite';
import { isPrimarySignIn } from '@server/auth/two-factor';
import { APP_URL, createTestServer } from '@server/testing';

const test = createTestServer();
const origin = { origin: APP_URL, 'content-type': 'application/json' };
const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
const post = (path: string, body: unknown, cookie?: string) =>
  test.app.request(`/api/auth${path}`, {
    method: 'POST',
    headers: { ...origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

/** RFC 6238, independent of the authentication library being tested. */
function totp(uri: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of new URL(uri).searchParams.get('secret') ?? '')
    bits += alphabet.indexOf(character.toUpperCase()).toString(2).padStart(5, '0');
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', bytes).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function requestCode(email: string) {
  const requested = await post('/email-otp/send-verification-otp', { email, type: 'sign-in' });
  expect(requested.status).toBe(200);
  const text = test.outbox?.list().find((mail) => mail.to === email)?.text ?? '';
  const code = /\b\d{6}\b/.exec(text)?.[0];
  if (!code) throw new Error('No code was delivered');
  return code;
}

async function enableAuthenticator(email: string) {
  const cookie = await test.signIn(email);
  const setup = await post('/two-factor/enable', { method: 'totp' }, cookie);
  expect(setup.status).toBe(200);
  const data = (await setup.json()) as { totpURI: string; backupCodes: string[] };
  const stored = await test.db.adminPool.query<{ secret: string; backup_codes: string }>(
    'select secret, backup_codes from account_two_factors join users on users.id = user_id where email = $1',
    [email],
  );
  expect(stored.rows[0]?.backup_codes).not.toContain(data.backupCodes[0]);
  expect(stored.rows[0]?.secret).not.toContain(new URL(data.totpURI).searchParams.get('secret'));
  const confirmed = await post('/two-factor/verify-totp', { code: totp(data.totpURI) }, cookie);
  expect(confirmed.status).toBe(200);
  return { ...data, cookie: cookiesOf(confirmed) || cookie };
}

/** A software authenticator: real P-256 keys, COSE/CBOR attestation and signed assertions. */
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const coordinates = publicKey.export({ format: 'jwk' });
  const credential = randomBytes(32);
  const id = credential.toString('base64url');
  const cose = Buffer.concat([
    Buffer.from('a5010203262001215820', 'hex'),
    Buffer.from(coordinates.x ?? '', 'base64url'),
    Buffer.from('225820', 'hex'),
    Buffer.from(coordinates.y ?? '', 'base64url'),
  ]);
  const data = (challenge: string, type: string, expectedOrigin = APP_URL) =>
    Buffer.from(JSON.stringify({ type, challenge, origin: expectedOrigin, crossOrigin: false }));
  const authData = (flags: number, counter: number, rp = 'localhost') => {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([createHash('sha256').update(rp).digest(), Buffer.from([flags]), count]);
  };
  return {
    register(challenge: string) {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(credential.length);
      const attested = Buffer.concat([
        authData(0x45, 0),
        Buffer.alloc(16),
        length,
        credential,
        cose,
      ]);
      const byteLength = Buffer.alloc(2);
      byteLength.writeUInt16BE(attested.length);
      const attestation = Buffer.concat([
        Buffer.from('a363666d74646e6f6e656761747453746d74a068617574684461746159', 'hex'),
        byteLength,
        attested,
      ]);
      return {
        id,
        rawId: id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: data(challenge, 'webauthn.create').toString('base64url'),
          attestationObject: attestation.toString('base64url'),
          transports: ['internal'],
        },
      };
    },
    assert(challenge: string, expectedOrigin = APP_URL, rp = 'localhost') {
      const clientData = data(challenge, 'webauthn.get', expectedOrigin);
      const signed = authData(0x05, 1, rp);
      return {
        id,
        rawId: id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData.toString('base64url'),
          authenticatorData: signed.toString('base64url'),
          signature: sign(
            'sha256',
            Buffer.concat([signed, createHash('sha256').update(clientData).digest()]),
            privateKey,
          ).toString('base64url'),
        },
      };
    },
  };
}

describe('passwordless accounts (spec 42)', () => {
  it('consumes email codes once and rejects wrong or expired codes', async () => {
    const email = `${randomUUID()}@example.com`;
    const otp = await requestCode(email);
    expect((await post('/sign-in/email-otp', { email, otp: 'wrong' })).status).toBe(400);
    const signedIn = await post('/sign-in/email-otp', { email, otp });
    expect(signedIn.status).toBe(200);
    expect(
      await (
        await test.app.request('/api/auth/get-session', {
          headers: { cookie: cookiesOf(signedIn) },
        })
      ).json(),
    ).toMatchObject({ user: { email, emailVerified: true } });
    expect((await post('/sign-in/email-otp', { email, otp })).status).toBe(400);
    const expiredEmail = `${randomUUID()}@example.com`;
    const expired = await requestCode(expiredEmail);
    await test.db.adminPool.query(
      "update verifications set expires_at = now() - interval '1 minute' where identifier = $1",
      [`sign-in-otp-${expiredEmail}`],
    );
    expect((await post('/sign-in/email-otp', { email: expiredEmail, otp: expired })).status).toBe(
      400,
    );
  });

  it('limits guesses even when the valid code is supplied after the attempt budget', async () => {
    const email = `${randomUUID()}@example.com`;
    const otp = await requestCode(email);
    for (let attempt = 0; attempt < 4; attempt += 1)
      await post('/sign-in/email-otp', { email, otp: 'wrong' });
    expect((await post('/sign-in/email-otp', { email, otp })).status).not.toBe(200);
  });

  it('requires a session for passkey registration and uses the configured relying party', async () => {
    expect((await test.app.request('/api/auth/passkey/generate-register-options')).status).toBe(
      401,
    );
    const cookie = await test.signIn();
    const options = await test.app.request('/api/auth/passkey/generate-register-options', {
      headers: { cookie },
    });
    expect(options.status).toBe(200);
    const registration = (await options.json()) as {
      challenge: string;
      rp: { id: string; name: string };
    };
    expect(registration).toMatchObject({ rp: { id: 'localhost', name: 'Covibes' } });
    const refused = await test.app.request('/api/auth/passkey/verify-registration', {
      method: 'POST',
      headers: { ...origin, cookie: cookie + '; ' + cookiesOf(options) },
      body: JSON.stringify({
        response: {
          id: 'credential',
          rawId: 'Y3JlZGVudGlhbA',
          type: 'public-key',
          clientExtensionResults: {},
          response: {
            clientDataJSON: Buffer.from(
              JSON.stringify({
                type: 'webauthn.create',
                challenge: registration.challenge,
                origin: 'https://other.example',
              }),
            ).toString('base64url'),
            attestationObject: 'oA',
          },
        },
      }),
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: 'FAILED_TO_VERIFY_REGISTRATION' });
  });

  it.each(['code', 'link'] as const)(
    'requires an authenticator after email %s and accepts a recovery code once',
    async (method) => {
      const email = `${randomUUID()}@example.com`;
      const factor = await enableAuthenticator(email);
      let pending: Response;
      if (method === 'code') {
        const otp = await requestCode(email);
        pending = await post('/sign-in/email-otp', { email, otp });
        expect(await pending.clone().json()).toMatchObject({ twoFactorRedirect: true });
      } else {
        await post('/sign-in/magic-link', { email, callbackURL: '/' });
        const link = test.outbox
          ?.list()
          .find((mail) => mail.to === email)
          ?.text.match(/https?:\/\/\S+/)?.[0];
        if (!link) throw new Error('No link was delivered');
        pending = await test.app.request(link);
        expect(pending.headers.get('location')).toContain('twoFactor=required');
      }
      const cookie = cookiesOf(pending);
      expect(
        await (await test.app.request('/api/auth/get-session', { headers: { cookie } })).json(),
      ).toBeNull();
      const recovered = await post(
        '/two-factor/verify-backup-code',
        { code: factor.backupCodes[0] },
        cookie,
      );
      expect(recovered.status).toBe(200);
      expect(
        await (
          await test.app.request('/api/auth/get-session', {
            headers: { cookie: cookiesOf(recovered) },
          })
        ).json(),
      ).toMatchObject({ user: { email } });
      const nextOtp = await requestCode(email);
      const nextChallenge = await post('/sign-in/email-otp', { email, otp: nextOtp });
      const nextCookie = cookiesOf(nextChallenge);
      expect(await nextChallenge.clone().json()).toMatchObject({ twoFactorRedirect: true });
      expect(
        (await post('/two-factor/verify-backup-code', { code: factor.backupCodes[0] }, nextCookie))
          .status,
      ).not.toBe(200);
      expect(
        await (
          await test.app.request('/api/auth/get-session', { headers: { cookie: nextCookie } })
        ).json(),
      ).toBeNull();
    },
  );

  it('does not enable an authenticator until a correct setup code is proved', async () => {
    const cookie = await test.signIn();
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session) throw new Error('No session');
    const setup = await post('/two-factor/enable', { method: 'totp' }, cookie);
    expect(setup.status).toBe(200);
    const data = (await setup.json()) as { totpURI: string };
    const current = totp(data.totpURI);
    const wrong = String((Number(current) + 1) % 1_000_000).padStart(6, '0');
    expect((await post('/two-factor/verify-totp', { code: wrong }, cookie)).status).not.toBe(200);
    expect(
      (
        await test.db.adminPool.query('select two_factor_enabled from users where id = $1', [
          session.user.id,
        ])
      ).rows[0],
    ).toMatchObject({ two_factor_enabled: false });
    expect((await post('/two-factor/verify-totp', { code: current }, cookie)).status).toBe(200);
    expect(
      (
        await test.db.adminPool.query('select two_factor_enabled from users where id = $1', [
          session.user.id,
        ])
      ).rows[0],
    ).toMatchObject({ two_factor_enabled: true });
  });

  it('verifies real passkey signatures, rejects origin/RP mismatches, and still requires TOTP', async () => {
    const email = `${randomUUID()}@example.com`;
    const factor = await enableAuthenticator(email);
    const key = authenticator();
    const options = await test.app.request('/api/auth/passkey/generate-register-options', {
      headers: { cookie: factor.cookie },
    });
    const registration = (await options.json()) as { challenge: string };
    const registered = await post(
      '/passkey/verify-registration',
      { name: 'Software authenticator', response: key.register(registration.challenge) },
      factor.cookie + '; ' + cookiesOf(options),
    );
    expect(registered.status).toBe(200);
    const stored = (await registered.json()) as { id: string };
    const stranger = await test.signIn();
    expect((await post('/passkey/delete-passkey', { id: stored.id }, stranger)).status).toBe(401);
    for (const mismatch of ['origin', 'rp', 'none'] as const) {
      const requested = await test.app.request('/api/auth/passkey/generate-authenticate-options');
      const challenge = (await requested.json()) as { challenge: string };
      const proof = key.assert(
        challenge.challenge,
        mismatch === 'origin' ? 'https://other.example' : APP_URL,
        mismatch === 'rp' ? 'other.example' : 'localhost',
      );
      const verified = await post(
        '/passkey/verify-authentication',
        { response: proof },
        cookiesOf(requested),
      );
      if (mismatch !== 'none') {
        expect(verified.status).not.toBe(200);
        continue;
      }
      expect(verified.status).toBe(200);
      expect(await verified.clone().json()).toMatchObject({ twoFactorRedirect: true });
      const cookie = cookiesOf(verified);
      expect(
        await (await test.app.request('/api/auth/get-session', { headers: { cookie } })).json(),
      ).toBeNull();
      const completed = await post(
        '/two-factor/verify-totp',
        { code: totp(factor.totpURI) },
        cookie,
      );
      expect(completed.status).toBe(200);
      expect(
        await (
          await test.app.request('/api/auth/get-session', {
            headers: { cookie: cookiesOf(completed) },
          })
        ).json(),
      ).toMatchObject({ user: { email } });
    }
    expect((await post('/passkey/delete-passkey', { id: stored.id }, factor.cookie)).status).toBe(
      200,
    );
  });

  it.each(['github', 'google', 'gitlab'] as const)(
    'challenges an existing %s account after a validated OAuth callback',
    async (provider) => {
      const email = `${randomUUID()}@example.com`;
      const factor = await enableAuthenticator(email);
      const session = await test.auth.api.getSession({
        headers: new Headers({ cookie: factor.cookie }),
      });
      if (!session) throw new Error('No setup session');
      const providerId = `${provider}-${session.user.id}`;
      await test.db.adminPool.query(
        'insert into accounts (id, account_id, provider_id, user_id, created_at, updated_at) values ($1, $2, $3, $4, now(), now())',
        [randomUUID(), providerId, provider, session.user.id],
      );
      const options = authOptions({
        env: test.env,
        adminPool: test.db.adminPool,
        mailer: test.outbox,
      });
      const auth = betterAuth({
        ...options,
        socialProviders: {
          [provider]: {
            clientId: 'test-client',
            clientSecret: 'test-secret',
            getUserInfo: () =>
              Promise.resolve({
                user: { id: providerId, email, name: 'OAuth member', emailVerified: true },
                data: { id: providerId, sub: providerId },
              }),
          },
        },
      });
      const exchange = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: 'fixture-access-token',
              token_type: 'Bearer',
              expires_in: 3600,
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        ),
      );
      try {
        const started = await auth.handler(
          new Request(`${APP_URL}/api/auth/sign-in/social`, {
            method: 'POST',
            headers: origin,
            body: JSON.stringify({
              provider,
              callbackURL: '/account?from=oauth',
              disableRedirect: true,
            }),
          }),
        );
        expect(started.status).toBe(200);
        const authorization = (await started.json()) as { url: string };
        const state = new URL(authorization.url).searchParams.get('state');
        if (!state) throw new Error('No OAuth state');
        const callback = await auth.handler(
          new Request(
            `${APP_URL}/api/auth/callback/${provider}?code=test-code&state=${encodeURIComponent(state)}`,
            { headers: { cookie: cookiesOf(started) } },
          ),
        );
        expect(callback.headers.get('location')).toContain('twoFactor=required');
        expect(
          new URL(callback.headers.get('location') ?? '', APP_URL).searchParams.get('redirect'),
        ).toBe('/account?from=oauth');
        const cookie = cookiesOf(callback);
        expect(
          await (await test.app.request('/api/auth/get-session', { headers: { cookie } })).json(),
        ).toBeNull();
        const verified = await post(
          '/two-factor/verify-totp',
          { code: totp(factor.totpURI) },
          cookie,
        );
        expect(verified.status).toBe(200);
        expect(
          await (
            await test.app.request('/api/auth/get-session', {
              headers: { cookie: cookiesOf(verified) },
            })
          ).json(),
        ).toMatchObject({ user: { email } });
      } finally {
        exchange.mockRestore();
      }
    },
  );

  it('checks beta admission only for proved, exact email identities', async () => {
    const email = `${randomUUID()}@example.com`;
    const options = {
      production: true,
      email,
      verified: true,
      allowed: [],
      adminPool: test.db.adminPool,
    };
    await expect(requireBetaAccess(options)).rejects.toMatchObject({ status: 'FORBIDDEN' });
    await expect(
      requireBetaAccess({ ...options, allowed: [email], verified: false }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' });
    await expect(requireBetaAccess({ ...options, allowed: [email] })).resolves.toBeUndefined();
    await inviteBetaEmail(test.db.adminPool, email.toUpperCase());
    await expect(requireBetaAccess(options)).resolves.toBeUndefined();
    await expect(requireBetaAccess({ ...options, email: `other-${email}` })).rejects.toMatchObject({
      status: 'FORBIDDEN',
    });
    await test.db.adminPool.query(
      "update beta_invitations set expires_at = now() - interval '1 second' where email = $1",
      [email],
    );
    await expect(requireBetaAccess(options)).rejects.toMatchObject({ status: 'FORBIDDEN' });
  });

  it('enforces the production gate inside actual account creation', async () => {
    const email = `${randomUUID()}@example.com`;
    const auth = createAuth({
      env: { ...test.env, NODE_ENV: 'production', BETA_ALLOWED_EMAILS: [] },
      adminPool: test.db.adminPool,
      mailer: test.outbox,
    });
    const context = await auth.$context;
    await expect(
      context.internalAdapter.createUser(
        { email, emailVerified: true, name: 'Invited' },
        { method: 'email-otp' },
      ),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' });
    await inviteBetaEmail(test.db.adminPool, email);
    await expect(
      context.internalAdapter.createUser(
        { email, emailVerified: false, name: 'Claimed' },
        { method: 'email-otp' },
      ),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' });
    await expect(
      context.internalAdapter.createUser(
        { email, emailVerified: true, name: 'Invited' },
        { method: 'email-otp' },
      ),
    ).resolves.toMatchObject({ email });
  });

  it('accepts a live exact project email invitation only after proving its identity', async () => {
    const cookie = await test.signIn();
    const email = `${randomUUID()}@example.com`;
    const created = await test.app.request('/api/projects', {
      method: 'POST',
      headers: { ...origin, cookie },
      body: JSON.stringify({ name: 'Invitation project' }),
    });
    const project = (await created.json()) as { id: string };
    const invited = await test.app.request(`/api/projects/${project.id}/invitations`, {
      method: 'POST',
      headers: { ...origin, cookie },
      body: JSON.stringify({ kind: 'email', role: 'editor', email }),
    });
    expect(invited.status).toBe(201);
    const gate = {
      production: true,
      email,
      verified: true,
      allowed: [],
      adminPool: test.db.adminPool,
    };
    await expect(requireBetaAccess({ ...gate, verified: false })).rejects.toMatchObject({
      status: 'FORBIDDEN',
    });
    await expect(requireBetaAccess(gate)).resolves.toBeUndefined();
    await test.db.adminPool.query('update invitations set revoked_at = now() where email = $1', [
      email,
    ]);
    await expect(requireBetaAccess(gate)).rejects.toMatchObject({ status: 'FORBIDDEN' });
  });

  it('keeps production email requests uniform and admits only invited proved identities', async () => {
    const auth = createAuth({
      env: { ...test.env, NODE_ENV: 'production', BETA_ALLOWED_EMAILS: [] },
      adminPool: test.db.adminPool,
      mailer: test.outbox,
    });
    const request = (path: string, body: unknown) =>
      auth.handler(
        new Request(`${APP_URL}/api/auth${path}`, {
          method: 'POST',
          headers: origin,
          body: JSON.stringify(body),
        }),
      );
    for (const invited of [false, true]) {
      const email = `${randomUUID()}@example.com`;
      if (invited) await inviteBetaEmail(test.db.adminPool, email);
      const requested = await request('/email-otp/send-verification-otp', {
        email,
        type: 'sign-in',
      });
      expect(requested.status).toBe(200);
      expect(await requested.json()).toEqual({ success: true });
      const otp = test.outbox
        ?.list()
        .find((mail) => mail.to === email)
        ?.text.match(/\b\d{6}\b/)?.[0];
      const verified = await request('/sign-in/email-otp', { email, otp });
      expect(verified.status).toBe(invited ? 200 : 403);
      const rows = await test.db.adminPool.query(
        'select email_verified from users where email = $1',
        [email],
      );
      expect(rows.rowCount).toBe(invited ? 1 : 0);
      if (invited) expect(rows.rows[0]).toMatchObject({ email_verified: true });
    }
  });

  it('registers all social and passkey primary completion paths with the second-factor guard', () => {
    for (const path of [
      '/callback/github',
      '/callback/google',
      '/callback/gitlab',
      '/passkey/verify-authentication',
      '/magic-link/verify',
      '/sign-in/email-otp',
    ])
      expect(isPrimarySignIn(path)).toBe(true);
    expect(isPrimarySignIn('/two-factor/verify-totp')).toBe(false);
    expect(isPrimarySignIn('/get-session')).toBe(false);
  });

  it('calls deletion preparation and completion from the built-in verified deletion endpoint', async () => {
    const cookie = await test.signIn();
    const beforeDeleteUser = vi.fn<(userId: string) => Promise<void>>().mockResolvedValue();
    const afterDeleteUser = vi.fn<(userId: string) => Promise<void>>().mockResolvedValue();
    const auth = betterAuth(
      authOptions({
        env: test.env,
        adminPool: test.db.adminPool,
        mailer: test.outbox,
        beforeDeleteUser,
        afterDeleteUser,
      }),
    );
    const request = (path: string, body?: unknown) =>
      auth.handler(
        new Request(`${APP_URL}/api/auth${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { ...origin, cookie },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    const asked = await request('/delete-user', { callbackURL: '/login' });
    expect(asked.status).toBe(200);
    expect(beforeDeleteUser).not.toHaveBeenCalled();
    const link = test.outbox?.list()[0]?.text.match(/https?:\/\/\S+/)?.[0];
    if (!link) throw new Error('No deletion link was delivered');
    const deleted = await auth.handler(new Request(link, { headers: { cookie } }));
    expect(deleted.status).toBe(302);
    expect(beforeDeleteUser).toHaveBeenCalledOnce();
    expect(afterDeleteUser).toHaveBeenCalledOnce();
    expect(beforeDeleteUser.mock.calls[0]).toEqual(afterDeleteUser.mock.calls[0]);
    expect(await (await request('/get-session')).json()).toBeNull();
    expect((await auth.handler(new Request(link, { headers: { cookie } }))).status).not.toBe(302);
  });

  it('blocks deletion without fresh proof when mail delivery is unavailable', async () => {
    const email = `${randomUUID()}@example.com`;
    const cookie = await test.signIn(email);
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session) throw new Error('No session');
    await test.db.adminPool.query(
      "update sessions set created_at = now() - interval '10 minutes' where id = $1",
      [session.session.id],
    );
    const beforeDeleteUser = vi.fn<(userId: string) => Promise<void>>().mockResolvedValue();
    const auth = createAuth({
      env: test.env,
      adminPool: test.db.adminPool,
      mailer: undefined,
      beforeDeleteUser,
    });
    const remove = (sessionCookie: string) =>
      auth.handler(
        new Request(`${APP_URL}/api/auth/delete-user`, {
          method: 'POST',
          headers: { ...origin, cookie: sessionCookie },
          body: '{}',
        }),
      );
    expect((await remove(cookie)).status).toBe(400);
    expect(beforeDeleteUser).not.toHaveBeenCalled();
    expect(
      (await test.db.adminPool.query('select 1 from users where id = $1', [session.user.id]))
        .rowCount,
    ).toBe(1);
    const renewed = await test.signIn(email);
    expect((await remove(renewed)).status).toBe(200);
    expect(beforeDeleteUser).toHaveBeenCalledWith(session.user.id);
  });

  it('keeps owned projects and the account intact when deletion preparation blocks it', async () => {
    const cookie = await test.signIn();
    const created = await test.app.request('/api/projects', {
      method: 'POST',
      headers: { ...origin, cookie },
      body: JSON.stringify({ name: 'Owned project' }),
    });
    expect(created.status).toBe(201);
    const project = (await created.json()) as { id: string };
    const requested = await post('/delete-user', { callbackURL: '/login' }, cookie);
    expect(requested.status).toBe(200);
    const link = test.outbox?.list()[0]?.text.match(/https?:\/\/\S+/)?.[0];
    if (!link) throw new Error('No deletion link');
    const blocked = await test.app.request(link, { headers: { cookie } });
    expect(blocked.status).toBe(409);
    expect(
      (await test.db.adminPool.query('select 1 from projects where id = $1', [project.id]))
        .rowCount,
    ).toBe(1);
    expect(await test.auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
  });
});
