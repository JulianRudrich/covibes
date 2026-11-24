import {
  PLAN_SECTIONS,
  projectIdSchema,
  projectSearchQuerySchema,
  type PlanNode,
  type ProjectSearchResult,
  type ProjectSearchResults,
} from '@covibes/shared';
import { Hono } from 'hono';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type AppDb } from '@server/db/database';

const PER_KIND = 20;
function planText(nodes: readonly PlanNode[]): string {
  return nodes.map((node) => node.text ?? planText(node.content ?? [])).join(' ');
}
function snippet(text: string, query: string): string {
  const match = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, match - 60);
  return `${start > 0 ? '…' : ''}${text.slice(start, start + 240)}${text.length > start + 240 ? '…' : ''}`;
}

/** Search only content of a project the caller can read. No cross-project index bypasses RLS. */
export function projectSearchRoutes(
  db: AppDb,
  auth: Auth,
  documents: Pick<BoardDocuments, 'readBoard' | 'readPlanSections'>,
) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));
  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const project = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!project.success) return apiError(c, 'not_found');
    const input = projectSearchQuerySchema.safeParse(c.req.query());
    if (!input.success) return apiError(c, 'invalid_input');
    const q = input.data.q;
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const stored = await withUser(db, user.id, async (trx) => {
      const member = await trx
        .selectFrom('project_members')
        .select('role')
        .where('project_id', '=', project.data)
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      if (!member) return undefined;
      const [messages, decisions, boards] = await Promise.all([
        trx
          .selectFrom('messages')
          .select(['id', 'content'])
          .where('project_id', '=', project.data)
          .where('content', 'ilike', pattern)
          .orderBy('created_at', 'desc')
          .orderBy('id', 'desc')
          .limit(PER_KIND)
          .execute(),
        trx
          .selectFrom('decisions')
          .select(['id', 'topic', 'value', 'reasoning'])
          .where('project_id', '=', project.data)
          .where((eb) =>
            eb.or([
              eb('topic', 'ilike', pattern),
              eb('value', 'ilike', pattern),
              eb('reasoning', 'ilike', pattern),
            ]),
          )
          .orderBy('updated_at', 'desc')
          .orderBy('id')
          .limit(PER_KIND)
          .execute(),
        trx
          .selectFrom('boards')
          .select(['id', 'title'])
          .where('project_id', '=', project.data)
          .orderBy('position')
          .orderBy('id')
          .execute(),
      ]);
      return { messages, decisions, boards };
    });
    if (!stored) return apiError(c, 'not_found');
    const results: ProjectSearchResult[] = stored.messages.map((message) => ({
      kind: 'message',
      id: message.id,
      title: message.content.slice(0, 80),
      snippet: snippet(message.content, q),
    }));
    for (const decision of stored.decisions)
      results.push({
        kind: 'decision',
        id: decision.id,
        title: decision.topic,
        snippet: snippet(`${decision.value ?? ''} ${decision.reasoning}`, q),
      });
    let blocks = 0;
    for (const board of stored.boards) {
      if (blocks >= PER_KIND) break;
      for (const node of (await documents.readBoard(board.id)).nodes) {
        const text = `${node.label} ${node.subtitle} ${node.fields.map((field) => `${field.name} ${field.type}`).join(' ')}`;
        if (text.toLocaleLowerCase().includes(q.toLocaleLowerCase())) {
          results.push({
            kind: 'block',
            id: node.id,
            boardId: board.id,
            title: node.label,
            snippet: snippet(text, q),
          });
          if (++blocks >= PER_KIND) break;
        }
      }
    }
    const sections = await documents.readPlanSections(project.data);
    for (const section of PLAN_SECTIONS) {
      const text = planText(sections[section] ?? []);
      if (text.toLocaleLowerCase().includes(q.toLocaleLowerCase()))
        results.push({
          kind: 'plan',
          id: section,
          section,
          title: section,
          snippet: snippet(text, q),
        });
    }
    return c.json<ProjectSearchResults>({ results });
  });
  return routes;
}
