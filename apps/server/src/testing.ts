import { randomUUID } from 'node:crypto';

import { afterAll, expect, inject } from 'vitest';

import { createApp } from '@server/app';
import { createAuth } from '@server/auth/auth';
import { createCollab, type BoardDocuments } from '@server/collab/collab';
import { createDatabase } from '@server/db/database';
import { loadServerEnv, type ServerEnv } from '@server/env';
import { createMailSetup } from '@server/integrations/mail/mailer';
import { createRealtime } from '@server/realtime/realtime';

export const APP_URL = 'http://localhost:5173';

/** A complete server against the test database. Closes its connections after the test file. */
export function createTestServer(overrides: Partial<Record<keyof ServerEnv, string>> = {}) {
  const { adminUrl, appUrl } = inject('database');
  const env = loadServerEnv({
    NODE_ENV: 'test',
    APP_URL,
    DATABASE_URL: appUrl,
    DATABASE_ADMIN_URL: adminUrl,
    BETTER_AUTH_SECRET: 'test-secret-with-at-least-32-characters',
    ...overrides,
  });
  const db = createDatabase(env);
  const mail = createMailSetup(env);
  const auth = createAuth({ env, adminPool: db.adminPool, mailer: mail.mailer });
  const realtime = createRealtime({ db, auth });
  const collab = createCollab({ db, auth, internalToken: env.INTERNAL_TOKEN });
  /** The app with another collaboration server, e.g. one a test starts and stops itself. */
  const appWith = (documents: BoardDocuments) =>
    createApp({ env, db, auth, mail, live: realtime, documents });
  const app = appWith(collab);
  const { outbox } = mail;
  afterAll(async () => {
    realtime.close();
    await collab.close();
    await db.close();
  });

  /** Signs in through the real login link and returns the session cookie. */
  async function signIn(email = `${randomUUID()}@example.com`): Promise<string> {
    const requested = await app.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify({ email, callbackURL: '/' }),
    });
    expect(requested.status).toBe(200);
    const sent = outbox?.list().find((candidate) => candidate.to === email);
    const link = sent?.text.match(/https?:\/\/\S+/)?.[0];
    if (!link) throw new Error(`No login link was sent to ${email}`);

    const verified = await app.request(link);
    expect(verified.status).toBe(302);
    const cookie = verified.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    expect(cookie).toContain('covibes.session_token=');
    return cookie;
  }

  return { app, appWith, env, db, auth, realtime, collab, outbox, signIn };
}
