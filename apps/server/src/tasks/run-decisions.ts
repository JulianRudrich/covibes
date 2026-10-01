import type { DB } from '@covibes/db';
import {
  DECISION_STATUSES,
  decisionAlternativeSchema,
  decisionOperationSchema,
  type Comparison,
  type DecisionAlternative,
  type DecisionOperation,
  type DecisionStatus,
  type ProposalReason,
  type VariantsOperation,
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

/** Topic and names of stored variants; their operations are not needed for the agents' context. */
const variantNamesSchema = z
  .array(z.object({ topic: z.string(), variants: z.array(z.object({ name: z.string() })) }))
  .transform((operations) =>
    operations.map((operation) => ({
      topic: operation.topic,
      names: operation.variants.map((variant) => variant.name),
    })),
  );

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
  /** Votes that are open (spec 16b). */
  votes: { topic: string; options: string[] }[];
  /** Variants that wait for the team to adopt one (spec 17). */
  openVariants: { topic: string; names: string[] }[];
};

export async function loadDecisionContext(
  admin: Kysely<DB>,
  projectId: string,
): Promise<DecisionContext> {
  const [criteria, decisions, proposals, votes] = await Promise.all([
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
      .select(['kind', 'operations'])
      .where('project_id', '=', projectId)
      .where('kind', 'in', ['decision', 'variants'])
      .where('status', '=', 'open')
      .orderBy('created_at')
      .execute(),
    admin
      .selectFrom('votes')
      .select(['topic', 'options'])
      .where('project_id', '=', projectId)
      .where('status', '=', 'open')
      .orderBy('created_at')
      .execute(),
  ]);
  return {
    criteria,
    decisions: decisions.flatMap((decision) =>
      isStatus(decision.status) ? [{ ...decision, status: decision.status }] : [],
    ),
    pending: proposals
      .filter((proposal) => proposal.kind === 'decision')
      .flatMap((proposal) => readDecisionOperations(proposal.operations)),
    openVariants: proposals
      .filter((proposal) => proposal.kind === 'variants')
      .flatMap((proposal) => {
        const parsed = variantNamesSchema.safeParse(proposal.operations);
        return parsed.success ? parsed.data : [];
      }),
    votes: votes.map((vote) => ({
      topic: vote.topic,
      options: z.array(z.string()).catch([]).parse(vote.options),
    })),
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
  /** Shows a comparison as a card in the run's answer; a second one replaces the first. */
  compare: (comparison: Comparison) => Promise<void>;
  /** Starts a vote as a card in the run's answer; false if the answer has a vote already. */
  startVote: (topic: string, options: readonly string[]) => Promise<boolean>;
  /** Stores variants as a proposal of the board, for the team to adopt one (spec 17). */
  proposeVariants: (boardId: string, operation: VariantsOperation) => Promise<void>;
};

export function decisionWriter(
  admin: Kysely<DB>,
  /** `messageId` is the run's answer, which carries its comparison and its vote. */
  run: { id: string; projectId: string; agentKey: string; messageId: string },
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
    compare: (comparison) =>
      serialized(async () => {
        await admin
          .insertInto('comparisons')
          .values({
            project_id: run.projectId,
            message_id: run.messageId,
            topic: comparison.topic,
            data: JSON.stringify(comparison),
          })
          .onConflict((conflict) =>
            conflict.column('message_id').doUpdateSet({
              topic: comparison.topic,
              data: JSON.stringify(comparison),
            }),
          )
          .execute();
        await notifyLive(admin, {
          kind: 'message',
          projectId: run.projectId,
          messageId: run.messageId,
        });
      }),
    startVote: (topic, options) =>
      serialized(async () => {
        try {
          await admin
            .insertInto('votes')
            .values({
              project_id: run.projectId,
              message_id: run.messageId,
              topic,
              options: JSON.stringify(options),
            })
            .execute();
        } catch (error) {
          // One vote per answer, and one open vote per topic.
          if (hasCode(error, '23505')) return false;
          throw error;
        }
        await notifyLive(admin, {
          kind: 'message',
          projectId: run.projectId,
          messageId: run.messageId,
        });
        return true;
      }),
    proposeVariants: (boardId, operation) =>
      serialized(async () => {
        await admin
          .insertInto('proposals')
          .values({
            project_id: run.projectId,
            board_id: boardId,
            run_id: run.id,
            agent_key: run.agentKey,
            kind: 'variants',
            reason: 'variants',
            operations: JSON.stringify([operation]),
          })
          .execute();
        await notifyLive(admin, { kind: 'proposals', projectId: run.projectId });
      }),
  };
}
