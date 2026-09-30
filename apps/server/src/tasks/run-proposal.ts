import type { DB } from '@covibes/db';
import {
  canvasOperationSchema,
  type CanvasNode,
  type CanvasOperation,
  type CanvasOperationInput,
  type ProposalReason,
} from '@covibes/shared';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { notifyLive } from '@server/realtime/notifications';
import type { ProposalSink } from '@server/tools/canvas-writer';

const storedOperationsSchema = z.array(canvasOperationSchema);

/** Stored names of elements; anything unreadable counts as none. */
function readNames(stored: unknown): Record<string, string> {
  const parsed = z.record(z.string(), z.string()).safeParse(stored);
  return parsed.success ? parsed.data : {};
}

/** Stored operations, or none if they no longer read (e.g. written by another version). */
function readOperations(stored: unknown): CanvasOperation[] {
  const parsed = storedOperationsSchema.safeParse(stored);
  return parsed.success ? parsed.data : [];
}

/**
 * The proposal of one agent run (spec 13): everything the agent proposes in its reply goes into
 * one row of `proposals`. A retry of the run continues its open proposal. Additions are written
 * one after the other, since the model may call several tools at once.
 */
export async function openRunProposal(
  admin: Kysely<DB>,
  run: { id: string; projectId: string; boardId: string; agentKey: string },
): Promise<ProposalSink> {
  const existing = await admin
    .selectFrom('proposals')
    .select(['id', 'operations', 'names'])
    .where('run_id', '=', run.id)
    .where('status', '=', 'open')
    .executeTakeFirst();
  const operations: CanvasOperationInput[] = existing ? readOperations(existing.operations) : [];
  const names: Record<string, string> = existing ? readNames(existing.names) : {};
  let proposalId = existing?.id ?? null;
  let queue = Promise.resolve();

  async function write(
    added: readonly CanvasOperationInput[],
    reason: ProposalReason,
    addedNames: Readonly<Record<string, string>>,
  ) {
    if (proposalId) {
      const updated = await admin
        .updateTable('proposals')
        .set({
          operations: JSON.stringify([...operations, ...added]),
          names: JSON.stringify({ ...names, ...addedNames }),
        })
        .where('id', '=', proposalId)
        .where('status', '=', 'open')
        .executeTakeFirst();
      // Someone decided the proposal meanwhile: the rest becomes a proposal of its own.
      if (updated.numUpdatedRows === 0n) {
        proposalId = null;
        operations.length = 0;
        for (const key of Object.keys(names)) Reflect.deleteProperty(names, key);
      }
    }
    if (!proposalId) {
      const inserted = await admin
        .insertInto('proposals')
        .values({
          project_id: run.projectId,
          board_id: run.boardId,
          run_id: run.id,
          agent_key: run.agentKey,
          reason,
          operations: JSON.stringify(added),
          names: JSON.stringify(addedNames),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      proposalId = inserted.id;
    }
    operations.push(...added);
    Object.assign(names, addedNames);
    await notifyLive(admin, { kind: 'proposals', projectId: run.projectId });
  }

  return {
    operations,
    add: (added, reason, addedNames) => {
      const next = queue.then(() => write(added, reason, addedNames));
      // A failed write fails its tool call, but not the ones after it.
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

/** The open proposals of a project, for the agents' context. */
export async function loadOpenProposals(admin: Kysely<DB>, projectId: string) {
  const rows = await admin
    .selectFrom('proposals')
    .select(['id', 'agent_key', 'operations'])
    .where('project_id', '=', projectId)
    .where('status', '=', 'open')
    .orderBy('created_at')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    agentKey: row.agent_key,
    operations: readOperations(row.operations),
  }));
}

/**
 * What a proposal does, in words for the model: e.g. `add the block "Queue"; an arrow "API" →
 * "Queue"`. Names come from the canvas and from the proposal itself.
 */
export function describeOperations(
  operations: readonly CanvasOperation[],
  nodes: readonly CanvasNode[],
): string {
  const names = new Map(nodes.map((node) => [node.id, node.label]));
  for (const operation of operations) {
    if (operation.op === 'add_block') names.set(operation.block.id, operation.block.label);
    if (operation.op === 'add_note') names.set(operation.note.id, operation.note.text);
    if (operation.op === 'add_frame') names.set(operation.frame.id, operation.frame.title);
  }
  const name = (id: string) => `"${names.get(id) ?? id}"`;
  return operations
    .map((operation) => {
      switch (operation.op) {
        case 'add_block':
          return `add the block ${name(operation.block.id)}`;
        case 'add_note':
          return `add the note ${name(operation.note.id)}`;
        case 'add_frame':
          return `add the frame ${name(operation.frame.id)}`;
        case 'add_edge':
          return `an arrow ${name(operation.edge.source)} → ${name(operation.edge.target)}`;
        case 'update_node':
          return `change ${name(operation.id)}`;
        case 'arrange':
          return operation.frame
            ? `arrange the frame ${name(operation.frame.id)}`
            : 'move elements';
      }
    })
    .join('; ');
}
