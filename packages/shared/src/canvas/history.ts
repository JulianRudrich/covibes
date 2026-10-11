import { z } from 'zod';

import { agentKeySchema } from '../agents/custom';

import { canvasEdgeSchema, canvasNodeSchema, type CanvasEdge, type CanvasNode } from './model';

// The history of a board (spec 38). The server compares the board with how it stood when it last
// wrote an entry, and writes what each author did since as one entry. An entry keeps how its
// elements were before and after, so it can be listed and, as a whole, taken back.

/** Entries are kept this long, and at most this many per board (owner decision, 2026-10-11). */
export const HISTORY_DAYS = 30;
export const HISTORY_MAX_ENTRIES = 200;
/** An entry holds at most this many elements; what goes beyond is left out of it. */
export const HISTORY_MAX_ITEMS = 300;
/** While the same author goes on within this time, their entry grows instead of a new one. */
export const HISTORY_MERGE_MS = 60_000;

export const HISTORY_ACTIONS = ['added', 'removed', 'moved', 'changed'] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

/** What an entry is about: a block, a note, a frame or an arrow. */
export const HISTORY_ELEMENT_KINDS = ['block', 'sticky', 'frame', 'edge'] as const;
export type HistoryElementKind = (typeof HISTORY_ELEMENT_KINDS)[number];

/** Who changed something: a person, an agent, or nobody the board can name. */
export const historyActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('human'), userId: z.uuid() }),
  z.object({ kind: z.literal('agent'), agentKey: agentKeySchema }),
  z.object({ kind: z.literal('unknown') }),
]);
export type HistoryActor = z.infer<typeof historyActorSchema>;

/** One element of an entry: what happened to it, and how it was before and after. */
export const historyItemSchema = z.object({
  id: z.uuid(),
  kind: z.enum(HISTORY_ELEMENT_KINDS),
  /** The name the list shows: the label of a block, a note or a frame; "A → B" for an arrow. */
  label: z.string(),
  action: z.enum(HISTORY_ACTIONS),
  /** The element before the entry; null for one the entry added. */
  before: z.union([canvasNodeSchema, canvasEdgeSchema]).nullable(),
  /** The element after the entry; null for one the entry removed. */
  after: z.union([canvasNodeSchema, canvasEdgeSchema]).nullable(),
});
export type HistoryItem = z.infer<typeof historyItemSchema>;
export const historyItemsSchema = z.array(historyItemSchema);

/** A board as the history compares it. */
export type BoardState = { nodes: readonly CanvasNode[]; edges: readonly CanvasEdge[] };

type Element = CanvasNode | CanvasEdge;

function isEdge(element: Element): element is CanvasEdge {
  return 'source' in element;
}

/** What says who touched an element, not what the element is. */
const AUTHORSHIP = new Set(['createdBy', 'lastChangedBy', 'lastChangedAt']);

/** What an element is, apart from who changed it last and when. */
function content(element: Element): string {
  return JSON.stringify(
    Object.entries(element)
      .filter(([key]) => !AUTHORSHIP.has(key))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Whether two elements are the same thing, whoever touched them last. */
export function sameContent(a: CanvasNode | CanvasEdge, b: CanvasNode | CanvasEdge): boolean {
  return content(a) === content(b);
}

/** A node without where it is: two nodes that only differ in this were moved. */
function placeless(node: CanvasNode): string {
  return content({ ...node, position: { x: 0, y: 0 }, frameId: null });
}

/** What happened between two states of one element, or null if nothing did. */
function actionOf(before: Element | null, after: Element | null): HistoryAction | null {
  if (before === null) return after === null ? null : 'added';
  if (after === null) return 'removed';
  if (content(before) === content(after)) return null;
  return !isEdge(before) && !isEdge(after) && placeless(before) === placeless(after)
    ? 'moved'
    : 'changed';
}

/** The name an element is listed by; an arrow by what it connects. */
function labelOf(element: Element, nodes: ReadonlyMap<string, CanvasNode>): string {
  if (!isEdge(element)) return element.label.replace(/\s+/g, ' ').trim();
  const end = (id: string) => nodes.get(id)?.label.replace(/\s+/g, ' ').trim() ?? '';
  return `${end(element.source)} → ${end(element.target)}`;
}

function itemOf(
  before: Element | null,
  after: Element | null,
  nodes: ReadonlyMap<string, CanvasNode>,
): HistoryItem | null {
  const action = actionOf(before, after);
  const element = after ?? before;
  if (action === null || element === null) return null;
  return {
    id: element.id,
    kind: isEdge(element) ? 'edge' : element.type,
    label: labelOf(element, nodes),
    action,
    before,
    after,
  };
}

/** Who was at work on a board since its last entry, as far as the server saw it. */
export type HistoryWindow = {
  /** The people whose changes arrived. */
  humans: ReadonlySet<string>;
  /** Whether the server changed the board itself: for an agent, or to apply a proposal. */
  service: boolean;
  /** Who made an element disappear, by the element's id. */
  removedBy: ReadonlyMap<string, HistoryActor>;
};

export function sameActor(a: HistoryActor, b: HistoryActor): boolean {
  if (a.kind === 'human' && b.kind === 'human') return a.userId === b.userId;
  if (a.kind === 'agent' && b.kind === 'agent') return a.agentKey === b.agentKey;
  return a.kind === 'unknown' && b.kind === 'unknown';
}

/**
 * Who an added, moved or changed element is by. Every element says who changed it last, and that
 * is believed if they were at work: a person whose changes arrived, or anyone while the server
 * changed the board, which it does for an agent and for a person who takes an entry back (spec
 * 38b). Otherwise the element came back as it was before, e.g. through someone's undo, which
 * restores the old author with the old content; then it is by the one person who was at work,
 * if there was exactly one.
 */
function actorOf(element: Element, window: HistoryWindow): HistoryActor {
  const by = element.lastChangedBy;
  const [only] = window.humans.size === 1 ? [...window.humans] : [];
  const atWork = by.kind === 'human' && window.humans.has(by.userId);
  if (atWork || window.service || only === undefined) return by;
  return { kind: 'human', userId: only };
}

/**
 * What changed between two states of a board, as one group of elements per author, in the order
 * the authors first appear. Elements keep the order of the board: nodes first, then arrows.
 */
export function diffBoard(
  before: BoardState,
  after: BoardState,
  window: HistoryWindow,
): { actor: HistoryActor; items: HistoryItem[] }[] {
  const groups: { actor: HistoryActor; items: HistoryItem[] }[] = [];
  const add = (actor: HistoryActor, item: HistoryItem) => {
    const group = groups.find((candidate) => sameActor(candidate.actor, actor));
    if (group) group.items.push(item);
    else groups.push({ actor, items: [item] });
  };
  const nodesBefore = new Map(before.nodes.map((node) => [node.id, node]));
  const nodesAfter = new Map(after.nodes.map((node) => [node.id, node]));
  const [only] = window.humans.size === 1 ? [...window.humans] : [];
  const remover = (id: string): HistoryActor =>
    window.removedBy.get(id) ??
    (only === undefined ? { kind: 'unknown' } : { kind: 'human', userId: only });

  const compare = <T extends Element>(was: readonly T[], is: readonly T[]) => {
    const earlier = new Map(was.map((element) => [element.id, element]));
    const later = new Map(is.map((element) => [element.id, element]));
    for (const element of is) {
      const item = itemOf(earlier.get(element.id) ?? null, element, nodesAfter);
      if (item) add(actorOf(element, window), item);
    }
    for (const element of was) {
      if (later.has(element.id)) continue;
      const item = itemOf(element, null, nodesBefore);
      if (item) add(remover(element.id), item);
    }
  };
  compare(before.nodes, after.nodes);
  compare(before.edges, after.edges);
  return groups;
}

/**
 * An entry that grows by what its author did next: an element both name keeps its first "before"
 * and takes the new "after". An element that ends as it began is no part of the entry any more,
 * e.g. a block that was added and removed again.
 */
export function mergeItems(
  entry: readonly HistoryItem[],
  next: readonly HistoryItem[],
): HistoryItem[] {
  const merged = new Map(entry.map((item) => [item.id, item]));
  for (const item of next) {
    const known = merged.get(item.id);
    if (!known) {
      merged.set(item.id, item);
      continue;
    }
    const action = actionOf(known.before, item.after);
    if (action === null) merged.delete(item.id);
    else merged.set(item.id, { ...item, before: known.before, action });
  }
  return [...merged.values()].slice(0, HISTORY_MAX_ITEMS);
}

/** An element of an entry as the list shows it. */
export const boardHistoryItemSchema = z.object({
  id: z.string(),
  kind: z.enum(HISTORY_ELEMENT_KINDS),
  label: z.string(),
  action: z.enum(HISTORY_ACTIONS),
  /** Whether the element is on the board right now, so the list can lead to it. */
  present: z.boolean(),
});
export type BoardHistoryItem = z.infer<typeof boardHistoryItemSchema>;

/**
 * An entry of the history as the API delivers it. A person has the name they had when the entry
 * was written, so it stays readable after they left the project.
 */
export const boardHistoryEntrySchema = z.object({
  id: z.string(),
  actor: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('human'), userId: z.string().nullable(), name: z.string() }),
    z.object({ kind: z.literal('agent'), agentKey: z.string() }),
    z.object({ kind: z.literal('unknown') }),
  ]),
  /** When the author last added to the entry. */
  at: z.string(),
  items: z.array(boardHistoryItemSchema),
  /** Whether this entry takes another one back (spec 38b). */
  reverts: z.boolean(),
  /** For an entry that was taken back: by whom and when, and what came of it. */
  undone: z
    .object({
      by: z.string(),
      at: z.string(),
      /** How many of its elements were set back, and how many stayed as they were. */
      reverted: z.number().int(),
      kept: z.number().int(),
    })
    .nullable(),
  /** Whether the reader may take the entry back: owners and editors, and only once. */
  canUndo: z.boolean(),
});
export type BoardHistoryEntry = z.infer<typeof boardHistoryEntrySchema>;

/** `GET /api/projects/:projectId/boards/:boardId/history`: the entries, the newest first. */
export type BoardHistory = { entries: BoardHistoryEntry[] };

/**
 * `POST /api/projects/:projectId/boards/:boardId/history/:entryId/undo`: how many elements of
 * the entry were set back and how many stayed as they are. With none set back, the entry is not
 * taken back and can be tried again.
 */
export const boardHistoryUndoSchema = z.object({
  reverted: z.number().int(),
  kept: z.number().int(),
});
export type BoardHistoryUndo = z.infer<typeof boardHistoryUndoSchema>;
