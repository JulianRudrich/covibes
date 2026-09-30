import * as Y from 'yjs';
import { z } from 'zod';

import { AGENT_KEYS } from '../agents/keys';

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

/**
 * Kinds of blocks this version offers (spec 08); `null` is the generic block. Stored nodes accept
 * any type string, so a type added by a later version shows as a generic block instead of breaking.
 */
export const BLOCK_TYPES = [
  'app',
  'server',
  'service',
  'database',
  'repository',
  'metric',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const blockTypeSchema = z.enum(BLOCK_TYPES);

const blockLabelSchema = z.string().trim().min(1).max(200);
const blockSubtitleSchema = z.string().trim().max(200);

export const addBlockInputSchema = z.object({
  /** Created by the caller (`crypto.randomUUID()`), so the new block can be selected right away. */
  id: z.uuid(),
  position: positionSchema,
  label: blockLabelSchema,
  subtitle: blockSubtitleSchema.default(''),
  blockType: blockTypeSchema.nullable().default(null),
});
export type AddBlockInput = z.input<typeof addBlockInputSchema>;

export const updateBlockInputSchema = z
  .object({
    label: blockLabelSchema,
    subtitle: blockSubtitleSchema,
    blockType: blockTypeSchema.nullable(),
  })
  .partial();
export type UpdateBlockInput = z.input<typeof updateBlockInputSchema>;

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
 * Changes the texts or the type of a block; returns false if it does not exist (e.g. removed by
 * someone else meanwhile). Other kinds of nodes are left alone.
 */
export function updateBlock(
  doc: Y.Doc,
  id: string,
  changes: UpdateBlockInput,
  author: Author,
): boolean {
  const data = updateBlockInputSchema.parse(changes);
  const changedBy = authorSchema.parse(author);
  const fields = getNodesMap(doc).get(id);
  if (fields?.get('type') !== 'block') return false;

  doc.transact(() => {
    // A key passed as `undefined` survives parsing; it means "unchanged", not "clear".
    for (const [key, value] of Object.entries(data) as [string, unknown][]) {
      if (value !== undefined) fields.set(key, value);
    }
    fields.set('lastChangedBy', changedBy);
    fields.set('lastChangedAt', new Date().toISOString());
  }, authorOrigin(changedBy));
  return true;
}

/** Removes nodes and every edge that touches one of them, as one change of the author. */
export function removeNodes(doc: Y.Doc, ids: readonly string[], author: Author): void {
  const removedBy = authorSchema.parse(author);
  const nodes = getNodesMap(doc);
  const edges = getEdgesMap(doc);
  const removed = new Set(ids.filter((id) => nodes.has(id)));
  if (removed.size === 0) return;

  doc.transact(() => {
    for (const id of removed) nodes.delete(id);
    for (const [edgeId, fields] of edges) {
      const ends = [fields.get('source'), fields.get('target')];
      if (ends.some((end) => typeof end === 'string' && removed.has(end))) edges.delete(edgeId);
    }
  }, authorOrigin(removedBy));
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
