import { blockTypeSchema, readNodes, updateNode } from '@covibes/shared';
import { z } from 'zod';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import type { CanvasToolOptions } from '@server/tools/placement';

/**
 * `update_block` (spec 08): an agent renames a block, changes its subtitle or its type. A block
 * that a human is editing stays untouched (humans take precedence, `project-overview.md`); the
 * agent learns who edits it and can tell the team.
 */
export function updateBlockTool(options: CanvasToolOptions): AgentTool {
  return defineTool({
    name: 'update_block',
    description:
      'Changes an existing block on the main canvas: its title, its subtitle or its type (app, server, service, database, repository, metric, or "none" for a plain block). Identify the block by the id from the canvas overview. Only pass what should change.',
    input: {
      id: z.string().min(1).max(100),
      title: z.string().trim().min(1).max(80).optional(),
      subtitle: z.string().trim().max(80).optional(),
      type: z.union([blockTypeSchema, z.literal('none')]).optional(),
    },
    run: async ({ id, title, subtitle, type }) => {
      if (title === undefined && subtitle === undefined && type === undefined) {
        throw new Error('Nothing to change: pass a title, a subtitle or a type.');
      }
      return await options.boards.withBoard(options.boardId, (doc, session) => {
        const block = readNodes(doc).find((node) => node.id === id && node.type === 'block');
        if (!block) throw new Error(`There is no block with the id ${id}.`);

        // Rule engine: spec 13. Until then a locked block is refused instead of becoming a proposal.
        const lock = session.locks().get(id);
        if (lock) {
          throw new Error(
            `${lock.name} is editing the block "${block.label}" right now, so it was not changed. Tell the team and ask them to mention you again once the block is free.`,
          );
        }

        updateNode(
          doc,
          id,
          {
            ...(title !== undefined && { label: title }),
            ...(subtitle !== undefined && { subtitle }),
            ...(type !== undefined && { blockType: type === 'none' ? null : type }),
          },
          options.author,
        );
        return `Changed the block "${title ?? block.label}".`;
      });
    },
  });
}
