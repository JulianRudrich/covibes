import { randomBytes } from 'node:crypto';

import type { DB } from '@covibes/db';
import {
  gitSyncInputSchema,
  projectIdSchema,
  type GitSync,
  type GitSyncRequested,
  type GitWebhook,
} from '@covibes/shared';
import { Hono, type Context } from 'hono';
import { sql, type Kysely, type Transaction } from 'kysely';

import { apiError } from '@server/api/errors';
import type { SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import { openToken, sealToken } from '@server/integrations/gitlab/crypto';
import type { RateLimiter } from '@server/rate-limit';
import { sameSecret } from '@server/secrets';

// Reading the repository's state (spec 30a): members ask for it, and a webhook with the project's
// secret does. The job that reads is the worker's (`tasks/git-sync.ts`).

type Env = { Variables: SessionVariables };

/** Where GitLab's webhook calls arrive, followed by the id of the project. */
export const GIT_WEBHOOK_PATH = '/api/git/webhook';

/** Webhook calls one project takes per minute; GitLab sends bursts, which become one job. */
export const WEBHOOK_CALLS_PER_MINUTE = 60;

/** The header GitLab sends the secret of a webhook in. */
const WEBHOOK_TOKEN_HEADER = 'x-gitlab-token';

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The secret of a stored webhook; undefined if it cannot be opened, e.g. after the server's key
 * changed. Such a secret matches no call, and a new one takes its place when an owner asks.
 */
function openSecret(tokenKey: string, sealed: string): string | undefined {
  try {
    return openToken(tokenKey, sealed);
  } catch {
    return undefined;
  }
}

/** When a project's repository was last read, as members see it; null before the first reading. */
export async function loadSync(trx: Transaction<DB>, projectId: string): Promise<GitSync | null> {
  const row = await trx
    .selectFrom('git_sync')
    .select(['synced_at', 'failed'])
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  return row ? { syncedAt: row.synced_at?.toISOString() ?? null, failed: row.failed } : null;
}

/**
 * Adds the routes of the sync below `/api/projects/:projectId/git`: asking for a reading, and
 * the webhook's address and secret for owners. `tokenKey` seals the secret; without it the server
 * is not set up for GitLab and has no webhook.
 */
export function addGitSyncRoutes(
  routes: Hono<Env>,
  {
    db,
    admin,
    appUrl,
    tokenKey,
  }: {
    db: AppDb;
    /** Role covibes_admin: no request of a user reaches the secret. */
    admin: Kysely<DB>;
    appUrl: string;
    tokenKey: string | undefined;
  },
) {
  /** Asks for the repository's state to be read; the database says whether it is time. */
  routes.post('/sync', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');
    const body: unknown = await c.req.json().catch(() => ({}));
    const input = gitSyncInputSchema.safeParse(body ?? {});
    if (!input.success) return apiError(c, 'invalid_input');
    try {
      const queued = await withUser(db, user.id, async (trx) => {
        const asked = await sql<{ queued: boolean }>`
          select public.request_git_sync(
            ${projectId.data}, ${input.data.force ?? false}
          ) as queued`.execute(trx);
        return asked.rows[0]?.queued === true;
      });
      return c.json<GitSyncRequested>({ queued });
    } catch (error) {
      if (sqlState(error) === 'P0002') return apiError(c, 'not_found');
      throw error;
    }
  });

  /** The project and the key for a route only owners may use, or the error to answer with. */
  async function owner(c: Context<Env>) {
    const user = c.get('user');
    if (!user) return { error: apiError(c, 'unauthorized') } as const;
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return { error: apiError(c, 'not_found') } as const;
    const member = await withUser(db, user.id, (trx) =>
      trx
        .selectFrom('project_members')
        .select('role')
        .where('project_id', '=', projectId.data)
        .where('user_id', '=', user.id)
        .executeTakeFirst(),
    );
    if (!member) return { error: apiError(c, 'not_found') } as const;
    if (member.role !== 'owner') return { error: apiError(c, 'forbidden') } as const;
    if (!tokenKey) return { error: apiError(c, 'not_found') } as const;
    return { projectId: projectId.data, tokenKey } as const;
  }

  const webhookOf = (projectId: string, secret: string): GitWebhook => ({
    url: `${appUrl.replace(/\/+$/, '')}${GIT_WEBHOOK_PATH}/${projectId}`,
    secret,
  });

  /** Stores a new secret for the project, in place of the one it had; the new secret. */
  async function renew(projectId: string, key: string): Promise<string> {
    const secret = randomBytes(24).toString('base64url');
    const sealed = sealToken(key, secret);
    await admin
      .insertInto('git_webhooks')
      .values({ project_id: projectId, secret: sealed })
      .onConflict((conflict) =>
        conflict.column('project_id').doUpdateSet({ secret: sealed, created_at: new Date() }),
      )
      .execute();
    return secret;
  }

  /** The webhook an owner enters in GitLab; its secret is made when it is first asked for. */
  routes.get('/webhook', async (c) => {
    const asked = await owner(c);
    if ('error' in asked) return asked.error;
    const first = randomBytes(24).toString('base64url');
    // Two owners asking at once get the same secret: the first one stored stays.
    await admin
      .insertInto('git_webhooks')
      .values({ project_id: asked.projectId, secret: sealToken(asked.tokenKey, first) })
      .onConflict((conflict) => conflict.column('project_id').doNothing())
      .execute();
    const stored = await admin
      .selectFrom('git_webhooks')
      .select('secret')
      .where('project_id', '=', asked.projectId)
      .executeTakeFirstOrThrow();
    const secret =
      openSecret(asked.tokenKey, stored.secret) ?? (await renew(asked.projectId, asked.tokenKey));
    return c.json<GitWebhook>(webhookOf(asked.projectId, secret));
  });

  /** Replaces the secret; the one entered in GitLab stops working. */
  routes.post('/webhook/renew', async (c) => {
    const asked = await owner(c);
    if ('error' in asked) return asked.error;
    return c.json<GitWebhook>(
      webhookOf(asked.projectId, await renew(asked.projectId, asked.tokenKey)),
    );
  });
}

/**
 * `POST /api/git/webhook/:projectId` (spec 30a): where GitLab says that something changed in a
 * project's repository. A call with the project's secret queues the job that reads the state;
 * what the call carries is not read. A wrong secret, an unknown project and a project without a
 * webhook all get the same answer, so the address tells nothing.
 */
export function gitWebhook(admin: Kysely<DB>, tokenKey: string | undefined, limiter: RateLimiter) {
  const routes = new Hono();

  routes.post('/:projectId', async (c) => {
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const given = c.req.header(WEBHOOK_TOKEN_HEADER);
    if (!projectId.success || !given || !tokenKey) return apiError(c, 'not_found');
    if (!limiter.take(projectId.data)) return apiError(c, 'too_many_requests');

    const stored = await admin
      .selectFrom('git_webhooks')
      .select('secret')
      .where('project_id', '=', projectId.data)
      .executeTakeFirst();
    const secret = stored ? openSecret(tokenKey, stored.secret) : undefined;
    if (secret === undefined || !sameSecret(given, secret)) return apiError(c, 'not_found');
    await sql`select private.queue_git_sync(${projectId.data})`.execute(admin);
    return c.body(null, 204);
  });

  return routes;
}
