import type { DB } from '@covibes/db';
import {
  carryTaskIds,
  isPlanEmpty,
  PLAN_SECTIONS,
  planNodeSchema,
  planSuggestionSchema,
  planVersionSchema,
  projectIdSchema,
  readPlan,
  readPlanSections,
  withoutTaskIds,
  writePlanSection,
  type PlanChange,
  type PlanSection,
  type PlanState,
  type PlanSuggestion,
  type PlanVersion,
  type PlanVersionContent,
} from '@covibes/shared';
import { Hono, type Context } from 'hono';
import { sql, type Transaction } from 'kysely';
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
/** How long the plan says that an update found nothing to change. */
const UP_TO_DATE_MS = 10 * 60_000;
/** Changes the note of an outdated plan names; more are counted. */
const CHANGES_SHOWN = 5;

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

function membership(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .select('role')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

/**
 * What changed in the project since the moderator last wrote or updated the plan (spec 25c): the
 * decisions that were made or reopened, each once with what happened last, and the criteria as
 * one change. Empty while the plan is current, and for a plan nobody generated.
 */
async function changesSince(
  trx: Transaction<DB>,
  projectId: string,
  base: Date | undefined,
): Promise<PlanChange[]> {
  if (!base) return [];
  const log = await trx
    .selectFrom('decision_log')
    .select(['kind', 'decision_id', 'topic'])
    .where('project_id', '=', projectId)
    .where('created_at', '>', base)
    .orderBy('created_at', 'desc')
    .orderBy('id')
    .execute();
  const changes: PlanChange[] = [];
  const seen = new Set<string>();
  for (const entry of log) {
    if (entry.kind === 'decided' || entry.kind === 'reopened') {
      const key = entry.decision_id ?? entry.topic ?? '';
      if (seen.has(key)) continue;
      seen.add(key);
      changes.push({ kind: entry.kind, topic: entry.topic });
    } else if (entry.kind.startsWith('criterion_') && !seen.has('criteria')) {
      seen.add('criteria');
      changes.push({ kind: 'criteria', topic: null });
    }
  }
  return changes;
}

/**
 * `/api/projects/:projectId/plan` (specs 25b and 25c): what waits around the plan, starting a
 * generation or an update, deciding the moderator's suggestions, and the versions of the plan.
 * The database checks who may do what and announces every change on the live channel; accepting
 * writes the text into the plan's document in the same transaction, so a suggestion is never
 * accepted without its text arriving.
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
      if (!(await membership(trx, projectId.data, user.id))) return undefined;
      const runs = trx
        .selectFrom('ai_runs')
        .where('project_id', '=', projectId.data)
        .where('kind', '=', 'plan')
        .orderBy('created_at', 'desc')
        .limit(1);
      const [rows, latest, written] = await Promise.all([
        trx
          .selectFrom('plan_suggestions')
          .select(['id', 'section', 'content', 'created_at', 'kind', 'hand_edited'])
          .where('project_id', '=', projectId.data)
          .where('status', '=', 'open')
          .execute(),
        runs.select(['id', 'status', 'error', 'created_at', 'finished_at']).executeTakeFirst(),
        // The run the plan was last written or updated by: what came later, it does not know.
        runs.where('status', '=', 'done').select(['id', 'created_at']).executeTakeFirst(),
      ]);
      const changes = await changesSince(trx, projectId.data, written?.created_at);
      const suggested =
        latest?.status === 'done'
          ? await trx
              .selectFrom('plan_suggestions')
              .select('id')
              .where('run_id', '=', latest.id)
              .limit(1)
              .executeTakeFirst()
          : undefined;
      const running = latest?.status === 'queued' || latest?.status === 'running';
      return {
        suggestions: rows.sort(bySection).flatMap((row): PlanSuggestion[] => {
          const parsed = planSuggestionSchema.safeParse({
            id: row.id,
            section: row.section,
            content: row.content,
            createdAt: row.created_at.toISOString(),
            kind: row.kind,
            handEdited: row.hand_edited,
          });
          return parsed.success ? [parsed.data] : [];
        }),
        generating: running && Date.now() - latest.created_at.getTime() < GENERATION_LOST_MS,
        failure: latest?.status === 'error' ? decodePlanFailure(latest.error) : null,
        outdated:
          changes.length > 0
            ? {
                changes: changes.slice(0, CHANGES_SHOWN),
                more: Math.max(0, changes.length - CHANGES_SHOWN),
              }
            : null,
        // An update that found nothing to change left no suggestion behind.
        upToDate:
          latest?.status === 'done' &&
          suggested === undefined &&
          changes.length === 0 &&
          Date.now() - (latest.finished_at ?? latest.created_at).getTime() < UP_TO_DATE_MS,
      };
    });
    if (!state) return apiError(c, 'not_found');
    return c.json<PlanState>(state);
  });

  /** Queues the moderator's run; the suggestions arrive on the live channel. */
  async function start(c: Context<{ Variables: SessionVariables }>, kind: 'generate' | 'update') {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    try {
      const started = await withUser(db, user.id, async (trx) => {
        if (!(await membership(trx, projectId.data, user.id))) return false;
        await sql`select public.start_plan_generation(${projectId.data}, ${kind})`.execute(trx);
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
  }

  // "Plan erzeugen" writes all sections; "Aktualisieren" only what a change affects (spec 25c).
  routes.post('/generate', (c) => start(c, 'generate'));
  routes.post('/update', (c) => start(c, 'update'));

  /**
   * Accepts or rejects one suggestion, or all open ones. Accepted text goes into the plan, and
   * the versions are kept (spec 25c): the plan as it stood before the first suggestion of a
   * generation or update is written into it, and the plan once all of them are decided.
   */
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
        const decided = await sql<{
          id: string;
          section: string;
          content: unknown;
          run_id: string | null;
          kind: string;
        }>`
          select id, section, content, run_id, kind
          from public.decide_plan_suggestions(
            ${projectId.data}, ${suggestionId?.data ?? null}, ${status}
          )`.execute(trx);
        const [first] = decided.rows;
        if (!first) return;
        const accepted = status === 'accepted' ? decided.rows : [];
        // The other suggestions of the same generation or update, as they stand now.
        const others = await trx
          .selectFrom('plan_suggestions')
          .select(['status'])
          .where('project_id', '=', projectId.data)
          .where(sql<boolean>`run_id is not distinct from ${first.run_id}`)
          .where(
            'id',
            'not in',
            decided.rows.map((row) => row.id),
          )
          .execute();
        const acceptedBefore = others.some((row) => row.status === 'accepted');
        const stillOpen = others.some((row) => row.status === 'open');
        const closes = !stillOpen && (accepted.length > 0 || acceptedBefore);
        if (accepted.length === 0 && !closes) return;

        const project = await trx
          .selectFrom('projects')
          .select('language')
          .where('id', '=', projectId.data)
          .executeTakeFirstOrThrow();
        const language = project.language === 'en' ? 'en' : 'de';
        // If the plan cannot be written, the decision is rolled back and the suggestion stays.
        await documents.changePlan(projectId.data, async (doc) => {
          const keep = async (reason: 'generated' | 'updated' | 'manual') => {
            if (isPlanEmpty(doc)) return;
            // A version holds the text of the plan, not the ids of its tasks (spec 26b).
            const content = withoutTaskIds(readPlan(doc));
            await sql`select public.keep_plan_version(
              ${projectId.data}, ${JSON.stringify(content)}::jsonb, ${reason}
            )`.execute(trx);
          };
          if (accepted.length > 0) {
            // What people wrote by hand is kept before the moderator's text replaces any of it.
            if (!acceptedBefore) await keep('manual');
            for (const row of [...accepted].sort(bySection)) {
              const content = contentSchema.safeParse(row.content);
              const nodes = content.success ? content.data : [];
              writePlanSection(
                doc,
                row.section as PlanSection,
                // The tasks of the rewritten milestones keep their ids, and so their assignees
                // (spec 26b).
                row.section === 'milestones'
                  ? carryTaskIds(readPlanSections(doc).milestones ?? [], nodes)
                  : nodes,
                language,
              );
            }
          }
          if (closes) await keep(first.kind === 'update' ? 'updated' : 'generated');
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

  // The versions of the plan (spec 25c), newest first; their text is loaded one by one.
  routes.get('/versions', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const versions = await withUser(db, user.id, async (trx) => {
      if (!(await membership(trx, projectId.data, user.id))) return undefined;
      return await versionRows(trx, projectId.data).execute();
    });
    if (!versions) return apiError(c, 'not_found');
    return c.json<PlanVersion[]>(versions.flatMap(toVersion));
  });

  routes.get('/versions/:versionId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const versionId = z.uuid().safeParse(c.req.param('versionId'));
    if (!projectId.success || !versionId.success) return apiError(c, 'not_found');

    const row = await withUser(db, user.id, (trx) =>
      versionRows(trx, projectId.data)
        .select('plan_versions.content')
        .where('plan_versions.id', '=', versionId.data)
        .executeTakeFirst(),
    );
    const [version] = row ? toVersion(row) : [];
    if (!row || !version) return apiError(c, 'not_found');
    const content = contentSchema.safeParse(row.content);
    return c.json<PlanVersionContent>({ ...version, content: content.success ? content.data : [] });
  });

  return routes;
}

/** The versions of a project; RLS shows them to its members only. */
function versionRows(trx: Transaction<DB>, projectId: string) {
  return trx
    .selectFrom('plan_versions')
    .leftJoin('users', 'users.id', 'plan_versions.created_by')
    .select([
      'plan_versions.id',
      'plan_versions.number',
      'plan_versions.reason',
      'plan_versions.created_at',
      'users.name as created_by_name',
    ])
    .where('plan_versions.project_id', '=', projectId)
    .orderBy('plan_versions.number', 'desc');
}

function toVersion(row: {
  id: string;
  number: number;
  reason: string;
  created_at: Date;
  created_by_name: string | null;
}): PlanVersion[] {
  const parsed = planVersionSchema.safeParse({
    id: row.id,
    number: row.number,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by_name,
  });
  return parsed.success ? [parsed.data] : [];
}
