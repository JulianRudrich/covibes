import type { DB } from '@covibes/db';
import {
  createCustomAgentInputSchema,
  customAgentSchema,
  isAgentKey,
  isAgentModel,
  MAX_PERSONAL_AGENTS,
  MAX_SHARED_AGENTS,
  projectIdSchema,
  updateCustomAgentInputSchema,
  type ApiErrorCode,
  type CustomAgent,
} from '@covibes/shared';
import { Hono } from 'hono';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import { functionError } from '@server/api/hands';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import type { LivePublisher } from '@server/realtime/realtime';

/** Custom agents as RLS shows them: the user's personal ones and those shared in their projects. */
function selectAgents(trx: Transaction<DB>) {
  return trx
    .selectFrom('custom_agents')
    .innerJoin('users', 'users.id', 'custom_agents.owner_id')
    .select([
      'custom_agents.id',
      'custom_agents.owner_id',
      'custom_agents.project_id',
      'custom_agents.name',
      'custom_agents.role',
      'custom_agents.instructions',
      'custom_agents.can_draw',
      'custom_agents.model',
      'custom_agents.color',
      'custom_agents.template',
      'users.name as owner_name',
    ]);
}

type AgentRow = Awaited<ReturnType<ReturnType<typeof selectAgents>['executeTakeFirstOrThrow']>>;

function toCustomAgent(row: AgentRow): CustomAgent | undefined {
  const agent = customAgentSchema.safeParse({
    key: row.id,
    name: row.name,
    role: row.role,
    color: row.color,
    model: isAgentModel(row.model) ? row.model : null,
    canDraw: row.can_draw,
    scope: row.project_id === null ? 'personal' : 'project',
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    deleted: false,
    instructions: row.instructions,
    projectId: row.project_id,
    template: isAgentKey(row.template) ? row.template : null,
  });
  return agent.success ? agent.data : undefined;
}

function roleIn(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .select('role')
    .executeTakeFirst();
}

function hasCode(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null)?.code === code;
}

type Failure = Extract<
  ApiErrorCode,
  'not_found' | 'forbidden' | 'invalid_input' | 'limit_reached' | 'name_taken'
>;

/**
 * Whether one more agent fits: 20 personal agents per person, 20 shared agents per project. A
 * shared agent needs an owner or editor of its project.
 */
async function checkScope(
  trx: Transaction<DB>,
  userId: string,
  projectId: string | null,
): Promise<Failure | undefined> {
  if (projectId !== null) {
    const member = await roleIn(trx, projectId, userId);
    if (!member) return 'not_found';
    if (member.role === 'viewer') return 'forbidden';
  }
  const count = await trx
    .selectFrom('custom_agents')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .$if(projectId === null, (query) =>
      query.where('project_id', 'is', null).where('owner_id', '=', userId),
    )
    .$if(projectId !== null, (query) => query.where('project_id', '=', projectId))
    .executeTakeFirstOrThrow();
  const limit = projectId === null ? MAX_PERSONAL_AGENTS : MAX_SHARED_AGENTS;
  return Number(count.count) >= limit ? 'limit_reached' : undefined;
}

/**
 * `/api/agents` (spec 19): the custom agents of the signed-in user. Personal agents belong to
 * their creator; agents shared in a project are read by its members and changed by its owners and
 * editors. RLS enforces all of it; the checks here only make the answers clearer. Changes are
 * announced in the projects that refer to the agent.
 */
export function customAgentRoutes(db: AppDb, auth: Auth, live: LivePublisher) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  /** The projects the user is part of whose team has the agent. */
  async function teamsOf(trx: Transaction<DB>, agentId: string): Promise<string[]> {
    const rows = await trx
      .selectFrom('project_agents')
      .select('project_id')
      .where('agent_key', '=', agentId)
      .execute();
    return rows.map((row) => row.project_id);
  }

  function announce(projectIds: readonly (string | null)[]) {
    for (const projectId of new Set(projectIds)) {
      if (projectId !== null) live.publish(projectId, { type: 'project' });
    }
  }

  // The user's personal agents and, with `projectId`, the agents shared in that project.
  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.optional().safeParse(c.req.query('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');
    const shared = projectId.data;

    const rows = await withUser(db, user.id, (trx) =>
      selectAgents(trx)
        .where((eb) =>
          eb.or([
            eb.and([
              eb('custom_agents.project_id', 'is', null),
              eb('custom_agents.owner_id', '=', user.id),
            ]),
            ...(shared === undefined ? [] : [eb('custom_agents.project_id', '=', shared)]),
          ]),
        )
        .orderBy(sql`lower(custom_agents.name)`)
        .orderBy('custom_agents.id')
        .execute(),
    );
    return c.json<CustomAgent[]>(rows.map(toCustomAgent).filter((agent) => agent !== undefined));
  });

  routes.post('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = createCustomAgentInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');
    const { projectId } = input.data;

    try {
      const result = await withUser(db, user.id, async (trx) => {
        const failure = await checkScope(trx, user.id, projectId);
        if (failure) return failure;
        const inserted = await trx
          .insertInto('custom_agents')
          .values({
            owner_id: user.id,
            project_id: projectId,
            name: input.data.name,
            role: input.data.role,
            instructions: input.data.instructions,
            can_draw: input.data.canDraw,
            model: input.data.model,
            color: input.data.color,
            template: input.data.template,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const row = await selectAgents(trx)
          .where('custom_agents.id', '=', inserted.id)
          .executeTakeFirstOrThrow();
        return toCustomAgent(row) ?? ('invalid_input' as const);
      });
      if (typeof result === 'string') return apiError(c, result);
      announce([projectId]);
      return c.json<CustomAgent>(result, 201);
    } catch (error) {
      // The name is taken among the user's personal agents or in the project.
      if (hasCode(error, '23505')) return apiError(c, 'name_taken');
      throw error;
    }
  });

  routes.patch('/:agentId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const agentId = z.uuid().safeParse(c.req.param('agentId'));
    if (!agentId.success) return apiError(c, 'not_found');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = updateCustomAgentInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');
    const { projectId, canDraw, ...rest } = input.data;

    try {
      const result = await withUser(db, user.id, async (trx) => {
        const before = await trx
          .selectFrom('custom_agents')
          .select(['project_id', 'owner_id'])
          .where('id', '=', agentId.data)
          .executeTakeFirst();
        if (!before) return 'not_found' as const;
        const moves = projectId !== undefined && projectId !== before.project_id;
        if (moves) {
          // Only the creator shares the agent or takes it back to personal.
          if (before.owner_id !== user.id) return 'forbidden' as const;
          const failure = await checkScope(trx, user.id, projectId);
          if (failure) return failure;
        }
        const updated = await trx
          .updateTable('custom_agents')
          .set({
            ...rest,
            ...(canDraw === undefined ? {} : { can_draw: canDraw }),
            ...(projectId === undefined ? {} : { project_id: projectId }),
          })
          .where('id', '=', agentId.data)
          .executeTakeFirst();
        // Visible but not changed: a viewer of the project the agent is shared in.
        if (updated.numUpdatedRows === 0n) return 'forbidden' as const;
        const row = await selectAgents(trx)
          .where('custom_agents.id', '=', agentId.data)
          .executeTakeFirstOrThrow();
        const agent = toCustomAgent(row);
        if (!agent) return 'invalid_input' as const;
        return {
          agent,
          projects: [before.project_id, row.project_id, ...(await teamsOf(trx, agentId.data))],
        };
      });
      if (typeof result === 'string') return apiError(c, result);
      announce(result.projects);
      return c.json<CustomAgent>(result.agent);
    } catch (error) {
      if (hasCode(error, '23505')) return apiError(c, 'name_taken');
      // The row level security refused the new scope.
      if (hasCode(error, '42501')) return apiError(c, 'forbidden');
      throw error;
    }
  });

  // Marks the agent as deleted and removes it from every team; the database function checks who
  // may do so and tells the teams.
  routes.delete('/:agentId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const agentId = z.uuid().safeParse(c.req.param('agentId'));
    if (!agentId.success) return apiError(c, 'not_found');
    try {
      await withUser(db, user.id, (trx) =>
        sql`select public.delete_custom_agent(${agentId.data})`.execute(trx),
      );
      return c.body(null, 204);
    } catch (error) {
      const code = functionError(error);
      if (code) return apiError(c, code);
      throw error;
    }
  });

  return routes;
}
