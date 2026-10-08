import type { DB } from '@covibes/db';
import {
  gitRepositoryInputSchema,
  gitRepositorySearchSchema,
  projectIdSchema,
  type GitConnection,
  type GitConnectStart,
  type GitRepository,
  type GitReturn,
  type GitState,
} from '@covibes/shared';
import { Hono, type Context } from 'hono';
import type { Transaction } from 'kysely';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import { GitlabError, type GitlabClient } from '@server/integrations/gitlab/client';
import type { GitConnections } from '@server/integrations/gitlab/connections';
import { readState, signState } from '@server/integrations/gitlab/crypto';
import type { GitlabSetup } from '@server/integrations/gitlab/setup';

/** What the routes need to reach a GitLab; undefined on a server that is not set up for it. */
export type GitDeps = { setup: GitlabSetup; client: GitlabClient; connections: GitConnections };

type Env = { Variables: SessionVariables };

function membership(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .select('role')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

/** The connection of a project as members see it; no token is part of it. */
async function loadConnection(
  trx: Transaction<DB>,
  projectId: string,
): Promise<GitConnection | null> {
  const row = await trx
    .selectFrom('git_connections')
    .innerJoin('users', 'users.id', 'git_connections.connected_by')
    .select([
      'git_connections.base_url',
      'git_connections.account_username',
      'git_connections.account_name',
      'git_connections.connected_by',
      'git_connections.created_at',
      'git_connections.repository_id',
      'git_connections.repository_path',
      'git_connections.repository_name',
      'git_connections.repository_url',
      'git_connections.repository_default_branch',
      'users.name as connected_by_name',
    ])
    .where('git_connections.project_id', '=', projectId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    baseUrl: row.base_url,
    account: { username: row.account_username, name: row.account_name },
    connectedBy: { userId: row.connected_by, name: row.connected_by_name },
    connectedAt: row.created_at.toISOString(),
    repository:
      row.repository_id !== null &&
      row.repository_path !== null &&
      row.repository_name !== null &&
      row.repository_url !== null
        ? {
            id: Number(row.repository_id),
            path: row.repository_path,
            name: row.repository_name,
            url: row.repository_url,
            defaultBranch: row.repository_default_branch,
          }
        : null,
  };
}

/**
 * `/api/projects/:projectId/git` (spec 28a): the project's connection to GitLab. Members see it;
 * owners connect through OAuth, pick the repository and disconnect. The way back from GitLab ends
 * at `gitCallback`.
 */
export function gitRoutes(db: AppDb, auth: Auth, git: GitDeps | undefined) {
  const routes = new Hono<Env>();
  routes.use(sessionMiddleware(auth));

  /** The project and the person's role in it, for a route only owners may use. */
  async function owner(c: Context<Env>) {
    const user = c.get('user');
    if (!user) return { error: apiError(c, 'unauthorized') } as const;
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return { error: apiError(c, 'not_found') } as const;
    const member = await withUser(db, user.id, (trx) => membership(trx, projectId.data, user.id));
    if (!member) return { error: apiError(c, 'not_found') } as const;
    if (member.role !== 'owner') return { error: apiError(c, 'forbidden') } as const;
    return { userId: user.id, projectId: projectId.data } as const;
  }

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const state = await withUser(db, user.id, async (trx) => {
      const member = await membership(trx, projectId.data, user.id);
      if (!member) return undefined;
      return {
        available: git !== undefined,
        canManage: member.role === 'owner',
        connection: await loadConnection(trx, projectId.data),
      } satisfies GitState;
    });
    if (!state) return apiError(c, 'not_found');
    return c.json<GitState>(state);
  });

  /** Starts the OAuth flow: the address of GitLab's consent page, with a state for this person. */
  routes.post('/connect', async (c) => {
    const asked = await owner(c);
    if ('error' in asked) return asked.error;
    if (!git) return apiError(c, 'not_found');
    const state = signState(git.setup.tokenKey, asked);
    return c.json<GitConnectStart>({ url: git.client.authorizeUrl(git.setup.source, state) });
  });

  /** The repositories the connected account works in, to pick from. */
  routes.get('/repositories', async (c) => {
    const asked = await owner(c);
    if ('error' in asked) return asked.error;
    const search = gitRepositorySearchSchema.safeParse(c.req.query('search') ?? '');
    if (!search.success) return apiError(c, 'invalid_input');
    const access = await git?.connections.access(asked.projectId);
    if (!git || !access) return apiError(c, 'not_found');
    return c.json<GitRepository[]>(
      await git.client.repositories(access.baseUrl, access.token, search.data),
    );
  });

  /** Picks the repository; it must be one the connected account can reach. */
  routes.put('/repository', async (c) => {
    const asked = await owner(c);
    if ('error' in asked) return asked.error;
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = gitRepositoryInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');
    const access = await git?.connections.access(asked.projectId);
    if (!git || !access) return apiError(c, 'not_found');
    const repository = await git.client.repository(
      access.baseUrl,
      access.token,
      input.data.repositoryId,
    );
    if (!repository) return apiError(c, 'invalid_input');
    if (!(await git.connections.setRepository(asked.projectId, repository))) {
      return apiError(c, 'not_found');
    }
    return c.body(null, 204);
  });

  /** Ends the connection; GitLab is told that the token is no longer used. */
  routes.delete('/', async (c) => {
    const asked = await owner(c);
    if ('error' in asked) return asked.error;
    if (!git) return apiError(c, 'not_found');
    await git.connections.disconnect(asked.projectId);
    return c.body(null, 204);
  });

  return routes;
}

/**
 * `GET /api/git/callback` (spec 28a): where GitLab sends the person back to. The state must be
 * one this server signed for the person who is signed in, and that person must still be an owner
 * of its project. Then the code is traded for tokens and the connection is stored. The answer is
 * always a redirect into the app: to the project with how it ended, or to the start.
 */
export function gitCallback(db: AppDb, auth: Auth, appUrl: string, git: GitDeps | undefined) {
  const routes = new Hono<Env>();
  routes.use(sessionMiddleware(auth));
  const home = appUrl.replace(/\/+$/, '');

  routes.get('/', async (c) => {
    const user = c.get('user');
    const asked = git ? readState(git.setup.tokenKey, c.req.query('state') ?? '') : undefined;
    // Without a state of this server for this person there is no project to go back to.
    if (!git || !user || asked?.userId !== user.id) return c.redirect(`${home}/`, 302);
    const back = (outcome: GitReturn) =>
      c.redirect(`${home}/p/${asked.projectId}?git=${outcome}`, 302);

    const member = await withUser(db, user.id, (trx) => membership(trx, asked.projectId, user.id));
    if (member?.role !== 'owner') return c.redirect(`${home}/`, 302);
    if (c.req.query('error')) return back('denied');
    const code = c.req.query('code');
    if (!code) return back('failed');

    try {
      const tokens = await git.client.exchangeCode(git.setup.source, code);
      const account = await git.client.account(git.setup.source.baseUrl, tokens.accessToken);
      await git.connections.connect(asked.projectId, user.id, account, tokens);
      return back('connected');
    } catch (error) {
      // A code that was used before, or a GitLab that is away: nothing is stored.
      if (!(error instanceof GitlabError)) throw error;
      return back('failed');
    }
  });

  return routes;
}
