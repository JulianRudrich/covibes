import type { DB } from '@covibes/db';
import {
  gitCommitPayloadSchema,
  gitIssueMark,
  gitIssuePayloadSchema,
  gitMergePayloadSchema,
  gitMergeRequestPayloadSchema,
  gitMilestonePayloadSchema,
  type GitActionError,
} from '@covibes/shared';
import type { Task } from 'graphile-worker';
import type { Kysely, Selectable } from 'kysely';
import { z } from 'zod';

import { RepositoryWriteError, type RepositoryWriters } from '@server/integrations/git-host';
import { GitlabError } from '@server/integrations/gitlab/client';
import type { GitAccess } from '@server/integrations/gitlab/connections';

/** Name of the job the database queues for an approved Git request (migration 0031). */
export const GIT_REQUEST_TASK = 'git_request';

const payloadSchema = z.object({ requestId: z.uuid() });

export type GitRequestDeps = {
  /** Role covibes_admin: the worker reads the request and writes the outcomes. */
  admin: Kysely<DB>;
  /** The access of a person to their GitLab; undefined without an account (any more). */
  accessOf: (userId: string) => Promise<GitAccess | undefined>;
  /** Writes to a repository with a person's token. */
  writers: RepositoryWriters;
  now?: () => number;
};

/** `gone`: nothing to run (decided otherwise, done before, or deleted with its project). */
export type GitRequestOutcome = 'gone' | 'done' | 'failed';

type Action = Selectable<DB['git_actions']>;

/** After these failures no further action is tried: the others would end the same way. */
const STOPS: readonly GitActionError[] = ['unreachable', 'no_account', 'not_found'];

/**
 * Runs an approved Git request (specs 29b to 29d): its actions in their order, with the access
 * of the person who approved it. Every action records its outcome, which is the log of Git
 * actions.
 *
 * - An action the host refuses fails with the reason, and the others go on. An issue whose
 *   milestone is not there, and a merge request whose commit did not work, fail without a call.
 * - If the host cannot be reached, the repository is gone or the approver has no account any
 *   more, the run stops: the action at hand fails, the rest waits for another approval.
 * - What is done is not done again. An issue that was started before (the worker ended in
 *   between) is first looked for by the mark in its description. A commit compares its files
 *   with its branch, and a merge request is looked up by its branch, before anything is created.
 */
export async function runGitRequest(
  { admin, accessOf, writers, now = Date.now }: GitRequestDeps,
  payload: unknown,
): Promise<GitRequestOutcome> {
  const { requestId } = payloadSchema.parse(payload);
  const request = await admin
    .selectFrom('git_requests')
    .selectAll()
    .where('id', '=', requestId)
    .executeTakeFirst();
  if (request?.status !== 'approved') return 'gone';
  const actions = await admin
    .selectFrom('git_actions')
    .selectAll()
    .where('request_id', '=', requestId)
    .orderBy('position')
    .execute();

  const fail = (action: Action, code: GitActionError, detail = '') =>
    admin
      .updateTable('git_actions')
      .set({ status: 'failed', error_code: code, error_detail: detail.slice(0, 300) })
      .where('id', '=', action.id)
      .execute();

  let access: GitAccess | undefined;
  let unreachable = '';
  try {
    access = request.decided_by ? await accessOf(request.decided_by) : undefined;
  } catch (error) {
    // Renewing the token did not reach GitLab; the account stays for the next try.
    if (!(error instanceof GitlabError)) throw error;
    unreachable = error.message;
  }
  // The account must be one of the GitLab the repository is in.
  const writer =
    access?.baseUrl === request.base_url
      ? writers(
          { baseUrl: request.base_url, repositoryId: Number(request.repository_id) },
          access.token,
        )
      : undefined;

  /** What an action made, or found. */
  const finish = (
    action: Action,
    result: { id?: number; number?: number; url?: string | null; existed?: boolean },
  ) =>
    admin
      .updateTable('git_actions')
      .set({
        status: 'done',
        result_id: result.id === undefined ? null : String(result.id),
        result_number: result.number === undefined ? null : String(result.number),
        result_url: result.url ?? null,
        result_existed: result.existed ?? false,
      })
      .where('id', '=', action.id)
      .execute();

  /** The milestones that are there, by their title, with the host's id of each. */
  const milestones = new Map<string, number>();
  /** The request commits files, and whether that commit is there: its merge request needs it. */
  const commits = actions.some((action) => action.kind === 'commit');
  let committed = false;
  for (const action of actions) {
    if (action.status === 'done') {
      if (action.kind === 'milestone' && action.result_id !== null) {
        milestones.set(action.title, Number(action.result_id));
      }
      if (action.kind === 'commit') committed = true;
      continue;
    }
    if (action.status === 'dropped') continue;
    if (!writer) {
      await fail(action, unreachable ? 'unreachable' : 'no_account', unreachable);
      break;
    }

    // Started before its call: if the worker ends now, the next run knows to look first.
    await admin
      .updateTable('git_actions')
      .set({
        status: 'started',
        attempts: action.attempts + 1,
        executed_by: request.decided_by,
        executed_at: new Date(now()),
      })
      .where('id', '=', action.id)
      .execute();
    try {
      if (action.kind === 'milestone') {
        const milestone = gitMilestonePayloadSchema.parse(action.payload);
        const written = await writer.ensureMilestone(milestone);
        milestones.set(milestone.title, written.id);
        await finish(action, written);
      } else if (action.kind === 'issue') {
        const issue = gitIssuePayloadSchema.parse(action.payload);
        const milestoneId = issue.milestone === null ? null : milestones.get(issue.milestone);
        if (milestoneId === undefined) {
          await fail(action, 'milestone');
          continue;
        }
        const mark = gitIssueMark(action.id);
        const before = action.attempts > 0 ? await writer.findIssue(mark) : undefined;
        const written =
          before ??
          (await writer.createIssue({
            title: issue.title,
            description: `${issue.description}

<!-- ${mark} -->`,
            milestoneId,
          }));
        await finish(action, written);
        // A new issue is open; its state is known without asking (spec 30a). One that an earlier
        // try created keeps the state that was read for it since.
        await admin
          .insertInto('git_issue_states')
          .values({
            project_id: request.project_id,
            base_url: request.base_url,
            repository_id: request.repository_id,
            number: String(written.number),
            state: 'opened',
          })
          .onConflict((conflict) =>
            before
              ? conflict.doNothing()
              : conflict
                  .columns(['project_id', 'base_url', 'repository_id', 'number'])
                  .doUpdateSet({ state: 'opened', synced_at: new Date() }),
          )
          .execute();
      } else if (action.kind === 'commit') {
        const commit = gitCommitPayloadSchema.parse(action.payload);
        const written = await writer.commitFiles(commit);
        committed = true;
        await finish(action, written);
      } else if (action.kind === 'merge_request') {
        const mergeRequest = gitMergeRequestPayloadSchema.parse(action.payload);
        if (commits && !committed) {
          await fail(action, 'blocked');
          continue;
        }
        await finish(action, await writer.openMergeRequest(mergeRequest));
      } else if (action.kind === 'merge') {
        const merge = gitMergePayloadSchema.parse(action.payload);
        await finish(action, await writer.mergeMergeRequest(merge));
      } else {
        await fail(action, 'invalid', 'The kind of action is unknown');
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        await fail(action, 'invalid', 'The action does not read');
        continue;
      }
      // Anything else is a fault of our own: the job fails and is tried again, and the action
      // stays started.
      if (!(error instanceof RepositoryWriteError)) throw error;
      // A token GitLab no longer takes: the account is as good as gone.
      const code = error.code === 'unauthorized' ? 'no_account' : error.code;
      await fail(action, code, error.detail);
      if (STOPS.includes(code)) break;
    }
  }

  const outcome = (await allDone(admin, requestId)) ? 'done' : 'failed';
  await admin
    .updateTable('git_requests')
    .set({ status: outcome, finished_at: new Date(now()) })
    .where('id', '=', requestId)
    .where('status', '=', 'approved')
    .execute();
  return outcome;
}

async function allDone(admin: Kysely<DB>, requestId: string): Promise<boolean> {
  const open = await admin
    .selectFrom('git_actions')
    .select('id')
    .where('request_id', '=', requestId)
    .where('status', 'not in', ['done', 'dropped'])
    .limit(1)
    .executeTakeFirst();
  return open === undefined;
}

/** The task for Graphile Worker. */
export function gitRequestTask(deps: GitRequestDeps): Task {
  return async (payload) => {
    await runGitRequest(deps, payload);
  };
}
