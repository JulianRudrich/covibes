import { moveProjectInputSchema, projectIdSchema } from '@covibes/shared';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type Database } from '@server/db/database';
import type { ProjectConnections } from '@server/realtime/connections';
import type { FileStorage } from '@server/storage/storage';
import { finishProjectDeletion, type DeletedProject } from '@server/workspaces/lifecycle';

const deletionInput = z.object({ confirmName: z.string().min(1).max(120) });

export function projectLifecycleRoutes(deps: {
  db: Database;
  auth: Auth;
  documents: BoardDocuments;
  connections: ProjectConnections;
  files: FileStorage;
}) {
  const { db, auth } = deps;
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.post('/:projectId/workspace', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const id = projectIdSchema.safeParse(c.req.param('projectId'));
    const input = moveProjectInputSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!id.success) return apiError(c, 'not_found');
    if (!input.success) return apiError(c, 'invalid_input');
    const result = await withUser(db.app, user.id, async (trx) => {
      const member = await trx
        .selectFrom('project_members')
        .select('role')
        .where('project_id', '=', id.data)
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      if (!member) return 'not_found' as const;
      if (member.role !== 'owner') return 'forbidden' as const;
      const members = await trx
        .selectFrom('project_members')
        .select('user_id')
        .where('project_id', '=', id.data)
        .execute();
      try {
        await sql`select public.move_workspace_project(${id.data},${input.data.workspaceId})`.execute(
          trx,
        );
      } catch (error) {
        const pg = error as { code?: string };
        if (pg.code === '42501') return 'forbidden' as const;
        if (pg.code === 'P0001') return 'conflict' as const;
        throw error;
      }
      return members.map((row) => row.user_id);
    });
    if (typeof result === 'string') return apiError(c, result);
    for (const memberId of result) deps.connections.closeUser(id.data, memberId, 'all');
    return c.body(null, 204);
  });

  routes.delete('/:projectId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const id = projectIdSchema.safeParse(c.req.param('projectId'));
    const input = deletionInput.safeParse(await c.req.json().catch(() => undefined));
    if (!id.success) return apiError(c, 'not_found');
    if (!input.success) return apiError(c, 'invalid_input');
    const result = await withUser(db.app, user.id, async (trx) => {
      const project = await trx
        .selectFrom('projects')
        .select(['id', 'name'])
        .where('id', '=', id.data)
        .forUpdate()
        .executeTakeFirst();
      if (!project) return 'not_found' as const;
      const membership = await trx
        .selectFrom('project_members')
        .select('role')
        .where('project_id', '=', id.data)
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      if (membership?.role !== 'owner') return 'forbidden' as const;
      if (input.data.confirmName !== project.name) return 'conflict' as const;
      const [boards, members, files, knowledge] = await Promise.all([
        trx.selectFrom('boards').select('id').where('project_id', '=', id.data).execute(),
        trx
          .selectFrom('project_members')
          .select('user_id')
          .where('project_id', '=', id.data)
          .execute(),
        trx.selectFrom('files').select('storage_key').where('project_id', '=', id.data).execute(),
        trx
          .selectFrom('agent_knowledge as k')
          .innerJoin('custom_agents as a', 'a.id', 'k.agent_id')
          .select('k.storage_key')
          .where('a.project_id', '=', id.data)
          .where('k.storage_key', 'is not', null)
          .execute(),
      ]);
      await trx.deleteFrom('projects').where('id', '=', id.data).execute();
      return {
        id: id.data,
        boards: boards.map((row) => row.id),
        members: members.map((row) => row.user_id),
        storageKeys: [
          ...files.map((row) => row.storage_key),
          ...knowledge.flatMap((row) => (row.storage_key ? [row.storage_key] : [])),
        ],
      } satisfies DeletedProject;
    });
    if (typeof result === 'string') return apiError(c, result);
    await finishProjectDeletion(deps, result);
    return c.body(null, 204);
  });
  return routes;
}
