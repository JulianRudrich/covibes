import type { DB } from '@covibes/db';
import {
  AI_PROVIDERS,
  createWorkspaceInputSchema,
  workspaceIdSchema,
  workspaceInvitationInputSchema,
  workspaceInvitationTokenSchema,
  workspaceMemberInputSchema,
  workspaceProjectInputSchema,
  type WorkspaceInvitation,
  type WorkspaceMember,
  type WorkspaceProject,
  type WorkspaceSummary,
  type WorkspaceAiSettings,
} from '@covibes/shared';
import { createHash, randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb, type AdminDb } from '@server/db/database';
import { sealToken } from '@server/integrations/gitlab/crypto';
import type { ProjectConnections } from '@server/realtime/connections';

type PgError = { code?: string; hint?: string };

/** Expected database permission/ownership failures retain the shared API error shape. */
async function mutate<T>(operation: () => Promise<T>): Promise<T | 'forbidden' | 'conflict'> {
  try {
    return await operation();
  } catch (error) {
    const pg = error as PgError;
    if (pg.code === '42501') return 'forbidden';
    if (pg.code === 'P0001' || pg.code === '23503' || pg.code === '23514') return 'conflict';
    throw error;
  }
}

function membership(trx: Transaction<DB>, workspaceId: string, userId: string) {
  return trx
    .selectFrom('workspace_members')
    .select('role')
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

export function workspaceRoutes(
  db: AppDb,
  auth: Auth,
  connections: ProjectConnections,
  admin: AdminDb,
  tokenKey?: string,
) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const rows = await withUser(db, user.id, (trx) =>
      trx
        .selectFrom('workspaces as w')
        .innerJoin('workspace_members as m', 'm.workspace_id', 'w.id')
        .where('m.user_id', '=', user.id)
        .select(['w.id', 'w.name', 'w.kind', 'm.role', 'w.created_at'])
        .select((eb) => [
          eb
            .selectFrom('projects')
            .select(sql<number>`count(*)::integer`.as('count'))
            .whereRef('projects.workspace_id', '=', 'w.id')
            .as('project_count'),
          eb
            .selectFrom('workspace_members')
            .select(sql<number>`count(*)::integer`.as('count'))
            .whereRef('workspace_members.workspace_id', '=', 'w.id')
            .as('member_count'),
        ])
        .orderBy('w.kind')
        .orderBy('w.created_at')
        .execute(),
    );
    return c.json<WorkspaceSummary[]>(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind as WorkspaceSummary['kind'],
        role: row.role,
        createdAt: row.created_at.toISOString(),
        projectCount: row.project_count ?? 0,
        memberCount: row.member_count ?? 0,
      })),
    );
  });

  routes.post('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const input = createWorkspaceInputSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!input.success) return apiError(c, 'invalid_input');
    const result = await withUser(db, user.id, (trx) =>
      sql<{ id: string; name: string }>`
      select id,name from public.create_workspace(${input.data.name})`.execute(trx),
    );
    return c.json(result.rows[0], 201);
  });

  routes.post('/invitations/:token/accept', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const token = workspaceInvitationTokenSchema.safeParse(c.req.param('token'));
    if (!token.success) return apiError(c, 'not_found');
    const result = await mutate(() =>
      withUser(db, user.id, (trx) =>
        sql<{ id: string }>`
      select public.accept_workspace_invitation(${token.data}) as id`.execute(trx),
      ),
    );
    if (typeof result === 'string') return apiError(c, result);
    return c.json({ workspaceId: result.rows[0]?.id });
  });

  routes.use(
    '/:workspaceId/*',
    createMiddleware<{ Variables: SessionVariables }>(async (c, next) => {
      if (!workspaceIdSchema.safeParse(c.req.param('workspaceId')).success)
        return apiError(c, 'not_found');
      await next();
    }),
  );

  // The credential table is deliberately inaccessible to the application role. Keep the
  // membership lock and privileged access in one transaction so a concurrent removal waits.
  async function asOwner<T>(
    workspaceId: string,
    userId: string,
    action: (trx: Transaction<DB>) => Promise<T>,
  ) {
    return admin.transaction().execute(async (trx) => {
      const member = await trx
        .selectFrom('workspace_members')
        .select('role')
        .where('workspace_id', '=', workspaceId)
        .where('user_id', '=', userId)
        .forShare()
        .executeTakeFirst();
      if (member?.role !== 'owner') return undefined;
      return action(trx);
    });
  }

  routes.get('/:workspaceId/ai', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const workspaceId = c.req.param('workspaceId');
    const result = await asOwner(workspaceId, user.id, async (trx) => {
      const keys = await trx
        .selectFrom('workspace_provider_keys')
        .select('provider')
        .where('workspace_id', '=', workspaceId)
        .orderBy('provider')
        .execute();
      const cost = await sql<{ instance: string; workspace: string; month: string }>`
        select to_char(date_trunc('month', now() at time zone 'UTC'), 'YYYY-MM-DD') as month,
          coalesce(sum(cost_usd) filter (where payer = 'instance'), 0)
            + coalesce((select sum(cost_usd) from public.workspace_legacy_ai_costs
              where workspace_id = ${workspaceId}::uuid
              and month = date_trunc('month', now() at time zone 'UTC')::date), 0) as instance,
          coalesce(sum(cost_usd) filter (where payer = 'workspace'), 0) as workspace
        from public.ai_attempts
        where workspace_id = ${workspaceId}::uuid
          and budget_month = date_trunc('month', now() at time zone 'UTC')::date
      `.execute(trx);
      const row = cost.rows[0];
      if (!row) throw new Error('Unable to load workspace spending');
      return {
        configured: keys.map(({ provider }) => z.enum(AI_PROVIDERS).parse(provider)),
        canStoreKeys: Boolean(tokenKey),
        month: row.month,
        spending: { instanceUsd: Number(row.instance), workspaceUsd: Number(row.workspace) },
      } satisfies WorkspaceAiSettings;
    });
    if (!result) return apiError(c, 'forbidden');
    return c.json(result);
  });

  routes.put('/:workspaceId/ai/:provider', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const provider = z.enum(AI_PROVIDERS).safeParse(c.req.param('provider'));
    const input = z
      .object({ key: z.string().trim().min(1).max(4096) })
      .safeParse(await c.req.json().catch(() => undefined));
    if (!provider.success || !input.success) return apiError(c, 'invalid_input');
    const workspaceId = c.req.param('workspaceId');
    const result = await asOwner(workspaceId, user.id, async (trx) => {
      if (!tokenKey) return false;
      const ciphertext = sealToken(
        tokenKey,
        input.data.key,
        'ai:' + workspaceId + ':' + provider.data,
      );
      await trx
        .insertInto('workspace_provider_keys')
        .values({ workspace_id: workspaceId, provider: provider.data, ciphertext })
        .onConflict((oc) => oc.columns(['workspace_id', 'provider']).doUpdateSet({ ciphertext }))
        .execute();
      return true;
    });
    if (result === undefined) return apiError(c, 'forbidden');
    if (!result) return apiError(c, 'conflict');
    return c.body(null, 204);
  });

  routes.delete('/:workspaceId/ai/:provider', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const provider = z.enum(AI_PROVIDERS).safeParse(c.req.param('provider'));
    if (!provider.success) return apiError(c, 'invalid_input');
    const result = await asOwner(c.req.param('workspaceId'), user.id, async (trx) => {
      await trx
        .deleteFrom('workspace_provider_keys')
        .where('workspace_id', '=', c.req.param('workspaceId'))
        .where('provider', '=', provider.data)
        .execute();
      return true;
    });
    if (!result) return apiError(c, 'forbidden');
    return c.body(null, 204);
  });

  routes.patch('/:workspaceId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const id = workspaceIdSchema.safeParse(c.req.param('workspaceId'));
    const input = createWorkspaceInputSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!id.success) return apiError(c, 'not_found');
    if (!input.success) return apiError(c, 'invalid_input');
    const result = await mutate(() =>
      withUser(db, user.id, (trx) =>
        sql`
      select public.update_workspace(${id.data},${input.data.name})`.execute(trx),
      ),
    );
    if (typeof result === 'string') return apiError(c, result);
    return c.body(null, 204);
  });

  routes.delete('/:workspaceId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const id = workspaceIdSchema.safeParse(c.req.param('workspaceId'));
    if (!id.success) return apiError(c, 'not_found');
    const result = await mutate(() =>
      withUser(db, user.id, (trx) =>
        sql`
      select public.delete_workspace(${id.data})`.execute(trx),
      ),
    );
    if (typeof result === 'string') return apiError(c, result);
    return c.body(null, 204);
  });

  routes.get('/:workspaceId/members', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const id = c.req.param('workspaceId');
    const result = await withUser(db, user.id, async (trx) => {
      if (!(await membership(trx, id, user.id))) return null;
      return trx
        .selectFrom('workspace_members as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select(['u.id as userId', 'u.name', 'm.role'])
        .where('m.workspace_id', '=', id)
        .orderBy('m.created_at')
        .execute();
    });
    if (!result) return apiError(c, 'not_found');
    return c.json<WorkspaceMember[]>(result);
  });

  routes.patch('/:workspaceId/members/:userId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const memberId = workspaceIdSchema.safeParse(c.req.param('userId'));
    const input = workspaceMemberInputSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!memberId.success || !input.success) return apiError(c, 'invalid_input');
    const result = await mutate(() =>
      withUser(db, user.id, async (trx) => {
        const projects = await trx
          .selectFrom('projects')
          .select('id')
          .where('workspace_id', '=', c.req.param('workspaceId'))
          .execute();
        await sql`select public.set_workspace_member(${c.req.param('workspaceId')},${memberId.data},${input.data.role}::public.project_role)`.execute(
          trx,
        );
        return projects;
      }),
    );
    if (typeof result === 'string') return apiError(c, result);
    for (const project of result) connections.closeUser(project.id, memberId.data, 'boards');
    return c.body(null, 204);
  });

  routes.delete('/:workspaceId/members/:userId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const memberId = workspaceIdSchema.safeParse(c.req.param('userId'));
    if (!memberId.success) return apiError(c, 'not_found');
    const result = await mutate(() =>
      withUser(db, user.id, async (trx) => {
        const projects = await trx
          .selectFrom('projects')
          .select('id')
          .where('workspace_id', '=', c.req.param('workspaceId'))
          .execute();
        await sql`select public.set_workspace_member(${c.req.param('workspaceId')},${memberId.data},null)`.execute(
          trx,
        );
        return projects;
      }),
    );
    if (typeof result === 'string') return apiError(c, result);
    for (const project of result) connections.closeUser(project.id, memberId.data, 'all');
    return c.body(null, 204);
  });

  routes.get('/:workspaceId/projects', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const id = c.req.param('workspaceId');
    const result = await withUser(db, user.id, async (trx) => {
      if (!(await membership(trx, id, user.id))) return null;
      return trx
        .selectFrom('projects as p')
        .innerJoin('project_members as m', 'm.project_id', 'p.id')
        .where('m.user_id', '=', user.id)
        .where('p.workspace_id', '=', id)
        .select(['p.id', 'p.name', 'p.workspace_id as workspaceId', 'm.role', 'p.updated_at'])
        .orderBy('p.updated_at', 'desc')
        .execute();
    });
    if (!result) return apiError(c, 'not_found');
    return c.json<WorkspaceProject[]>(
      result.map(({ updated_at, ...row }) => ({ ...row, updatedAt: updated_at.toISOString() })),
    );
  });

  routes.post('/:workspaceId/projects', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const input = workspaceProjectInputSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!input.success) return apiError(c, 'invalid_input');
    const result = await mutate(() =>
      withUser(db, user.id, (trx) =>
        sql<{ id: string }>`
      select id from public.create_workspace_project(${c.req.param('workspaceId')},${input.data.name},${input.data.language ?? 'de'})`.execute(
          trx,
        ),
      ),
    );
    if (typeof result === 'string') return apiError(c, result);
    return c.json(result.rows[0], 201);
  });

  routes.get('/:workspaceId/invitations', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const rows = await withUser(db, user.id, (trx) =>
      trx
        .selectFrom('workspace_invitations')
        .select(['id', 'workspace_id', 'email', 'role', 'expires_at', 'accepted_at', 'revoked_at'])
        .where('workspace_id', '=', c.req.param('workspaceId'))
        .orderBy('created_at', 'desc')
        .execute(),
    );
    return c.json<WorkspaceInvitation[]>(
      rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        email: row.email,
        role: row.role as WorkspaceInvitation['role'],
        expiresAt: row.expires_at.toISOString(),
        acceptedAt: row.accepted_at?.toISOString() ?? null,
        revokedAt: row.revoked_at?.toISOString() ?? null,
      })),
    );
  });

  routes.post('/:workspaceId/invitations', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const input = workspaceInvitationInputSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!input.success) return apiError(c, 'invalid_input');
    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    const result = await mutate(() =>
      withUser(db, user.id, (trx) =>
        sql<{ id: string }>`
      select id from public.invite_workspace_member(${c.req.param('workspaceId')},${hash},${input.data.email ?? null},${input.data.role}::public.project_role)`.execute(
          trx,
        ),
      ),
    );
    if (typeof result === 'string') return apiError(c, result);
    return c.json({ id: result.rows[0]?.id, token }, 201);
  });

  routes.delete('/:workspaceId/invitations/:invitationId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const id = workspaceIdSchema.safeParse(c.req.param('invitationId'));
    if (!id.success) return apiError(c, 'not_found');
    const result = await mutate(() =>
      withUser(db, user.id, (trx) =>
        sql`
      select public.revoke_workspace_invitation(${c.req.param('workspaceId')},${id.data})`.execute(
          trx,
        ),
      ),
    );
    if (typeof result === 'string') return apiError(c, result);
    return c.body(null, 204);
  });

  return routes;
}
