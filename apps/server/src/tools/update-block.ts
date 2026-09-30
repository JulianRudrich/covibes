import { blockTypeSchema, readNodes } from '@covibes/shared';
import { z } from 'zod';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import { entityFieldsInput } from '@server/tools/add-block';
import { writeCanvas } from '@server/tools/canvas-writer';
import type { CanvasToolOptions } from '@server/tools/placement';

/**
 * `update_block` (specs 08, 12 and 13): an agent renames a block, changes its subtitle, its type
 * or the fields of an entity. Humans take precedence (`project-overview.md`): the change of a
 * block that someone is editing becomes a proposal, and the agent learns who edits it.
 */
export function updateBlockTool(options: CanvasToolOptions): AgentTool {
  return defineTool({
    name: 'update_block',
    description:
      'Changes an existing block on the main canvas: its title, its subtitle, its type (the types of add_block, or "none" for a plain block) or the fields of an entity (the complete new list of fields). Identify the block by the id from the canvas overview. Only pass what should change.',
    input: {
      id: z.string().min(1).max(100),
      title: z.string().trim().min(1).max(80).optional(),
      subtitle: z.string().trim().max(80).optional(),
      type: z.union([blockTypeSchema, z.literal('none')]).optional(),
      fields: entityFieldsInput.optional(),
    },
    run: async ({ id, title, subtitle, type, fields }) => {
      if ([title, subtitle, type, fields].every((value) => value === undefined)) {
        throw new Error('Nothing to change: pass a title, a subtitle, a type or fields.');
      }
      return await writeCanvas(options, (view, session) => {
        const block = readNodes(view).find((node) => node.id === id && node.type === 'block');
        if (!block) throw new Error(`There is no block with the id ${id}.`);
        const blockType = type === undefined ? block.blockType : type === 'none' ? null : type;
        if (fields && fields.length > 0 && blockType !== 'entity') {
          throw new Error(
            'Only entities have fields: set the type "entity" or leave the fields out.',
          );
        }

        const lock = session.locks().get(id);
        const name = title ?? block.label;
        return {
          operations: [
            {
              op: 'update_node',
              id,
              changes: {
                ...(title !== undefined && { label: title }),
                ...(subtitle !== undefined && { subtitle }),
                ...(type !== undefined && { blockType: type === 'none' ? null : type }),
                ...(fields !== undefined && {
                  fields: fields.map((field) => ({ name: field.name, type: field.type ?? '' })),
                }),
              },
            },
          ],
          lockedTarget: lock !== undefined,
          done: `Changed the block "${name}".`,
          proposed: lock
            ? `${lock.name} is editing the block "${block.label}" right now, so your change became a proposal: it is not on the canvas until someone in the team applies it. Tell the team.`
            : `Proposed to change the block "${block.label}". This is a proposal: it is not on the canvas until someone in the team applies it.`,
        };
      });
    },
  });
}
