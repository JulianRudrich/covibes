import { pathToFileURL } from 'node:url';

import pg from 'pg';
import { z } from 'zod';

import { normalizeEmail } from '@server/auth/beta-access';
import { loadServerEnv } from '@server/env';

/** Operator-only provisioning; no unauthenticated HTTP endpoint creates beta invitations. */
export async function inviteBetaEmail(adminPool: pg.Pool, input: string, days = 7): Promise<void> {
  const email = z.email().parse(normalizeEmail(input));
  const duration = z.number().int().min(1).max(30).parse(days);
  await adminPool.query(
    `insert into public.beta_invitations (email, expires_at) values ($1, now() + $2 * interval '1 day')
     on conflict (email) do update set expires_at = excluded.expires_at`,
    [email, duration],
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = loadServerEnv();
  const pool = new pg.Pool({ connectionString: env.DATABASE_ADMIN_URL });
  try {
    await inviteBetaEmail(pool, process.argv[2] ?? '', Number(process.argv[3] ?? 7));
    console.log('The address can create a verified account during the invitation period.');
  } finally {
    await pool.end();
  }
}
