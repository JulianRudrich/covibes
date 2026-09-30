import type { DB } from '@covibes/db';
import {
  addProjectAgentInputSchema,
  AGENT_KEYS,
  isAgentKey,
  isAgentModel,
  projectIdSchema,
  updateProjectAgentInputSchema,
  type AgentKey,
  type ApiErrorCode,
  type ProjectAgent,
} from '@covibes/shared';
import { Hono, type Context } from 'hono';
import type { Kysely, Transaction } from 'kysely';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import type { LivePublisher } from '@server/realtime/realtime';

/** The project's team in catalog order, the moderator first (spec 14). */
export async function loadProjectAgents(
  db: Kysely<DB> | Transaction<DB>,
  projectId: string,
): Promise<ProjectAgent[]> {
  const rows = await db
    .selectFrom('project_agents')
    .select(['agent_key', 'model'])
    .where('project_id', '=', projectId)
    .execute();
  return rows
    .flatMap((row) =>
      isAgentKey(row.agent_key)
        ? [{ key: row.agent_key, model: isAgentModel(row.model) ? row.model : null }]
        : [],
    )
    .sort((a, b) => AGENT_KEYS.indexOf(a.key) - AGENT_KEYS.indexOf(b.key));
}

function membership(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .select('role')
    .executeTakeFirst();
}

type Outcome = 'done' | Extract<ApiErrorCode, 'not_found' | 'forbidden' | 'invalid_input'>;
type Member = { projectId: string; userId: string; role: string };

/**
 * `/api/projects/:projectId/agents` (spec 14): owners and editors add catalog agents and remove
 * specialists; the moderator always stays. Only owners choose an agent's model. Every change
 * announces `project` on the live channel, so all members see the new team.
 */
export function agentRoutes(db: AppDb, auth: Auth, live: LivePublisher) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  /** Runs `apply` for an owner or editor of the project and answers with 204 or the error. */
  async function change(
    c: Context<{ Variables: SessionVariables }>,
    apply: (trx: Transaction<DB>, context: Member) => Promise<Outcome>,
  ) {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');
    const outcome = await withUser(db, user.id, async (trx) => {
      const member = await membership(trx, projectId.data, user.id);
      if (!member) return 'not_found' as const;
      if (member.role === 'viewer') return 'forbidden' as const;
      return await apply(trx, { projectId: projectId.data, userId: user.id, role: member.role });
    });
    if (outcome !== 'done') return apiError(c, outcome);
    live.publish(projectId.data, { type: 'project' });
    return c.body(null, 204);
  }

  function agentKeyOf(c: Context): AgentKey | undefined {
    const key = c.req.param('agentKey');
    return isAgentKey(key) ? key : undefined;
  }

  routes.post('/', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = addProjectAgentInputSchema.safeParse(body);
    return change(c, async (trx, { projectId, userId }) => {
      // The moderator is part of every project from the start.
      if (!input.success || input.data.agentKey === 'moderator') return 'invalid_input';
      // Adding an agent that is in the team already changes nothing and is fine.
      await trx
        .insertInto('project_agents')
        .values({ project_id: projectId, agent_key: input.data.agentKey, added_by: userId })
        .onConflict((conflict) => conflict.columns(['project_id', 'agent_key']).doNothing())
        .execute();
      return 'done';
    });
  });

  routes.delete('/:agentKey', (c) =>
    change(c, async (trx, { projectId }) => {
      const key = agentKeyOf(c);
      if (!key) return 'not_found';
      if (key === 'moderator') return 'forbidden';
      const deleted = await trx
        .deleteFrom('project_agents')
        .where('project_id', '=', projectId)
        .where('agent_key', '=', key)
        .executeTakeFirst();
      return deleted.numDeletedRows > 0n ? 'done' : 'not_found';
    }),
  );

  routes.patch('/:agentKey', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = updateProjectAgentInputSchema.safeParse(body);
    return change(c, async (trx, { projectId, role }) => {
      const key = agentKeyOf(c);
      if (!key) return 'not_found';
      // The model decides about costs, so it is the owner's choice.
      if (role !== 'owner') return 'forbidden';
      if (!input.success) return 'invalid_input';
      const updated = await trx
        .updateTable('project_agents')
        .set({ model: input.data.model })
        .where('project_id', '=', projectId)
        .where('agent_key', '=', key)
        .executeTakeFirst();
      return updated.numUpdatedRows > 0n ? 'done' : 'not_found';
    });
  });

  return routes;
}
