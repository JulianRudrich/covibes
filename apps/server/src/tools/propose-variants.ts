import { randomUUID } from 'node:crypto';

import {
  blockTypeSchema,
  computeLayout,
  DECISION_TOPIC_MAX_LENGTH,
  diagramTypeSchema,
  edgeLabelSchema,
  findFreeSpot,
  FRAME_PADDING,
  FRAME_SIZE,
  newBlockType,
  readEdges,
  readNodes,
  VARIANT_NAME_MAX_LENGTH,
  VARIANT_SUMMARY_MAX_LENGTH,
  variantLetter,
  variantsOperationSchema,
  withOperations,
  type Author,
  type BlockType,
  type CanvasOperationInput,
  type Position,
  type Size,
} from '@covibes/shared';
import type * as Y from 'yjs';
import { z } from 'zod';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import type { BoardAccess } from '@server/collab/board-client';
import type { DecisionWriter } from '@server/tasks/run-decisions';
import { entityFieldsInput } from '@server/tools/add-block';
import { layoutEngine } from '@server/tools/arrange-frame';
import { centerOfNodes } from '@server/tools/placement';

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const variantInput = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(VARIANT_NAME_MAX_LENGTH)
    .describe('The name of the variant, one to three words, e.g. "Monolith"'),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(VARIANT_SUMMARY_MAX_LENGTH)
    .describe('What distinguishes the variant and what speaks for it, in one sentence'),
  diagramType: diagramTypeSchema.describe('The type of its diagram, e.g. architecture'),
  blocks: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .describe('A short key for the connections, e.g. "api"'),
        title: z.string().trim().min(1).max(80),
        subtitle: z.string().trim().max(80).optional(),
        type: blockTypeSchema.optional(),
        fields: entityFieldsInput.optional(),
      }),
    )
    .min(1)
    .max(12),
  connections: z
    .array(
      z.object({
        from: z.string().trim().min(1).max(40).describe('The key of the block the arrow leaves'),
        to: z.string().trim().min(1).max(40).describe('The key of the block the arrow leads to'),
        label: edgeLabelSchema.optional(),
      }),
    )
    .max(24)
    .optional(),
});
type VariantInput = z.infer<typeof variantInput>;

/** Room between the frames of two variants, enough for their headers to stay apart. */
const VARIANT_GAP = 80;

type DrawnVariant = {
  operations: CanvasOperationInput[];
  /** Where the arranged frame lies and how large it is. */
  position: Position;
  size: Size;
};

/** The same operations, drawn `offset` away. */
function shifted(
  operations: readonly CanvasOperationInput[],
  offset: Position,
): CanvasOperationInput[] {
  const move = (position: Position) => ({ x: position.x + offset.x, y: position.y + offset.y });
  return operations.map((operation) => {
    switch (operation.op) {
      case 'add_frame':
        return {
          ...operation,
          frame: { ...operation.frame, position: move(operation.frame.position) },
        };
      case 'add_block':
        return {
          ...operation,
          block: { ...operation.block, position: move(operation.block.position) },
        };
      case 'arrange':
        return {
          ...operation,
          moves: operation.moves.map((entry) => ({ ...entry, position: move(entry.position) })),
          frame: operation.frame
            ? { ...operation.frame, position: move(operation.frame.position) }
            : null,
        };
      default:
        return operation;
    }
  });
}

/**
 * The operations that draw one variant as a diagram in its own frame: the frame, its blocks and
 * arrows, and the arrangement by the layout of the diagram type. The place is provisional; the
 * variants are put in a row once the size of every frame is known.
 */
async function drawVariant(
  view: Y.Doc,
  title: string,
  variant: VariantInput,
  author: Author,
): Promise<DrawnVariant> {
  const nodes = readNodes(view);
  const frameId = randomUUID();
  const position = findFreeSpot(nodes, centerOfNodes(nodes), FRAME_SIZE);
  const operations: CanvasOperationInput[] = [
    {
      op: 'add_frame',
      frame: { id: frameId, position, title, diagramType: variant.diagramType },
    },
  ];

  const ids = new Map<string, string>();
  const members: { blockType: BlockType | null }[] = [];
  variant.blocks.forEach((block, index) => {
    const key = block.key.toLowerCase();
    if (ids.has(key))
      throw new Error(`The variant "${variant.name}" uses the key "${block.key}" twice.`);
    const id = randomUUID();
    ids.set(key, id);
    const blockType = block.type ?? newBlockType(variant.diagramType, members);
    members.push({ blockType });
    operations.push({
      op: 'add_block',
      block: {
        id,
        // Only a start; the arrangement below gives every block its place.
        position: {
          x: position.x + FRAME_PADDING.left + index * 24,
          y: position.y + FRAME_PADDING.top + index * 24,
        },
        label: block.title,
        subtitle: block.subtitle ?? '',
        blockType,
        fields:
          blockType === 'entity'
            ? (block.fields ?? []).map((field) => ({ name: field.name, type: field.type ?? '' }))
            : [],
        frameId,
      },
    });
  });
  for (const connection of variant.connections ?? []) {
    const source = ids.get(connection.from.toLowerCase());
    const target = ids.get(connection.to.toLowerCase());
    if (!source || !target) {
      throw new Error(
        `The connection "${connection.from}" → "${connection.to}" of the variant "${variant.name}" names a block that is not in it.`,
      );
    }
    operations.push({
      op: 'add_edge',
      edge: { id: randomUUID(), source, target, label: connection.label ?? '' },
    });
  }

  const staged = withOperations(view, operations, author);
  const layout = await computeLayout(layoutEngine(), readNodes(staged), readEdges(staged), frameId);
  const size = layout.frameSizes.get(frameId);
  operations.push({
    op: 'arrange',
    moves: [...layout.positions]
      .filter(([id]) => id !== frameId)
      .map(([id, place]) => ({ id, position: place })),
    frame: size ? { id: frameId, position: layout.positions.get(frameId) ?? position, size } : null,
  });
  return {
    operations,
    position: (size ? layout.positions.get(frameId) : undefined) ?? position,
    size: size ?? FRAME_SIZE,
  };
}

/**
 * `propose_variants` (spec 17): the moderator shows two or three alternatives as diagrams side by
 * side. The server draws each in its own frame, arranges it and puts the frames next to each
 * other. The result is a proposal by nature: nothing is on the canvas until the team adopts one
 * variant.
 */
export function proposeVariantsTool(options: {
  boards: BoardAccess;
  boardId: string;
  author: Author;
  decisions: DecisionWriter;
}): AgentTool {
  return defineTool({
    name: 'propose_variants',
    description:
      'Shows two or three alternative ways to build something as variants A/B: one diagram per variant, side by side on the canvas, for the team to adopt one. Give every variant a name, one sentence on what distinguishes it, the diagram type, its blocks (each with a short key) and the connections between them by key. The diagrams are arranged for you.',
    input: {
      topic: z
        .string()
        .trim()
        .min(1)
        .max(DECISION_TOPIC_MAX_LENGTH)
        .describe('What is being decided, in one to three words, e.g. "Architektur"'),
      variants: z.array(variantInput).min(2).max(3),
    },
    run: async ({ topic, variants }) => {
      const { decisions, openVariants } = await options.decisions.load();
      const existing = decisions.find((decision) => sameText(decision.topic, topic));
      if (existing?.status === 'decided') {
        return `"${existing.topic}" is decided already: ${existing.value ?? ''}. No variants were proposed. Someone in the team has to reopen the decision first, in the overview under "Entscheidungen".`;
      }
      if (openVariants.some((open) => sameText(open.topic, topic))) {
        return `Variants for "${topic}" wait for the team already. No new ones were proposed.`;
      }
      const duplicate = variants.find(
        (variant, index) =>
          variants.findIndex((other) => sameText(other.name, variant.name)) !== index,
      );
      if (duplicate) throw new Error(`Two variants are called "${duplicate.name}".`);

      const name = existing?.topic ?? topic;
      const drawn = await options.boards.withBoard(options.boardId, async (doc) => {
        // Every variant is drawn on its own; the board itself stays as it is.
        const drafts: DrawnVariant[] = [];
        for (const variant of variants) {
          drafts.push(await drawVariant(doc, `${name}: ${variant.name}`, variant, options.author));
        }
        // Side by side: one row with the tops aligned, at a spot that is free for all of them.
        const nodes = readNodes(doc);
        const row = findFreeSpot(nodes, centerOfNodes(nodes), {
          width:
            drafts.reduce((width, draft) => width + draft.size.width, 0) +
            VARIANT_GAP * (drafts.length - 1),
          height: Math.max(...drafts.map((draft) => draft.size.height)),
        });
        let x = row.x;
        return variants.map((variant, index) => {
          const draft = drafts[index];
          if (!draft) throw new Error('A variant was not drawn.');
          const offset = { x: x - draft.position.x, y: row.y - draft.position.y };
          x += draft.size.width + VARIANT_GAP;
          return {
            name: variant.name,
            summary: variant.summary,
            operations: shifted(draft.operations, offset),
          };
        });
      });

      if (!existing) await options.decisions.open(name);
      await options.decisions.proposeVariants(
        options.boardId,
        variantsOperationSchema.parse({ op: 'variants', topic: name, variants: drawn }),
      );
      const list = drawn
        .map((variant, index) => `${variantLetter(index)} "${variant.name}"`)
        .join(', ');
      return `Proposed the variants ${list} for "${name}". They are shown side by side on the canvas as dashed diagrams; nothing is on the canvas until someone in the team adopts one, there or under "Wartet auf dich". Say in two or three sentences how the variants differ; do not describe the diagrams block by block.`;
    },
  });
}
