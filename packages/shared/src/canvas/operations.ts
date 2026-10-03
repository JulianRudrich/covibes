import * as Y from 'yjs';
import { z } from 'zod';

import { addEdge, addEdgeInputSchema, edgeProblem } from './edges';
import {
  addBlock,
  addBlockInputSchema,
  addFrame,
  addFrameInputSchema,
  addNote,
  addNoteInputSchema,
  authorOrigin,
  authorSchema,
  FRAME_MIN_SIZE,
  getEdgesMap,
  getNodesMap,
  moveNodes,
  placeNodes,
  positionSchema,
  resizeFrame,
  ROADMAP_DIAGRAM,
  updateNode,
  updateNodeInputSchema,
  type Author,
} from './model';

// Changes of the canvas as data (spec 13). Agents' tools describe what they do as operations: run
// directly they are applied at once, as a proposal they are stored and applied when someone
// accepts it. Each operation stands for one function of the model and is validated like it.

const nodeIdSchema = z.uuid();

export const canvasOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_block'), block: addBlockInputSchema }),
  z.object({ op: z.literal('add_note'), note: addNoteInputSchema }),
  z.object({
    op: z.literal('add_frame'),
    frame: addFrameInputSchema,
    /** Blocks the frame is drawn around; they become its members. */
    members: z.array(nodeIdSchema).max(50).default([]),
  }),
  z.object({ op: z.literal('add_edge'), edge: addEdgeInputSchema }),
  z.object({ op: z.literal('update_node'), id: nodeIdSchema, changes: updateNodeInputSchema }),
  z.object({
    /** New positions from arranging a frame, and the frame's new bounds. */
    op: z.literal('arrange'),
    moves: z.array(z.object({ id: nodeIdSchema, position: positionSchema })).max(500),
    frame: z
      .object({
        id: nodeIdSchema,
        position: positionSchema,
        size: z.object({
          width: z.number().min(FRAME_MIN_SIZE.width),
          height: z.number().min(FRAME_MIN_SIZE.height),
        }),
      })
      .nullable()
      .default(null),
  }),
]);
export type CanvasOperation = z.output<typeof canvasOperationSchema>;
export type CanvasOperationInput = z.input<typeof canvasOperationSchema>;

export type ApplyResult = { applied: number; skipped: number };

function isFrame(doc: Y.Doc, id: string | null): id is string {
  return id !== null && getNodesMap(doc).get(id)?.get('type') === 'frame';
}

function hasRoadmap(doc: Y.Doc): boolean {
  for (const fields of getNodesMap(doc).values()) {
    if (fields.get('type') === 'frame' && fields.get('diagramType') === ROADMAP_DIAGRAM)
      return true;
  }
  return false;
}

/** A frame that takes blocks: any frame but a roadmap (spec 26a). */
function takesBlocks(doc: Y.Doc, id: string | null): id is string {
  return isFrame(doc, id) && getNodesMap(doc).get(id)?.get('diagramType') !== ROADMAP_DIAGRAM;
}

/** Applies one operation; false if it no longer fits the canvas. */
function applyOne(doc: Y.Doc, operation: CanvasOperation, author: Author): boolean {
  const nodes = getNodesMap(doc);
  switch (operation.op) {
    case 'add_block': {
      const { block } = operation;
      if (nodes.has(block.id)) return false;
      addBlock(
        doc,
        { ...block, frameId: takesBlocks(doc, block.frameId) ? block.frameId : null },
        author,
      );
      return true;
    }
    case 'add_note':
      if (nodes.has(operation.note.id)) return false;
      addNote(doc, operation.note, author);
      return true;
    case 'add_frame':
      if (nodes.has(operation.frame.id)) return false;
      // A board shows the roadmap once, also when a proposal for it is applied late (spec 26a).
      if (operation.frame.diagramType === ROADMAP_DIAGRAM && hasRoadmap(doc)) return false;
      addFrame(doc, operation.frame, author);
      placeNodes(
        doc,
        operation.members.filter((id) => nodes.has(id)),
        author,
      );
      return true;
    case 'add_edge': {
      const { edge } = operation;
      if (getEdgesMap(doc).has(edge.id) || edgeProblem(doc, edge.source, edge.target) !== null) {
        return false;
      }
      addEdge(doc, edge, author);
      return true;
    }
    case 'update_node':
      try {
        return updateNode(doc, operation.id, operation.changes, author);
      } catch {
        // E.g. the node became something else meanwhile; the rest still applies.
        return false;
      }
    case 'arrange': {
      const moves = operation.moves.filter((move) => nodes.has(move.id));
      const { frame } = operation;
      if (moves.length === 0 && !(frame && isFrame(doc, frame.id))) return false;
      moveNodes(
        doc,
        moves.map((move) => [move.id, move.position] as const),
        author,
      );
      if (frame && isFrame(doc, frame.id)) {
        resizeFrame(doc, frame.id, { size: frame.size, position: frame.position }, author);
      }
      return true;
    }
  }
}

/**
 * Applies operations as one change of the author. What no longer fits (an arrow to a removed
 * block, an element that exists already) is skipped, so applying the same operations twice changes
 * nothing the second time.
 */
export function applyOperations(
  doc: Y.Doc,
  operations: readonly CanvasOperationInput[],
  author: Author,
): ApplyResult {
  const parsed = operations.map((operation) => canvasOperationSchema.parse(operation));
  const by = authorSchema.parse(author);
  const result: ApplyResult = { applied: 0, skipped: 0 };
  doc.transact(() => {
    for (const operation of parsed) {
      if (applyOne(doc, operation, by)) result.applied += 1;
      else result.skipped += 1;
    }
  }, authorOrigin(by));
  return result;
}

/** A copy of the canvas with operations applied, e.g. to look at a proposal before applying it. */
export function withOperations(
  doc: Y.Doc,
  operations: readonly CanvasOperationInput[],
  author: Author,
): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  if (operations.length > 0) applyOperations(copy, operations, author);
  return copy;
}

/** The ids of existing nodes an operation changes or moves (not the ones it adds). */
export function changedNodeIds(operation: CanvasOperation): string[] {
  switch (operation.op) {
    case 'update_node':
      return [operation.id];
    case 'arrange':
      return [
        ...operation.moves.map((move) => move.id),
        ...(operation.frame ? [operation.frame.id] : []),
      ];
    default:
      return [];
  }
}
