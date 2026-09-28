import type { DB } from '@covibes/db';
import {
  createProjectInputSchema,
  projectIdSchema,
  type ProjectDetails,
  type ProjectSummary,
} from '@covibes/shared';
import { Hono } from 'hono';
import { sql, type Transaction } from 'kysely';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';

/** The user's projects with their own role. RLS already limits the rows to member projects. */
function summaries(trx: Transaction<DB>, userId: string) {
  return trx
    .selectFrom('projects')
    .innerJoin('project_members', 'project_members.project_id', 'projects.id')
    .where('project_members.user_id', '=', userId)
    .select(['projects.id', 'projects.name', 'project_members.role', 'projects.updated_at']);
}

function toSummary(row: {
  id: string;
  name: string;
  role: ProjectSummary['role'];
  updated_at: Date;
}): ProjectSummary {
  return { id: row.id, name: row.name, role: row.role, updatedAt: row.updated_at.toISOString() };
}

/** `/api/projects`: every route needs a session and reads through `withUser`. */
export function projectRoutes(db: AppDb, auth: Auth) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const rows = await withUser(db, user.id, (trx) =>
      summaries(trx, user.id).orderBy('projects.updated_at', 'desc').execute(),
    );
    return c.json<ProjectSummary[]>(rows.map(toSummary));
  });

  routes.post('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = createProjectInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');

    const row = await withUser(db, user.id, async (trx) => {
      // Creates project, owner membership and main board in one step (migration 0002).
      const created = await sql<{
        id: string;
      }>`select id from public.create_project(${input.data.name})`.execute(trx);
      const id = created.rows[0]?.id;
      if (!id) throw new Error('create_project returned no project');
      return summaries(trx, user.id).where('projects.id', '=', id).executeTakeFirstOrThrow();
    });
    return c.json<ProjectSummary>(toSummary(row), 201);
  });

  routes.get('/:projectId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    // Unknown, foreign and malformed ids all look the same from outside.
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const details = await withUser(db, user.id, async (trx) => {
      const project = await summaries(trx, user.id)
        .where('projects.id', '=', projectId.data)
        .executeTakeFirst();
      if (!project) return undefined;
      const members = await trx
        .selectFrom('project_members')
        .innerJoin('users', 'users.id', 'project_members.user_id')
        .where('project_members.project_id', '=', projectId.data)
        .select(['users.id as userId', 'users.name', 'project_members.role'])
        .orderBy('project_members.created_at')
        .execute();
      return { id: project.id, name: project.name, role: project.role, members };
    });
    if (!details) return apiError(c, 'not_found');
    return c.json<ProjectDetails>(details);
  });

  return routes;
}
