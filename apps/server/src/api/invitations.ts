import { createHash, randomBytes } from 'node:crypto';

import type { DB } from '@covibes/db';
import {
  acceptInvitationResultSchema,
  createInvitationInputSchema,
  INVITATION_DAYS,
  invitationPreviewSchema,
  invitationSchema,
  invitationTokenInputSchema,
  MAX_OPEN_INVITATIONS,
  projectIdSchema,
  updateMemberInputSchema,
  type AcceptInvitationResult,
  type CreatedInvitation,
  type Invitation,
  type InvitationPreview,
} from '@covibes/shared';
import { Hono } from 'hono';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import type { Mailer } from '@server/integrations/mail/mailer';
import { invitationMail } from '@server/integrations/mail/templates';
import type { RateLimiter } from '@server/rate-limit';
import type { ProjectConnections } from '@server/realtime/connections';

/** Invitation mails one person may send per hour: Covibes must not mail any address for anyone. */
export const INVITATION_MAILS_PER_HOUR = 20;

const INVITATION_COLUMNS = [
  'id',
  'kind',
  'role',
  'email',
  'created_at',
  'expires_at',
  'uses',
] as const;

type InvitationRow = {
  id: string;
  kind: string;
  role: string;
  email: string | null;
  created_at: Date;
  expires_at: Date;
  uses: number;
};

function toInvitation(row: InvitationRow): Invitation {
  return invitationSchema.parse({
    id: row.id,
    kind: row.kind,
    role: row.role,
    email: row.email,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    uses: row.uses,
  });
}

/** A new secret for a link, and the hash it is stored under. */
function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex') };
}

function roleIn(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .select('role')
    .executeTakeFirst();
}

/** `not_found` for someone outside the project, `forbidden` for a member who is no owner. */
async function ownerOnly(trx: Transaction<DB>, projectId: string, userId: string) {
  const member = await roleIn(trx, projectId, userId);
  if (!member) return 'not_found' as const;
  return member.role === 'owner' ? undefined : ('forbidden' as const);
}

/** Invitations that still work: not revoked, not expired, and by mail not used yet. */
function openInvitations(trx: Transaction<DB>, projectId: string) {
  return trx
    .selectFrom('invitations')
    .where('project_id', '=', projectId)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', sql<Date>`now()`)
    .where((eb) => eb.or([eb('kind', '=', 'link'), eb('uses', '=', 0)]));
}

/** The SQLSTATE and hint of the trigger that keeps the last owner in (migration 0002). */
function isLastOwner(error: unknown): boolean {
  const { code, hint } = (error ?? {}) as { code?: unknown; hint?: unknown };
  return code === 'P0001' && hint === 'last_owner';
}

/**
 * `/api/projects/:projectId/invitations` (spec 21a): owners invite by link or by email, see the
 * open invitations, send a mail again and revoke. The link is made here and only its hash is
 * stored, so it is told once: in the answer for a link, in the mail for an invitation by email.
 */
export function projectInvitationRoutes(
  db: AppDb,
  auth: Auth,
  deps: { appUrl: string; mailer: Mailer | undefined; limiter: RateLimiter },
) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  const linkOf = (token: string) => new URL(`/invite/${token}`, deps.appUrl).href;

  /** What the mail says besides the link. */
  function mailContext(trx: Transaction<DB>, projectId: string) {
    return trx
      .selectFrom('projects')
      .select(['name', 'language'])
      .where('id', '=', projectId)
      .executeTakeFirstOrThrow();
  }

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const result = await withUser(db, user.id, async (trx) => {
      const failure = await ownerOnly(trx, projectId.data, user.id);
      if (failure) return failure;
      return openInvitations(trx, projectId.data)
        .select(INVITATION_COLUMNS)
        .orderBy('created_at')
        .orderBy('id')
        .execute();
    });
    if (typeof result === 'string') return apiError(c, result);
    return c.json<Invitation[]>(result.map(toInvitation));
  });

  routes.post('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = createInvitationInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');
    const { mailer } = deps;
    const email = input.data.kind === 'email' ? input.data.email : null;
    // Without a mailer there are only links; the web app does not offer the mail then.
    if (email !== null && !mailer) return apiError(c, 'invalid_input');

    const { token, hash } = newToken();
    const result = await withUser(db, user.id, async (trx) => {
      const failure = await ownerOnly(trx, projectId.data, user.id);
      if (failure) return failure;
      if (email !== null) {
        const known = await sql<{ known: boolean }>`
          select public.project_has_member_email(${projectId.data}, ${email}) as known
        `.execute(trx);
        if (known.rows[0]?.known) return 'already_member' as const;
        if (!deps.limiter.take(user.id)) return 'too_many_requests' as const;
        // One open invitation per address: an earlier one stops working.
        await openInvitations(trx, projectId.data)
          .where('email', '=', email)
          .select('id')
          .execute()
          .then((rows) =>
            rows.length === 0
              ? undefined
              : trx
                  .updateTable('invitations')
                  .set({ revoked_at: sql`now()` })
                  .where(
                    'id',
                    'in',
                    rows.map((row) => row.id),
                  )
                  .execute(),
          );
      }
      const open = await openInvitations(trx, projectId.data)
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow();
      if (Number(open.count) >= MAX_OPEN_INVITATIONS) return 'limit_reached' as const;

      const row = await trx
        .insertInto('invitations')
        .values({
          project_id: projectId.data,
          kind: input.data.kind,
          role: input.data.role,
          email,
          token_hash: hash,
          created_by: user.id,
        })
        .returning(INVITATION_COLUMNS)
        .executeTakeFirstOrThrow();
      return { invitation: toInvitation(row), project: await mailContext(trx, projectId.data) };
    });
    if (typeof result === 'string') return apiError(c, result);

    if (email !== null && mailer) {
      await mailer.send(
        invitationMail({
          to: email,
          url: linkOf(token),
          projectName: result.project.name,
          inviterName: user.name,
          role: input.data.role,
          days: INVITATION_DAYS,
          locale: result.project.language === 'en' ? 'en' : 'de',
        }),
      );
    }
    return c.json<CreatedInvitation>(
      { invitation: result.invitation, url: email === null ? linkOf(token) : null },
      201,
    );
  });

  // Sends the mail of an invitation by email again, with a new link and seven more days.
  routes.post('/:invitationId/resend', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const invitationId = z.uuid().safeParse(c.req.param('invitationId'));
    if (!projectId.success || !invitationId.success) return apiError(c, 'not_found');
    const { mailer } = deps;
    if (!mailer) return apiError(c, 'invalid_input');

    const { token, hash } = newToken();
    const result = await withUser(db, user.id, async (trx) => {
      const failure = await ownerOnly(trx, projectId.data, user.id);
      if (failure) return failure;
      if (!deps.limiter.take(user.id)) return 'too_many_requests' as const;
      const row = await trx
        .updateTable('invitations')
        .set({
          token_hash: hash,
          expires_at: sql<Date>`now() + make_interval(days => ${INVITATION_DAYS})`,
        })
        .where('id', '=', invitationId.data)
        .where('project_id', '=', projectId.data)
        .where('kind', '=', 'email')
        .where('revoked_at', 'is', null)
        .where('uses', '=', 0)
        .returning(INVITATION_COLUMNS)
        .executeTakeFirst();
      if (!row) return 'not_found' as const;
      return { invitation: toInvitation(row), project: await mailContext(trx, projectId.data) };
    });
    if (typeof result === 'string') return apiError(c, result);

    const { invitation, project } = result;
    if (invitation.email !== null) {
      await mailer.send(
        invitationMail({
          to: invitation.email,
          url: linkOf(token),
          projectName: project.name,
          inviterName: user.name,
          role: invitation.role,
          days: INVITATION_DAYS,
          locale: project.language === 'en' ? 'en' : 'de',
        }),
      );
    }
    return c.json<Invitation>(invitation);
  });

  // Revokes: the link stops working at once.
  routes.delete('/:invitationId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const invitationId = z.uuid().safeParse(c.req.param('invitationId'));
    if (!projectId.success || !invitationId.success) return apiError(c, 'not_found');

    const result = await withUser(db, user.id, async (trx) => {
      const failure = await ownerOnly(trx, projectId.data, user.id);
      if (failure) return failure;
      const revoked = await trx
        .updateTable('invitations')
        .set({ revoked_at: sql`now()` })
        .where('id', '=', invitationId.data)
        .where('project_id', '=', projectId.data)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      return revoked.numUpdatedRows === 0n ? ('not_found' as const) : undefined;
    });
    if (result) return apiError(c, result);
    return c.body(null, 204);
  });

  return routes;
}

/**
 * `/api/invitations` (spec 21a): what a link leads to, and joining. The token comes in the body,
 * so it is in no address the server logs; the database checks it against its hash.
 */
export function invitationRoutes(db: AppDb, auth: Auth) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.post('/preview', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = invitationTokenInputSchema.safeParse(body);
    // Anything that cannot be a token is a link nobody issued.
    if (!input.success) return apiError(c, 'not_found');

    const { rows } = await withUser(db, user.id, (trx) =>
      sql<{
        project_id: string | null;
        project_name: string | null;
        role: string | null;
        invited_by: string | null;
        status: string;
      }>`select * from public.invitation_preview(${input.data.token})`.execute(trx),
    );
    const [row] = rows;
    if (!row) return apiError(c, 'not_found');
    return c.json<InvitationPreview>(
      invitationPreviewSchema.parse({
        status: row.status,
        projectId: row.project_id,
        projectName: row.project_name,
        role: row.role,
        invitedBy: row.invited_by,
      }),
    );
  });

  routes.post('/accept', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = invitationTokenInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'not_found');

    const { rows } = await withUser(db, user.id, (trx) =>
      sql<{
        project_id: string | null;
        status: string;
      }>`select * from public.accept_invitation(${input.data.token})`.execute(trx),
    );
    const [row] = rows;
    if (!row) return apiError(c, 'not_found');
    return c.json<AcceptInvitationResult>(
      acceptInvitationResultSchema.parse({ status: row.status, projectId: row.project_id }),
    );
  });

  return routes;
}

/**
 * `/api/projects/:projectId/members` (spec 21a): owners change roles, grant editors the right to
 * approve Git actions and remove members; everyone leaves on their own. Whoever's access changed
 * gets their open connections closed; the database tells the project's live channel.
 */
export function memberRoutes(db: AppDb, auth: Auth, connections: ProjectConnections) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.patch('/:userId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const userId = z.uuid().safeParse(c.req.param('userId'));
    if (!projectId.success || !userId.success) return apiError(c, 'not_found');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = updateMemberInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');

    try {
      const result = await withUser(db, user.id, async (trx) => {
        const failure = await ownerOnly(trx, projectId.data, user.id);
        if (failure) return failure;
        const member = await trx
          .selectFrom('project_members')
          .select(['role', 'can_approve_git'])
          .where('project_id', '=', projectId.data)
          .where('user_id', '=', userId.data)
          .executeTakeFirst();
        if (!member) return 'not_found' as const;
        const role = input.data.role ?? member.role;
        // The right is one of editors: owners approve anyway, viewers never.
        const canApproveGit =
          role === 'editor' && (input.data.canApproveGit ?? member.can_approve_git);
        if (input.data.canApproveGit === true && role !== 'editor') {
          return 'invalid_input' as const;
        }
        await trx
          .updateTable('project_members')
          .set({ role, can_approve_git: canApproveGit })
          .where('project_id', '=', projectId.data)
          .where('user_id', '=', userId.data)
          .execute();
        return { roleChanged: role !== member.role };
      });
      if (typeof result === 'string') return apiError(c, result);
      if (result.roleChanged) connections.closeUser(projectId.data, userId.data, 'boards');
      return c.body(null, 204);
    } catch (error) {
      if (isLastOwner(error)) return apiError(c, 'last_owner');
      throw error;
    }
  });

  // An owner removes a member, or a member leaves.
  routes.delete('/:userId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const userId = z.uuid().safeParse(c.req.param('userId'));
    if (!projectId.success || !userId.success) return apiError(c, 'not_found');

    try {
      const result = await withUser(db, user.id, async (trx) => {
        const member = await roleIn(trx, projectId.data, user.id);
        if (!member) return 'not_found' as const;
        if (userId.data !== user.id && member.role !== 'owner') return 'forbidden' as const;
        const removed = await trx
          .deleteFrom('project_members')
          .where('project_id', '=', projectId.data)
          .where('user_id', '=', userId.data)
          .executeTakeFirst();
        return removed.numDeletedRows === 0n ? ('not_found' as const) : undefined;
      });
      if (result) return apiError(c, result);
      connections.closeUser(projectId.data, userId.data, 'all');
      return c.body(null, 204);
    } catch (error) {
      if (isLastOwner(error)) return apiError(c, 'last_owner');
      throw error;
    }
  });

  return routes;
}
