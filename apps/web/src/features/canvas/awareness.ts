import { positionSchema, type Position } from '@covibes/shared';
import { z } from 'zod';

// Awareness states come from other browsers, so they are validated like any outside input.
const awarenessStateSchema = z.object({
  user: z.object({ id: z.string().min(1).max(100), name: z.string().max(200) }),
  cursor: positionSchema.nullable().optional(),
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
