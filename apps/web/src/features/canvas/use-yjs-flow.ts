import {
  authorOrigin,
  getEdgesMap,
  getNodesMap,
  moveNode,
  readEdges,
  readNodes,
  type Author,
  type Position,
} from '@covibes/shared';
import { applyNodeChanges, type Edge, type NodeChange } from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { toFlowEdges, toFlowNodes, type BlockFlowNode } from '@web/features/canvas/flow-mapping';

/**
 * React Flow state derived from the Y.Doc of a board. The Y.Doc stays the only source of truth:
 * local changes are written into it, and every change (local or remote) flows back from there.
 * While dragging, positions are written at most once per animation frame; the final position is
 * written as soon as the drag ends. Viewers can select, but not move or delete.
 */
export function useYjsFlow(doc: Y.Doc, author: Author, readOnly: boolean) {
  const [nodes, setNodes] = useState<BlockFlowNode[]>(() => toFlowNodes(readNodes(doc), []));
  const [edges, setEdges] = useState<Edge[]>(() => toFlowEdges(readEdges(doc)));

  useEffect(() => {
    const nodesMap = getNodesMap(doc);
    const edgesMap = getEdgesMap(doc);
    const syncNodes = () => {
      setNodes((previous) => toFlowNodes(readNodes(doc), previous));
    };
    const syncEdges = () => {
      setEdges(toFlowEdges(readEdges(doc)));
    };
    syncNodes();
    syncEdges();
    nodesMap.observeDeep(syncNodes);
    edgesMap.observeDeep(syncEdges);
    return () => {
      nodesMap.unobserveDeep(syncNodes);
      edgesMap.unobserveDeep(syncEdges);
    };
  }, [doc]);

  const pending = useRef(new Map<string, Position>());
  const frame = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (pending.current.size === 0) return;
    const moves = [...pending.current];
    pending.current.clear();
    doc.transact(() => {
      for (const [id, position] of moves) moveNode(doc, id, position, author);
    }, authorOrigin(author));
  }, [doc, author]);

  // Nothing may stay unwritten when the board is left in the middle of a drag.
  useEffect(() => flush, [flush]);

  const onNodesChange = useCallback(
    (changes: NodeChange<BlockFlowNode>[]) => {
      const allowed = changes.filter(
        (change) => change.type !== 'remove' && !(readOnly && change.type === 'position'),
      );
      if (allowed.length === 0) return;
      setNodes((previous) => applyNodeChanges(allowed, previous));

      let dragEnded = false;
      for (const change of allowed) {
        if (change.type !== 'position') continue;
        if (change.position) pending.current.set(change.id, change.position);
        if (!change.dragging) dragEnded = true;
      }
      if (dragEnded) flush();
      else if (pending.current.size > 0 && frame.current === null) {
        frame.current = requestAnimationFrame(flush);
      }
    },
    [readOnly, flush],
  );

  return { nodes, edges, onNodesChange };
}
