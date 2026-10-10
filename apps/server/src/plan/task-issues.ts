import type { DB } from '@covibes/db';
import type { RoadmapIssue } from '@covibes/shared';
import type { Kysely } from 'kysely';

/**
 * The issues of a project's tasks in its repository (specs 29b and 30a), by the id of the task:
 * the number and address Covibes got when it created the issue, and whether the issue is closed
 * as far as the repository's state was read. A project without a repository has none; issues of
 * a repository the project had before do not count. `db` decides what is visible: a member's
 * transaction, or the admin connection of the worker.
 */
export async function loadTaskIssues(
  db: Kysely<DB>,
  projectId: string,
): Promise<Map<string, RoadmapIssue>> {
  const rows = await db
    .selectFrom('git_actions')
    .innerJoin('git_requests', 'git_requests.id', 'git_actions.request_id')
    .innerJoin('git_connections', (join) =>
      join
        .onRef('git_connections.project_id', '=', 'git_actions.project_id')
        .onRef('git_connections.base_url', '=', 'git_requests.base_url')
        .onRef('git_connections.repository_id', '=', 'git_requests.repository_id'),
    )
    .leftJoin('git_issue_states', (join) =>
      join
        .onRef('git_issue_states.project_id', '=', 'git_actions.project_id')
        .onRef('git_issue_states.base_url', '=', 'git_requests.base_url')
        .onRef('git_issue_states.repository_id', '=', 'git_requests.repository_id')
        .onRef('git_issue_states.number', '=', 'git_actions.result_number'),
    )
    .select([
      'git_actions.task_id',
      'git_actions.result_number',
      'git_actions.result_url',
      'git_issue_states.state',
    ])
    .where('git_actions.project_id', '=', projectId)
    .where('git_actions.kind', '=', 'issue')
    .where('git_actions.status', '=', 'done')
    .execute();
  const issues = new Map<string, RoadmapIssue>();
  for (const row of rows) {
    if (row.task_id === null || row.result_number === null || row.result_url === null) continue;
    issues.set(row.task_id, {
      number: Number(row.result_number),
      url: row.result_url,
      closed: row.state === 'closed',
    });
  }
  return issues;
}

/**
 * The task an issue of the project's repository was created for (spec 30b): the id it carries in
 * the plan, or null if Covibes created no issue of that number there. Should two tasks carry the
 * number, the issue that was created last counts: it is the one the repository holds.
 */
export async function loadIssueTask(
  db: Kysely<DB>,
  projectId: string,
  number: number,
): Promise<string | null> {
  const row = await db
    .selectFrom('git_actions')
    .innerJoin('git_requests', 'git_requests.id', 'git_actions.request_id')
    .innerJoin('git_connections', (join) =>
      join
        .onRef('git_connections.project_id', '=', 'git_actions.project_id')
        .onRef('git_connections.base_url', '=', 'git_requests.base_url')
        .onRef('git_connections.repository_id', '=', 'git_requests.repository_id'),
    )
    .select('git_actions.task_id')
    .where('git_actions.project_id', '=', projectId)
    .where('git_actions.kind', '=', 'issue')
    .where('git_actions.status', '=', 'done')
    .where('git_actions.result_number', '=', String(number))
    .where('git_actions.task_id', 'is not', null)
    .orderBy('git_actions.executed_at', (order) => order.desc().nullsLast())
    .orderBy('git_actions.created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.task_id ?? null;
}
