import { computeLayout, layoutPreset, readEdges, readNodes } from '@covibes/shared';
import Elk from 'elkjs/lib/elk.bundled.js';
import type { ELK } from 'elkjs/lib/elk-api';
import { z } from 'zod';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import { proposedNote, writeCanvas } from '@server/tools/canvas-writer';
import type { CanvasToolOptions } from '@server/tools/placement';

let elk: ELK | null = null;

/** One ELK for the whole process, created on the first layout. */
function layoutEngine(): ELK {
  elk ??= new Elk();
  return elk;
}

/**
 * `arrange_frame` (spec 12): an agent arranges the diagram in a frame with the preset of its
 * type, with the same code as auto-layout in the web app, and fits the frame around it. Elements
 * that someone is editing keep their place.
 */
export function arrangeFrameTool(options: CanvasToolOptions): AgentTool {
  return defineTool({
    name: 'arrange_frame',
    description:
      'Arranges the content of a frame with the layout of its diagram type (a mind map as a tree growing to the right, a data model from left to right, flows and architectures from top to bottom, a sitemap as a tree downwards) and fits the frame around it. Call it once after drawing or changing a diagram in a frame. Identify the frame by the id from the canvas overview.',
    input: { frameId: z.string().min(1).max(100) },
    run: ({ frameId }) =>
      writeCanvas(options, async (view, session) => {
        const nodes = readNodes(view);
        const frame = nodes.find((node) => node.id === frameId && node.type === 'frame');
        if (!frame) throw new Error(`There is no frame with the id ${frameId}.`);

        const layout = await computeLayout(layoutEngine(), nodes, readEdges(view), frameId);
        if (layout.positions.size === 0) {
          return {
            operations: [],
            done: `The frame "${frame.label}" is empty, so there was nothing to arrange.`,
            proposed: '',
          };
        }
        // Humans take precedence: what someone is editing stays where it is.
        const locks = session.locks();
        const moves = [...layout.positions]
          .filter(([id]) => id !== frameId && !locks.has(id))
          .map(([id, position]) => ({ id, position }));
        const size = layout.frameSizes.get(frameId);
        // The frame itself moves too when it grew over its neighbors.
        const position = layout.positions.get(frameId) ?? frame.position;

        const kept = [...layout.positions.keys()].filter((id) => locks.has(id)).length;
        const preset = layoutPreset(frame.diagramType);
        const how = preset.algorithm === 'mrtree' ? 'as a tree' : 'in layers';
        const direction = preset.direction === 'RIGHT' ? 'to the right' : 'downwards';
        const keptNote =
          kept === 0
            ? ''
            : kept === 1
              ? ' 1 element kept its place because someone is editing it.'
              : ` ${String(kept)} elements kept their place because someone is editing them.`;
        return {
          operations: [
            {
              op: 'arrange',
              moves,
              frame: size && !locks.has(frameId) ? { id: frameId, position, size } : null,
            },
          ],
          done: `Arranged the frame "${frame.label}" ${how} ${direction}.${keptNote}`,
          proposed: `${proposedNote(`to arrange the frame "${frame.label}" ${how} ${direction}`)}${keptNote}`,
        };
      }),
  });
}
