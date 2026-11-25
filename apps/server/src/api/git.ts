import type { DB } from '@covibes/db';
import {
  gitConnectInputSchema,
  gitRepositoryInputSchema,
  gitRepositorySearchSchema,
  projectIdSchema,
  type GitAccountState,
  type GitConnection,
  type GitConnectStart,
  type GitRepository,
  type GitState,
} from '@covibes/shared';
import { Hono, type Context } from 'hono';
import type { Kysely, Transaction } from 'kysely';

import { apiError } from '@server/api/errors';
import { addGitRequestRoutes } from '@server/api/git-requests';
import { addGitReviewRoutes } from '@server/api/git-reviews';
import { addGitSyncRoutes, loadSync } from '@server/api/git-sync';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type AppDb } from '@server/db/database';
import { GitlabError } from '@server/integrations/gitlab/client';
import { readState, signState } from '@server/integrations/gitlab/crypto';
import type { RepositoryServices } from '@server/integrations/repository-operations';

/** What the routes need to reach a GitLab; undefined on a server that is not set up for it. */
export type GitDeps = RepositoryServices;

type Env = { Variables: SessionVariables };

function membership(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .select('role')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

/** The repository of a project as members see it; no token is part of it. */
async function loadConnection(
  trx: Transaction<DB>,
  projectId: string,
): Promise<GitConnection | null> {
  const row = await trx
    .selectFrom('git_connections')
    .innerJoin('users', 'users.id', 'git_connections.connected_by')
    .select([
      'git_connections.base_url',
      'git_connections.provider',
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
  if (
    !row ||
    row.repository_id === null ||
    row.repository_path === null ||
    row.repository_name === null ||
    row.repository_url === null
  ) {
    return null;
  }
  return {
    provider: row.provider as 'github' | 'gitlab',
    baseUrl: row.base_url,
    account: { username: row.account_username, name: row.account_name },
    connectedBy: { userId: row.connected_by, name: row.connected_by_name },
    connectedAt: row.created_at.toISOString(),
    repository: {
      provider: row.provider as 'github' | 'gitlab',
      id: Number(row.repository_id),
      path: row.repository_path,
      name: row.repository_name,
      url: row.repository_url,
      defaultBranch: row.repository_default_branch,
    },
  };
}

/**
 * `/api/git/account` (spec 29a): the GitLab account of the person who is signed in. Everyone
 * connects their own through OAuth and disconnects it again. The way back from GitLab ends at
 * `gitCallback`.
 */
export function gitAccountRoutes(auth: Auth, services: GitDeps | undefined) {
  const git = services?.gitlab;
  const routes = new Hono<Env>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    return c.json<GitAccountState>({
      available: git !== undefined,
      account: (await git?.connections.account(user.id)) ?? null,
    });
  });

  /** Starts the OAuth flow: the address of GitLab's consent page, with a state for this person. */
  routes.post('/connect', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = gitConnectInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');
    if (!git) return apiError(c, 'not_found');
    const state = signState(git.setup.tokenKey, {
      userId: user.id,
      projectId: input.data.projectId ?? null,
      origin: input.data.origin,
    });
    return c.json<GitConnectStart>({ url: git.client.authorizeUrl(git.setup.source, state) });
  });

  /**
   * Ends the own account; GitLab is told that the token is no longer used. The projects whose
   * repository the person picked are disconnected with it.
   */
  routes.delete('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    if (!git) return apiError(c, 'not_found');
    await git.connections.disconnectAccount(user.id);
    return c.body(null, 204);
  });

  return routes;
}

/**
 * `/api/projects/:projectId/git` (specs 28a and 29a): the repository of a project. Members see
 * it; an owner with a GitLab account picks it and removes it again. Below it are the requests for
 * Git actions and their log (spec 29b, `git-requests.ts`).
 */
export function gitRoutes(
  db: AppDb,
  auth: Auth,
  git: GitDeps | undefined,
  documents: Pick<BoardDocuments, 'readPlanSections' | 'giveTaskIds' | 'readBoard' | 'readPlan'>,
  /** For the webhook (spec 30a): where the app is, and the role that keeps its secret. */
  webhook: { admin: Kysely<DB>; appUrl: string },
) {
  const routes = new Hono<Env>();
  routes.use(sessionMiddleware(auth));
  addGitSyncRoutes(routes, { db, ...webhook, tokenKey: git?.gitlab?.setup.tokenKey });
  addGitRequestRoutes(routes, {
    db,
    documents,
    git,
    connection: loadConnection,
  });
  addGitReviewRoutes(routes, { db, git, connection: loadConnection });

  /** The project and the person, for a route only owners may use. */
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

    const project = await withUser(db, user.id, async (trx) => {
      const member = await membership(trx, projectId.data, user.id);
      if (!member) return undefined;
      const connection = await loadConnection(trx, projectId.data);
      return {
        canManage: member.role === 'owner',
        connection,
        // A project without a repository has nothing to read.
        sync: connection ? await loadSync(trx, projectId.data) : null,
      };
    });
    if (!project) return apiError(c, 'not_found');
    return c.json<GitState>({
      available: git !== undefined,
      ...project,
      account: (await git?.connections.account(user.id, projectId.data)) ?? null,
    });
  });

  /** The repositories the owner's own account works in, to pick from. */
  routes.get('/repositories', async (c) => {
    const asked = await owner(c);
    if ('error' in asked) return asked.error;
    const search = gitRepositorySearchSchema.safeParse(c.req.query('search') ?? '');
    if (!search.success) return apiError(c, 'invalid_input');
    const access = await git?.gitlab?.connections.accessOf(asked.userId);
    // Without an account of their own the owner connects one first.
    if (!git?.gitlab || !access) return apiError(c, 'not_found');
    return c.json<GitRepository[]>(
      await git.gitlab.client.repositories(access.baseUrl, access.token, search.data),
    );
  });

  /**
   * Picks the repository of the project; it must be one the owner's own account can reach. The
   * owner who picks is the one whose access the agents read with from then on.
   */
  routes.put('/repository', async (c) => {
    const asked = await owner(c);
    if ('error' in asked) return asked.error;
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = gitRepositoryInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');
    const access = await git?.gitlab?.connections.accessOf(asked.userId);
    if (!git?.gitlab || !access) return apiError(c, 'not_found');
    const repository = await git.client.repository(
      access.baseUrl,
      access.token,
      input.data.repositoryId,
    );
    if (!repository) return apiError(c, 'invalid_input');
    if (!(await git.gitlab.connections.setRepository(asked.projectId, asked.userId, repository))) {
      return apiError(c, 'not_found');
    }
    return c.body(null, 204);
  });

  /** Removes the repository from the project; the account of who picked it stays. */
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
 * `GET /api/git/callback` (specs 28a and 29a): where GitLab sends the person back to. The state
 * must be one this server signed for the person who is signed in. Then the code is traded for
 * tokens and the account is stored. The answer is always a redirect into the app: to the project
 * or the start page the flow came from, with how it ended for the dialog it was started in.
 */
export function gitCallback(auth: Auth, appUrl: string, services: GitDeps | undefined) {
  const git = services?.gitlab;
  const routes = new Hono<Env>();
  routes.use(sessionMiddleware(auth));
  const home = appUrl.replace(/\/+$/, '');

  routes.get('/', async (c) => {
    const user = c.get('user');
    const asked = git ? readState(git.setup.tokenKey, c.req.query('state') ?? '') : undefined;
    // Without a state of this server for this person there is nothing to go back to.
    if (!git || !user || asked?.userId !== user.id) return c.redirect(`${home}/`, 302);
    const back = (outcome: 'connected' | 'denied' | 'failed') => {
      const page = asked.projectId ? `/p/${asked.projectId}` : '/';
      // The dialog "Repository" belongs to a project; without one the account dialog answers.
      const dialog = asked.origin === 'repository' && asked.projectId ? 'git' : 'gitAccount';
      return c.redirect(`${home}${page}?${dialog}=${outcome}`, 302);
    };

    if (c.req.query('error')) return back('denied');
    const code = c.req.query('code');
    if (!code) return back('failed');

    try {
      const tokens = await git.client.exchangeCode(git.setup.source, code);
      const account = await git.client.account(git.setup.source.baseUrl, tokens.accessToken);
      await git.connections.connectAccount(user.id, account, tokens);
      return back('connected');
    } catch (error) {
      // A code that was used before, or a GitLab that is away: nothing is stored.
      if (!(error instanceof GitlabError)) throw error;
      return back('failed');
    }
  });

  return routes;
}
