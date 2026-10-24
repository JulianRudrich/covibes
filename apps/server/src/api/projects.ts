import type { DB } from '@covibes/db';
import {
  createProjectInputSchema,
  isAgentKey,
  projectIdSchema,
  projectSettingsSchema,
  setPhaseInputSchema,
  toPhase,
  updateProjectInputSchema,
  type ProjectDetails,
  type ProjectSeen,
  type ProjectSummary,
} from '@covibes/shared';
import { Hono } from 'hono';
import { sql, type Transaction } from 'kysely';

import { loadAgentDirectory, loadProjectAgents, orderTeam } from '@server/api/agents';
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
    .select([
      'projects.id',
      'projects.name',
      'project_members.role',
      'projects.updated_at',
      'projects.phase',
      // What waits for the user there (spec 22a).
      sql<number>`public.project_waiting_count(projects.id)`.as('waiting'),
    ]);
}

type SummaryRow = {
  id: string;
  name: string;
  role: ProjectSummary['role'];
  updated_at: Date;
  phase: string;
  waiting: number;
};

/**
 * The summaries with what their cards show (spec 36c): the phase, the people and the team. The
 * people and teams of all projects come in one query each; only a team with custom agents reads
 * the project's directory, which names them.
 */
async function toSummaries(
  trx: Transaction<DB>,
  userId: string,
  rows: readonly SummaryRow[],
): Promise<ProjectSummary[]> {
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  const members = await trx
    .selectFrom('project_members')
    .innerJoin('users', 'users.id', 'project_members.user_id')
    .where('project_members.project_id', 'in', ids)
    .select(['project_members.project_id', 'users.id as userId', 'users.name'])
    .orderBy('project_members.created_at')
    .orderBy('users.id')
    .execute();
  const teams = await trx
    .selectFrom('project_agents')
    .where('project_id', 'in', ids)
    .select(['project_id', 'agent_key', 'model'])
    .execute();

  return Promise.all(
    rows.map(async (row): Promise<ProjectSummary> => {
      const people = members.filter((member) => member.project_id === row.id);
      const team = teams.filter((agent) => agent.project_id === row.id);
      const directory = team.some((agent) => !isAgentKey(agent.agent_key))
        ? await loadAgentDirectory(trx, row.id)
        : [];
      const custom = new Map(directory.map((agent) => [agent.key, agent]));
      return {
        id: row.id,
        name: row.name,
        role: row.role,
        updatedAt: row.updated_at.toISOString(),
        waiting: row.waiting,
        phase: toPhase(row.phase),
        members: [
          ...people.filter((member) => member.userId === userId),
          ...people.filter((member) => member.userId !== userId),
        ].map((member) => ({ userId: member.userId, name: member.name })),
        agents: orderTeam(team, directory).map(({ key }) => {
          const agent = custom.get(key);
          return {
            key,
            custom: agent ? { name: agent.name, color: agent.color, mark: agent.mark } : null,
          };
        }),
      };
    }),
  );
}

/** `/api/projects`: every route needs a session and reads through `withUser`. */
export function projectRoutes(db: AppDb, auth: Auth, live: LivePublisher) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const list = await withUser(db, user.id, async (trx) =>
      toSummaries(
        trx,
        user.id,
        await summaries(trx, user.id).orderBy('projects.updated_at', 'desc').execute(),
      ),
    );
    return c.json<ProjectSummary[]>(list);
  });

  routes.post('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = createProjectInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');

    const row = await withUser(db, user.id, async (trx) => {
      // Without a language the project is written in the language of who creates it.
      const language =
        input.data.language ??
        (
          await trx
            .selectFrom('users')
            .select('locale')
            .where('id', '=', user.id)
            .executeTakeFirst()
        )?.locale ??
        'de';
      // Creates project, owner membership and main board in one step (migrations 0002, 0039).
      const created = await sql<{
        id: string;
      }>`select id from public.create_project(${input.data.name}, ${language})`.execute(trx);
      const id = created.rows[0]?.id;
      if (!id) throw new Error('create_project returned no project');
      const project = await summaries(trx, user.id)
        .where('projects.id', '=', id)
        .executeTakeFirstOrThrow();
      const [summary] = await toSummaries(trx, user.id, [project]);
      if (!summary) throw new Error('the new project has no summary');
      return summary;
    });
    return c.json<ProjectSummary>(row, 201);
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
        .select(['projects.settings', 'projects.language'])
        .executeTakeFirst();
      if (!project) return undefined;
      const settings = projectSettingsSchema.safeParse(project.settings);
      const members = await trx
        .selectFrom('project_members')
        .innerJoin('users', 'users.id', 'project_members.user_id')
        .where('project_members.project_id', '=', projectId.data)
        .select([
          'users.id as userId',
          'users.name',
          'project_members.role',
          'project_members.can_approve_git',
        ])
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
      const customAgents = await loadAgentDirectory(trx, projectId.data);
      const agents = await loadProjectAgents(trx, projectId.data, customAgents);
      return {
        id: project.id,
        name: project.name,
        role: project.role,
        members: members.map((member) => ({
          userId: member.userId,
          name: member.name,
          role: member.role,
          // Owners approve by their role; for editors it is a right an owner grants.
          canApproveGit: member.role === 'owner' || member.can_approve_git,
        })),
        boards: boards.map((board) => ({
          id: board.id,
          title: board.title,
          kind: board.kind === 'main' ? ('main' as const) : ('extra' as const),
        })),
        proposalsOnly: settings.success && settings.data.proposalsOnly === true,
        observer: !settings.success || settings.data.observer !== false,
        webAccess: !settings.success || settings.data.webAccess !== false,
        stance: (settings.success ? settings.data.stance : undefined) ?? ('criteria' as const),
        decisionProcess:
          (settings.success ? settings.data.decisionProcess : undefined) ?? ('consensus' as const),
        phase: toPhase(project.phase),
        language: project.language === 'en' ? ('en' as const) : ('de' as const),
        agents,
        customAgents,
      };
    });
    if (!details) return apiError(c, 'not_found');
    return c.json<ProjectDetails>(details);
  });

  // The member has the project open and visible right now (spec 22b): what waits there counts as
  // seen, so no mail tells them about it. The answer says whether they are back from an absence
  // (spec 23); then "Seit du weg warst" has something new to show.
  routes.post('/:projectId/seen', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');
    const seen = await withUser(db, user.id, (trx) =>
      sql<{
        returned: boolean;
      }>`select public.touch_project_seen(${projectId.data}) as returned`.execute(trx),
    );
    return c.json<ProjectSeen>({ returned: seen.rows[0]?.returned === true });
  });

  // The phase of the project (spec 24): owners and editors jump to any phase, forward or back.
  // The database announces the change on the live channel.
  routes.put('/:projectId/phase', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = setPhaseInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');

    const result = await withUser(db, user.id, async (trx) => {
      const project = await summaries(trx, user.id)
        .where('projects.id', '=', projectId.data)
        .executeTakeFirst();
      if (!project) return 'not_found' as const;
      if (project.role === 'viewer') return 'forbidden' as const;
      await sql`select public.set_project_phase(${projectId.data}, ${input.data.phase})`.execute(
        trx,
      );
      return 'updated' as const;
    });
    if (result !== 'updated') return apiError(c, result);
    return c.body(null, 204);
  });

  // The project's settings (spec 13: the proposals-only mode, spec 15: the observer, spec 16b: the
  // moderator's stance and the decision process, spec 32b: the language); only owners change
  // them.
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
      // The language is a column of its own; what is written in the old one stays as it is.
      const { language, ...settings } = input.data;
      // Merged into the stored settings, so the other settings stay as they are; settings that
      // are not given are undefined and left out of the JSON.
      await trx
        .updateTable('projects')
        .set({
          settings: sql`settings || ${JSON.stringify(settings)}::jsonb`,
          ...(language ? { language } : {}),
        })
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
