import { randomUUID } from 'node:crypto';

import {
  addBlock,
  findFreeSpot,
  readNodes,
  type Author,
  type CanvasNode,
  type Position,
} from '@covibes/shared';
import { z } from 'zod';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import type { BoardAccess } from '@server/collab/board-client';

/** Roughly the middle of the visible canvas at the default view (100 %, no scrolling). */
const DEFAULT_CENTER: Position = { x: 360, y: 320 };

/** New blocks go next to the existing ones: around their center, or in view on an empty board. */
function centerOf(nodes: readonly CanvasNode[]): Position {
  if (nodes.length === 0) return DEFAULT_CENTER;
  const sum = nodes.reduce(
    (total, node) => ({
      x: total.x + node.position.x + node.size.width / 2,
      y: total.y + node.position.y + node.size.height / 2,
    }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / nodes.length, y: sum.y / nodes.length };
}

/**
 * `add_block` (spec 07): an agent adds a block to the project's main board. It writes through the
 * live Y.Doc with the shared `addBlock`, so the block appears for everyone at once and carries the
 * agent as its author.
 */
export function addBlockTool(options: {
  boards: BoardAccess;
  boardId: string;
  author: Author;
}): AgentTool {
  return defineTool({
    name: 'add_block',
    description:
      'Adds a block (a component, service, idea or step) to the main canvas of the project. Use a short title of one to three words; the subtitle can say what it is. Leave out x and y unless someone asked for a place: the block then goes to a free spot next to the others.',
    input: {
      title: z.string().trim().min(1).max(80),
      subtitle: z.string().trim().max(80).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    },
    // Rule engine: spec 13. Until then every call runs directly.
    run: ({ title, subtitle, x, y }) =>
      options.boards.withBoard(options.boardId, (doc) => {
        const nodes = readNodes(doc);
        const position =
          x !== undefined && y !== undefined ? { x, y } : findFreeSpot(nodes, centerOf(nodes));
        addBlock(
          doc,
          { id: randomUUID(), position, label: title, subtitle: subtitle ?? '' },
          options.author,
        );
        return Promise.resolve(
          `Added the block "${title}" at ${String(Math.round(position.x))}, ${String(Math.round(position.y))}.`,
        );
      }),
  });
}
