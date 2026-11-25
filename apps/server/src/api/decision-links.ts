import type { DB } from '@covibes/db';
import {
  decisionLinkInputSchema,
  decisionLinkTargetQuerySchema,
  MAX_DECISION_LINKS,
  projectIdSchema,
  readRoadmap,
  sameDecisionTarget,
  type ApiErrorCode,
  type DecisionLink,
  type DecisionLinkCandidate,
  type DecisionLinkTarget,
} from '@covibes/shared';
import { Hono, type Context } from 'hono';
import { sql, type Selectable } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type AppDb } from '@server/db/database';

type Routes = Context<{ Variables: SessionVariables }>;
type Scope = { projectId: string; userId: string; boards: { id: string; title: string }[] };
type Documents = Pick<BoardDocuments, 'readBoard' | 'readPlanSections'>;

async function authorize(db: AppDb, c: Routes, write = false): Promise<Scope | ApiErrorCode> {
  const user = c.get('user');
  if (!user) return 'unauthorized';
  const project = projectIdSchema.safeParse(c.req.param('projectId'));
  if (!project.success) return 'not_found';
  return withUser(db, user.id, async (trx) => {
    const member = await trx
      .selectFrom('project_members')
      .select('role')
      .where('project_id', '=', project.data)
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    if (!member) return 'not_found';
    if (write && member.role === 'viewer') return 'forbidden';
    const boards = await trx
      .selectFrom('boards')
      .select(['id', 'title'])
      .where('project_id', '=', project.data)
      .orderBy('position')
      .orderBy('id')
      .execute();
    return { projectId: project.data, userId: user.id, boards };
  });
}

async function targets(documents: Documents, scope: Scope): Promise<DecisionLinkCandidate[]> {
  const result: DecisionLinkCandidate[] = [];
  for (const board of scope.boards) {
    for (const node of (await documents.readBoard(board.id)).nodes) {
      if (node.type !== 'block') continue;
      result.push({
        target: { kind: 'block', boardId: board.id, id: node.id },
        label: node.label || node.id,
        context: board.title,
      });
    }
  }
  const roadmap = readRoadmap(await documents.readPlanSections(scope.projectId));
  for (const milestone of roadmap.milestones) {
    for (const task of milestone.tasks) {
      if (task.id)
        result.push({
          target: { kind: 'task', id: task.id },
          label: task.text,
          context: milestone.title,
        });
    }
  }
  return result;
}

function targetOf(row: Selectable<DB['decision_links']>): DecisionLinkTarget {
  return row.target_kind === 'block' && row.board_id
    ? { kind: 'block', boardId: row.board_id, id: row.target_id }
    : { kind: 'task', id: row.target_id };
}

/** Explicit project dependencies: documents provide current labels, SQL provides relationships. */
export function decisionLinkRoutes(db: AppDb, auth: Auth, documents: Documents) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const scope = await authorize(db, c);
    if (typeof scope === 'string') return apiError(c, scope);
    const rows = await withUser(db, scope.userId, (trx) =>
      trx
        .selectFrom('decision_links')
        .innerJoin('decisions', 'decisions.id', 'decision_links.decision_id')
        .selectAll('decision_links')
        .select(['decisions.topic', 'decisions.status'])
        .where('decision_links.project_id', '=', scope.projectId)
        .orderBy('decision_links.created_at')
        .orderBy('decision_links.id')
        .execute(),
    );
    const candidates = rows.length ? await targets(documents, scope) : [];
    const links: DecisionLink[] = rows.map((row) => {
      const target = targetOf(row);
      const current = candidates.find((candidate) => sameDecisionTarget(candidate.target, target));
      return {
        id: row.id,
        decisionId: row.decision_id,
        topic: row.topic,
        status: row.status === 'decided' ? 'decided' : 'open',
        target,
        label: current?.label ?? row.target_label,
        context: current?.context ?? '',
        available: current !== undefined,
      };
    });
    return c.json(links);
  });

  routes.get('/targets', async (c) => {
    const scope = await authorize(db, c);
    if (typeof scope === 'string') return apiError(c, scope);
    const query = decisionLinkTargetQuerySchema.safeParse(c.req.query());
    if (!query.success) return apiError(c, 'invalid_input');
    const needle = query.data.q.toLocaleLowerCase();
    const matches = (await targets(documents, scope)).filter((candidate) =>
      `${candidate.label} ${candidate.context}`.toLocaleLowerCase().includes(needle),
    );
    // Keep both kinds discoverable even on a large board before a search was entered.
    const blocks = matches.filter((candidate) => candidate.target.kind === 'block');
    const tasks = matches.filter((candidate) => candidate.target.kind === 'task');
    const available = [];
    for (let index = 0; index < 50 && (blocks[index] || tasks[index]); index++) {
      if (blocks[index]) available.push(blocks[index]);
      if (tasks[index]) available.push(tasks[index]);
    }
    return c.json({ targets: available.slice(0, 50), more: matches.length > 50 });
  });

  routes.post('/', async (c) => {
    const scope = await authorize(db, c, true);
    if (typeof scope === 'string') return apiError(c, scope);
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = decisionLinkInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');
    const candidate = (await targets(documents, scope)).find((entry) =>
      sameDecisionTarget(entry.target, input.data.target),
    );
    if (!candidate) return apiError(c, 'not_found');
    const outcome = await withUser(db, scope.userId, async (trx) => {
      // Serializing per project bounds link count and makes concurrent duplicate adds idempotent.
      await sql`select pg_advisory_xact_lock(hashtextextended(${scope.projectId}, 50))`.execute(
        trx,
      );
      const decision = await trx
        .selectFrom('decisions')
        .select('id')
        .where('project_id', '=', scope.projectId)
        .where('id', '=', input.data.decisionId)
        .executeTakeFirst();
      if (!decision) return { error: 'not_found' as const };
      const target = input.data.target;
      const boardId = target.kind === 'block' ? target.boardId : null;
      const existing = await trx
        .selectFrom('decision_links')
        .select('id')
        .where('project_id', '=', scope.projectId)
        .where('decision_id', '=', input.data.decisionId)
        .where('target_kind', '=', target.kind)
        .where('target_id', '=', target.id)
        .where('board_id', boardId === null ? 'is' : '=', boardId)
        .executeTakeFirst();
      if (existing) return { id: existing.id };
      const count = await trx
        .selectFrom('decision_links')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('project_id', '=', scope.projectId)
        .executeTakeFirstOrThrow();
      if (Number(count.count) >= MAX_DECISION_LINKS) return { error: 'limit_reached' as const };
      return trx
        .insertInto('decision_links')
        .values({
          project_id: scope.projectId,
          decision_id: input.data.decisionId,
          target_kind: target.kind,
          target_id: target.id,
          board_id: boardId,
          target_label: candidate.label.slice(0, 300),
          created_by: scope.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    });
    if ('error' in outcome) return apiError(c, outcome.error);
    return c.json(outcome);
  });

  routes.delete('/:linkId', async (c) => {
    const scope = await authorize(db, c, true);
    if (typeof scope === 'string') return apiError(c, scope);
    const id = z.uuid().safeParse(c.req.param('linkId'));
    if (!id.success) return apiError(c, 'not_found');
    await withUser(db, scope.userId, (trx) =>
      trx
        .deleteFrom('decision_links')
        .where('project_id', '=', scope.projectId)
        .where('id', '=', id.data)
        .execute(),
    );
    return c.body(null, 204);
  });
  return routes;
}
