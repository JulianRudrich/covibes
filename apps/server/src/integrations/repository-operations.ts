import type { DB } from '@covibes/db';
import type { Kysely } from 'kysely';

import {
  RepositoryError,
  type RepositoryTarget,
  type RepositoryWriters,
  type RepositoryPullRequest,
} from '@server/integrations/git-host';
import { createGithubClient, GITHUB_WEB } from '@server/integrations/github/client';
import { createGithubConnections } from '@server/integrations/github/connections';
import { githubRepositoryOperations } from '@server/integrations/github/repository';
import { githubSetup, type GithubEnv } from '@server/integrations/github/setup';
import { githubWriter } from '@server/integrations/github/writer';
import { listBlobs } from '@server/integrations/gitlab/blobs';
import { createGitlabClient } from '@server/integrations/gitlab/client';
import { createGitConnections, type GitAccess } from '@server/integrations/gitlab/connections';
import { readIssueStates } from '@server/integrations/gitlab/issues';
import {
  listOpenMergeRequests,
  readMergeRequest,
} from '@server/integrations/gitlab/merge-requests';
import { repositoryReaders } from '@server/integrations/gitlab/repository';
import { gitlabSetup } from '@server/integrations/gitlab/setup';
import { gitlabWriter } from '@server/integrations/gitlab/writer';
import {
  RepositoryGoneError,
  type RepositoryReaders,
} from '@server/integrations/repository-reader';

/** Provider methods operate on domain objects, never on another provider's HTTP dialect. */
export type RepositoryOperations = {
  blobs(
    target: RepositoryTarget,
    token: string,
    ref: string,
    folders: readonly string[],
  ): Promise<Map<string, string> | undefined>;
  pull(
    target: RepositoryTarget,
    token: string,
    number: number,
  ): Promise<RepositoryPullRequest | undefined>;
  pulls(target: RepositoryTarget, token: string): Promise<RepositoryPullRequest[]>;
  issueStates(
    target: RepositoryTarget,
    token: string,
    numbers: readonly number[],
  ): Promise<Map<number, 'opened' | 'closed'>>;
};

export function createRepositoryServices({
  admin,
  env,
  gitlabFetch,
  githubFetch,
}: {
  admin: Kysely<DB>;
  env: Parameters<typeof gitlabSetup>[0] & GithubEnv;
  gitlabFetch?: typeof fetch;
  githubFetch?: typeof fetch;
}) {
  const labSetup = gitlabSetup(env);
  const hubSetup = githubSetup(env);
  if (!labSetup && !hubSetup) return undefined;
  const labClient = createGitlabClient(gitlabFetch);
  const hubClient = createGithubClient(githubFetch);
  const lab = labSetup
    ? {
        setup: labSetup,
        client: labClient,
        connections: createGitConnections({ admin, client: labClient, setup: labSetup }),
      }
    : undefined;
  const hub = hubSetup
    ? {
        setup: hubSetup,
        client: hubClient,
        connections: createGithubConnections({ admin, client: hubClient, setup: hubSetup }),
      }
    : undefined;

  async function connection(projectId: string) {
    return admin
      .selectFrom('git_connections')
      .selectAll()
      .where('project_id', '=', projectId)
      .executeTakeFirst();
  }
  const targetOf = (row: {
    base_url: string;
    repository_id: string | null;
    repository_path: string | null;
    project_id: string;
  }): RepositoryTarget => ({
    baseUrl: row.base_url,
    repositoryId: Number(row.repository_id),
    repositoryPath: row.repository_path ?? '',
    projectId: row.project_id,
  });

  async function accessOf(
    userId: string,
    target?: RepositoryTarget,
  ): Promise<GitAccess | undefined> {
    if (!target) return lab?.connections.accessOf(userId);
    if (!target.projectId) return undefined;
    const row = await connection(target.projectId);
    if (
      !row ||
      row.base_url !== target.baseUrl ||
      row.repository_id !== String(target.repositoryId) ||
      row.repository_path !== target.repositoryPath
    )
      return undefined;
    const member = await admin
      .selectFrom('project_members')
      .select(['role', 'can_approve_git'])
      .where('project_id', '=', target.projectId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!(member?.role === 'owner' || (member?.role === 'editor' && member.can_approve_git)))
      return undefined;
    if (row.provider === 'github')
      return hub?.connections.accessOf(userId, target, target.projectId);
    if (row.base_url !== lab?.setup.source.baseUrl) return undefined;
    return lab.connections.accessOf(userId);
  }

  const connections = {
    async account(userId: string, projectId?: string) {
      const row = projectId ? await connection(projectId) : undefined;
      if (row?.provider === 'github') return hub?.connections.account(userId);
      return lab?.connections.account(userId);
    },
    accessOf,
    async access(projectId: string): Promise<GitAccess | undefined> {
      const row = await connection(projectId);
      if (!row) return undefined;
      return row.provider === 'github'
        ? hub?.connections.accessOf(row.connected_by, targetOf(row), projectId)
        : row.base_url === lab?.setup.source.baseUrl
          ? lab.connections.access(projectId)
          : undefined;
    },
    async disconnect(projectId: string) {
      const result = await admin
        .deleteFrom('git_connections')
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      return result.numDeletedRows > 0n;
    },
  };

  const hubOperations = (target: RepositoryTarget, token: string) => {
    if (!hub) throw new RepositoryError(503, 'GitHub integration is unavailable');
    return githubRepositoryOperations(hubClient, target, token);
  };
  const githubTarget = (target: RepositoryTarget): boolean => {
    if (target.baseUrl === GITHUB_WEB && hub) return true;
    if (lab && target.baseUrl === lab.setup.source.baseUrl) return false;
    throw new RepositoryError(403, 'Repository target is outside the configured provider');
  };
  const operations: RepositoryOperations = {
    blobs: (target, token, ref, folders) =>
      githubTarget(target)
        ? hubOperations(target, token).blobs(ref, folders)
        : listBlobs(labClient, target, token, ref, folders),
    pull: (target, token, number) =>
      githubTarget(target)
        ? hubOperations(target, token).pull(number)
        : readMergeRequest(labClient, target, token, number),
    pulls: (target, token) =>
      githubTarget(target)
        ? hubOperations(target, token).pulls()
        : listOpenMergeRequests(labClient, target, token),
    issueStates: (target, token, numbers) =>
      githubTarget(target)
        ? hubOperations(target, token).issueStates(numbers)
        : readIssueStates(labClient, target, token, numbers),
  };
  const labReaders = lab
    ? repositoryReaders({ admin, client: labClient, connections: lab.connections })
    : undefined;
  const readers: RepositoryReaders = async (projectId) => {
    const row = await connection(projectId);
    if (!row) return undefined;
    if (row.provider !== 'github') return labReaders?.(projectId);
    if (!hub) return undefined;
    const meta = {
      path: row.repository_path ?? '',
      name: row.repository_name ?? '',
      defaultBranch: row.repository_default_branch,
    };
    // Each tool call rechecks access rather than retaining an installation token through a session.
    const current = async () => {
      const access = await connections.access(projectId);
      if (!access) throw new RepositoryGoneError();
      const fresh = await connection(projectId);
      if (!fresh || fresh.provider !== 'github' || fresh.repository_id !== row.repository_id)
        throw new RepositoryGoneError();
      return hubOperations(targetOf(fresh), access.token).reader();
    };
    return {
      repository: meta,
      tree: async (...args) => (await current()).tree(...args),
      file: async (...args) => (await current()).file(...args),
      issues: async (...args) => (await current()).issues(...args),
      issue: async (...args) => (await current()).issue(...args),
      mergeRequests: async (...args) => (await current()).mergeRequests(...args),
      mergeRequest: async (...args) => (await current()).mergeRequest(...args),
    };
  };
  const writers: RepositoryWriters = (target, token) =>
    githubTarget(target)
      ? githubWriter(hubClient, target, token)
      : gitlabWriter(labClient, target, token);
  return { gitlab: lab, github: hub, client: labClient, connections, operations, readers, writers };
}

export type RepositoryServices = NonNullable<ReturnType<typeof createRepositoryServices>>;
