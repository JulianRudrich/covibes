import { z } from 'zod';

import { positionSchema, type Position } from './model';

// The awareness of a board carries who is there, their cursors and their locks (architecture.md,
// "Canvas"). States come from other clients, so they are validated like any outside input.
export const awarenessStateSchema = z.object({
  user: z.object({ id: z.string().min(1).max(100), name: z.string().max(200) }),
  cursor: positionSchema.nullable().optional(),
  /** The node this client edits right now, and since when (milliseconds since 1970). */
  editing: z
    .object({ nodeId: z.string().min(1).max(100), since: z.number().int().nonnegative() })
    .nullable()
    .optional(),
});

export type AwarenessUser = z.infer<typeof awarenessStateSchema>['user'];

export type RemoteCursor = { clientId: number; userId: string; name: string; position: Position };

/**
 * The cursors of everyone else on the board, in flow coordinates. Clients of the signed-in user
 * (e.g. a second tab) are left out, as are clients without a cursor on the canvas.
 */
export function remoteCursors(
  states: ReadonlyMap<number, Record<string, unknown>>,
  own: { clientId: number; userId: string },
): RemoteCursor[] {
  const cursors: RemoteCursor[] = [];
  for (const [clientId, state] of states) {
    if (clientId === own.clientId) continue;
    const parsed = awarenessStateSchema.safeParse(state);
    if (!parsed.success || !parsed.data.cursor) continue;
    if (parsed.data.user.id === own.userId) continue;
    cursors.push({
      clientId,
      userId: parsed.data.user.id,
      name: parsed.data.user.name,
      position: parsed.data.cursor,
    });
  }
  return cursors;
}

export type NodeLock = { clientId: number; userId: string; name: string; since: number };

/**
 * Who holds the lock of each node that someone edits (spec 08). When two clients start editing the
 * same node, the earlier start wins, then the lower client id, so every client reaches the same
 * answer on its own.
 */
export function nodeLocks(
  states: ReadonlyMap<number, Record<string, unknown>>,
): Map<string, NodeLock> {
  const locks = new Map<string, NodeLock>();
  for (const [clientId, state] of states) {
    const parsed = awarenessStateSchema.safeParse(state);
    if (!parsed.success || !parsed.data.editing) continue;
    const { nodeId, since } = parsed.data.editing;
    const holder = locks.get(nodeId);
    if (
      holder &&
      (holder.since < since || (holder.since === since && holder.clientId < clientId))
    ) {
      continue;
    }
    locks.set(nodeId, {
      clientId,
      userId: parsed.data.user.id,
      name: parsed.data.user.name,
      since,
    });
  }
  return locks;
}
