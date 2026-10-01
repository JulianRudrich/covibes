import type { DB } from '@covibes/db';
import {
  createProjectInputSchema,
  projectIdSchema,
  projectSettingsSchema,
  updateProjectInputSchema,
  type ProjectDetails,
  type ProjectSummary,
} from '@covibes/shared';
import { Hono } from 'hono';
import { sql, type Transaction } from 'kysely';

import { loadProjectAgents } from '@server/api/agents';
import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import type { LivePublisher } from '@server/realtime/realtime';

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
export function projectRoutes(db: AppDb, auth: Auth, live: LivePublisher) {
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
        .select('projects.settings')
        .executeTakeFirst();
      if (!project) return undefined;
      const settings = projectSettingsSchema.safeParse(project.settings);
      const members = await trx
        .selectFrom('project_members')
        .innerJoin('users', 'users.id', 'project_members.user_id')
        .where('project_members.project_id', '=', projectId.data)
        .select(['users.id as userId', 'users.name', 'project_members.role'])
        .orderBy('project_members.created_at')
        .execute();
      const boards = await trx
        .selectFrom('boards')
        .where('project_id', '=', projectId.data)
        .select(['id', 'title', 'kind'])
        .orderBy('kind', 'desc') // 'main' before 'extra'
        .orderBy('position')
        .orderBy('created_at')
        .execute();
      const agents = await loadProjectAgents(trx, projectId.data);
      return {
        id: project.id,
        name: project.name,
        role: project.role,
        members,
        boards: boards.map((board) => ({
          id: board.id,
          title: board.title,
          kind: board.kind === 'main' ? ('main' as const) : ('extra' as const),
        })),
        proposalsOnly: settings.success && settings.data.proposalsOnly === true,
        observer: !settings.success || settings.data.observer !== false,
        stance: (settings.success ? settings.data.stance : undefined) ?? ('criteria' as const),
        decisionProcess:
          (settings.success ? settings.data.decisionProcess : undefined) ?? ('consensus' as const),
        agents,
      };
    });
    if (!details) return apiError(c, 'not_found');
    return c.json<ProjectDetails>(details);
  });

  // The project's settings (spec 13: the proposals-only mode, spec 15: the observer, spec 16b: the
  // moderator's stance and the decision process); only owners change them.
  routes.patch('/:projectId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = updateProjectInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');

    const result = await withUser(db, user.id, async (trx) => {
      const project = await summaries(trx, user.id)
        .where('projects.id', '=', projectId.data)
        .executeTakeFirst();
      if (!project) return 'not_found' as const;
      if (project.role !== 'owner') return 'forbidden' as const;
      // Merged into the stored settings, so the other settings stay as they are; settings that
      // are not given are undefined and left out of the JSON.
      await trx
        .updateTable('projects')
        .set({ settings: sql`settings || ${JSON.stringify(input.data)}::jsonb` })
        .where('id', '=', projectId.data)
        .execute();
      return 'updated' as const;
    });
    if (result !== 'updated') return apiError(c, result);
    live.publish(projectId.data, { type: 'project' });
    return c.body(null, 204);
  });

  return routes;
}
