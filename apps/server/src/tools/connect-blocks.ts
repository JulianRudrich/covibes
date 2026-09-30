import { randomUUID } from 'node:crypto';

import { addEdge, edgeLabelSchema, EdgeRuleError, readNodes } from '@covibes/shared';
import { z } from 'zod';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import type { CanvasToolOptions } from '@server/tools/placement';

/**
 * `connect_blocks` (spec 09): an agent draws a labeled arrow from one block to another. The rules
 * of `addEdge` apply: only blocks, never a block to itself, at most one arrow per direction.
 */
export function connectBlocksTool(options: CanvasToolOptions): AgentTool {
  return defineTool({
    name: 'connect_blocks',
    description:
      'Draws an arrow from one block to another on the main canvas, for a real relationship (e.g. "calls", "stores in", "SQL"). Identify both blocks by the ids from the canvas overview. The label is optional and short (at most 40 characters). Only blocks can be connected, and only once per direction.',
    input: {
      from: z.string().min(1).max(100),
      to: z.string().min(1).max(100),
      label: edgeLabelSchema.optional(),
    },
    // Rule engine: spec 13. Until then every call runs directly.
    run: async ({ from, to, label }) =>
      await options.boards.withBoard(options.boardId, (doc) => {
        const nodes = new Map(readNodes(doc).map((node) => [node.id, node]));
        const source = nodes.get(from);
        const target = nodes.get(to);
        const missing = [from, to].filter((id) => !nodes.has(id));
        if (!source || !target) {
          throw new Error(`There is no element with the id ${missing.join(' or ')}.`);
        }
        try {
          addEdge(
            doc,
            { id: randomUUID(), source: from, target: to, label: label ?? '' },
            options.author,
          );
        } catch (error) {
          if (error instanceof EdgeRuleError) {
            throw new Error(`${error.message}.`, { cause: error });
          }
          throw error;
        }
        const labelText = label ? ` labeled "${label}"` : '';
        return `Drew an arrow from "${source.label}" to "${target.label}"${labelText}.`;
      }),
  });
}
