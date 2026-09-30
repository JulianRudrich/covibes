import { randomUUID } from 'node:crypto';

import { edgeLabelSchema, EdgeRuleError, edgeProblem, readNodes } from '@covibes/shared';
import { z } from 'zod';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import { proposedNote, writeCanvas } from '@server/tools/canvas-writer';
import type { CanvasToolOptions } from '@server/tools/placement';

/**
 * `connect_blocks` (spec 09): an agent draws a labeled arrow from one block to another. The rules
 * of `addEdge` apply: only blocks, never a block to itself, at most one arrow per direction. As a
 * proposal it may lead to blocks proposed in the same reply.
 */
export function connectBlocksTool(options: CanvasToolOptions): AgentTool {
  return defineTool({
    name: 'connect_blocks',
    description:
      'Draws an arrow from one block to another on the main canvas, for a real relationship (e.g. "calls", "stores in", "SQL"). Identify both blocks by the ids from the canvas overview or from your earlier tool results. The label is optional and short (at most 40 characters). Only blocks can be connected, and only once per direction.',
    input: {
      from: z.string().min(1).max(100),
      to: z.string().min(1).max(100),
      label: edgeLabelSchema.optional(),
    },
    run: ({ from, to, label }) =>
      writeCanvas(options, (view) => {
        const nodes = new Map(readNodes(view).map((node) => [node.id, node]));
        const source = nodes.get(from);
        const target = nodes.get(to);
        const missing = [from, to].filter((id) => !nodes.has(id));
        if (!source || !target) {
          throw new Error(`There is no element with the id ${missing.join(' or ')}.`);
        }
        const problem = edgeProblem(view, from, to);
        if (problem) {
          const error = new EdgeRuleError(problem);
          throw new Error(`${error.message}.`, { cause: error });
        }
        const labelText = label ? ` labeled "${label}"` : '';
        const what = `an arrow from "${source.label}" to "${target.label}"${labelText}`;
        return {
          operations: [
            {
              op: 'add_edge',
              edge: { id: randomUUID(), source: from, target: to, label: label ?? '' },
            },
          ],
          done: `Drew ${what}.`,
          proposed: proposedNote(what),
        };
      }),
  });
}
