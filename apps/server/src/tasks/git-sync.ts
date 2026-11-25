import type { DB } from '@covibes/db';
import type { Task } from 'graphile-worker';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import { issueOfMergeRequest } from '@server/git/merge-request-issue';
import type { GitlabClient } from '@server/integrations/gitlab/client';
import type { GitConnections } from '@server/integrations/gitlab/connections';
import { readIssueStates } from '@server/integrations/gitlab/issues';
import {
  listOpenMergeRequests,
  MAX_OPEN_MERGE_REQUESTS,
} from '@server/integrations/gitlab/merge-requests';
import { notifyLive } from '@server/realtime/notifications';
import { RepositoryError } from '@server/integrations/git-host';
import type { RepositoryOperations } from '@server/integrations/repository-operations';

/** Name of the job the database queues to read a repository's state (migration 0035). */
export const GIT_SYNC_TASK = 'git_sync';

const payloadSchema = z.object({ projectId: z.uuid() });

export type GitSyncDeps = {
  operations?: RepositoryOperations | undefined;
  /** Role covibes_admin: the worker reads the project and stores what it read. */
  admin: Kysely<DB>;
  client: Pick<GitlabClient, 'get'>;
  /** The project's reading access (spec 28b). */
  connections: Pick<GitConnections, 'access'>;
  now?: () => number;
};

/** `gone`: the project has no repository (any more). */
export type GitSyncOutcome = 'gone' | 'done' | 'failed';

/** A commit as GitLab names it; the review of a merge request is for one. */
const COMMIT = /^[0-9a-f]{7,64}$/;

/**
 * Reads the state of a project's repository (spec 30a): whether the issues Covibes created are
 * open or closed. It reads with the project's reading access and changes nothing in GitLab. What
 * it reads is stored, with when; a reading that did not work is recorded as failed, and the
 * states of before stay. Everyone with the project open learns that it ran.
 *
 * It also looks at the open merge requests (spec 30b): one that belongs to an issue Covibes
 * created gets a review of the state its commits have now, unless that state has one; drafts
 * wait. Reviews of merge requests that are no longer open are marked so.
 */
export async function runGitSync(
  { admin, client, connections, operations, now = Date.now }: GitSyncDeps,
  payload: unknown,
): Promise<GitSyncOutcome> {
  const { projectId } = payloadSchema.parse(payload);
  const connection = await admin
    .selectFrom('git_connections')
    .select(['base_url', 'repository_id', 'repository_path'])
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
  // Whether a review of this repository still counts its merge request as open.
  const reviewed = await admin
    .selectFrom('git_reviews')
    .select('id')
    .where('project_id', '=', projectId)
    .where('base_url', '=', connection.base_url)
    .where('repository_id', '=', repositoryId)
    .where('mr_open', '=', true)
    .limit(1)
    .executeTakeFirst();

  let failed = false;
  // Without issues of its own and without reviews, the repository says nothing Covibes shows.
  if (numbers.length > 0 || reviewed) {
    try {
      const access = await connections.access(projectId);
      if (access) {
        const target = {
          baseUrl: access.baseUrl,
          repositoryId: Number(repositoryId),
          repositoryPath: connection.repository_path ?? '',
        };
        const states =
          numbers.length > 0
            ? operations
              ? await operations.issueStates(target, access.token, numbers)
              : await readIssueStates(client, target, access.token, numbers)
            : new Map<number, never>();
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

        const open = operations
          ? await operations.pulls(target, access.token)
          : await listOpenMergeRequests(client, target, access.token);
        const ofRepository = admin
          .updateTable('git_reviews')
          .where('project_id', '=', projectId)
          .where('base_url', '=', connection.base_url)
          .where('repository_id', '=', repositoryId);
        const openNumbers = open.map((mergeRequest) => String(mergeRequest.number));
        // The list is whole unless it is full; then one that is not in it may still be open.
        if (open.length < MAX_OPEN_MERGE_REQUESTS) {
          let closed = ofRepository.set({ mr_open: false }).where('mr_open', '=', true);
          if (openNumbers.length > 0) closed = closed.where('number', 'not in', openNumbers);
          await closed.execute();
        }
        if (openNumbers.length > 0) {
          // One that was opened again counts as open again.
          await ofRepository
            .set({ mr_open: true })
            .where('mr_open', '=', false)
            .where('number', 'in', openNumbers)
            .execute();
        }

        const ownIssues = new Set(numbers);
        for (const mergeRequest of open) {
          if (mergeRequest.draft || mergeRequest.sha === null) continue;
          if (!COMMIT.test(mergeRequest.sha)) continue;
          const issue = issueOfMergeRequest(mergeRequest, ownIssues);
          if (issue === null) continue;
          // The database starts it once per state, within the bounds of a day.
          await sql`
            select private.start_git_review(
              ${projectId}, ${mergeRequest.number}, ${mergeRequest.sha},
              ${mergeRequest.title || `!${String(mergeRequest.number)}`}, ${mergeRequest.url},
              ${mergeRequest.sourceBranch}, ${mergeRequest.author}, ${issue}, 'auto', null
            )`.execute(admin);
        }
      } else {
        failed = true;
      }
    } catch (error) {
      // GitLab is away or refuses: the states of before stay, and the next reading tries again.
      if (!(error instanceof RepositoryError)) throw error;
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
