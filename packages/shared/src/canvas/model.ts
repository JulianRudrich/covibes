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

/** The fields of an entity in a data model (spec 12), e.g. `id uuid`. */
export const ENTITY_FIELDS_MAX = 20;
export const entityFieldSchema = z.object({
  name: z.string().trim().min(1).max(40),
  type: z.string().trim().max(40).default(''),
});
export type EntityField = z.output<typeof entityFieldSchema>;
export const entityFieldsSchema = z.array(entityFieldSchema).max(ENTITY_FIELDS_MAX);

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
  /**
   * The diagram in a frame (spec 12); null is a free frame. Like block types, any string is read,
   * so a type from a later version shows as a free frame. Missing in documents from before.
   */
  diagramType: z.string().min(1).max(40).nullable().default(null),
  /** The fields of an entity block (spec 12); missing in documents from before. */
  fields: z
    .array(z.object({ name: z.string().max(40), type: z.string().max(40) }))
    .max(ENTITY_FIELDS_MAX)
    .default([]),
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
  lastChangedBy: authorSchema,
  lastChangedAt: z.iso.datetime(),
});
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;

/** Blocks have a fixed size in the design handoff (180 × 96). */
export const BLOCK_SIZE: Size = { width: 180, height: 96 };
/** Sticky notes are 176 × 124 in the handoff. */
export const NOTE_SIZE: Size = { width: 176, height: 124 };
/** A new frame; frames can be resized, but not below `FRAME_MIN_SIZE` (spec 09). */
export const FRAME_SIZE: Size = { width: 480, height: 320 };
export const FRAME_MIN_SIZE: Size = { width: 240, height: 160 };

/** Rows an entity card shows before "+ n weitere", their height and the room around them. */
export const ENTITY_VISIBLE_FIELDS = 8;
export const ENTITY_FIELD_HEIGHT = 22;
const ENTITY_FIELDS_PADDING = 8;

/**
 * Kinds of blocks this version offers (specs 08 and 12); `null` is the generic block. Stored nodes
 * accept any type string, so a type added by a later version shows as a generic block instead of
 * breaking.
 */
export const BLOCK_TYPES = [
  'app',
  'server',
  'service',
  'database',
  'repository',
  'metric',
  'topic',
  'idea',
  'entity',
  'start',
  'step',
  'decision',
  'end',
  'page',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const blockTypeSchema = z.enum(BLOCK_TYPES);

/** The diagrams a frame can hold (spec 12); the roadmap follows in spec 26. */
export const DIAGRAM_TYPES = ['mindmap', 'architecture', 'datamodel', 'flow', 'sitemap'] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];
export const diagramTypeSchema = z.enum(DIAGRAM_TYPES);

export function isDiagramType(value: unknown): value is DiagramType {
  return (DIAGRAM_TYPES as readonly unknown[]).includes(value);
}

/** The block types of each diagram; the generic block fits everywhere. */
export const DIAGRAM_BLOCK_TYPES: Readonly<Record<DiagramType, readonly BlockType[]>> = {
  mindmap: ['topic', 'idea'],
  architecture: ['app', 'server', 'service', 'database', 'repository', 'metric'],
  datamodel: ['entity'],
  flow: ['start', 'step', 'decision', 'end'],
  sitemap: ['page'],
};

/**
 * The type of a new block in a frame of `diagramType` with these members: a mind map starts with
 * its central topic and continues with ideas; architecture and free frames start generic.
 */
export function newBlockType(
  diagramType: string | null,
  members: readonly Pick<CanvasNode, 'blockType'>[],
): BlockType | null {
  switch (diagramType) {
    case 'mindmap':
      return members.some((member) => member.blockType === 'topic') ? 'idea' : 'topic';
    case 'datamodel':
      return 'entity';
    case 'flow':
      return 'step';
    case 'sitemap':
      return 'page';
    default:
      return null;
  }
}

/** The size of a block: entities grow with the fields they show (spec 12). */
export function blockSize(blockType: string | null, fields: readonly EntityField[]): Size {
  if (blockType !== 'entity' || fields.length === 0) return BLOCK_SIZE;
  const shown = Math.min(fields.length, ENTITY_VISIBLE_FIELDS);
  const rows = shown + (fields.length > ENTITY_VISIBLE_FIELDS ? 1 : 0);
  return {
    width: BLOCK_SIZE.width,
    height: BLOCK_SIZE.height + ENTITY_FIELDS_PADDING + rows * ENTITY_FIELD_HEIGHT,
  };
}

const nodeTextSchema = z.string().trim().min(1).max(200);
const blockSubtitleSchema = z.string().trim().max(200);
const frameSizeSchema = z.object({
  width: z.number().min(FRAME_MIN_SIZE.width),
  height: z.number().min(FRAME_MIN_SIZE.height),
});

export const addBlockInputSchema = z.object({
  /** Created by the caller (`crypto.randomUUID()`), so the new block can be selected right away. */
  id: z.uuid(),
  position: positionSchema,
  label: nodeTextSchema,
  subtitle: blockSubtitleSchema.default(''),
  blockType: blockTypeSchema.nullable().default(null),
  fields: entityFieldsSchema.default([]),
  /** The frame the block belongs to, whatever lies under its center (e.g. an agent's diagram). */
  frameId: z.uuid().nullable().default(null),
});
export type AddBlockInput = z.input<typeof addBlockInputSchema>;

export const addNoteInputSchema = z.object({
  id: z.uuid(),
  position: positionSchema,
  text: nodeTextSchema,
});
export type AddNoteInput = z.input<typeof addNoteInputSchema>;

export const addFrameInputSchema = z.object({
  id: z.uuid(),
  position: positionSchema,
  title: nodeTextSchema,
  size: frameSizeSchema.default(FRAME_SIZE),
  diagramType: diagramTypeSchema.nullable().default(null),
});
export type AddFrameInput = z.input<typeof addFrameInputSchema>;

/**
 * Changes of a node: title, subtitle, type and fields of a block, the text of a note, the title
 * and diagram type of a frame.
 */
export const updateNodeInputSchema = z
  .object({
    label: nodeTextSchema,
    subtitle: blockSubtitleSchema,
    blockType: blockTypeSchema.nullable(),
    fields: entityFieldsSchema,
    diagramType: diagramTypeSchema.nullable(),
  })
  .partial();
export type UpdateNodeInput = z.input<typeof updateNodeInputSchema>;

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

/** Stores a new node, stamped as created and last changed by its author. */
function insertNode(
  doc: Y.Doc,
  fields: Omit<CanvasNode, 'createdBy' | 'lastChangedBy' | 'lastChangedAt'>,
  author: Author,
): CanvasNode {
  const createdBy = authorSchema.parse(author);
  const node: CanvasNode = {
    ...fields,
    createdBy,
    lastChangedBy: createdBy,
    lastChangedAt: new Date().toISOString(),
  };
  const nodes = getNodesMap(doc);
  if (nodes.has(node.id)) throw new Error(`Node ${node.id} already exists`);

  doc.transact(() => {
    const map: NodeFields = new Y.Map();
    for (const [key, value] of Object.entries(node)) map.set(key, value);
    nodes.set(node.id, map);
  }, authorOrigin(createdBy));
  return node;
}

export function addBlock(doc: Y.Doc, input: AddBlockInput, author: Author): CanvasNode {
  const data = addBlockInputSchema.parse(input);
  if (data.frameId && getNodesMap(doc).get(data.frameId)?.get('type') !== 'frame') {
    throw new Error(`Frame ${data.frameId} does not exist`);
  }
  return insertNode(
    doc,
    {
      id: data.id,
      type: 'block',
      blockType: data.blockType,
      position: data.position,
      size: blockSize(data.blockType, data.fields),
      label: data.label,
      subtitle: data.subtitle,
      frameId: data.frameId,
      diagramType: null,
      fields: data.fields,
    },
    author,
  );
}

/** A sticky note for an unfinished thought (spec 09); its text is the node's label. */
export function addNote(doc: Y.Doc, input: AddNoteInput, author: Author): CanvasNode {
  const data = addNoteInputSchema.parse(input);
  return insertNode(
    doc,
    {
      id: data.id,
      type: 'sticky',
      blockType: null,
      position: data.position,
      size: NOTE_SIZE,
      label: data.text,
      subtitle: '',
      frameId: null,
      diagramType: null,
      fields: [],
    },
    author,
  );
}

/** A frame: a labeled area that holds a diagram (spec 09). Its title is the node's label. */
export function addFrame(doc: Y.Doc, input: AddFrameInput, author: Author): CanvasNode {
  const data = addFrameInputSchema.parse(input);
  return insertNode(
    doc,
    {
      id: data.id,
      type: 'frame',
      blockType: null,
      position: data.position,
      size: data.size,
      label: data.title,
      subtitle: '',
      frameId: null,
      diagramType: data.diagramType,
      fields: [],
    },
    author,
  );
}

function stampChange(fields: NodeFields, changedBy: Author, at: string) {
  fields.set('lastChangedBy', changedBy);
  fields.set('lastChangedAt', at);
}

function readPosition(fields: NodeFields): Position | undefined {
  const parsed = positionSchema.safeParse(fields.get('position'));
  return parsed.success ? parsed.data : undefined;
}

/**
 * Moves nodes as one change. A frame takes its members along, except members that are moved
 * themselves (e.g. selected together with the frame); members keep their last change, since
 * nobody changed them. Unknown ids are skipped.
 */
export function moveNodes(
  doc: Y.Doc,
  moves: Iterable<readonly [string, Position]>,
  author: Author,
): void {
  const targets = new Map(
    Array.from(moves, ([id, position]) => [id, positionSchema.parse(position)] as const),
  );
  const changedBy = authorSchema.parse(author);
  const nodes = getNodesMap(doc);
  if (![...targets.keys()].some((id) => nodes.has(id))) return;

  doc.transact(() => {
    const at = new Date().toISOString();
    for (const [id, position] of targets) {
      const fields = nodes.get(id);
      if (!fields) continue;
      const before = readPosition(fields);
      fields.set('position', position);
      stampChange(fields, changedBy, at);
      if (fields.get('type') !== 'frame' || !before) continue;

      const dx = position.x - before.x;
      const dy = position.y - before.y;
      for (const [memberId, member] of nodes) {
        if (member.get('frameId') !== id || targets.has(memberId)) continue;
        const current = readPosition(member);
        if (current) member.set('position', { x: current.x + dx, y: current.y + dy });
      }
    }
  }, authorOrigin(changedBy));
}

/** Moves one node; returns false if it does not exist (e.g. removed by someone else meanwhile). */
export function moveNode(doc: Y.Doc, id: string, position: Position, author: Author): boolean {
  const target = positionSchema.parse(position);
  if (!getNodesMap(doc).has(id)) return false;
  moveNodes(doc, [[id, target]], author);
  return true;
}

/**
 * Changes the texts of a node, the type and fields of a block or the diagram type of a frame;
 * returns false if the node does not exist (e.g. removed by someone else meanwhile). Notes only
 * have their text. A block's size follows its type and fields.
 */
export function updateNode(
  doc: Y.Doc,
  id: string,
  changes: UpdateNodeInput,
  author: Author,
): boolean {
  const data = updateNodeInputSchema.parse(changes);
  const changedBy = authorSchema.parse(author);
  const fields = getNodesMap(doc).get(id);
  if (!fields) return false;
  const type = fields.get('type');
  const blockOnly = [data.subtitle, data.blockType, data.fields].some(
    (value) => value !== undefined,
  );
  if (type !== 'block' && blockOnly) {
    throw new Error(`A ${String(type)} has neither a subtitle, a type nor fields`);
  }
  if (type !== 'frame' && data.diagramType !== undefined) {
    throw new Error(`A ${String(type)} has no diagram type`);
  }

  doc.transact(() => {
    // A key passed as `undefined` survives parsing; it means "unchanged", not "clear".
    for (const [key, value] of Object.entries(data) as [string, unknown][]) {
      if (value !== undefined) fields.set(key, value);
    }
    if (type === 'block' && (data.blockType !== undefined || data.fields !== undefined)) {
      const blockType = fields.get('blockType');
      const entityFields = entityFieldsSchema.safeParse(fields.get('fields') ?? []);
      fields.set(
        'size',
        blockSize(
          typeof blockType === 'string' ? blockType : null,
          entityFields.success ? entityFields.data : [],
        ),
      );
    }
    stampChange(fields, changedBy, new Date().toISOString());
  }, authorOrigin(changedBy));
  return true;
}

function centerOf(node: Pick<CanvasNode, 'position' | 'size'>): Position {
  return {
    x: node.position.x + node.size.width / 2,
    y: node.position.y + node.size.height / 2,
  };
}

function contains(area: Pick<CanvasNode, 'position' | 'size'>, point: Position): boolean {
  return (
    point.x >= area.position.x &&
    point.x <= area.position.x + area.size.width &&
    point.y >= area.position.y &&
    point.y <= area.position.y + area.size.height
  );
}

/** The topmost frame that contains `point`, or null. */
export function frameAt(nodes: readonly CanvasNode[], point: Position): CanvasNode | null {
  let found: CanvasNode | null = null;
  for (const frame of nodes) {
    if (frame.type !== 'frame' || !contains(frame, point)) continue;
    // Frames stack by their last change, like all nodes; the latest one lies on top.
    if (!found || frame.lastChangedAt > found.lastChangedAt) found = frame;
  }
  return found;
}

/** The frame a node belongs to by its center: the topmost frame that contains it, or null. */
function frameFor(node: CanvasNode, frames: readonly CanvasNode[]): string | null {
  return frameAt(frames, centerOf(node))?.id ?? null;
}

/** Sets `frameId` of the given nodes from where their centers lie now. */
function placeIn(doc: Y.Doc, ids: Iterable<string>, origin: string) {
  const snapshot = readNodes(doc);
  const frames = snapshot.filter((node) => node.type === 'frame');
  const byId = new Map(snapshot.map((node) => [node.id, node]));
  const nodes = getNodesMap(doc);
  doc.transact(() => {
    for (const id of ids) {
      const node = byId.get(id);
      if (!node || node.type === 'frame') continue;
      const frameId = frameFor(node, frames);
      if (frameId !== node.frameId) nodes.get(id)?.set('frameId', frameId);
    }
  }, origin);
}

/**
 * After a drop, a node belongs to the frame in which its center lies, or to none (spec 09).
 * Frames themselves are never members: frames are not nested in V1.
 */
export function placeNodes(doc: Y.Doc, ids: Iterable<string>, author: Author): void {
  placeIn(doc, ids, authorOrigin(authorSchema.parse(author)));
}

/**
 * Resizes a frame; from a top or left corner its position changes too. Membership follows the
 * new bounds: free nodes whose center the frame now covers join, members left outside leave (and
 * join whatever frame lies under them). Members of other frames stay where they belong, so a
 * frame that grows over another one never takes its diagram (spec 12).
 */
export function resizeFrame(
  doc: Y.Doc,
  id: string,
  bounds: { size: Size; position?: Position },
  author: Author,
): boolean {
  const size = frameSizeSchema.parse(bounds.size);
  const position = bounds.position ? positionSchema.parse(bounds.position) : undefined;
  const changedBy = authorSchema.parse(author);
  const fields = getNodesMap(doc).get(id);
  if (fields?.get('type') !== 'frame') return false;

  const origin = authorOrigin(changedBy);
  doc.transact(() => {
    fields.set('size', size);
    if (position) fields.set('position', position);
    stampChange(fields, changedBy, new Date().toISOString());
    const area = { position: position ?? readPosition(fields) ?? { x: 0, y: 0 }, size };
    const nodes = getNodesMap(doc);
    const leaving: string[] = [];
    for (const node of readNodes(doc)) {
      if (node.type === 'frame') continue;
      const inside = contains(area, centerOf(node));
      if (node.frameId === id && !inside) leaving.push(node.id);
      if (!node.frameId && inside) nodes.get(node.id)?.set('frameId', id);
    }
    placeIn(doc, leaving, origin);
  }, origin);
  return true;
}

/**
 * Removes nodes and every edge that touches one of them, as one change of the author. The members
 * of a removed frame stay on the canvas, outside of any frame.
 */
export function removeNodes(doc: Y.Doc, ids: readonly string[], author: Author): void {
  const removedBy = authorSchema.parse(author);
  const nodes = getNodesMap(doc);
  const edges = getEdgesMap(doc);
  const removed = new Set(ids.filter((id) => nodes.has(id)));
  if (removed.size === 0) return;

  doc.transact(() => {
    for (const id of removed) nodes.delete(id);
    for (const member of nodes.values()) {
      const frameId = member.get('frameId');
      if (typeof frameId === 'string' && removed.has(frameId)) member.set('frameId', null);
    }
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
