import type { DB } from '@covibes/db';
import {
  DECISION_STATUSES,
  decisionAlternativeSchema,
  decisionOperationSchema,
  type AgentKey,
  type DecisionAlternative,
  type DecisionOperation,
  type DecisionStatus,
  type ProposalReason,
} from '@covibes/shared';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import { notifyLive } from '@server/realtime/notifications';

const storedOperationsSchema = z.array(decisionOperationSchema);

/** Stored decision operations, or none if they no longer read. */
export function readDecisionOperations(stored: unknown): DecisionOperation[] {
  const parsed = storedOperationsSchema.safeParse(stored);
  return parsed.success ? parsed.data : [];
}

/** Stored alternatives of a decision, or none if they no longer read. */
export function readAlternatives(stored: unknown): DecisionAlternative[] {
  const parsed = z.array(decisionAlternativeSchema).safeParse(stored);
  return parsed.success ? parsed.data : [];
}

function isStatus(value: string): value is DecisionStatus {
  return (DECISION_STATUSES as readonly string[]).includes(value);
}

/** Criteria and decisions of a project as the agents see them (spec 16a). */
export type DecisionContext = {
  criteria: { id: string; text: string }[];
  decisions: {
    id: string;
    topic: string;
    status: DecisionStatus;
    value: string | null;
    reasoning: string;
  }[];
  /** Decisions that wait for someone to confirm them. */
  pending: DecisionOperation[];
};

export async function loadDecisionContext(
  admin: Kysely<DB>,
  projectId: string,
): Promise<DecisionContext> {
  const [criteria, decisions, proposals] = await Promise.all([
    admin
      .selectFrom('criteria')
      .select(['id', 'text'])
      .where('project_id', '=', projectId)
      .orderBy('created_at')
      .orderBy('id')
      .execute(),
    admin
      .selectFrom('decisions')
      .select(['id', 'topic', 'status', 'value', 'reasoning'])
      .where('project_id', '=', projectId)
      .orderBy('created_at')
      .orderBy('id')
      .execute(),
    admin
      .selectFrom('proposals')
      .select('operations')
      .where('project_id', '=', projectId)
      .where('kind', '=', 'decision')
      .where('status', '=', 'open')
      .orderBy('created_at')
      .execute(),
  ]);
  return {
    criteria,
    decisions: decisions.flatMap((decision) =>
      isStatus(decision.status) ? [{ ...decision, status: decision.status }] : [],
    ),
    pending: proposals.flatMap((proposal) => readDecisionOperations(proposal.operations)),
  };
}

function hasCode(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null)?.code === code;
}

/** How the moderator's tools write criteria and decisions for one run (spec 16a). */
export type DecisionWriter = {
  /** Criteria, decisions and pending decisions, read fresh for every call. */
  load: () => Promise<DecisionContext>;
  /** Adds criteria in the agent's name; the log names the agent. */
  addCriteria: (texts: readonly string[]) => Promise<void>;
  /** Removes criteria by id and returns how many existed. */
  removeCriteria: (ids: readonly string[]) => Promise<number>;
  /** Notes a topic as open; false if the topic exists already. */
  open: (topic: string) => Promise<boolean>;
  /** Records a decision as confirmed by `userId`; false if the topic is decided already. */
  decide: (operation: DecisionOperation, userId: string | null) => Promise<boolean>;
  /** Proposes a decision, to be confirmed by someone in the team. */
  propose: (operation: DecisionOperation, reason: ProposalReason) => Promise<void>;
};

export function decisionWriter(
  admin: Kysely<DB>,
  run: { id: string; projectId: string; agentKey: AgentKey },
): DecisionWriter {
  let queue = Promise.resolve();
  function serialized<T>(write: () => Promise<T>): Promise<T> {
    const next = queue.then(write);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  return {
    load: () => loadDecisionContext(admin, run.projectId),
    addCriteria: (texts) =>
      serialized(async () => {
        // One after the other, so the criteria keep the order they were stated in.
        for (const text of texts) {
          await admin
            .insertInto('criteria')
            .values({ project_id: run.projectId, text, created_by_agent: run.agentKey })
            .execute();
        }
      }),
    removeCriteria: (ids) =>
      serialized(async () => {
        if (ids.length === 0) return 0;
        // The log trigger reads who removes from the transaction.
        return await admin.transaction().execute(async (trx) => {
          await sql`select set_config('app.agent_key', ${run.agentKey}, true)`.execute(trx);
          const removed = await trx
            .deleteFrom('criteria')
            .where('project_id', '=', run.projectId)
            .where('id', 'in', [...ids])
            .executeTakeFirst();
          return Number(removed.numDeletedRows);
        });
      }),
    open: (topic) =>
      serialized(async () => {
        try {
          await admin
            .insertInto('decisions')
            .values({ project_id: run.projectId, topic, recorded_by_agent: run.agentKey })
            .execute();
          return true;
        } catch (error) {
          if (hasCode(error, '23505')) return false;
          throw error;
        }
      }),
    decide: (operation, userId) =>
      serialized(async () => {
        try {
          await sql`select private.decide(
            ${run.projectId}, ${operation.topic}, ${operation.value}, ${operation.reasoning},
            ${JSON.stringify(operation.alternatives)}::jsonb, ${run.agentKey}, ${userId}
          )`.execute(admin);
          return true;
        } catch (error) {
          // Decided in the meantime: it has to be reopened first.
          if (hasCode(error, '55000')) return false;
          throw error;
        }
      }),
    // One proposal per decision, so the team confirms each on its own.
    propose: (operation, reason) =>
      serialized(async () => {
        await admin
          .insertInto('proposals')
          .values({
            project_id: run.projectId,
            board_id: null,
            run_id: run.id,
            agent_key: run.agentKey,
            kind: 'decision',
            reason,
            operations: JSON.stringify([operation]),
          })
          .execute();
        await notifyLive(admin, { kind: 'proposals', projectId: run.projectId });
      }),
  };
}
