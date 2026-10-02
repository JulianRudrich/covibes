import {
  PLAN_SECTIONS,
  planNodeSchema,
  planSuggestionSchema,
  projectIdSchema,
  writePlanSection,
  type PlanSection,
  type PlanState,
  type PlanSuggestion,
} from '@covibes/shared';
import { Hono, type Context } from 'hono';
import { sql } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import { functionError } from '@server/api/hands';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type AppDb } from '@server/db/database';
import { decodePlanFailure } from '@server/plan/failure';

/** After this long without an end, a generation counts as lost (migration 0023). */
const GENERATION_LOST_MS = 10 * 60_000;

const contentSchema = z.array(planNodeSchema);

function bySection(a: { section: string }, b: { section: string }): number {
  return (
    PLAN_SECTIONS.indexOf(a.section as PlanSection) -
    PLAN_SECTIONS.indexOf(b.section as PlanSection)
  );
}

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * `/api/projects/:projectId/plan` (spec 25b): what waits around the plan, starting a generation,
 * and deciding the moderator's suggestions. The database checks who may do what and announces
 * every change on the live channel; accepting writes the text into the plan's document in the
 * same transaction, so a suggestion is never accepted without its text arriving.
 */
export function planRoutes(db: AppDb, auth: Auth, documents: Pick<BoardDocuments, 'changePlan'>) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const state = await withUser(db, user.id, async (trx): Promise<PlanState | undefined> => {
      const member = await trx
        .selectFrom('project_members')
        .select('role')
        .where('project_id', '=', projectId.data)
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      if (!member) return undefined;
      const [rows, latest] = await Promise.all([
        trx
          .selectFrom('plan_suggestions')
          .select(['id', 'section', 'content', 'created_at'])
          .where('project_id', '=', projectId.data)
          .where('status', '=', 'open')
          .execute(),
        trx
          .selectFrom('ai_runs')
          .select(['status', 'error', 'created_at'])
          .where('project_id', '=', projectId.data)
          .where('kind', '=', 'plan')
          .orderBy('created_at', 'desc')
          .limit(1)
          .executeTakeFirst(),
      ]);
      const running = latest?.status === 'queued' || latest?.status === 'running';
      return {
        suggestions: rows.sort(bySection).flatMap((row): PlanSuggestion[] => {
          const parsed = planSuggestionSchema.safeParse({
            id: row.id,
            section: row.section,
            content: row.content,
            createdAt: row.created_at.toISOString(),
          });
          return parsed.success ? [parsed.data] : [];
        }),
        generating: running && Date.now() - latest.created_at.getTime() < GENERATION_LOST_MS,
        failure: latest?.status === 'error' ? decodePlanFailure(latest.error) : null,
      };
    });
    if (!state) return apiError(c, 'not_found');
    return c.json<PlanState>(state);
  });

  // "Plan erzeugen": queues the moderator's run; the suggestions arrive on the live channel.
  routes.post('/generate', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    try {
      const started = await withUser(db, user.id, async (trx) => {
        const member = await trx
          .selectFrom('project_members')
          .select('role')
          .where('project_id', '=', projectId.data)
          .where('user_id', '=', user.id)
          .executeTakeFirst();
        if (!member) return false;
        await sql`select public.start_plan_generation(${projectId.data})`.execute(trx);
        return true;
      });
      if (!started) return apiError(c, 'not_found');
      return c.body(null, 202);
    } catch (error) {
      const state = sqlState(error);
      if (state === '55000') return apiError(c, 'already_running');
      if (state === '42501') return apiError(c, 'forbidden');
      throw error;
    }
  });

  /** Accepts or rejects one suggestion, or all open ones; accepted text goes into the plan. */
  async function decide(
    c: Context<{ Variables: SessionVariables }>,
    status: 'accepted' | 'rejected',
    all: boolean,
  ) {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const suggestionId = all ? undefined : z.uuid().safeParse(c.req.param('suggestionId'));
    if (!projectId.success || suggestionId?.success === false) return apiError(c, 'not_found');

    try {
      await withUser(db, user.id, async (trx) => {
        const decided = await sql<{ section: string; content: unknown }>`
          select section, content
          from public.decide_plan_suggestions(
            ${projectId.data}, ${suggestionId?.data ?? null}, ${status}
          )`.execute(trx);
        if (status !== 'accepted' || decided.rows.length === 0) return;
        const project = await trx
          .selectFrom('projects')
          .select('language')
          .where('id', '=', projectId.data)
          .executeTakeFirstOrThrow();
        const language = project.language === 'en' ? 'en' : 'de';
        // If the plan cannot be written, the decision is rolled back and the suggestion stays.
        await documents.changePlan(projectId.data, (doc) => {
          for (const row of [...decided.rows].sort(bySection)) {
            const content = contentSchema.safeParse(row.content);
            writePlanSection(
              doc,
              row.section as PlanSection,
              content.success ? content.data : [],
              language,
            );
          }
        });
      });
      return c.body(null, 204);
    } catch (error) {
      const refused = functionError(error);
      if (refused) return apiError(c, refused);
      throw error;
    }
  }

  routes.post('/suggestions/accept', (c) => decide(c, 'accepted', true));
  routes.post('/suggestions/:suggestionId/accept', (c) => decide(c, 'accepted', false));
  routes.post('/suggestions/:suggestionId/reject', (c) => decide(c, 'rejected', false));

  return routes;
}
