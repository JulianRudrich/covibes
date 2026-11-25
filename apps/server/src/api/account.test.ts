import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { withUser } from '@server/db/database';
import { APP_URL, createTestServer } from '@server/testing';

const test = createTestServer();

describe('personal account data (spec 42)', () => {
  it('requires a session and exports only the requesting person without credentials', async () => {
    expect((await test.app.request('/api/account/export')).status).toBe(401);
    const ownerEmail = `${randomUUID()}@example.com`;
    const cookie = await test.signIn(ownerEmail);
    const other = await test.signIn();
    const create = await test.app.request('/api/projects', {
      method: 'POST',
      headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Private project' }),
    });
    expect(create.status).toBe(201);
    const exported = await test.app.request('/api/account/export', { headers: { cookie } });
    expect(exported.headers.get('cache-control')).toBe('no-store');
    expect(exported.headers.get('content-disposition')).toContain('attachment');
    const data = (await exported.json()) as {
      profile: { id: string; email: string };
      memberships: unknown[];
    };
    expect(data.profile.email).toBe(ownerEmail);
    expect(data.memberships).toHaveLength(1);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('session_token');
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('backup_codes');
    expect(serialized).not.toContain('storage_key');
    const otherSession = await test.auth.api.getSession({
      headers: new Headers({ cookie: other }),
    });
    expect(serialized).not.toContain(otherSession?.user.id);
  });

  it('does not allow the application role to read authentication secrets or beta invitations', async () => {
    const cookie = await test.signIn();
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session) throw new Error('No session');
    for (const table of ['account_two_factors', 'account_passkeys', 'beta_invitations']) {
      await expect(
        withUser(test.db.app, session.user.id, (trx) =>
          sql`select * from ${sql.table(table)}`.execute(trx),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('validates profile names and revokes another session without accepting another user’s token', async () => {
    const email = `${randomUUID()}@example.com`;
    const cookie = await test.signIn(email);
    const second = await test.signIn(email);
    const stranger = await test.signIn();
    const headers = { cookie, origin: APP_URL, 'content-type': 'application/json' };
    const update = (name: string) =>
      test.app.request('/api/auth/update-user', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name }),
      });
    expect((await update('   ')).status).toBe(400);
    expect((await update('x'.repeat(81))).status).toBe(400);
    expect((await update('  A person  ')).status).toBe(200);
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie: second }) });
    if (!session) throw new Error('No other session');
    const denied = await test.app.request('/api/auth/revoke-session', {
      method: 'POST',
      headers: { ...headers, cookie: stranger },
      body: JSON.stringify({ token: session.session.token }),
    });
    // The library deliberately returns success for unknown/foreign tokens, without revealing
    // their existence. The meaningful permission assertion is that the foreign session survives.
    expect(denied.status).toBe(200);
    expect(
      await test.auth.api.getSession({ headers: new Headers({ cookie: second }) }),
    ).toMatchObject({ user: { email } });
    const revoked = await test.app.request('/api/auth/revoke-session', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: session.session.token }),
    });
    expect(revoked.status).toBe(200);
    expect(
      await (
        await test.app.request('/api/auth/get-session', { headers: { cookie: second } })
      ).json(),
    ).toBeNull();
  });
});
