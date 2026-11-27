import type { DB } from '@covibes/db';
import type { GitAccount, GitRepository } from '@covibes/shared';
import type { Kysely } from 'kysely';

import {
  GitlabError,
  type GitlabAccount,
  type GitlabClient,
  type GitlabTokens,
} from '@server/integrations/gitlab/client';
import { openToken, sealToken } from '@server/integrations/gitlab/crypto';
import type { GitlabSetup } from '@server/integrations/gitlab/setup';

// The GitLab accounts of people and the repositories of projects as the server keeps them (specs
// 28a and 29a). A token belongs to a person. A project names the owner who picked its repository
// and is read with that person's access. Only this module reads and writes tokens: sealed in the
// database, open in memory for the one call that needs them. It works with the role
// covibes_admin; who may ask is checked by its callers.

/** An access token that ends within this time is renewed before it is used. */
const RENEW_BEFORE_MS = 60_000;

export type GitAccess = {
  /** Where the GitLab is. */
  baseUrl: string;
  /** An access token that holds for at least a minute. */
  token: string;
};

export type GitConnections = ReturnType<typeof createGitConnections>;

export function createGitConnections({
  admin,
  client,
  setup,
  now = Date.now,
}: {
  /** Role covibes_admin: no request of a user reaches the tokens. */
  admin: Kysely<DB>;
  client: GitlabClient;
  setup: GitlabSetup;
  now?: () => number;
}) {
  const seal = (token: string) => sealToken(setup.tokenKey, token);

  const sealed = (tokens: GitlabTokens) => ({
    access_token: seal(tokens.accessToken),
    refresh_token: tokens.refreshToken === null ? null : seal(tokens.refreshToken),
    expires_at: tokens.expiresAt,
    scope: tokens.scope,
  });

  /**
   * Stores the account a person came back from GitLab with, in the place of an earlier one. If it
   * is another account in GitLab than before, the repositories that person picked for projects are
   * removed: they were reached with the old account and are picked anew.
   */
  async function connectAccount(
    userId: string,
    account: GitlabAccount,
    tokens: GitlabTokens,
  ): Promise<void> {
    const fields = {
      base_url: setup.source.baseUrl,
      account_id: String(account.id),
      account_username: account.username,
      account_name: account.name,
      ...sealed(tokens),
    };
    await admin.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('git_accounts')
        .select(['account_id', 'base_url'])
        .where('user_id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      await trx
        .insertInto('git_accounts')
        .values({ user_id: userId, ...fields })
        .onConflict((conflict) =>
          conflict.column('user_id').doUpdateSet({ ...fields, updated_at: new Date(now()) }),
        )
        .execute();
      const same = before?.account_id === fields.account_id && before.base_url === fields.base_url;
      if (before && !same) {
        await trx
          .deleteFrom('git_connections')
          .where('connected_by', '=', userId)
          .where('provider', '=', 'gitlab')
          .execute();
      } else if (before) {
        // The same account may have another name by now.
        await trx
          .updateTable('git_connections')
          .set({ account_username: account.username, account_name: account.name })
          .where('connected_by', '=', userId)
          .where('provider', '=', 'gitlab')
          .execute();
      }
    });
  }

  /** The account a person connected, without its tokens; undefined if there is none. */
  async function account(userId: string): Promise<GitAccount | undefined> {
    const row = await admin
      .selectFrom('git_accounts')
      .select(['base_url', 'account_username', 'account_name'])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row
      ? { baseUrl: row.base_url, username: row.account_username, name: row.account_name }
      : undefined;
  }

  /**
   * Access to GitLab as a person; undefined if that person has no account (any more). A token
   * that is about to end is renewed first. The row of the account is locked for it, so server and
   * worker never renew at the same time: GitLab retires a refresh token with its first use. An
   * account GitLab no longer accepts is removed, and with it the projects it served.
   */
  async function accessOf(userId: string): Promise<GitAccess | undefined> {
    return await admin.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('git_accounts')
        .select(['base_url', 'access_token', 'refresh_token', 'expires_at'])
        .where('user_id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!row) return undefined;

      const holds = row.expires_at === null || row.expires_at.getTime() - now() > RENEW_BEFORE_MS;
      if (holds) {
        return { baseUrl: row.base_url, token: openToken(setup.tokenKey, row.access_token) };
      }
      // Tokens of another GitLab than the one this server is set up for cannot be renewed.
      const renewable = row.refresh_token !== null && row.base_url === setup.source.baseUrl;
      try {
        if (!renewable) throw new GitlabError(400, 'The account has no way to renew its token');
        const tokens = await client.refresh(
          setup.source,
          openToken(setup.tokenKey, row.refresh_token ?? ''),
        );
        await trx
          .updateTable('git_accounts')
          .set({ ...sealed(tokens), updated_at: new Date(now()) })
          .where('user_id', '=', userId)
          .execute();
        return { baseUrl: row.base_url, token: tokens.accessToken };
      } catch (error) {
        // GitLab refused the refresh token (revoked, or used up): the account is over. Any other
        // failure, e.g. GitLab being away, leaves it for the next try.
        const refused =
          error instanceof GitlabError && (error.status === 400 || error.status === 401);
        if (!refused) throw error;
        await trx.deleteFrom('git_accounts').where('user_id', '=', userId).execute();
        return undefined;
      }
    });
  }

  /**
   * Ends the account of a person: tells GitLab that the token is no longer used, as far as that
   * works, and removes the account. The projects whose repository that person picked are
   * disconnected with it. Whether there was an account.
   */
  async function disconnectAccount(userId: string): Promise<boolean> {
    const row = await admin
      .selectFrom('git_accounts')
      .select(['base_url', 'access_token'])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (row?.base_url === setup.source.baseUrl) {
      // The account ends here in any case; GitLab lets a token it was not told about run out.
      await client
        .revoke(setup.source, openToken(setup.tokenKey, row.access_token))
        .catch(() => undefined);
    }
    const deleted = await admin
      .deleteFrom('git_accounts')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return deleted.numDeletedRows > 0n;
  }

  /**
   * Makes a repository the one of a project, picked by an owner with an account; it takes the
   * place of an earlier one. Whether it was stored: not for a person without an account.
   */
  async function setRepository(
    projectId: string,
    userId: string,
    repository: GitRepository,
  ): Promise<boolean> {
    return await admin.transaction().execute(async (trx) => {
      const owner = await trx
        .selectFrom('git_accounts')
        .select(['base_url', 'account_id', 'account_username', 'account_name'])
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (!owner) return false;
      const fields = {
        provider: 'gitlab' as const,
        base_url: owner.base_url,
        connected_by: userId,
        account_id: owner.account_id,
        account_username: owner.account_username,
        account_name: owner.account_name,
        repository_id: String(repository.id),
        repository_path: repository.path,
        repository_name: repository.name,
        repository_url: repository.url,
        repository_default_branch: repository.defaultBranch,
      };
      await trx.deleteFrom('github_installations').where('project_id', '=', projectId).execute();
      await trx
        .insertInto('git_connections')
        .values({ project_id: projectId, ...fields })
        .onConflict((conflict) =>
          // A new pick is a new connection: it counts from now.
          conflict.column('project_id').doUpdateSet({ ...fields, created_at: new Date(now()) }),
        )
        .execute();
      return true;
    });
  }

  /**
   * Access to the GitLab of a project's repository, as the owner who picked it; undefined if the
   * project has none (any more).
   */
  async function access(projectId: string): Promise<GitAccess | undefined> {
    const row = await admin
      .selectFrom('git_connections')
      .select('connected_by')
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    return row ? await accessOf(row.connected_by) : undefined;
  }

  /** Removes the repository from a project; the account of who picked it stays. */
  async function disconnect(projectId: string): Promise<boolean> {
    const deleted = await admin
      .deleteFrom('git_connections')
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    return deleted.numDeletedRows > 0n;
  }

  return {
    connectAccount,
    account,
    accessOf,
    disconnectAccount,
    setRepository,
    access,
    disconnect,
  };
}
