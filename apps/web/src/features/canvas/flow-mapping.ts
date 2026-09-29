import { BLOCK_SIZE, type CanvasEdge, type CanvasNode, type Position } from '@covibes/shared';
import type { Edge, Node } from '@xyflow/react';

export type BlockNodeData = { label: string; subtitle: string };
export type BlockFlowNode = Node<BlockNodeData, 'block'>;

/**
 * React Flow nodes from the Y.Doc snapshot. UI state that only lives in this browser (selection,
 * measured size, an ongoing drag) is carried over from `previous`; while a node is dragged here, its
 * local position wins until the drag ends and is written to the Y.Doc.
 * Sticky notes and frames follow with spec 09; until then only blocks are shown.
 */
export function toFlowNodes(
  canvasNodes: readonly CanvasNode[],
  previous: readonly BlockFlowNode[],
): BlockFlowNode[] {
  const previousById = new Map(previous.map((node) => [node.id, node]));
  return canvasNodes
    .filter((node) => node.type === 'block')
    .map((node) => {
      const flowNode: BlockFlowNode = {
        id: node.id,
        type: 'block',
        position: node.position,
        data: { label: node.label, subtitle: node.subtitle },
      };
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

/** Grid of the canvas background; new blocks snap to it. */
export const GRID_SIZE = 20;
const MAX_RINGS = 12;

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function overlaps(position: Position, node: CanvasNode) {
  const gap = GRID_SIZE;
  return (
    position.x < node.position.x + node.size.width + gap &&
    position.x + BLOCK_SIZE.width + gap > node.position.x &&
    position.y < node.position.y + node.size.height + gap &&
    position.y + BLOCK_SIZE.height + gap > node.position.y
  );
}

/**
 * Top-left position for a new block near `center` (usually the middle of the visible canvas) that
 * does not cover an existing node. Searches outwards on a block-sized grid, nearest spots first;
 * among equally near spots, below and to the right come before above and to the left.
 */
export function findFreeSpot(nodes: readonly CanvasNode[], center: Position): Position {
  const start = {
    x: snap(center.x - BLOCK_SIZE.width / 2),
    y: snap(center.y - BLOCK_SIZE.height / 2),
  };
  const stepX = BLOCK_SIZE.width + GRID_SIZE;
  const stepY = BLOCK_SIZE.height + GRID_SIZE;

  const offsets: { dx: number; dy: number; distance: number }[] = [];
  for (let dy = -MAX_RINGS; dy <= MAX_RINGS; dy += 1) {
    for (let dx = -MAX_RINGS; dx <= MAX_RINGS; dx += 1) {
      offsets.push({ dx, dy, distance: Math.hypot(dx * stepX, dy * stepY) });
    }
  }
  offsets.sort((a, b) => a.distance - b.distance || b.dy - a.dy || b.dx - a.dx);

  for (const { dx, dy } of offsets) {
    const candidate = { x: start.x + dx * stepX, y: start.y + dy * stepY };
    if (!nodes.some((node) => overlaps(candidate, node))) return candidate;
  }
  return start;
}
