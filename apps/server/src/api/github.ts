import { createHmac, timingSafeEqual } from 'node:crypto';

import type { DB } from '@covibes/db';
import {
  gitConnectInputSchema,
  githubRepositoriesQuerySchema,
  githubRepositoryInputSchema,
  projectIdSchema,
  type GithubAccountState,
  type GithubInstallations,
} from '@covibes/shared';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import { GithubError, type GithubSetup } from '@server/integrations/github/client';
import type { GithubConnections } from '@server/integrations/github/connections';

export type GithubDeps = { setup: GithubSetup; connections: GithubConnections };
type Env = { Variables: SessionVariables };

export function githubAccountRoutes(auth: Auth, appUrl: string, github: GithubDeps | undefined) {
  const routes = new Hono<Env>();
  routes.use(sessionMiddleware(auth));
  routes.get('/account', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    return c.json<GithubAccountState>({
      available: Boolean(github),
      account: (await github?.connections.account(user.id)) ?? null,
      installUrl: github ? `https://github.com/apps/${github.setup.slug}/installations/new` : null,
    });
  });
  routes.post('/account/connect', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    if (!github) return apiError(c, 'not_found');
    const input = gitConnectInputSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!input.success) return apiError(c, 'invalid_input');
    return c.json({
      url: await github.connections.start(user.id, {
        projectId: input.data.projectId ?? null,
        origin: input.data.origin,
      }),
    });
  });
  routes.delete('/account', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    if (!github) return apiError(c, 'not_found');
    await github.connections.disconnectAccount(user.id);
    return c.body(null, 204);
  });
  routes.get('/callback', async (c) => {
    const user = c.get('user');
    const home = appUrl.replace(/\/+$/, '');
    if (!user || !github || c.req.query('error')) return c.redirect(home, 302);
    const code = z.string().min(1).max(1000).safeParse(c.req.query('code'));
    const state = z.string().min(1).max(2000).safeParse(c.req.query('state'));
    if (!code.success || !state.success) return c.redirect(home, 302);
    try {
      const flow = await github.connections.finish(user.id, state.data, code.data);
      if (!flow) return c.redirect(home, 302);
      const destination = flow.projectId ? `/p/${flow.projectId}` : '/';
      const parameter = flow.origin === 'account' ? 'githubAccount' : 'github';
      return c.redirect(`${home}${destination}?${parameter}=connected`, 302);
    } catch (error) {
      if (!(error instanceof GithubError)) throw error;
      return c.redirect(`${home}/?github=failed`, 302);
    }
  });
  return routes;
}

export function githubProjectRoutes(db: AppDb, auth: Auth, github: GithubDeps | undefined) {
  const routes = new Hono<Env>();
  routes.use(sessionMiddleware(auth));
  async function owner(c: Context<Env>) {
    const user = c.get('user');
    if (!user) return { error: apiError(c, 'unauthorized') } as const;
    const project = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!project.success) return { error: apiError(c, 'not_found') } as const;
    const member = await withUser(db, user.id, (trx) =>
      trx
        .selectFrom('project_members')
        .select('role')
        .where('project_id', '=', project.data)
        .where('user_id', '=', user.id)
        .executeTakeFirst(),
    );
    if (!member) return { error: apiError(c, 'not_found') } as const;
    if (member.role !== 'owner') return { error: apiError(c, 'forbidden') } as const;
    if (!github) return { error: apiError(c, 'not_found') } as const;
    return { projectId: project.data, userId: user.id, github };
  }
  const upstream = (c: Context<Env>, error: unknown) => {
    if (!(error instanceof GithubError)) throw error;
    return apiError(c, error.status === 401 || error.status === 403 ? 'forbidden' : 'internal');
  };
  routes.get('/installations', async (c) => {
    const who = await owner(c);
    if ('error' in who) return who.error;
    const page = z.coerce.number().int().min(1).max(20).default(1).safeParse(c.req.query('page'));
    if (!page.success) return apiError(c, 'invalid_input');
    try {
      return c.json<GithubInstallations>(
        await who.github.connections.installations(who.userId, page.data),
      );
    } catch (error) {
      return upstream(c, error);
    }
  });
  routes.get('/repositories', async (c) => {
    const who = await owner(c);
    if ('error' in who) return who.error;
    const input = githubRepositoriesQuerySchema.safeParse(c.req.query());
    if (!input.success) return apiError(c, 'invalid_input');
    try {
      const repos = await who.github.connections.repositories(
        who.userId,
        input.data.installationId,
        input.data.search,
      );
      return c.json(
        repos.map((r) => ({
          id: r.id,
          path: r.full_name,
          name: r.name,
          url: r.html_url,
          defaultBranch: r.default_branch,
          provider: 'github',
        })),
      );
    } catch (error) {
      return upstream(c, error);
    }
  });
  routes.put('/repository', async (c) => {
    const who = await owner(c);
    if ('error' in who) return who.error;
    const input = githubRepositoryInputSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!input.success) return apiError(c, 'invalid_input');
    try {
      await who.github.connections.connect(
        who.projectId,
        who.userId,
        input.data.installationId,
        input.data.repositoryId,
      );
      return c.body(null, 204);
    } catch (error) {
      return upstream(c, error);
    }
  });
  return routes;
}

export function validGithubSignature(
  secret: string,
  bytes: Uint8Array,
  signature: string | undefined,
): boolean {
  if (!signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const given = Buffer.from(signature.slice(7), 'hex');
  const expected = createHmac('sha256', secret).update(bytes).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const webhookSchema = z.object({
  action: z.string().optional(),
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({ id: z.number().int().positive() }).optional(),
  repositories_removed: z.array(z.object({ id: z.number().int().positive() })).optional(),
});

export function githubWebhook(admin: Kysely<DB>, setup: GithubSetup | undefined) {
  const routes = new Hono();
  routes.use(bodyLimit({ maxSize: 64 * 1024, onError: (c) => apiError(c, 'too_large') }));
  routes.post('/', async (c) => {
    if (!setup) return apiError(c, 'not_found');
    const delivery = c.req.header('x-github-delivery');
    const event = c.req.header('x-github-event');
    if (!delivery || !/^[0-9a-f-]{36}$/i.test(delivery) || !event) return apiError(c, 'not_found');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > 64 * 1024) return apiError(c, 'too_large');
    if (!validGithubSignature(setup.webhookSecret, bytes, c.req.header('x-hub-signature-256')))
      return apiError(c, 'not_found');
    if (
      !['issues', 'pull_request', 'push', 'installation', 'installation_repositories'].includes(
        event,
      )
    )
      return c.body(null, 204);
    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    } catch {
      return apiError(c, 'invalid_input');
    }
    const input = webhookSchema.safeParse(json);
    if (!input.success) return apiError(c, 'invalid_input');
    await admin.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('github_webhook_deliveries')
        .values({ delivery_id: delivery })
        .onConflict((q) => q.column('delivery_id').doNothing())
        .returning('delivery_id')
        .executeTakeFirst();
      if (!inserted) return;
      const bindings = await trx
        .selectFrom('github_installations')
        .select(['project_id', 'repository_id'])
        .where('installation_id', '=', String(input.data.installation.id))
        .execute();
      const removed = new Set((input.data.repositories_removed ?? []).map((r) => String(r.id)));
      for (const binding of bindings) {
        const invalidated =
          (event === 'installation' && ['deleted', 'suspend'].includes(input.data.action ?? '')) ||
          (event === 'installation_repositories' &&
            input.data.action === 'removed' &&
            removed.has(binding.repository_id));
        if (invalidated) {
          await trx
            .deleteFrom('git_connections')
            .where('project_id', '=', binding.project_id)
            .where('provider', '=', 'github')
            .execute();
        } else if (
          input.data.repository &&
          binding.repository_id === String(input.data.repository.id)
        ) {
          await sql`select private.queue_git_sync(${binding.project_id})`.execute(trx);
        }
      }
      await trx
        .deleteFrom('github_webhook_deliveries')
        .where('received_at', '<', new Date(Date.now() - 30 * 86400_000))
        .execute();
    });
    return c.body(null, 204);
  });
  return routes;
}
