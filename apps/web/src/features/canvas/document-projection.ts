import {
  canvasEdgeSchema,
  canvasNodeSchema,
  getEdgesMap,
  getNodesMap,
  type CanvasEdge,
  type CanvasNode,
} from '@covibes/shared';
import * as Y from 'yjs';

type Snapshot = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  changedNodes: ReadonlySet<string>;
  changedEdges: ReadonlySet<string>;
};

/** Validate only changed Y.Map entries; unchanged snapshots retain their object identity. */
export function observeBoardProjection(doc: Y.Doc, changed: (snapshot: Snapshot) => void) {
  const nodeMap = getNodesMap(doc);
  const edgeMap = getEdgesMap(doc);
  const nodes = new Map<string, CanvasNode>();
  const edges = new Map<string, CanvasEdge>();
  function readNode(id: string) {
    const parsed = canvasNodeSchema.safeParse(nodeMap.get(id)?.toJSON());
    if (parsed.success && parsed.data.id === id) nodes.set(id, parsed.data);
    else nodes.delete(id);
  }
  function readEdge(id: string) {
    const parsed = canvasEdgeSchema.safeParse(edgeMap.get(id)?.toJSON());
    if (parsed.success && parsed.data.id === id) edges.set(id, parsed.data);
    else edges.delete(id);
  }
  for (const id of nodeMap.keys()) readNode(id);
  for (const id of edgeMap.keys()) readEdge(id);
  function publish(changedNodes: ReadonlySet<string>, changedEdges: ReadonlySet<string>) {
    changed({ nodes: [...nodes.values()], edges: [...edges.values()], changedNodes, changedEdges });
  }
  const onNodes: Parameters<typeof nodeMap.observeDeep>[0] = (events) => {
    const ids = new Set<string>();
    for (const event of events) {
      if (event.target === nodeMap && event instanceof Y.YMapEvent) {
        for (const id of event.keysChanged) if (typeof id === 'string') ids.add(id);
      } else if (typeof event.path[0] === 'string') ids.add(event.path[0]);
    }
    for (const id of ids) readNode(id);
    publish(ids, new Set());
  };
  const onEdges: Parameters<typeof edgeMap.observeDeep>[0] = (events) => {
    const ids = new Set<string>();
    for (const event of events) {
      if (event.target === edgeMap && event instanceof Y.YMapEvent) {
        for (const id of event.keysChanged) if (typeof id === 'string') ids.add(id);
      } else if (typeof event.path[0] === 'string') ids.add(event.path[0]);
    }
    for (const id of ids) readEdge(id);
    publish(new Set(), ids);
  };
  nodeMap.observeDeep(onNodes);
  edgeMap.observeDeep(onEdges);
  publish(new Set(nodes.keys()), new Set(edges.keys()));
  return {
    readNodes: () => [...nodes.values()],
    stop() {
      nodeMap.unobserveDeep(onNodes);
      edgeMap.unobserveDeep(onEdges);
    },
  };
}
