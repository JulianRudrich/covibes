import type { DB } from '@covibes/db';
import type { GitRepository } from '@covibes/shared';
import type { Kysely } from 'kysely';

import {
  GitlabError,
  type GitlabAccount,
  type GitlabClient,
  type GitlabTokens,
} from '@server/integrations/gitlab/client';
import { openToken, sealToken } from '@server/integrations/gitlab/crypto';
import type { GitlabSetup } from '@server/integrations/gitlab/setup';

// The connections of projects to GitLab as the server keeps them (spec 28a). Only this module
// reads and writes tokens: sealed in the database, open in memory for the one call that needs
// them. It works with the role covibes_admin; who may ask is checked by its callers.

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
   * Stores the connection an owner came back from GitLab with, in the place of an earlier one of
   * the project; the repository is picked afterwards.
   */
  async function connect(
    projectId: string,
    userId: string,
    account: GitlabAccount,
    tokens: GitlabTokens,
  ): Promise<void> {
    await admin.transaction().execute(async (trx) => {
      await trx.deleteFrom('git_connections').where('project_id', '=', projectId).execute();
      await trx
        .insertInto('git_connections')
        .values({
          project_id: projectId,
          base_url: setup.source.baseUrl,
          connected_by: userId,
          account_id: String(account.id),
          account_username: account.username,
          account_name: account.name,
        })
        .execute();
      await trx
        .insertInto('oauth_tokens')
        .values({ project_id: projectId, ...sealed(tokens) })
        .execute();
    });
  }

  /**
   * Access to the GitLab of a project's connection; undefined if the project has none (any more).
   * A token that is about to end is renewed first. The row of the tokens is locked for it, so
   * server and worker never renew at the same time: GitLab retires a refresh token with its first
   * use. A connection GitLab no longer accepts is removed.
   */
  async function access(projectId: string): Promise<GitAccess | undefined> {
    return await admin.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('oauth_tokens')
        .innerJoin('git_connections', 'git_connections.project_id', 'oauth_tokens.project_id')
        .select([
          'git_connections.base_url',
          'oauth_tokens.access_token',
          'oauth_tokens.refresh_token',
          'oauth_tokens.expires_at',
        ])
        .where('oauth_tokens.project_id', '=', projectId)
        .forUpdate('oauth_tokens')
        .executeTakeFirst();
      if (!row) return undefined;

      const holds = row.expires_at === null || row.expires_at.getTime() - now() > RENEW_BEFORE_MS;
      if (holds) {
        return { baseUrl: row.base_url, token: openToken(setup.tokenKey, row.access_token) };
      }
      // Tokens of another GitLab than the one this server is set up for cannot be renewed.
      const renewable = row.refresh_token !== null && row.base_url === setup.source.baseUrl;
      try {
        if (!renewable) throw new GitlabError(400, 'The connection has no way to renew its token');
        const tokens = await client.refresh(
          setup.source,
          openToken(setup.tokenKey, row.refresh_token ?? ''),
        );
        await trx
          .updateTable('oauth_tokens')
          .set({ ...sealed(tokens), updated_at: new Date(now()) })
          .where('project_id', '=', projectId)
          .execute();
        return { baseUrl: row.base_url, token: tokens.accessToken };
      } catch (error) {
        // GitLab refused the refresh token (revoked, or used up): the connection is over. Any
        // other failure, e.g. GitLab being away, leaves it for the next try.
        const refused =
          error instanceof GitlabError && (error.status === 400 || error.status === 401);
        if (!refused) throw error;
        await trx.deleteFrom('git_connections').where('project_id', '=', projectId).execute();
        return undefined;
      }
    });
  }

  /** Writes the repository the owner picked into the project's connection. */
  async function setRepository(projectId: string, repository: GitRepository): Promise<boolean> {
    const updated = await admin
      .updateTable('git_connections')
      .set({
        repository_id: String(repository.id),
        repository_path: repository.path,
        repository_name: repository.name,
        repository_url: repository.url,
        repository_default_branch: repository.defaultBranch,
      })
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    return updated.numUpdatedRows > 0n;
  }

  /**
   * Ends the connection of a project: tells GitLab that the token is no longer used, as far as
   * that works, and removes connection and tokens. Whether there was one.
   */
  async function disconnect(projectId: string): Promise<boolean> {
    const row = await admin
      .selectFrom('oauth_tokens')
      .innerJoin('git_connections', 'git_connections.project_id', 'oauth_tokens.project_id')
      .select(['git_connections.base_url', 'oauth_tokens.access_token'])
      .where('oauth_tokens.project_id', '=', projectId)
      .executeTakeFirst();
    if (row?.base_url === setup.source.baseUrl) {
      // The connection ends here in any case; GitLab lets a token it was not told about run out.
      await client
        .revoke(setup.source, openToken(setup.tokenKey, row.access_token))
        .catch(() => undefined);
    }
    const deleted = await admin
      .deleteFrom('git_connections')
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    return deleted.numDeletedRows > 0n;
  }

  return { connect, access, setRepository, disconnect };
}
