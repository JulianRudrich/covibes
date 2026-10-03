import type { DB } from '@covibes/db';
import type { RoadmapAssignee } from '@covibes/shared';
import type { Kysely } from 'kysely';

/**
 * Who took which task of a project (spec 26b), by the id of the task. Someone who left the project
 * has no task of it any more. `db` decides what is visible: a member's transaction, or the admin
 * connection of the worker.
 */
export async function loadAssignees(
  db: Kysely<DB>,
  projectId: string,
): Promise<Map<string, RoadmapAssignee>> {
  const rows = await db
    .selectFrom('tasks')
    .innerJoin('project_members', (join) =>
      join
        .onRef('project_members.project_id', '=', 'tasks.project_id')
        .onRef('project_members.user_id', '=', 'tasks.assignee_id'),
    )
    .innerJoin('users', 'users.id', 'project_members.user_id')
    .select(['tasks.id', 'users.id as userId', 'users.name'])
    .where('tasks.project_id', '=', projectId)
    .execute();
  return new Map(rows.map((row) => [row.id, { userId: row.userId, name: row.name }]));
}
