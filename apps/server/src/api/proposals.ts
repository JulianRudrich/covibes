import type { DB } from '@covibes/db';
import {
  applyOperations,
  canvasOperationSchema,
  changedNodeIds,
  proposalSchema,
  projectIdSchema,
  type ApiErrorCode,
  type ApplyResult,
  type Proposal,
} from '@covibes/shared';
import { Hono, type Context } from 'hono';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { isAgentKey } from '@server/chat/rows';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type AppDb } from '@server/db/database';
import type { LivePublisher } from '@server/realtime/realtime';

function membership(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .select('role')
    .executeTakeFirst();
}

type ProposalRow = {
  id: string;
  project_id: string;
  board_id: string;
  agent_key: string;
  status: string;
  reason: string;
  operations: unknown;
  names: unknown;
  created_at: Date;
  updated_at: Date;
};

/** The API shape of a row, or undefined if it does not read (e.g. from another version). */
function toProposal(row: ProposalRow): Proposal | undefined {
  const parsed = proposalSchema.safeParse({
    id: row.id,
    projectId: row.project_id,
    boardId: row.board_id,
    agentKey: row.agent_key,
    status: row.status,
    reason: row.reason,
    operations: row.operations,
    names: row.names,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
  return parsed.success ? parsed.data : undefined;
}

const PROPOSAL_COLUMNS = [
  'id',
  'project_id',
  'board_id',
  'agent_key',
  'status',
  'reason',
  'operations',
  'names',
  'created_at',
  'updated_at',
] as const;

type Decision<T> = { ok: true; value: T } | { ok: false; code: ApiErrorCode; detail?: string };

/** Someone edits a node the proposal changes; the decision is rolled back. */
class BeingEdited extends Error {
  constructor(readonly editor: string) {
    super(`${editor} is editing a node of the proposal`);
  }
}

function pathIds(c: Context) {
  const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
  const proposalId = z.uuid().safeParse(c.req.param('proposalId'));
  return projectId.success && proposalId.success
    ? { projectId: projectId.data, proposalId: proposalId.data }
    : undefined;
}

/**
 * `/api/projects/:projectId/proposals` (spec 13): the open proposals of agents, and applying or
 * rejecting them (owners and editors). Applying claims the decision first and then writes the
 * operations into the board with the agent as author; if a node to change is being edited, the
 * claim is rolled back and the proposal stays open.
 */
export function proposalRoutes(
  db: AppDb,
  auth: Auth,
  live: LivePublisher,
  documents: BoardDocuments,
) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const rows = await withUser(db, user.id, async (trx) => {
      if (!(await membership(trx, projectId.data, user.id))) return undefined;
      return await trx
        .selectFrom('proposals')
        .select(PROPOSAL_COLUMNS)
        .where('project_id', '=', projectId.data)
        .where('status', '=', 'open')
        .orderBy('created_at')
        .orderBy('id')
        .execute();
    });
    if (!rows) return apiError(c, 'not_found');
    return c.json<Proposal[]>(rows.map(toProposal).filter((proposal) => proposal !== undefined));
  });

  /** Claims the decision on an open proposal in the user's name; `then` runs in the same claim. */
  async function decide<T>(
    c: Context<{ Variables: SessionVariables }>,
    status: 'applied' | 'rejected',
    then: (row: ProposalRow) => Promise<T>,
  ): Promise<Decision<T>> {
    const user = c.get('user');
    if (!user) return { ok: false, code: 'unauthorized' };
    const ids = pathIds(c);
    if (!ids) return { ok: false, code: 'not_found' };
    try {
      const outcome = await withUser(db, user.id, async (trx): Promise<Decision<T>> => {
        const member = await membership(trx, ids.projectId, user.id);
        if (!member) return { ok: false, code: 'not_found' };
        const row = await trx
          .selectFrom('proposals')
          .select(PROPOSAL_COLUMNS)
          .where('id', '=', ids.proposalId)
          .where('project_id', '=', ids.projectId)
          .executeTakeFirst();
        if (!row) return { ok: false, code: 'not_found' };
        if (member.role === 'viewer') return { ok: false, code: 'forbidden' };
        if (row.status !== 'open') return { ok: false, code: 'already_decided' };

        // The row lock of the update settles two people deciding at the same moment.
        const claimed = await trx
          .updateTable('proposals')
          .set({ status, decided_at: sql`now()`, decided_by: user.id })
          .where('id', '=', row.id)
          .where('status', '=', 'open')
          .executeTakeFirst();
        if (claimed.numUpdatedRows === 0n) return { ok: false, code: 'already_decided' };
        return { ok: true, value: await then(row) };
      });
      if (outcome.ok) live.publish(ids.projectId, { type: 'proposals' });
      return outcome;
    } catch (error) {
      if (error instanceof BeingEdited) {
        return { ok: false, code: 'being_edited', detail: error.editor };
      }
      throw error;
    }
  }

  routes.post('/:proposalId/apply', async (c) => {
    const outcome = await decide(c, 'applied', async (row) => {
      const operations = z.array(canvasOperationSchema).parse(row.operations);
      if (!isAgentKey(row.agent_key)) throw new Error(`Unknown agent ${row.agent_key}`);
      const author = { kind: 'agent' as const, agentKey: row.agent_key };
      const board = { boardId: row.board_id, projectId: row.project_id };
      return await documents.changeBoard(board, (doc, locks) => {
        // Humans take precedence: nothing changes a node that someone is editing right now.
        for (const id of operations.flatMap(changedNodeIds)) {
          const lock = locks.get(id);
          if (lock) throw new BeingEdited(lock.name);
        }
        return applyOperations(doc, operations, author);
      });
    });
    if (!outcome.ok) return apiError(c, outcome.code, outcome.detail);
    return c.json<ApplyResult>(outcome.value);
  });

  routes.post('/:proposalId/reject', async (c) => {
    const outcome = await decide(c, 'rejected', () => Promise.resolve(null));
    if (!outcome.ok) return apiError(c, outcome.code);
    return c.body(null, 204);
  });

  return routes;
}
