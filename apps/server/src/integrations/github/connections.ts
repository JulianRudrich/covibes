import { createHash } from 'node:crypto';

import type { DB } from '@covibes/db';
import type { GitRepository } from '@covibes/shared';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import type { RepositoryTarget } from '@server/integrations/git-host';
import {
  GithubError,
  githubAppJwt,
  githubRepositoryPath,
  GITHUB_WEB,
  type GithubClient,
  type GithubSetup,
  type GithubUserTokens,
} from '@server/integrations/github/client';
import { githubRepositorySchema, parseGithub } from '@server/integrations/github/repository';
import {
  openToken,
  readState,
  sealToken,
  signState,
  STATE_LIFETIME_MS,
  type FlowState,
} from '@server/integrations/gitlab/crypto';

const userSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable(),
});
const installationSchema = z.object({
  id: z.number().int().positive(),
  app_id: z.number().int().positive(),
  suspended_at: z.string().nullable(),
  account: z.object({ login: z.string() }).nullable(),
  permissions: z.object({
    contents: z.string().optional(),
    issues: z.string().optional(),
    pull_requests: z.string().optional(),
  }),
});
const installationListSchema = z.object({
  installations: z.array(installationSchema),
  total_count: z.number().int().nonnegative(),
});
const repositoriesSchema = z.object({
  repositories: z.array(githubRepositorySchema),
  total_count: z.number().int().nonnegative(),
});
const hashState = (state: string) => createHash('sha256').update(state).digest('hex');

export function createGithubConnections({
  admin,
  client,
  setup,
  now = Date.now,
}: {
  admin: Kysely<DB>;
  client: GithubClient;
  setup: GithubSetup;
  now?: () => number;
}) {
  const seal = (value: string) => sealToken(setup.tokenKey, value);
  const fields = (tokens: GithubUserTokens) => ({
    access_token: seal(tokens.token),
    refresh_token: tokens.refreshToken ? seal(tokens.refreshToken) : null,
    expires_at: tokens.expiresAt,
    refresh_expires_at: tokens.refreshExpiresAt,
  });

  async function account(userId: string) {
    const row = await admin
      .selectFrom('github_accounts')
      .select(['login', 'name'])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row ? { baseUrl: GITHUB_WEB, username: row.login, name: row.name } : undefined;
  }

  async function userToken(userId: string): Promise<string | undefined> {
    return admin.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('github_accounts')
        .selectAll()
        .where('user_id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!row) return undefined;
      if (row.expires_at === null || row.expires_at.getTime() > now() + 60_000)
        return openToken(setup.tokenKey, row.access_token);
      if (
        !row.refresh_token ||
        (row.refresh_expires_at && row.refresh_expires_at.getTime() <= now())
      ) {
        await trx.deleteFrom('github_accounts').where('user_id', '=', userId).execute();
        return undefined;
      }
      try {
        const tokens = await client.oauth(setup, {
          grant_type: 'refresh_token',
          refresh_token: openToken(setup.tokenKey, row.refresh_token),
        });
        await trx
          .updateTable('github_accounts')
          .set({ ...fields(tokens), updated_at: new Date(now()) })
          .where('user_id', '=', userId)
          .execute();
        return tokens.token;
      } catch (error) {
        if (!(error instanceof GithubError) || ![400, 401].includes(error.status)) throw error;
        await trx.deleteFrom('github_accounts').where('user_id', '=', userId).execute();
        return undefined;
      }
    });
  }

  async function authorizedInstallation(token: string, installationId: number) {
    if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new GithubError(400);
    // Only installations exposed to THIS App's authorized user may be attached to a project.
    for (let page = 1; page <= 20; page += 1) {
      const result = parseGithub(
        installationListSchema,
        await client.api('GET', `/user/installations?per_page=100&page=${String(page)}`, token),
      );
      const found = result.installations.find(
        (i) => i.id === installationId && String(i.app_id) === setup.appId,
      );
      if (found) {
        if (
          found.suspended_at ||
          !['contents', 'issues', 'pull_requests'].every(
            (key) => found.permissions[key as keyof typeof found.permissions] === 'write',
          )
        )
          throw new GithubError(
            403,
            'GitHub App installation does not grant the required permissions',
          );
        return found;
      }
      if (result.installations.length < 100) break;
    }
    throw new GithubError(403, 'GitHub installation is not available to this integration account');
  }

  async function repositories(
    userId: string,
    installationId: number,
    search = '',
    wantedId?: number,
  ) {
    const token = await userToken(userId);
    if (!token) throw new GithubError(401);
    await authorizedInstallation(token, installationId);
    const found = [];
    for (let page = 1; page <= 20; page += 1) {
      const result = parseGithub(
        repositoriesSchema,
        await client.api(
          'GET',
          `/user/installations/${String(installationId)}/repositories?per_page=100&page=${String(page)}`,
          token,
        ),
      );
      for (const repo of result.repositories) {
        if (!repo.permissions?.push || repo.archived || repo.disabled) continue;
        if (
          wantedId !== undefined
            ? repo.id === wantedId
            : repo.full_name.toLowerCase().includes(search.toLowerCase())
        ) {
          // Re-parse the full name through the actual API path validator before storing it.
          githubRepositoryPath(repo.full_name);
          if (repo.html_url !== `${GITHUB_WEB}/${repo.full_name}`) throw new GithubError(502);
          found.push(repo);
        }
      }
      if (wantedId !== undefined && found.length > 0) return found;
      if (found.length >= 20 && wantedId === undefined) return found.slice(0, 20);
      if (result.repositories.length < 100) return found;
    }
    if (wantedId !== undefined)
      throw new GithubError(403, 'Repository access could not be established');
    return found.slice(0, 20);
  }

  async function accessOf(userId: string, target: RepositoryTarget, projectId?: string) {
    if (target.baseUrl !== GITHUB_WEB) return undefined;
    let query = admin
      .selectFrom('github_installations')
      .innerJoin('git_connections', 'git_connections.project_id', 'github_installations.project_id')
      .select([
        'github_installations.installation_id',
        'github_installations.project_id',
        'git_connections.repository_path',
      ])
      .where('github_installations.repository_id', '=', String(target.repositoryId))
      .where('git_connections.provider', '=', 'github');
    if (projectId) query = query.where('github_installations.project_id', '=', projectId);
    const binding = await query.executeTakeFirst();
    if (!binding || binding.repository_path !== target.repositoryPath) return undefined;
    const allowed = await repositories(
      userId,
      Number(binding.installation_id),
      '',
      target.repositoryId,
    );
    if (!allowed.some((r) => r.id === target.repositoryId && r.full_name === target.repositoryPath))
      return undefined;
    // A fresh JWT lookup also detects suspended/deleted installations before issuing a write token.
    const install = parseGithub(
      installationSchema,
      await client.api(
        'GET',
        `/app/installations/${binding.installation_id}`,
        githubAppJwt(setup, now()),
      ),
    );
    if (String(install.app_id) !== setup.appId || install.suspended_at) throw new GithubError(403);
    const token = await client.installationToken(
      setup,
      Number(binding.installation_id),
      target.repositoryId,
    );
    return { baseUrl: GITHUB_WEB, token };
  }

  return {
    account,
    userToken,
    repositories,
    accessOf,
    async installations(userId: string, page = 1) {
      if (!Number.isSafeInteger(page) || page < 1 || page > 20) throw new GithubError(400);
      const token = await userToken(userId);
      if (!token) throw new GithubError(401);
      const result = parseGithub(
        installationListSchema,
        await client.api('GET', `/user/installations?per_page=100&page=${String(page)}`, token),
      );
      return {
        installations: result.installations
          .filter((i) => String(i.app_id) === setup.appId && !i.suspended_at)
          .map((i) => ({ id: i.id, account: i.account?.login ?? '', permissions: i.permissions })),
        more: page * 100 < result.total_count,
      };
    },
    async start(userId: string, flow: Omit<FlowState, 'userId'>) {
      const state = signState(`${setup.tokenKey}:github-integration`, { ...flow, userId }, now());
      await admin
        .deleteFrom('github_oauth_states')
        .where('expires_at', '<=', new Date(now()))
        .execute();
      await admin
        .insertInto('github_oauth_states')
        .values({
          state_hash: hashState(state),
          user_id: userId,
          expires_at: new Date(now() + STATE_LIFETIME_MS),
        })
        .execute();
      const query = new URLSearchParams({
        client_id: setup.clientId,
        redirect_uri: setup.redirectUri,
        state,
      });
      return `${GITHUB_WEB}/login/oauth/authorize?${query.toString()}`;
    },
    async finish(userId: string, state: string, code: string): Promise<FlowState | undefined> {
      const flow = readState(`${setup.tokenKey}:github-integration`, state, now());
      if (!flow || flow.userId !== userId) return undefined;
      const used = await admin
        .deleteFrom('github_oauth_states')
        .where('state_hash', '=', hashState(state))
        .where('user_id', '=', userId)
        .where('expires_at', '>', new Date(now()))
        .returning('user_id')
        .executeTakeFirst();
      if (!used) return undefined;
      const tokens = await client.oauth(setup, { code, redirect_uri: setup.redirectUri });
      const user = parseGithub(userSchema, await client.api('GET', '/user', tokens.token));
      await admin.transaction().execute(async (trx) => {
        const old = await trx
          .selectFrom('github_accounts')
          .select('account_id')
          .where('user_id', '=', userId)
          .forUpdate()
          .executeTakeFirst();
        if (old && old.account_id !== String(user.id))
          await trx
            .deleteFrom('git_connections')
            .where('connected_by', '=', userId)
            .where('provider', '=', 'github')
            .execute();
        await trx
          .insertInto('github_accounts')
          .values({
            user_id: userId,
            account_id: String(user.id),
            login: user.login,
            name: user.name ?? '',
            ...fields(tokens),
          })
          .onConflict((c) =>
            c.column('user_id').doUpdateSet({
              account_id: String(user.id),
              login: user.login,
              name: user.name ?? '',
              ...fields(tokens),
              updated_at: new Date(now()),
            }),
          )
          .execute();
      });
      return flow;
    },
    async disconnectAccount(userId: string) {
      // Local removal immediately revokes Covibes' authority and disconnects its project bindings.
      await admin.deleteFrom('github_accounts').where('user_id', '=', userId).execute();
    },
    async connect(
      projectId: string,
      userId: string,
      installationId: number,
      repositoryId: number,
    ): Promise<GitRepository> {
      const repo = (await repositories(userId, installationId, '', repositoryId)).find(
        (r) => r.id === repositoryId,
      );
      const owner = await account(userId);
      if (!repo || !owner) throw new GithubError(403);
      const accountRow = await admin
        .selectFrom('github_accounts')
        .select('account_id')
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow();
      await admin.transaction().execute(async (trx) => {
        const member = await trx
          .selectFrom('project_members')
          .select('role')
          .where('project_id', '=', projectId)
          .where('user_id', '=', userId)
          .forUpdate()
          .executeTakeFirst();
        if (member?.role !== 'owner') throw new GithubError(403);
        // A replacement invalidates pending requests through the existing delete trigger.
        await trx.deleteFrom('git_connections').where('project_id', '=', projectId).execute();
        await trx
          .insertInto('git_connections')
          .values({
            project_id: projectId,
            provider: 'github',
            base_url: GITHUB_WEB,
            connected_by: userId,
            account_id: accountRow.account_id,
            account_username: owner.username,
            account_name: owner.name,
            repository_id: String(repo.id),
            repository_path: repo.full_name,
            repository_name: repo.name,
            repository_url: repo.html_url,
            repository_default_branch: repo.default_branch,
          })
          .execute();
        await trx
          .insertInto('github_installations')
          .values({
            project_id: projectId,
            user_id: userId,
            installation_id: String(installationId),
            repository_id: String(repo.id),
          })
          .execute();
      });
      return {
        id: repo.id,
        path: repo.full_name,
        name: repo.name,
        url: repo.html_url,
        defaultBranch: repo.default_branch,
        provider: 'github',
      };
    },
  };
}

export type GithubConnections = ReturnType<typeof createGithubConnections>;
