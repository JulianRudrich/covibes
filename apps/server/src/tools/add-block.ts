import { randomUUID } from 'node:crypto';

import {
  addBlock,
  authorOrigin,
  blockSize,
  blockTypeSchema,
  ENTITY_FIELDS_MAX,
  findFreeSpot,
  FRAME_PADDING,
  newBlockType,
  readNodes,
  resizeFrame,
  type CanvasNode,
  type Position,
  type Size,
} from '@covibes/shared';
import type * as Y from 'yjs';
import { z } from 'zod';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import { centerOfNodes, describePosition, type CanvasToolOptions } from '@server/tools/placement';

/** The fields of an entity as agents pass them (spec 12). */
export const entityFieldsInput = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(40),
      type: z.string().trim().max(40).optional(),
    }),
  )
  .max(ENTITY_FIELDS_MAX);

/**
 * A free spot in a frame: below its title, next to its members, and clear of every other block
 * and note on the canvas. The frame grows around it afterwards if needed.
 */
function spotIn(frame: CanvasNode, nodes: readonly CanvasNode[], size: Size): Position {
  const members = nodes.filter((node) => node.frameId === frame.id && node.type !== 'frame');
  const center =
    members.length > 0
      ? centerOfNodes(members)
      : {
          x: frame.position.x + FRAME_PADDING.left + size.width / 2,
          y: frame.position.y + FRAME_PADDING.top + size.height / 2,
        };
  return findFreeSpot(
    nodes.filter((node) => node.type !== 'frame'),
    center,
    size,
  );
}

/** Grows a frame so that the block with `id` lies inside it, with the frame's padding. */
function growAround(doc: Y.Doc, frame: CanvasNode, id: string, options: CanvasToolOptions) {
  const block = readNodes(doc).find((node) => node.id === id);
  if (!block) return;
  const left = Math.min(frame.position.x, block.position.x - FRAME_PADDING.left);
  const top = Math.min(frame.position.y, block.position.y - FRAME_PADDING.top);
  const right = Math.max(
    frame.position.x + frame.size.width,
    block.position.x + block.size.width + FRAME_PADDING.right,
  );
  const bottom = Math.max(
    frame.position.y + frame.size.height,
    block.position.y + block.size.height + FRAME_PADDING.bottom,
  );
  const grown =
    left < frame.position.x ||
    top < frame.position.y ||
    right > frame.position.x + frame.size.width ||
    bottom > frame.position.y + frame.size.height;
  if (grown) {
    resizeFrame(
      doc,
      frame.id,
      { position: { x: left, y: top }, size: { width: right - left, height: bottom - top } },
      options.author,
    );
  }
}

/**
 * `add_block` (specs 07 and 12): an agent adds a block to the project's main board, optionally
 * into a frame, where it gets the type of the frame's diagram unless another is given. It writes
 * through the live Y.Doc with the shared `addBlock`, so the block appears for everyone at once and
 * carries the agent as its author.
 */
export function addBlockTool(options: CanvasToolOptions): AgentTool {
  return defineTool({
    name: 'add_block',
    description:
      'Adds a block to the main canvas: a component, idea, entity, step or page. Use a short title of one to three words; the subtitle can say what it is. Pass frameId to put the block into a frame (a diagram); it then gets the type that fits the diagram unless you set one. Types by diagram: architecture: app, server, service (a service, API or gateway), database, repository, metric (a limit, budget or number); mind map: topic (the central topic, one per mind map), idea; data model: entity, with its fields (name and type, e.g. id uuid); flow: start, step, decision, end; sitemap: page. Leave the type out for anything else. Leave out x and y unless someone asked for a place: the block then goes to a free spot next to the others.',
    input: {
      title: z.string().trim().min(1).max(80),
      subtitle: z.string().trim().max(80).optional(),
      type: blockTypeSchema.optional(),
      fields: entityFieldsInput.optional(),
      frameId: z.string().min(1).max(100).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    },
    // Rule engine: spec 13. Until then every call runs directly.
    run: ({ title, subtitle, type, fields, frameId, x, y }) =>
      options.boards.withBoard(options.boardId, (doc) => {
        const nodes = readNodes(doc);
        const frame = frameId
          ? nodes.find((node) => node.id === frameId && node.type === 'frame')
          : undefined;
        if (frameId && !frame) throw new Error(`There is no frame with the id ${frameId}.`);
        const blockType =
          type ??
          (frame
            ? newBlockType(
                frame.diagramType,
                nodes.filter((node) => node.frameId === frame.id),
              )
            : null);
        if (fields && fields.length > 0 && blockType !== 'entity') {
          throw new Error(
            'Only entities have fields: set the type "entity" or leave the fields out.',
          );
        }
        const entityFields = (fields ?? []).map((field) => ({
          name: field.name,
          type: field.type ?? '',
        }));
        const size = blockSize(blockType, entityFields);
        const position =
          x !== undefined && y !== undefined
            ? { x, y }
            : frame
              ? spotIn(frame, nodes, size)
              : findFreeSpot(nodes, centerOfNodes(nodes), size);

        const id = randomUUID();
        doc.transact(() => {
          addBlock(
            doc,
            {
              id,
              position,
              label: title,
              subtitle: subtitle ?? '',
              blockType,
              fields: entityFields,
              frameId: frame?.id ?? null,
            },
            options.author,
          );
          if (frame) growAround(doc, frame, id, options);
        }, authorOrigin(options.author));
        const typeNote = blockType ? ` of type ${blockType}` : '';
        const where = frame ? ` in the frame "${frame.label}"` : '';
        return Promise.resolve(
          `Added the block "${title}"${typeNote} (id ${id})${where} at ${describePosition(position)}.`,
        );
      }),
  });
}
