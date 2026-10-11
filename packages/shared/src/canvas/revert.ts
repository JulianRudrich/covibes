import * as Y from 'yjs';

import { edgeProblem } from './edges';
import { sameContent, type HistoryItem } from './history';
import {
  authorOrigin,
  authorSchema,
  canvasEdgeSchema,
  canvasNodeSchema,
  getEdgesMap,
  getNodesMap,
  type Author,
  type CanvasEdge,
  type CanvasNode,
} from './model';

// Taking an entry of a board's history back (spec 38b): every element of the entry is set to how
// it was before, as long as it is still as the entry left it. What was changed since, what
// something else hangs on and what someone is editing stays as it is.

export type RevertResult = {
  /** The elements that are again as they were before the entry. */
  reverted: string[];
  /** The elements that stayed as they are: they are no longer as the entry left them. */
  kept: string[];
  /** Of the reverted elements, those that were taken off the board. */
  removed: string[];
};

function nodeOf(fields: Y.Map<unknown> | undefined): CanvasNode | null {
  const parsed = canvasNodeSchema.safeParse(fields?.toJSON());
  return parsed.success ? parsed.data : null;
}

function edgeOf(fields: Y.Map<unknown> | undefined): CanvasEdge | null {
  const parsed = canvasEdgeSchema.safeParse(fields?.toJSON());
  return parsed.success ? parsed.data : null;
}

function isEdge(element: CanvasNode | CanvasEdge): element is CanvasEdge {
  return 'source' in element;
}

/** The fields that say what a node is; who made and changed it is written apart. */
const NODE_CONTENT = [
  'type',
  'blockType',
  'position',
  'size',
  'label',
  'subtitle',
  'frameId',
  'diagramType',
  'fields',
] as const;
const EDGE_CONTENT = ['source', 'target', 'sourceHandle', 'targetHandle', 'label'] as const;

/**
 * Sets the elements of a history entry back on a board, as one change of `author`, the person who
 * takes the entry back:
 * - an element the entry added is removed, with nothing else: a block that an arrow still
 *   touches stays
 * - an element the entry removed comes back as it was, made by who made it; an arrow only if its
 *   blocks are there and no other arrow runs between them
 * - an element the entry moved or changed is set back
 *
 * Only an element that is still as the entry left it is touched, and none that is in `locked`
 * (someone is editing it). An element that is already as it was before counts as neither set
 * back nor kept.
 */
export function revertItems(
  doc: Y.Doc,
  items: readonly HistoryItem[],
  author: Author,
  locked: ReadonlySet<string> = new Set(),
): RevertResult {
  const by = authorSchema.parse(author);
  const nodes = getNodesMap(doc);
  const edges = getEdgesMap(doc);
  const result: RevertResult = { reverted: [], kept: [], removed: [] };
  const now = new Date().toISOString();
  const stamp = (fields: Y.Map<unknown>) => {
    fields.set('lastChangedBy', by);
    fields.set('lastChangedAt', now);
  };

  /** The node as it can be on the board now: a frame that is gone holds nothing. */
  const placed = (node: CanvasNode): CanvasNode =>
    node.frameId !== null && nodes.get(node.frameId)?.get('type') !== 'frame'
      ? { ...node, frameId: null }
      : node;
  const writeNode = (node: CanvasNode, fields: Y.Map<unknown>) => {
    for (const key of NODE_CONTENT) fields.set(key, node[key]);
    stamp(fields);
  };
  const writeEdge = (edge: CanvasEdge, fields: Y.Map<unknown>) => {
    for (const key of EDGE_CONTENT) fields.set(key, edge[key]);
    stamp(fields);
  };

  const of = (action: HistoryItem['action'], edge: boolean) =>
    items.filter((item) => item.action === action && (item.kind === 'edge') === edge);
  const changedOf = (edge: boolean) => [...of('moved', edge), ...of('changed', edge)];

  doc.transact(() => {
    // What the entry removed comes back first, frames before what they hold.
    const removedNodes = of('removed', false).sort(
      (a, b) => Number(b.kind === 'frame') - Number(a.kind === 'frame'),
    );
    for (const item of removedNodes) {
      const before = item.before;
      if (before === null || isEdge(before) || nodes.has(item.id)) continue;
      const fields = new Y.Map<unknown>();
      fields.set('id', before.id);
      fields.set('createdBy', before.createdBy);
      nodes.set(before.id, fields);
      writeNode(placed(before), fields);
      result.reverted.push(item.id);
    }

    // What the entry moved or changed is set back, if it is still as the entry left it.
    for (const item of changedOf(false)) {
      const { before, after } = item;
      const fields = nodes.get(item.id);
      const current = nodeOf(fields);
      if (before === null || after === null || isEdge(before) || isEdge(after)) continue;
      const target = placed(before);
      if (current && sameContent(current, target)) continue;
      if (!fields || !current || locked.has(item.id) || !sameContent(current, after)) {
        result.kept.push(item.id);
        continue;
      }
      writeNode(target, fields);
      result.reverted.push(item.id);
    }
    for (const item of changedOf(true)) {
      const { before, after } = item;
      const fields = edges.get(item.id);
      const current = edgeOf(fields);
      if (before === null || after === null || !isEdge(before) || !isEdge(after)) continue;
      if (current && sameContent(current, before)) continue;
      if (!fields || !current || !sameContent(current, after)) {
        result.kept.push(item.id);
        continue;
      }
      writeEdge(before, fields);
      result.reverted.push(item.id);
    }

    // The arrows the entry removed come back between their blocks.
    for (const item of of('removed', true)) {
      const before = item.before;
      if (before === null || !isEdge(before) || edges.has(item.id)) continue;
      if (edgeProblem(doc, before.source, before.target) !== null) {
        result.kept.push(item.id);
        continue;
      }
      const fields = new Y.Map<unknown>();
      fields.set('id', before.id);
      fields.set('createdBy', before.createdBy);
      edges.set(before.id, fields);
      writeEdge(before, fields);
      result.reverted.push(item.id);
    }

    // What the entry added goes: arrows first, then the blocks they ran between.
    for (const item of of('added', true)) {
      const after = item.after;
      const current = edgeOf(edges.get(item.id));
      if (after === null || !isEdge(after) || !current) continue;
      if (!sameContent(current, after)) {
        result.kept.push(item.id);
        continue;
      }
      edges.delete(item.id);
      result.reverted.push(item.id);
      result.removed.push(item.id);
    }
    for (const item of of('added', false)) {
      const after = item.after;
      const current = nodeOf(nodes.get(item.id));
      if (after === null || isEdge(after) || !current) continue;
      // The entry's own arrows are gone by now; an arrow that still touches the block is
      // someone else's, or was changed since.
      const inUse = [...edges.values()].some(
        (fields) => fields.get('source') === item.id || fields.get('target') === item.id,
      );
      if (locked.has(item.id) || inUse || !sameContent(current, after)) {
        result.kept.push(item.id);
        continue;
      }
      nodes.delete(item.id);
      // What a removed frame held stays on the board, outside of any frame.
      for (const member of nodes.values()) {
        if (member.get('frameId') === item.id) member.set('frameId', null);
      }
      result.reverted.push(item.id);
      result.removed.push(item.id);
    }
  }, authorOrigin(by));

  return result;
}
