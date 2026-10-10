import type { DB } from '@covibes/db';
import type { Task } from 'graphile-worker';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { GitlabError, type GitlabClient } from '@server/integrations/gitlab/client';
import type { GitConnections } from '@server/integrations/gitlab/connections';
import { readIssueStates } from '@server/integrations/gitlab/issues';
import { notifyLive } from '@server/realtime/notifications';

/** Name of the job the database queues to read a repository's state (migration 0035). */
export const GIT_SYNC_TASK = 'git_sync';

const payloadSchema = z.object({ projectId: z.uuid() });

export type GitSyncDeps = {
  /** Role covibes_admin: the worker reads the project and stores what it read. */
  admin: Kysely<DB>;
  client: Pick<GitlabClient, 'get'>;
  /** The project's reading access (spec 28b). */
  connections: Pick<GitConnections, 'access'>;
  now?: () => number;
};

/** `gone`: the project has no repository (any more). */
export type GitSyncOutcome = 'gone' | 'done' | 'failed';

/**
 * Reads the state of a project's repository (spec 30a): whether the issues Covibes created are
 * open or closed. It reads with the project's reading access and changes nothing in GitLab. What
 * it reads is stored, with when; a reading that did not work is recorded as failed, and the
 * states of before stay. Everyone with the project open learns that it ran.
 */
export async function runGitSync(
  { admin, client, connections, now = Date.now }: GitSyncDeps,
  payload: unknown,
): Promise<GitSyncOutcome> {
  const { projectId } = payloadSchema.parse(payload);
  const connection = await admin
    .selectFrom('git_connections')
    .select(['base_url', 'repository_id'])
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  if (!connection || connection.repository_id === null) return 'gone';
  const repositoryId = connection.repository_id;

  // The issues Covibes created in this repository; other issues are not its tasks.
  const created = await admin
    .selectFrom('git_actions')
    .innerJoin('git_requests', 'git_requests.id', 'git_actions.request_id')
    .select('git_actions.result_number')
    .where('git_actions.project_id', '=', projectId)
    .where('git_actions.kind', '=', 'issue')
    .where('git_actions.status', '=', 'done')
    .where('git_actions.result_number', 'is not', null)
    .where('git_requests.base_url', '=', connection.base_url)
    .where('git_requests.repository_id', '=', repositoryId)
    .execute();
  const numbers = [...new Set(created.map((action) => Number(action.result_number)))];

  let failed = false;
  if (numbers.length > 0) {
    try {
      const access = await connections.access(projectId);
      if (access) {
        const states = await readIssueStates(
          client,
          { baseUrl: access.baseUrl, repositoryId: Number(repositoryId) },
          access.token,
          numbers,
        );
        if (states.size > 0) {
          await admin
            .insertInto('git_issue_states')
            .values(
              [...states].map(([number, state]) => ({
                project_id: projectId,
                base_url: connection.base_url,
                repository_id: repositoryId,
                number: String(number),
                state,
                synced_at: new Date(now()),
              })),
            )
            .onConflict((conflict) =>
              conflict
                .columns(['project_id', 'base_url', 'repository_id', 'number'])
                .doUpdateSet((eb) => ({
                  state: eb.ref('excluded.state'),
                  synced_at: eb.ref('excluded.synced_at'),
                })),
            )
            .execute();
        }
      } else {
        failed = true;
      }
    } catch (error) {
      // GitLab is away or refuses: the states of before stay, and the next reading tries again.
      if (!(error instanceof GitlabError)) throw error;
      failed = true;
    }
  }

  const read = failed ? {} : { synced_at: new Date(now()) };
  await admin
    .insertInto('git_sync')
    .values({ project_id: projectId, failed, ...read })
    .onConflict((conflict) => conflict.column('project_id').doUpdateSet({ failed, ...read }))
    .execute();
  await notifyLive(admin, { kind: 'git', projectId });
  return failed ? 'failed' : 'done';
}

/** The task for Graphile Worker. */
export function gitSyncTask(deps: GitSyncDeps): Task {
  return async (payload) => {
    await runGitSync(deps, payload);
  };
}
