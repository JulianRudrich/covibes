import { randomBytes } from 'node:crypto';

import type { DB } from '@covibes/db';
import {
  buildIssueActions,
  buildMergeRequestActions,
  MAX_GIT_ISSUES,
  mergeRequestBranch,
  readEdges,
  readNodes,
  readPlan,
  readPlanSections,
  readRoadmap,
  withAssignees,
  type GitActionDraft,
  type GitRequestKind,
} from '@covibes/shared';
import { sql, type Kysely } from 'kysely';

import { gatherPackageInput, type PackageReaders } from '@server/api/package';
import type { BoardAccess } from '@server/collab/board-client';
import { comparePackage, packageDiffers } from '@server/git/package-compare';
import { GitlabError, type GitlabClient } from '@server/integrations/gitlab/client';
import type { GitConnections } from '@server/integrations/gitlab/connections';
import { readMergeRequest } from '@server/integrations/gitlab/merge-requests';
import { loadAssignees } from '@server/plan/assignees';
import { readStoredPlan } from '@server/plan/stored-plan';

// What an agent proposes for the repository (spec 29e): the same Git requests people make in the
// dialogs, built in the worker. Each one waits for approval; nothing here changes the repository.

/** `no_repository`: the project lost its repository while the agent worked. */
export type IssuesProposal =
  | { outcome: 'requested'; issues: number; milestones: number }
  /** Every task has an issue, or one waits; the plan names no tasks; no such milestone. */
  | { outcome: 'none' | 'no_tasks' | 'no_milestone' | 'no_repository' };

export type PackageProposal =
  | { outcome: 'requested'; added: number; changed: number }
  | {
      outcome:
        | 'no_plan'
        | 'too_large'
        | 'no_branch'
        | 'unreachable'
        /** The repository holds the package already. */
        | 'up_to_date'
        /** A request for the package waits already. */
        | 'waiting'
        | 'no_repository';
    };

export type MergeProposal =
  | { outcome: 'requested'; number: number; title: string }
  | { outcome: 'not_found' | 'draft' | 'not_open' | 'unreachable' | 'waiting' | 'no_repository' };

/** What an agent can ask for in the repository of one project. */
export type AgentGitRequests = {
  /** Which repository it is, for the tools' answers. */
  repository: { path: string };
  /** Issues for the plan's tasks that have none; of one milestone if its number is given. */
  issues(options: { milestone?: number }): Promise<IssuesProposal>;
  /** The plan package as a merge request, as it is right now. */
  planMergeRequest(): Promise<PackageProposal>;
  /** The merging of an open merge request. */
  merge(number: number): Promise<MergeProposal>;
};

export type AgentGitRequestsFor = (
  projectId: string,
  agentKey: string,
) => Promise<AgentGitRequests | undefined>;

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Gives what an agent can ask for in a project's repository; nothing for a project without one.
 * The worker reads the plan as it was last stored and the boards as they are.
 */
export function agentGitRequests({
  admin,
  client,
  connections,
  boards,
  now = () => new Date(),
}: {
  /** Role covibes_admin: the worker reads the project and stores the request. */
  admin: Kysely<DB>;
  client: Pick<GitlabClient, 'get'>;
  /** The project's reading access, with which the repository is looked at. */
  connections: Pick<GitConnections, 'access'>;
  boards: BoardAccess;
  now?: () => Date;
}): AgentGitRequestsFor {
  const readers: PackageReaders = {
    readPlan: (projectId) => readStoredPlan(admin, projectId, (doc) => readPlan(doc)),
    readBoard: (boardId) =>
      boards.withBoard(boardId, (doc) => ({ nodes: readNodes(doc), edges: readEdges(doc) })),
  };

  return async (projectId, agentKey) => {
    const connection = await admin
      .selectFrom('git_connections')
      .select([
        'base_url',
        'repository_id',
        'repository_path',
        'repository_url',
        'repository_default_branch',
      ])
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    if (
      !connection ||
      connection.repository_id === null ||
      connection.repository_path === null ||
      connection.repository_url === null
    ) {
      return undefined;
    }
    const repository = {
      id: Number(connection.repository_id),
      path: connection.repository_path,
      url: connection.repository_url,
      defaultBranch: connection.repository_default_branch,
    };

    /**
     * Stores a request in the agent's name. `taken`: the database refused it, since what it asks
     * for is asked for already. `gone`: the project has no repository any more.
     */
    async function store(
      kind: GitRequestKind,
      actions: readonly GitActionDraft[],
    ): Promise<'stored' | 'taken' | 'gone'> {
      try {
        await sql`select private.insert_git_request(
          ${projectId}, ${kind}, ${JSON.stringify(actions)}::jsonb, null, ${agentKey}
        )`.execute(admin);
        return 'stored';
      } catch (error) {
        const state = sqlState(error);
        if (state === '23505') return 'taken';
        if (state === 'P0002') return 'gone';
        throw error;
      }
    }

    return {
      repository: { path: repository.path },

      async issues({ milestone }) {
        const project = await admin
          .selectFrom('projects')
          .select(['name', 'language'])
          .where('id', '=', projectId)
          .executeTakeFirst();
        if (!project) return { outcome: 'no_repository' };
        const roadmap = withAssignees(
          readRoadmap(await readStoredPlan(admin, projectId, (doc) => readPlanSections(doc))),
          await loadAssignees(admin, projectId),
        );
        const milestones =
          milestone === undefined
            ? roadmap.milestones
            : roadmap.milestones.filter((entry) => entry.number === milestone);
        if (milestone !== undefined && milestones.length === 0) return { outcome: 'no_milestone' };
        // A task without an id is one the server has not counted yet; it gets its issue later.
        const tasks = milestones.flatMap((entry) => entry.tasks.flatMap((task) => task.id ?? []));
        if (tasks.length === 0) return { outcome: 'no_tasks' };

        const taken = await admin
          .selectFrom('git_actions')
          .innerJoin('git_requests', 'git_requests.id', 'git_actions.request_id')
          .select('git_actions.task_id')
          .where('git_actions.project_id', '=', projectId)
          .where('git_actions.kind', '=', 'issue')
          .where('git_actions.status', '<>', 'dropped')
          .where('git_requests.base_url', '=', connection.base_url)
          .where('git_requests.repository_id', '=', String(repository.id))
          .execute();
        const has = new Set(taken.map((action) => action.task_id));
        const free = tasks.filter((id) => !has.has(id)).slice(0, MAX_GIT_ISSUES);
        if (free.length === 0) return { outcome: 'none' };

        const actions = buildIssueActions({
          projectName: project.name,
          language: project.language === 'en' ? 'en' : 'de',
          roadmap,
          taskIds: new Set(free),
          repository,
        });
        const stored = await store('issues', actions);
        if (stored === 'gone') return { outcome: 'no_repository' };
        // Someone asked for one of these tasks in the same moment.
        if (stored === 'taken') return { outcome: 'none' };
        return {
          outcome: 'requested',
          issues: actions.filter((action) => action.kind === 'issue').length,
          milestones: actions.filter((action) => action.kind === 'milestone').length,
        };
      },

      async planMergeRequest() {
        const compared = await comparePackage(
          await gatherPackageInput(admin, readers, projectId),
          repository,
          { client, access: () => connections.access(projectId) },
        );
        if (compared.problem !== null) return { outcome: compared.problem };
        if (!packageDiffers(compared)) return { outcome: 'up_to_date' };
        const stored = await store(
          'merge_request',
          buildMergeRequestActions({
            projectName: compared.projectName,
            language: compared.language,
            files: compared.files,
            branch: mergeRequestBranch(now(), randomBytes(3).toString('hex')),
            targetBranch: compared.targetBranch,
            stale: compared.stale,
          }),
        );
        if (stored === 'gone') return { outcome: 'no_repository' };
        if (stored === 'taken') return { outcome: 'waiting' };
        const count = (state: string) =>
          compared.states.filter((file) => file.state === state).length;
        return { outcome: 'requested', added: count('new'), changed: count('changed') };
      },

      async merge(number) {
        let found: Awaited<ReturnType<typeof readMergeRequest>>;
        try {
          const access = await connections.access(projectId);
          if (!access) return { outcome: 'unreachable' };
          found = await readMergeRequest(
            client,
            { baseUrl: access.baseUrl, repositoryId: repository.id },
            access.token,
            number,
          );
        } catch (error) {
          if (!(error instanceof GitlabError)) throw error;
          return { outcome: 'unreachable' };
        }
        if (!found) return { outcome: 'not_found' };
        if (found.state !== 'opened') return { outcome: 'not_open' };
        if (found.draft) return { outcome: 'draft' };
        const stored = await store('merge', [
          {
            kind: 'merge',
            payload: {
              title: `!${String(found.number)} ${found.title}`.slice(0, 255),
              number: found.number,
              sha: found.sha,
            },
          },
        ]);
        if (stored === 'gone') return { outcome: 'no_repository' };
        if (stored === 'taken') return { outcome: 'waiting' };
        return { outcome: 'requested', number: found.number, title: found.title };
      },
    };
  };
}
