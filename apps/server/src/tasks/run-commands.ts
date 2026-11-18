import { AsyncLocalStorage } from 'node:async_hooks';

import type { DB } from '@covibes/db';
import {
  applyOperations,
  authorSchema,
  canvasOperationSchema,
  changedNodeIds,
  projectSettingsSchema,
} from '@covibes/shared';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type * as Y from 'yjs';

import type { AgentTool } from '@server/ai-gateway/types';
import type { BoardAccess } from '@server/collab/board-client';

const canvasCommandSchema = z.object({
  boardId: z.uuid(),
  author: authorSchema,
  operations: z.array(canvasOperationSchema),
  response: z.string(),
});
export type CanvasCommand = z.infer<typeof canvasCommandSchema>;
type CanvasCommandInput = z.input<typeof canvasCommandSchema>;
const RECEIPTS = '_covibes_command_receipts';

export function hasCanvasCommandReceipt(doc: Y.Doc, commandId: string): boolean {
  return doc.getMap<boolean>(RECEIPTS).get(commandId) === true;
}

type CommandRow = {
  id: string;
  position: number;
  tool_name: string;
  input: unknown;
  status: string;
  response: string | null;
  canvas: unknown;
};

export class RecoveryConflictError extends Error {
  override name = 'RecoveryConflictError';
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

/** Receipt and mutation share one Yjs transaction and are persisted together. */
export function applyCanvasCommand(doc: Y.Doc, commandId: string, value: CanvasCommandInput): void {
  const command = canvasCommandSchema.parse(value);
  const receipts = doc.getMap<boolean>(RECEIPTS);
  if (receipts.get(commandId)) return;
  doc.transact(() => {
    applyOperations(doc, command.operations, command.author);
    receipts.set(commandId, true);
  });
}

/**
 * A model retry is not a transaction retry: its wording, order and arguments can change.
 * Only recorded commands are replayable after a mutation; divergence stops safely.
 */
export async function createRunCommands(admin: Kysely<DB>, runId: string, boards: BoardAccess) {
  const previous =
    await sql<CommandRow>`select id, position, tool_name, input, status, response, canvas
    from tool_commands where run_id = ${runId} order by position`.execute(admin);
  const recorded = previous.rows;
  const context = new AsyncLocalStorage<{ id: string; canvas?: CanvasCommand }>();
  let position = 0;

  async function complete(id: string, response: string) {
    await sql`update tool_commands set status = 'complete', response = ${response}, completed_at = now()
      where id = ${id}::uuid`.execute(admin);
  }

  async function recover(row: CommandRow): Promise<string> {
    if (row.status === 'complete' && row.response !== null) return row.response;
    const parsed = canvasCommandSchema.safeParse(row.canvas);
    if (!parsed.success) {
      throw new RecoveryConflictError(
        'An interrupted tool has an uncertain result; a new instruction is required',
      );
    }
    const command = parsed.data;
    const project = await sql<{ settings: unknown }>`select p.settings from projects p
      join ai_runs r on r.project_id = p.id where r.id = ${runId}::uuid`.execute(admin);
    const settings = projectSettingsSchema.safeParse(project.rows[0]?.settings);
    await boards.withBoard(command.boardId, (doc, session) => {
      if (hasCanvasCommandReceipt(doc, row.id)) return;
      if (settings.success && settings.data.proposalsOnly) {
        throw new RecoveryConflictError(
          'The project now requires proposals; the interrupted direct mutation was not replayed',
        );
      }
      const locks = session.locks();
      if (
        command.operations.some((operation) =>
          changedNodeIds(operation).some((id) => locks.has(id)),
        )
      ) {
        throw new RecoveryConflictError(
          'An interrupted mutation targets something a person is editing',
        );
      }
      applyCanvasCommand(doc, row.id, command);
    });
    await boards.flush?.(command.boardId, row.id);
    await complete(row.id, command.response);
    row.status = 'complete';
    row.response = command.response;
    return command.response;
  }

  return {
    /** Reconcile prepared canvas commands before the next prompt reads the board. */
    recover: async () => {
      for (const row of recorded) if (row.status !== 'complete') await recover(row);
    },
    /** Called before a canvas mutation, so all generated identifiers survive a process exit. */
    prepareCanvas: async (value: CanvasCommandInput): Promise<string> => {
      const active = context.getStore();
      if (!active) throw new Error('A canvas command must run inside its recorded tool call');
      const command = canvasCommandSchema.parse(value);
      if (active.canvas)
        throw new RecoveryConflictError('One tool call cannot prepare two canvas commands');
      await sql`update tool_commands set canvas = ${JSON.stringify(command)}::jsonb,
        response = ${command.response} where id = ${active.id}::uuid`.execute(admin);
      active.canvas = command;
      return active.id;
    },
    wrap: (tool: AgentTool): AgentTool => ({
      ...tool,
      run: async (raw) => {
        const input = z.object(tool.input).parse(raw);
        const index = position++;
        const existing = recorded[index];
        if (existing) {
          if (existing.tool_name !== tool.name || canonical(existing.input) !== canonical(input)) {
            throw new RecoveryConflictError(
              'Recovered tool calls must match the recorded operation',
            );
          }
          return recover(existing);
        }
        if (recorded.length > 0) {
          throw new RecoveryConflictError(
            'Recovery replays earlier changes only; a new instruction is required',
          );
        }
        const inserted = await sql<{ id: string }>`insert into tool_commands
          (run_id, position, tool_name, input) values
          (${runId}::uuid, ${index}, ${tool.name}, ${JSON.stringify(input)}::jsonb)
          returning id`.execute(admin);
        const id = inserted.rows[0]?.id;
        if (!id) throw new Error('The tool command was not recorded');
        return context.run({ id }, async () => {
          const response = await tool.run(input);
          const active = context.getStore();
          if (active?.canvas) await boards.flush?.(active.canvas.boardId, id);
          await complete(id, response);
          return response;
        });
      },
    }),
  };
}

export type RunCommands = Awaited<ReturnType<typeof createRunCommands>>;
