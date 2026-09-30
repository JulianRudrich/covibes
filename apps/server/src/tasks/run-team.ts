import type { DB } from '@covibes/db';
import {
  AGENT_KEYS,
  isAgentKey,
  isAgentModel,
  teamOperationSchema,
  type AgentKey,
  type AgentModel,
  type ProposalReason,
  type TeamOperation,
} from '@covibes/shared';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { notifyLive } from '@server/realtime/notifications';

const storedTeamOperationsSchema = z.array(teamOperationSchema);

/** Stored team operations, or none if they no longer read. */
export function readTeamOperations(stored: unknown): TeamOperation[] {
  const parsed = storedTeamOperationsSchema.safeParse(stored);
  return parsed.success ? parsed.data : [];
}

function byCatalogOrder(a: AgentKey, b: AgentKey): number {
  return AGENT_KEYS.indexOf(a) - AGENT_KEYS.indexOf(b);
}

export type TeamContext = {
  /** The agents of the team in catalog order, with the model an owner chose. */
  members: { key: AgentKey; model: AgentModel | null }[];
  /** Agents in open team proposals. */
  proposed: AgentKey[];
  /** Agents the team rejected in a team proposal and did not add since. */
  rejected: AgentKey[];
};

/** The project's team and what became of earlier team proposals (spec 14). */
export async function loadTeam(admin: Kysely<DB>, projectId: string): Promise<TeamContext> {
  const [rows, proposals] = await Promise.all([
    admin
      .selectFrom('project_agents')
      .select(['agent_key', 'model'])
      .where('project_id', '=', projectId)
      .execute(),
    admin
      .selectFrom('proposals')
      .select(['status', 'operations'])
      .where('project_id', '=', projectId)
      .where('kind', '=', 'team')
      .where('status', 'in', ['open', 'rejected'])
      .execute(),
  ]);
  const members = rows
    .flatMap((row) =>
      isAgentKey(row.agent_key)
        ? [{ key: row.agent_key, model: isAgentModel(row.model) ? row.model : null }]
        : [],
    )
    .sort((a, b) => byCatalogOrder(a.key, b.key));
  const inTeam = new Set(members.map((member) => member.key));
  const keysOf = (status: string) =>
    new Set(
      proposals
        .filter((proposal) => proposal.status === status)
        .flatMap((proposal) => readTeamOperations(proposal.operations))
        .map((operation) => operation.agentKey)
        .filter((key) => !inTeam.has(key)),
    );
  const proposed = keysOf('open');
  const rejected = [...keysOf('rejected')].filter((key) => !proposed.has(key));
  return {
    members,
    proposed: [...proposed].sort(byCatalogOrder),
    rejected: rejected.sort(byCatalogOrder),
  };
}

/** How the `add_agents` tool changes the team of one run's project (spec 14). */
export type TeamWriter = {
  /** The team and the agents in open team proposals, read fresh for every call. */
  load: () => Promise<{ members: ReadonlySet<AgentKey>; proposed: ReadonlySet<AgentKey> }>;
  /** Adds agents right away; the agent is the author, so `added_by` stays empty. */
  add: (keys: readonly AgentKey[]) => Promise<void>;
  /** Adds operations to the run's team proposal. */
  propose: (operations: readonly TeamOperation[], reason: ProposalReason) => Promise<void>;
};

/**
 * The team writer of one run. Like canvas proposals, everything the run proposes goes into one
 * row, and writes happen one after the other.
 */
export function teamWriter(
  admin: Kysely<DB>,
  run: { id: string; projectId: string; agentKey: AgentKey },
): TeamWriter {
  let queue = Promise.resolve();
  function serialized(write: () => Promise<void>): Promise<void> {
    const next = queue.then(write);
    queue = next.catch(() => undefined);
    return next;
  }

  return {
    load: async () => {
      const team = await loadTeam(admin, run.projectId);
      return {
        members: new Set(team.members.map((member) => member.key)),
        proposed: new Set(team.proposed),
      };
    },
    add: (keys) =>
      serialized(async () => {
        await admin
          .insertInto('project_agents')
          .values(keys.map((key) => ({ project_id: run.projectId, agent_key: key })))
          .onConflict((conflict) => conflict.columns(['project_id', 'agent_key']).doNothing())
          .execute();
        await notifyLive(admin, { kind: 'project', projectId: run.projectId });
      }),
    propose: (operations, reason) =>
      serialized(async () => {
        const open = await admin
          .selectFrom('proposals')
          .select(['id', 'operations'])
          .where('run_id', '=', run.id)
          .where('kind', '=', 'team')
          .where('status', '=', 'open')
          .executeTakeFirst();
        const updated =
          open &&
          (await admin
            .updateTable('proposals')
            .set({
              operations: JSON.stringify([...readTeamOperations(open.operations), ...operations]),
            })
            .where('id', '=', open.id)
            .where('status', '=', 'open')
            .executeTakeFirst());
        // No open proposal of this run, or someone decided it meanwhile: a new one.
        if (!updated || updated.numUpdatedRows === 0n) {
          await admin
            .insertInto('proposals')
            .values({
              project_id: run.projectId,
              board_id: null,
              run_id: run.id,
              agent_key: run.agentKey,
              kind: 'team',
              reason,
              operations: JSON.stringify(operations),
            })
            .execute();
        }
        await notifyLive(admin, { kind: 'proposals', projectId: run.projectId });
      }),
  };
}
