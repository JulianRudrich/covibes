import type { DB } from '@covibes/db';
import {
  buildCodingPackage,
  codingPackageSummary,
  codingPackageTexts,
  exportFileName,
  MAX_MILESTONES,
  PACKAGE_TEXT_KINDS,
  packageTextInputSchema,
  packageTextKindSchema,
  planSectionsOf,
  projectIdSchema,
  readRoadmap,
  type AcceptedPackageSuggestion,
  type CodingPackageInput,
  type CodingPackageOverview,
  type PackageSpecRun,
  type PackageSuggestion,
  type PackageTexts,
} from '@covibes/shared';
import { strToU8, zipSync } from 'fflate';
import { Hono } from 'hono';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';

import { loadDecisions } from '@server/api/decisions';
import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type AppDb } from '@server/db/database';
import { loadAssignees } from '@server/plan/assignees';
import { decodePlanFailure } from '@server/plan/failure';
import type { LivePublisher } from '@server/realtime/realtime';

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

type Documents = Pick<BoardDocuments, 'readBoard' | 'readPlan'>;

/** A run without an end after this time is taken as lost, like the database does (0027). */
const SUGGESTION_LOST_MS = 10 * 60_000;

const milestoneSchema = z.coerce.number().int().min(1).max(MAX_MILESTONES);

/**
 * Where the run that writes a milestone's specs stands; null once it is done, since the specs
 * themselves say so then.
 */
function specRunState(row: {
  status: string;
  error: string | null;
  created_at: Date;
}): PackageSpecRun | null {
  if (row.status === 'done') return null;
  const waits = row.status === 'queued' || row.status === 'running';
  if (waits && Date.now() - row.created_at.getTime() < SUGGESTION_LOST_MS) {
    return { status: 'running' };
  }
  return {
    status: 'failed',
    failure:
      row.status === 'error' ? decodePlanFailure(row.error) : { kind: 'failed', resetsAt: null },
  };
}

/** Where a suggestion stands, from its row and the run that writes it. */
function suggestionState(row: {
  content: string | null;
  status: string;
  error: string | null;
  created_at: Date;
}): PackageSuggestion {
  if (row.content) return { status: 'ready', content: row.content };
  const waits = row.status === 'queued' || row.status === 'running';
  if (waits && Date.now() - row.created_at.getTime() < SUGGESTION_LOST_MS) {
    return { status: 'running' };
  }
  return {
    status: 'failed',
    failure:
      row.status === 'error' ? decodePlanFailure(row.error) : { kind: 'failed', resetsAt: null },
  };
}

/**
 * What a project holds right now, as the package is built from it; undefined for someone who is
 * no member. The plan and the boards are read as they stand, also while people have them open.
 */
async function gather(
  db: AppDb,
  documents: Documents,
  projectId: string,
  userId: string,
): Promise<
  | {
      input: CodingPackageInput;
      canEdit: boolean;
      suggestions: CodingPackageOverview['suggestions'];
      /** The run that writes a milestone's specs, by the milestone's number. */
      specRuns: Map<number, PackageSpecRun>;
    }
  | undefined
> {
  const stored = await withUser(db, userId, async (trx) => {
    const member = await membership(trx, projectId, userId);
    if (!member) return undefined;
    const project = await trx
      .selectFrom('projects')
      .select(['name', 'language'])
      .where('id', '=', projectId)
      .executeTakeFirstOrThrow();
    const boards = await trx
      .selectFrom('boards')
      .select(['id', 'title'])
      .where('project_id', '=', projectId)
      .orderBy('kind', 'desc') // 'main' before 'extra'
      .orderBy('position')
      .orderBy('created_at')
      .execute();
    const criteria = await trx
      .selectFrom('criteria')
      .select('text')
      .where('project_id', '=', projectId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    const texts = await trx
      .selectFrom('package_texts')
      .select(['kind', 'content'])
      .where('project_id', '=', projectId)
      .execute();
    const suggestions = await trx
      .selectFrom('package_suggestions')
      .innerJoin('ai_runs', 'ai_runs.id', 'package_suggestions.run_id')
      .select([
        'package_suggestions.kind',
        'package_suggestions.content',
        'ai_runs.status',
        'ai_runs.error',
        'ai_runs.created_at',
      ])
      .where('package_suggestions.project_id', '=', projectId)
      .execute();
    const specs = await trx
      .selectFrom('package_specs')
      .select(['task_text', 'content'])
      .where('project_id', '=', projectId)
      .execute();
    const specRuns = await trx
      .selectFrom('package_spec_runs')
      .innerJoin('ai_runs', 'ai_runs.id', 'package_spec_runs.run_id')
      .select([
        'package_spec_runs.milestone',
        'ai_runs.status',
        'ai_runs.error',
        'ai_runs.created_at',
      ])
      .where('package_spec_runs.project_id', '=', projectId)
      .execute();
    return {
      role: member.role,
      project,
      boards,
      criteria,
      texts,
      suggestions,
      specs,
      specRuns,
      decisions: await loadDecisions(trx, projectId),
      assignees: await loadAssignees(trx, projectId),
    };
  });
  if (!stored) return undefined;

  const plan = await documents.readPlan(projectId);
  const boards: CodingPackageInput['boards'][number][] = [];
  // One after the other: a board nobody has open is read from the database.
  for (const board of stored.boards) {
    boards.push({ title: board.title, ...(await documents.readBoard(board.id)) });
  }
  const texts: PackageTexts = { code_standards: '', ui_direction: '' };
  const suggestions: CodingPackageOverview['suggestions'] = {
    code_standards: null,
    ui_direction: null,
  };
  for (const kind of PACKAGE_TEXT_KINDS) {
    texts[kind] = stored.texts.find((text) => text.kind === kind)?.content ?? '';
    const suggestion = stored.suggestions.find((row) => row.kind === kind);
    suggestions[kind] = suggestion ? suggestionState(suggestion) : null;
  }
  const specRuns = new Map<number, PackageSpecRun>();
  for (const row of stored.specRuns) {
    const state = specRunState(row);
    if (state) specRuns.set(row.milestone, state);
  }
  return {
    canEdit: stored.role !== 'viewer',
    suggestions,
    specRuns,
    input: {
      projectName: stored.project.name,
      language: stored.project.language === 'en' ? 'en' : 'de',
      date: new Date(),
      plan,
      assignees: new Map(
        [...stored.assignees].map(([taskId, assignee]) => [taskId, assignee.name]),
      ),
      specs: new Map(stored.specs.map((spec) => [spec.task_text, spec.content])),
      decisions: stored.decisions,
      criteria: stored.criteria.map((criterion) => criterion.text),
      boards,
      texts,
    },
  };
}

/**
 * `/api/projects/:projectId/package` (specs 27b to 27d): the package for coding agents. Members
 * see what it holds and download it as a ZIP; owners and editors write the two texts the plan
 * does not hold, ask the moderator for a suggestion for one, and have it write the feature specs
 * of a milestone out. The package itself is built from what the project holds, without a model.
 */
export function packageRoutes(db: AppDb, auth: Auth, live: LivePublisher, documents: Documents) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const project = await gather(db, documents, projectId.data, user.id);
    if (!project) return apiError(c, 'not_found');
    const summary = codingPackageSummary(project.input);
    return c.json<CodingPackageOverview>({
      ...summary,
      milestoneSpecs: summary.milestoneSpecs.map((milestone) => ({
        ...milestone,
        run: project.specRuns.get(milestone.number) ?? null,
      })),
      language: project.input.language,
      texts: project.input.texts,
      suggestions: project.suggestions,
      canEdit: project.canEdit,
    });
  });

  /**
   * Asks the moderator for a suggestion for a text (spec 27c). The run is queued for the worker
   * and the answer returns at once; the suggestion arrives with the live event `package`.
   */
  routes.post('/texts/:kind/suggestion', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const kind = packageTextKindSchema.safeParse(c.req.param('kind'));
    if (!projectId.success || !kind.success) return apiError(c, 'not_found');

    try {
      const started = await withUser(db, user.id, async (trx) => {
        if (!(await membership(trx, projectId.data, user.id))) return false;
        await sql`select public.start_package_suggestion(${projectId.data}, ${kind.data})`.execute(
          trx,
        );
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

  /** Takes a written suggestion over as the team's text; the answer is that text. */
  routes.post('/texts/:kind/suggestion/accept', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const kind = packageTextKindSchema.safeParse(c.req.param('kind'));
    if (!projectId.success || !kind.success) return apiError(c, 'not_found');

    try {
      const content = await withUser(db, user.id, async (trx) => {
        if (!(await membership(trx, projectId.data, user.id))) return undefined;
        const accepted = await sql<{ content: string | null }>`
          select public.accept_package_suggestion(${projectId.data}, ${kind.data}) as content
        `.execute(trx);
        return accepted.rows[0]?.content ?? undefined;
      });
      // Nobody of the project, or no written suggestion waits (any more).
      if (content === undefined) return apiError(c, 'not_found');
      return c.json<AcceptedPackageSuggestion>({ content });
    } catch (error) {
      if (sqlState(error) === '42501') return apiError(c, 'forbidden');
      throw error;
    }
  });

  /** Dismisses a suggestion, also one that is still being written or whose run failed. */
  routes.delete('/texts/:kind/suggestion', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const kind = packageTextKindSchema.safeParse(c.req.param('kind'));
    if (!projectId.success || !kind.success) return apiError(c, 'not_found');

    const outcome = await withUser(db, user.id, async (trx) => {
      const member = await membership(trx, projectId.data, user.id);
      if (!member) return 'not_found' as const;
      if (member.role === 'viewer') return 'forbidden' as const;
      await trx
        .deleteFrom('package_suggestions')
        .where('project_id', '=', projectId.data)
        .where('kind', '=', kind.data)
        .execute();
      return 'done' as const;
    });
    if (outcome !== 'done') return apiError(c, outcome);
    live.publish(projectId.data, { type: 'package' });
    return c.body(null, 204);
  });

  /** Stores one of the team's texts; an empty one removes it. The database checks who may. */
  routes.put('/texts/:kind', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const kind = packageTextKindSchema.safeParse(c.req.param('kind'));
    if (!projectId.success || !kind.success) return apiError(c, 'not_found');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = packageTextInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');

    try {
      const outcome = await withUser(db, user.id, async (trx) => {
        const member = await membership(trx, projectId.data, user.id);
        if (!member) return 'not_found' as const;
        // Removing a text as a viewer changes nothing and raises nothing, so it is said here.
        if (member.role === 'viewer') return 'forbidden' as const;
        if (input.data.content === '') {
          await trx
            .deleteFrom('package_texts')
            .where('project_id', '=', projectId.data)
            .where('kind', '=', kind.data)
            .execute();
          return 'done' as const;
        }
        await trx
          .insertInto('package_texts')
          .values({
            project_id: projectId.data,
            kind: kind.data,
            content: input.data.content,
            updated_by: user.id,
          })
          .onConflict((conflict) =>
            conflict
              .columns(['project_id', 'kind'])
              .doUpdateSet({ content: input.data.content, updated_by: user.id }),
          )
          .execute();
        return 'done' as const;
      });
      if (outcome !== 'done') return apiError(c, outcome);
      return c.body(null, 204);
    } catch (error) {
      if (sqlState(error) === '42501') return apiError(c, 'forbidden');
      throw error;
    }
  });

  /**
   * Asks the moderator to write the specs of a milestone out (spec 27d). The run is queued for
   * the worker and the answer returns at once; the specs arrive with the live event `package`.
   */
  routes.post('/specs/:milestone', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const milestone = milestoneSchema.safeParse(c.req.param('milestone'));
    if (!projectId.success || !milestone.success) return apiError(c, 'not_found');

    const member = await withUser(db, user.id, (trx) => membership(trx, projectId.data, user.id));
    if (!member) return apiError(c, 'not_found');
    // The milestone must be one of the plan as it stands, with tasks to write specs for.
    const { milestones } = readRoadmap(planSectionsOf(await documents.readPlan(projectId.data)));
    if ((milestones[milestone.data - 1]?.tasks.length ?? 0) === 0) return apiError(c, 'not_found');

    try {
      await withUser(db, user.id, (trx) =>
        sql`select public.start_package_specs(${projectId.data}, ${milestone.data})`.execute(trx),
      );
      return c.body(null, 202);
    } catch (error) {
      const state = sqlState(error);
      if (state === '55000') return apiError(c, 'already_running');
      if (state === '42501') return apiError(c, 'forbidden');
      throw error;
    }
  });

  /** The package as a ZIP, with its files at the top, named after the project. */
  routes.get('/download', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const project = await gather(db, documents, projectId.data, user.id);
    if (!project) return apiError(c, 'not_found');
    const files = buildCodingPackage(project.input);
    // Without a plan there is no package.
    if (files.length === 0) return apiError(c, 'not_found');

    const zip = zipSync(
      Object.fromEntries(files.map((file) => [file.path, strToU8(file.content)])),
      { level: 6, mtime: project.input.date },
    );
    const { language, projectName } = project.input;
    const name = exportFileName(projectName, codingPackageTexts(language).fileName);
    return c.body(new Uint8Array(zip), 200, {
      'content-type': 'application/zip',
      // The name holds lowercase letters, digits and hyphens only.
      'content-disposition': `attachment; filename="${name}.zip"`,
      'cache-control': 'no-store',
    });
  });

  return routes;
}
