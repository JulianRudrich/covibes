import { APIError } from 'better-auth/api';
import type pg from 'pg';

import type { BoardDocuments } from '@server/collab/collab';
import type { Database } from '@server/db/database';
import type { ProjectConnections } from '@server/realtime/connections';
import type { FileStorage } from '@server/storage/storage';
import { cleanStoredFile } from '@server/tasks/file-cleanup';

export type DeletedProject = {
  id: string;
  boards: string[];
  members: string[];
  storageKeys: string[];
};
type ProjectDocuments = BoardDocuments & {
  /** Spec 41's project tombstone contract; old test readers can omit it. */
  deleteProjectDocuments?: (projectId: string, boardIds: readonly string[]) => Promise<void>;
};

/** The auth before-delete callback is a read-only preflight, never irreversible cleanup. */
export async function prepareAccountDeletion(adminPool: pg.Pool, userId: string) {
  const conflicts = await adminPool.query<{ conflict: boolean }>(
    `
    select exists(
      select 1 from workspace_members mine join workspaces w on w.id=mine.workspace_id
      where mine.user_id=$1 and mine.role='owner' and w.kind='team'
        and not exists(select 1 from workspace_members other where other.workspace_id=w.id
          and other.user_id<>$1 and other.role='owner')
        and (exists(select 1 from workspace_members other where other.workspace_id=w.id and other.user_id<>$1)
          or exists(select 1 from projects p join project_members m on m.project_id=p.id
            where p.workspace_id=w.id and m.user_id<>$1))
    ) or exists(
      select 1 from projects p where p.owner_id=$1
        and exists(select 1 from project_members m where m.project_id=p.id and m.user_id<>$1)
        and not exists(select 1 from project_members m where m.project_id=p.id and m.user_id<>$1 and m.role='owner')
    ) as conflict`,
    [userId],
  );
  if (conflicts.rows[0]?.conflict) {
    throw new APIError('CONFLICT', {
      code: 'LAST_OWNER',
      message: 'Transfer ownership of shared workspaces and projects before deleting the account.',
    });
  }
}

/** Called only after relational deletion. Durable rows retain any failed file cleanup. */
export async function finishProjectDeletion(
  deps: {
    db: Database;
    documents: ProjectDocuments;
    connections: ProjectConnections;
    files: FileStorage;
  },
  deleted: DeletedProject,
) {
  for (const userId of deleted.members) deps.connections.closeUser(deleted.id, userId, 'all');
  if (deps.documents.deleteProjectDocuments) {
    await deps.documents.deleteProjectDocuments(deleted.id, deleted.boards);
  } else {
    await Promise.all(deleted.boards.map((id) => deps.documents.deleteBoard(id)));
    await deps.db.adminPool.query('delete from yjs_documents where name=$1', [
      `plan:${deleted.id}`,
    ]);
  }
  await Promise.allSettled(
    deleted.storageKeys.map((key) => cleanStoredFile(deps.db.admin, deps.files, key)),
  );
}
