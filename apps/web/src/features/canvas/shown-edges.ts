import { readsLeftToRight } from '@covibes/shared';

import { arrowGeometries, type Rect } from '@web/features/canvas/arrow-geometry';
import type { ArrowFlowEdge, CanvasFlowNode } from '@web/features/canvas/flow-mapping';

/** Where every element is right now, by id. */
export function nodeRects(nodes: readonly CanvasFlowNode[]): Map<string, Rect> {
  return new Map<string, Rect>(
    nodes.map((node) => [
      node.id,
      { ...node.position, width: node.data.size.width, height: node.data.size.height },
    ]),
  );
}

/**
 * The arrows with their path, anchored from where the blocks are right now. In mind maps and data
 * models, arrows follow the reading direction (spec 12).
 */
export function edgesWithGeometry(
  nodes: readonly CanvasFlowNode[],
  edges: readonly ArrowFlowEdge[],
  rects: ReadonlyMap<string, Rect>,
  previous: readonly ArrowFlowEdge[] = [],
): ArrowFlowEdge[] {
  const sideways = new Set(
    nodes
      .filter((node) => node.type === 'block' && readsLeftToRight(node.data.diagramType))
      .map((node) => node.id),
  );
  const geometries = arrowGeometries(
    edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sideways: sideways.has(edge.source) && sideways.has(edge.target),
    })),
    rects,
  );
  const previousById = new Map(previous.map((edge) => [edge.id, edge]));
  return edges.map((edge) => {
    const geometry = geometries.get(edge.id);
    const old = previousById.get(edge.id);
    if (
      old &&
      old.source === edge.source &&
      old.target === edge.target &&
      old.selected === edge.selected &&
      old.data?.label === edge.data?.label &&
      old.data?.changedByAgent === edge.data?.changedByAgent &&
      old.data?.lastChangedAt === edge.data?.lastChangedAt &&
      JSON.stringify(old.data?.geometry) === JSON.stringify(geometry)
    )
      return old;
    return edge.data && geometry ? { ...edge, data: { ...edge.data, geometry } } : edge;
  });
}
