import * as Y from 'yjs';
import { z } from 'zod';

import { AGENT_KEYS } from '../agents';

// The canvas of a board lives in one Y.Doc (`board:{boardId}`, see architecture.md, "Canvas model").
// Web app and server change it only through these functions, so every change is validated and
// carries its author. Zod numbers reject NaN and Infinity on their own.

export const authorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('human'), userId: z.uuid() }),
  z.object({ kind: z.literal('agent'), agentKey: z.enum(AGENT_KEYS) }),
]);
export type Author = z.infer<typeof authorSchema>;

export const positionSchema = z.object({ x: z.number(), y: z.number() });
export type Position = z.infer<typeof positionSchema>;

export const sizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});
export type Size = z.infer<typeof sizeSchema>;

export const CANVAS_NODE_TYPES = ['block', 'sticky', 'frame'] as const;

export const canvasNodeSchema = z.object({
  id: z.uuid(),
  type: z.enum(CANVAS_NODE_TYPES),
  /** Kind of block (e.g. service or database); icons and names follow in spec 08. */
  blockType: z.string().min(1).max(40).nullable(),
  position: positionSchema,
  size: sizeSchema,
  label: z.string().max(200),
  subtitle: z.string().max(200),
  frameId: z.uuid().nullable(),
  createdBy: authorSchema,
  lastChangedBy: authorSchema,
  lastChangedAt: z.iso.datetime(),
});
export type CanvasNode = z.infer<typeof canvasNodeSchema>;

export const canvasEdgeSchema = z.object({
  id: z.uuid(),
  source: z.uuid(),
  target: z.uuid(),
  sourceHandle: z.string().max(40).nullable(),
  targetHandle: z.string().max(40).nullable(),
  label: z.string().max(120),
  createdBy: authorSchema,
});
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;

/** Blocks have a fixed size in the design handoff (180 × 96). */
export const BLOCK_SIZE: Size = { width: 180, height: 96 };

export const addBlockInputSchema = z.object({
  /** Created by the caller (`crypto.randomUUID()`), so the new block can be selected right away. */
  id: z.uuid(),
  position: positionSchema,
  label: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(200).default(''),
  blockType: z.string().min(1).max(40).nullable().default(null),
});
export type AddBlockInput = z.input<typeof addBlockInputSchema>;

type NodeFields = Y.Map<unknown>;

export function getNodesMap(doc: Y.Doc): Y.Map<NodeFields> {
  return doc.getMap<NodeFields>('nodes');
}

export function getEdgesMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('edges');
}

/**
 * Transaction origin of an author. Strings compare by value, so the undo manager (spec 10) can
 * track the changes of one person across many transactions.
 */
export function authorOrigin(author: Author): string {
  return author.kind === 'human' ? `human:${author.userId}` : `agent:${author.agentKey}`;
}

export function addBlock(doc: Y.Doc, input: AddBlockInput, author: Author): CanvasNode {
  const data = addBlockInputSchema.parse(input);
  const createdBy = authorSchema.parse(author);
  const node: CanvasNode = {
    id: data.id,
    type: 'block',
    blockType: data.blockType,
    position: data.position,
    size: BLOCK_SIZE,
    label: data.label,
    subtitle: data.subtitle,
    frameId: null,
    createdBy,
    lastChangedBy: createdBy,
    lastChangedAt: new Date().toISOString(),
  };
  const nodes = getNodesMap(doc);
  if (nodes.has(node.id)) throw new Error(`Node ${node.id} already exists`);

  doc.transact(() => {
    const fields: NodeFields = new Y.Map();
    for (const [key, value] of Object.entries(node)) fields.set(key, value);
    nodes.set(node.id, fields);
  }, authorOrigin(createdBy));
  return node;
}

/** Moves a node; returns false if it does not exist (e.g. removed by someone else meanwhile). */
export function moveNode(doc: Y.Doc, id: string, position: Position, author: Author): boolean {
  const target = positionSchema.parse(position);
  const changedBy = authorSchema.parse(author);
  const fields = getNodesMap(doc).get(id);
  if (!fields) return false;

  doc.transact(() => {
    fields.set('position', target);
    fields.set('lastChangedBy', changedBy);
    fields.set('lastChangedAt', new Date().toISOString());
  }, authorOrigin(changedBy));
  return true;
}

/**
 * Plain snapshots for the UI and the agents. Entries that do not match the schema (e.g. written by
 * an outdated client) are left out instead of breaking the whole canvas.
 */
export function readNodes(doc: Y.Doc): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  for (const fields of getNodesMap(doc).values()) {
    const parsed = canvasNodeSchema.safeParse(fields.toJSON());
    if (parsed.success) nodes.push(parsed.data);
  }
  return nodes;
}

export function readEdges(doc: Y.Doc): CanvasEdge[] {
  const edges: CanvasEdge[] = [];
  for (const fields of getEdgesMap(doc).values()) {
    const parsed = canvasEdgeSchema.safeParse(fields.toJSON());
    if (parsed.success) edges.push(parsed.data);
  }
  return edges;
}

/** Name of the Y.Doc of a board, as used by the collaboration server. */
export function boardDocumentName(boardId: string): string {
  return `board:${boardId}`;
}

/** The board id inside a document name, or undefined for anything else. */
export function boardIdFromDocumentName(name: string): string | undefined {
  if (!name.startsWith('board:')) return undefined;
  const id = z.uuid().safeParse(name.slice('board:'.length));
  return id.success ? id.data : undefined;
}
