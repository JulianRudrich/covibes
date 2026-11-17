import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { APP_URL, createTestServer } from '@server/testing';

const test = createTestServer({
  GITLAB_CLIENT_ID: 'test-gitlab-client',
  GITLAB_CLIENT_SECRET: 'test-gitlab-secret',
});

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}

async function sessionsFor(email: string): Promise<number> {
  const result = await test.db.adminPool.query<{ count: number }>(
    'select count(*)::integer as count from sessions join users on users.id = sessions.user_id where users.email = $1',
    [email],
  );
  return result.rows[0]?.count ?? 0;
}

describe('verification records have one purpose (spec 39)', () => {
  it.each(['existing', 'new'] as const)(
    'cannot turn a GitLab OAuth state into a login link for a %s account',
    async (account) => {
      const email = `${randomUUID()}@example.com`;
      if (account === 'existing') await test.signIn(email);
      const sessionsBefore = await sessionsFor(email);

      // The attacker chooses the mailbox owner's address without accessing their mail or
      // completing a GitLab callback. This is the public path from GHSA-965c-763c-88jm.
      const started = await test.app.request('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { origin: APP_URL, 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'gitlab',
          callbackURL: '/',
          disableRedirect: true,
          additionalData: { email, name: 'Mailbox owner' },
        }),
      });
      expect(started.status).toBe(200);
      const authorization = (await started.json()) as { url: string };
      const state = new URL(authorization.url).searchParams.get('state');
      expect(state).toBeTruthy();

      const forgedLink = new URL('/api/auth/magic-link/verify', APP_URL);
      forgedLink.searchParams.set('token', state ?? '');
      forgedLink.searchParams.set('callbackURL', '/');
      forgedLink.searchParams.set('errorCallbackURL', '/login');
      const rejected = await test.app.request(forgedLink.toString(), {
        headers: { cookie: cookiesOf(started) },
      });

      expect(rejected.status).toBe(302);
      expect(cookiesOf(rejected)).not.toContain('covibes.session_token=');
      expect(
        new URL(rejected.headers.get('location') ?? '', APP_URL).searchParams.get('error'),
      ).toBe('INVALID_TOKEN');
      const session = await test.app.request('/api/auth/get-session', {
        headers: { cookie: cookiesOf(rejected) },
      });
      expect(await session.json()).toBeNull();
      expect(await sessionsFor(email)).toBe(sessionsBefore);
      if (account === 'new') {
        const created = await test.db.adminPool.query('select id from users where email = $1', [
          email,
        ]);
        expect(created.rowCount).toBe(0);
      }
    },
  );

  it('still signs in through a mailed link and consumes it once', async () => {
    const email = `${randomUUID()}@example.com`;
    const requested = await test.app.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { origin: APP_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ email, callbackURL: '/' }),
    });
    expect(requested.status).toBe(200);
    const mail = test.outbox?.list().find((candidate) => candidate.to === email);
    const link = mail?.text.match(/https?:\/\/\S+/)?.[0];
    if (!link) throw new Error('No login link was sent');

    const verified = await test.app.request(link);
    expect(verified.status).toBe(302);
    const cookie = cookiesOf(verified);
    expect(cookie).toContain('covibes.session_token=');
    const session = await test.app.request('/api/auth/get-session', { headers: { cookie } });
    expect(await session.json()).toMatchObject({ user: { email, emailVerified: true } });
    expect(await sessionsFor(email)).toBe(1);

    const replayed = await test.app.request(link);
    expect(replayed.status).toBe(302);
    expect(cookiesOf(replayed)).not.toContain('covibes.session_token=');
    expect(new URL(replayed.headers.get('location') ?? '', APP_URL).searchParams.get('error')).toBe(
      'INVALID_TOKEN',
    );
    expect(await sessionsFor(email)).toBe(1);
  });
});
