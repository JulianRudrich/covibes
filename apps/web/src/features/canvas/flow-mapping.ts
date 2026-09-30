import type { AgentKey, Author, CanvasEdge, CanvasNode, NodeLock } from '@covibes/shared';
import type { Edge, Node } from '@xyflow/react';

export type BlockNodeData = {
  label: string;
  subtitle: string;
  /** One of `BLOCK_TYPES`, `null` for the generic block, or a type of a later version. */
  blockType: string | null;
  createdBy: Author;
  /** The agent that made the last change, or null when it was a human. */
  changedByAgent: AgentKey | null;
  lastChangedAt: string;
  /** Someone else editing this block right now, or null (spec 08). */
  lockedBy: { name: string } | null;
};
export type BlockFlowNode = Node<BlockNodeData, 'block'>;

/** How long a block shows that an agent just changed it (spec 07). */
export const JUST_DRAWN_MS = 5000;

/**
 * Milliseconds for which a block still shows the state "just changed by AI" at `now`: 0 after a
 * human change or once the agent's change is 5 s old. A change stamped in the future (the clocks of
 * server and browser differ) counts as made right now, so the state never lasts longer than 5 s.
 */
export function justDrawnRemainingMs(
  data: Pick<BlockNodeData, 'changedByAgent' | 'lastChangedAt'>,
  now: number,
): number {
  if (data.changedByAgent === null) return 0;
  const age = Math.max(0, now - Date.parse(data.lastChangedAt));
  return Math.max(0, JUST_DRAWN_MS - age);
}

export type FlowLocks = { locks: ReadonlyMap<string, NodeLock>; ownClientId: number };

/**
 * Stacking order: the last changed node lies on top, ties by id. The order of a Y.Map can differ
 * between clients, so without sorting overlapping blocks could stack differently per browser.
 */
function byLastChange(a: CanvasNode, b: CanvasNode): number {
  if (a.lastChangedAt !== b.lastChangedAt) return a.lastChangedAt < b.lastChangedAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * React Flow nodes from the Y.Doc snapshot. UI state that only lives in this browser (selection,
 * measured size, an ongoing drag) is carried over from `previous`; while a node is dragged here, its
 * local position wins until the drag ends and is written to the Y.Doc. A block that someone else
 * edits can neither be dragged nor deleted here.
 * Sticky notes and frames follow with spec 09; until then only blocks are shown.
 */
export function toFlowNodes(
  canvasNodes: readonly CanvasNode[],
  previous: readonly BlockFlowNode[],
  { locks, ownClientId }: FlowLocks,
): BlockFlowNode[] {
  const previousById = new Map(previous.map((node) => [node.id, node]));
  return canvasNodes
    .filter((node) => node.type === 'block')
    .sort(byLastChange)
    .map((node) => {
      const lock = locks.get(node.id);
      const lockedBy = lock && lock.clientId !== ownClientId ? { name: lock.name } : null;
      const flowNode: BlockFlowNode = {
        id: node.id,
        type: 'block',
        position: node.position,
        data: {
          label: node.label,
          subtitle: node.subtitle,
          blockType: node.blockType,
          createdBy: node.createdBy,
          changedByAgent: node.lastChangedBy.kind === 'agent' ? node.lastChangedBy.agentKey : null,
          lastChangedAt: node.lastChangedAt,
          lockedBy,
        },
      };
      if (lockedBy) {
        flowNode.draggable = false;
        flowNode.deletable = false;
      }
      const local = previousById.get(node.id);
      if (!local) return flowNode;
      if (local.dragging) flowNode.position = local.position;
      if (local.selected !== undefined) flowNode.selected = local.selected;
      if (local.dragging !== undefined) flowNode.dragging = local.dragging;
      if (local.measured !== undefined) flowNode.measured = local.measured;
      return flowNode;
    });
}

export function toFlowEdges(canvasEdges: readonly CanvasEdge[]): Edge[] {
  return canvasEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label,
  }));
}
