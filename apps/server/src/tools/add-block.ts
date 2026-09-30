import { randomUUID } from 'node:crypto';

import { addBlock, blockTypeSchema, findFreeSpot, readNodes } from '@covibes/shared';
import { z } from 'zod';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import { centerOfNodes, describePosition, type CanvasToolOptions } from '@server/tools/placement';

/**
 * `add_block` (spec 07): an agent adds a block to the project's main board. It writes through the
 * live Y.Doc with the shared `addBlock`, so the block appears for everyone at once and carries the
 * agent as its author.
 */
export function addBlockTool(options: CanvasToolOptions): AgentTool {
  return defineTool({
    name: 'add_block',
    description:
      'Adds a block (a component, service, idea or step) to the main canvas of the project. Use a short title of one to three words; the subtitle can say what it is. Set the type when one fits: app (an app or frontend), server, service (a service, API or gateway), database, repository or metric (a limit, budget or number); leave it out for anything else. Leave out x and y unless someone asked for a place: the block then goes to a free spot next to the others.',
    input: {
      title: z.string().trim().min(1).max(80),
      subtitle: z.string().trim().max(80).optional(),
      type: blockTypeSchema.optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    },
    // Rule engine: spec 13. Until then every call runs directly.
    run: ({ title, subtitle, type, x, y }) =>
      options.boards.withBoard(options.boardId, (doc) => {
        const nodes = readNodes(doc);
        const position =
          x !== undefined && y !== undefined ? { x, y } : findFreeSpot(nodes, centerOfNodes(nodes));
        const id = randomUUID();
        addBlock(
          doc,
          { id, position, label: title, subtitle: subtitle ?? '', blockType: type ?? null },
          options.author,
        );
        return Promise.resolve(
          `Added the block "${title}" (id ${id}) at ${describePosition(position)}.`,
        );
      }),
  });
}
