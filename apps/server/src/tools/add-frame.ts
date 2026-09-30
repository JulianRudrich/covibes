import { randomUUID } from 'node:crypto';

import {
  addFrame,
  diagramTypeSchema,
  findFreeSpot,
  FRAME_MIN_SIZE,
  FRAME_SIZE,
  placeNodes,
  readNodes,
  type CanvasNode,
} from '@covibes/shared';
import { z } from 'zod';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import { centerOfNodes, describePosition, type CanvasToolOptions } from '@server/tools/placement';

/** Space between the blocks and the edge of a frame drawn around them; it holds the title. */
const FRAME_PADDING = 40;

/** The bounds of a frame that encloses the given blocks with padding. */
function around(blocks: readonly CanvasNode[]) {
  const left = Math.min(...blocks.map((block) => block.position.x)) - FRAME_PADDING;
  const top = Math.min(...blocks.map((block) => block.position.y)) - FRAME_PADDING;
  const right = Math.max(...blocks.map((block) => block.position.x + block.size.width));
  const bottom = Math.max(...blocks.map((block) => block.position.y + block.size.height));
  return {
    position: { x: left, y: top },
    size: {
      width: Math.max(FRAME_MIN_SIZE.width, right + FRAME_PADDING - left),
      height: Math.max(FRAME_MIN_SIZE.height, bottom + FRAME_PADDING - top),
    },
  };
}

/**
 * `add_frame` (specs 09 and 12): an agent adds a frame, a labeled area for a diagram of a type.
 * With blocks, the frame encloses them and they become its members; blocks that someone is editing
 * are left out.
 */
export function addFrameTool(options: CanvasToolOptions): AgentTool {
  return defineTool({
    name: 'add_frame',
    description:
      'Adds a frame to the main canvas: a labeled area that holds one diagram, e.g. "Architektur". Set the diagram type: mindmap, architecture, datamodel, flow (also for pipelines) or sitemap; leave it out for a free area. Pass the ids of blocks from the canvas overview to put a frame around them; without blocks the frame goes to a free spot next to the others, and blocks are then added with add_block and its frameId.',
    input: {
      title: z.string().trim().min(1).max(80),
      diagramType: diagramTypeSchema.optional(),
      blockIds: z.array(z.string().min(1).max(100)).max(50).optional(),
    },
    // Rule engine: spec 13. Until then every call runs directly.
    run: async ({ title, diagramType, blockIds }) =>
      await options.boards.withBoard(options.boardId, (doc, session) => {
        const nodes = readNodes(doc);
        const id = randomUUID();
        const typeNote = diagramType ? ` of type ${diagramType}` : '';
        if (!blockIds || blockIds.length === 0) {
          const position = findFreeSpot(nodes, centerOfNodes(nodes), FRAME_SIZE);
          addFrame(doc, { id, position, title, diagramType: diagramType ?? null }, options.author);
          return `Added the frame "${title}"${typeNote} (id ${id}) at ${describePosition(position)}.`;
        }

        const byId = new Map(nodes.map((node) => [node.id, node]));
        const unknown = blockIds.filter((blockId) => byId.get(blockId)?.type !== 'block');
        if (unknown.length > 0) {
          throw new Error(`There is no block with the id ${unknown.join(', ')}.`);
        }
        // Humans take precedence: a block someone is editing stays where it is.
        const locks = session.locks();
        const locked = blockIds.filter((blockId) => locks.has(blockId));
        const blocks = blockIds
          .filter((blockId) => !locks.has(blockId))
          .flatMap((blockId) => byId.get(blockId) ?? []);
        if (blocks.length === 0) {
          throw new Error(
            'Someone is editing all of these blocks right now, so no frame was added.',
          );
        }

        addFrame(
          doc,
          { id, title, diagramType: diagramType ?? null, ...around(blocks) },
          options.author,
        );
        placeNodes(
          doc,
          blocks.map((block) => block.id),
          options.author,
        );
        const skipped = locked
          .map(
            (blockId) =>
              `"${byId.get(blockId)?.label ?? blockId}" (${locks.get(blockId)?.name ?? 'someone'} is editing it)`,
          )
          .join(', ');
        const count = `${String(blocks.length)} ${blocks.length === 1 ? 'block' : 'blocks'}`;
        return `Added the frame "${title}"${typeNote} (id ${id}) around ${count}.${
          skipped ? ` Left out ${skipped}.` : ''
        }`;
      }),
  });
}
