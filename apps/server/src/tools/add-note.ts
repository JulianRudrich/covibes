import { randomUUID } from 'node:crypto';

import { addNote, findFreeSpot, NOTE_SIZE, readNodes } from '@covibes/shared';
import { z } from 'zod';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import { centerOfNodes, describePosition, type CanvasToolOptions } from '@server/tools/placement';

/** `add_note` (spec 09): an agent puts a sticky note with an open thought next to the others. */
export function addNoteTool(options: CanvasToolOptions): AgentTool {
  return defineTool({
    name: 'add_note',
    description:
      'Adds a sticky note to the main canvas for an open thought, question or idea that is not decided yet. Keep the text short. Decided things are blocks, not notes.',
    input: {
      text: z.string().trim().min(1).max(200),
    },
    // Rule engine: spec 13. Until then every call runs directly.
    run: async ({ text }) =>
      await options.boards.withBoard(options.boardId, (doc) => {
        const nodes = readNodes(doc);
        const position = findFreeSpot(nodes, centerOfNodes(nodes), NOTE_SIZE);
        const id = randomUUID();
        addNote(doc, { id, position, text }, options.author);
        return `Added the note "${text}" (id ${id}) at ${describePosition(position)}.`;
      }),
  });
}
