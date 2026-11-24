import {
  ROADMAP_DIAGRAM,
  type Author,
  type CanvasEdge,
  type CanvasNode,
  type EntityField,
  type NodeLock,
  type Size,
} from '@covibes/shared';
import type { Edge, Node } from '@xyflow/react';

import type { ArrowGeometry } from '@web/features/canvas/arrow-geometry';

/** What every element on the canvas shows: its text, who made it and who changed it. */
type CommonData = {
  label: string;
  createdBy: Author;
  /** The agent that made the last change, or null when it was a human. */
  /** The key of the agent that last changed the element, catalog or custom. */
  changedByAgent: string | null;
  lastChangedAt: string;
  /** Someone else editing this element right now, or null (spec 08). */
  lockedBy: { name: string } | null;
  size: Size;
};

export type BlockNodeData = CommonData & {
  subtitle: string;
  /** One of `BLOCK_TYPES`, `null` for the generic block, or a type of a later version. */
  blockType: string | null;
  /** The fields of an entity (spec 12). */
  fields: EntityField[];
  /** The diagram type of the frame the block lies in, or null outside a typed frame (spec 12). */
  diagramType: string | null;
};
export type NoteNodeData = CommonData;
export type FrameNodeData = CommonData & {
  /** Blocks inside the frame, for "5 Blöcke". */
  blockCount: number;
  /** One of `DIAGRAM_TYPES`, null for a free frame, or a type of a later version (spec 12). */
  diagramType: string | null;
};

export type BlockFlowNode = Node<BlockNodeData, 'block'>;
export type NoteFlowNode = Node<NoteNodeData, 'sticky'>;
export type FrameFlowNode = Node<FrameNodeData, 'frame'>;
export type CanvasFlowNode = BlockFlowNode | NoteFlowNode | FrameFlowNode;

export type ArrowEdgeData = {
  label: string;
  /** The agent of the last change of the arrow or of its target, whichever is newer. */
  /** The key of the agent that last changed the element, catalog or custom. */
  changedByAgent: string | null;
  lastChangedAt: string;
  /** Path and label position, computed by the board from where the blocks are right now. */
  geometry?: ArrowGeometry;
};
export type ArrowFlowEdge = Edge<ArrowEdgeData, 'arrow'>;

/** How long an element shows that an agent just changed it (spec 07). */
export const JUST_DRAWN_MS = 5000;

/**
 * Stacking layers: frames at the bottom, arrows above them (so they stay visible inside frames),
 * blocks and notes on top.
 */
export const LAYER = { frame: 0, edge: 1, node: 2 } as const;

/**
 * Milliseconds for which an element still shows the state "just changed by AI" at `now`: 0 after
 * a human change or once the agent's change is 5 s old. A change stamped in the future (the clocks
 * of server and browser differ) counts as made right now, so the state never lasts longer than 5 s.
 */
export function justDrawnRemainingMs(
  data: Pick<CommonData, 'changedByAgent' | 'lastChangedAt'>,
  now: number,
): number {
  if (data.changedByAgent === null) return 0;
  const age = Math.max(0, now - Date.parse(data.lastChangedAt));
  return Math.max(0, JUST_DRAWN_MS - age);
}

export type FlowLocks = { locks: ReadonlyMap<string, NodeLock>; ownClientId: number };

/**
 * Stacking order within a layer: the last changed element lies on top, ties by id. The order of a
 * Y.Map can differ between clients, so without sorting overlapping elements could stack
 * differently per browser.
 */
function byLastChange(a: CanvasNode, b: CanvasNode): number {
  if (a.lastChangedAt !== b.lastChangedAt) return a.lastChangedAt < b.lastChangedAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function agentOf(author: Author): string | null {
  return author.kind === 'agent' ? author.agentKey : null;
}

function commonData(node: CanvasNode, lockedBy: { name: string } | null): CommonData {
  return {
    label: node.label,
    createdBy: node.createdBy,
    changedByAgent: agentOf(node.lastChangedBy),
    lastChangedAt: node.lastChangedAt,
    lockedBy,
    size: node.size,
  };
}

function toFlowNode(
  node: CanvasNode,
  lockedBy: { name: string } | null,
  blockCounts: ReadonlyMap<string, number>,
  frameTypes: ReadonlyMap<string, string | null>,
): CanvasFlowNode {
  const base = { id: node.id, position: node.position };
  switch (node.type) {
    case 'block':
      return {
        ...base,
        type: 'block',
        zIndex: LAYER.node,
        data: {
          ...commonData(node, lockedBy),
          subtitle: node.subtitle,
          blockType: node.blockType,
          fields: node.fields,
          diagramType: node.frameId ? (frameTypes.get(node.frameId) ?? null) : null,
        },
      };
    case 'sticky':
      return { ...base, type: 'sticky', zIndex: LAYER.node, data: commonData(node, lockedBy) };
    case 'frame':
      return {
        ...base,
        type: 'frame',
        zIndex: LAYER.frame,
        width: node.size.width,
        height: node.size.height,
        data: {
          ...commonData(node, lockedBy),
          blockCount: blockCounts.get(node.id) ?? 0,
          diagramType: node.diagramType,
        },
      };
  }
}

/**
 * React Flow nodes from the Y.Doc snapshot, frames first. UI state that only lives in this browser
 * (selection, measured size, an ongoing drag or resize) is carried over from `previous`; while a
 * node is dragged or resized here, its local position and size win until the change ends and is
 * written to the Y.Doc. An element that someone else edits can neither be dragged nor deleted here.
 */
export function toFlowNodes(
  canvasNodes: readonly CanvasNode[],
  previous: readonly CanvasFlowNode[],
  { locks, ownClientId }: FlowLocks,
  changedIds?: ReadonlySet<string>,
): CanvasFlowNode[] {
  const previousById = new Map(previous.map((node) => [node.id, node]));
  const blockCounts = new Map<string, number>();
  const frameTypes = new Map<string, string | null>();
  for (const node of canvasNodes) {
    if (node.type === 'block' && node.frameId) {
      blockCounts.set(node.frameId, (blockCounts.get(node.frameId) ?? 0) + 1);
    }
    if (node.type === 'frame') frameTypes.set(node.id, node.diagramType);
  }
  const sorted = [...canvasNodes].sort(byLastChange);
  const ordered = [
    ...sorted.filter((node) => node.type === 'frame'),
    ...sorted.filter((node) => node.type !== 'frame'),
  ];

  return ordered.map((node) => {
    const lock = locks.get(node.id);
    const lockedBy = lock && lock.clientId !== ownClientId ? { name: lock.name } : null;
    const local = previousById.get(node.id);
    const sameContext =
      local &&
      (node.type === 'frame' && local.type === 'frame'
        ? local.data.blockCount === (blockCounts.get(node.id) ?? 0) &&
          local.data.diagramType === node.diagramType
        : node.type === 'block' && local.type === 'block'
          ? local.data.diagramType ===
            (node.frameId ? (frameTypes.get(node.frameId) ?? null) : null)
          : node.type === local.type);
    if (
      changedIds &&
      !changedIds.has(node.id) &&
      local &&
      sameContext &&
      local.data.lockedBy?.name === lockedBy?.name
    )
      return local;
    const flowNode = toFlowNode(node, lockedBy, blockCounts, frameTypes);
    if (lockedBy) {
      flowNode.draggable = false;
      flowNode.deletable = false;
    }
    if (!local) return flowNode;
    if (local.dragging) flowNode.position = local.position;
    if (local.resizing) {
      flowNode.position = local.position;
      flowNode.width = local.width;
      flowNode.height = local.height;
    }
    if (local.selected !== undefined) flowNode.selected = local.selected;
    if (local.dragging !== undefined) flowNode.dragging = local.dragging;
    if (local.resizing !== undefined) flowNode.resizing = local.resizing;
    if (local.measured !== undefined) flowNode.measured = local.measured;
    const same =
      local.type === flowNode.type &&
      local.position.x === flowNode.position.x &&
      local.position.y === flowNode.position.y &&
      local.width === flowNode.width &&
      local.height === flowNode.height &&
      local.draggable === flowNode.draggable &&
      local.deletable === flowNode.deletable &&
      local.selected === flowNode.selected &&
      local.dragging === flowNode.dragging &&
      local.resizing === flowNode.resizing &&
      local.measured === flowNode.measured &&
      JSON.stringify(local.data) === JSON.stringify(flowNode.data);
    return same ? local : flowNode;
  });
}

/**
 * Roadmaps take the size of their content (spec 26a), also while the stored size still lags behind
 * the plan, e.g. for viewers, who never write it.
 */
export function sizeRoadmaps(nodes: CanvasFlowNode[], size: Size | null): CanvasFlowNode[] {
  if (!size) return nodes;
  return nodes.map((node) =>
    node.type === 'frame' &&
    node.data.diagramType === ROADMAP_DIAGRAM &&
    (node.width !== size.width || node.height !== size.height)
      ? { ...node, width: size.width, height: size.height }
      : node,
  );
}

/**
 * React Flow edges from the Y.Doc snapshot. An arrow shows an agent change of itself or of its
 * target (handoff: "if the target or the edge was just changed by AI"), whichever is newer.
 * Selection is carried over from `previous`.
 */
export function toFlowEdges(
  canvasEdges: readonly CanvasEdge[],
  canvasNodes: readonly CanvasNode[],
  previous: readonly ArrowFlowEdge[] = [],
  changedEdges?: ReadonlySet<string>,
  changedNodes?: ReadonlySet<string>,
): ArrowFlowEdge[] {
  const nodes = new Map(canvasNodes.map((node) => [node.id, node]));
  const selected = new Set(previous.filter((edge) => edge.selected).map((edge) => edge.id));
  const old = new Map(previous.map((edge) => [edge.id, edge]));
  return canvasEdges.map((edge) => {
    const existing = old.get(edge.id);
    if (existing && changedEdges && !changedEdges.has(edge.id) && !changedNodes?.has(edge.target))
      return existing;
    const target = nodes.get(edge.target);
    const latest =
      target && target.lastChangedAt > edge.lastChangedAt
        ? { by: target.lastChangedBy, at: target.lastChangedAt }
        : { by: edge.lastChangedBy, at: edge.lastChangedAt };
    const next: ArrowFlowEdge = {
      id: edge.id,
      type: 'arrow',
      source: edge.source,
      target: edge.target,
      zIndex: LAYER.edge,
      selected: selected.has(edge.id),
      data: { label: edge.label, changedByAgent: agentOf(latest.by), lastChangedAt: latest.at },
    };
    return existing &&
      existing.source === next.source &&
      existing.target === next.target &&
      existing.selected === next.selected &&
      JSON.stringify(existing.data) === JSON.stringify(next.data)
      ? existing
      : next;
  });
}
