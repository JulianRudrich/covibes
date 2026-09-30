import {
  authorOrigin,
  getEdgesMap,
  getNodesMap,
  moveNode,
  readEdges,
  readNodes,
  removeNodes,
  type Author,
  type Position,
} from '@covibes/shared';
import { applyNodeChanges, type Edge, type NodeChange } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';

import {
  toFlowEdges,
  toFlowNodes,
  type BlockFlowNode,
  type FlowLocks,
} from '@web/features/canvas/flow-mapping';

type YjsFlowOptions = {
  author: Author;
  readOnly: boolean;
  locks: FlowLocks;
  /** The block the own client edits; it cannot be dragged meanwhile. */
  editingId: string | null;
};

/**
 * React Flow state derived from the Y.Doc of a board. The Y.Doc stays the only source of truth:
 * local changes are written into it, and every change (local or remote) flows back from there.
 * While dragging, positions are written at most once per animation frame; the final position is
 * written as soon as the drag ends. Viewers can select, but not move or delete; nobody moves or
 * deletes a block that someone else edits.
 */
export function useYjsFlow(doc: Y.Doc, { author, readOnly, locks, editingId }: YjsFlowOptions) {
  const locksRef = useRef(locks);
  const [nodes, setNodes] = useState<BlockFlowNode[]>(() => toFlowNodes(readNodes(doc), [], locks));
  const [edges, setEdges] = useState<Edge[]>(() => toFlowEdges(readEdges(doc)));

  useEffect(() => {
    const nodesMap = getNodesMap(doc);
    const edgesMap = getEdgesMap(doc);
    const syncNodes = () => {
      setNodes((previous) => toFlowNodes(readNodes(doc), previous, locksRef.current));
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

  // Locks live in the awareness, not in the Y.Doc, so they are applied when they change.
  useEffect(() => {
    locksRef.current = locks;
    setNodes((previous) => toFlowNodes(readNodes(doc), previous, locks));
  }, [doc, locks]);

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
      const lockedByOthers = (id: string) => {
        const lock = locksRef.current.locks.get(id);
        return lock !== undefined && lock.clientId !== locksRef.current.ownClientId;
      };
      const removed = readOnly
        ? []
        : changes.flatMap((change) =>
            change.type === 'remove' && !lockedByOthers(change.id) ? [change.id] : [],
          );
      if (removed.length > 0) removeNodes(doc, removed, author);

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
    [doc, author, readOnly, flush],
  );

  const shownNodes = useMemo(
    () =>
      editingId === null
        ? nodes
        : nodes.map((node) => (node.id === editingId ? { ...node, draggable: false } : node)),
    [nodes, editingId],
  );

  return { nodes: shownNodes, edges, onNodesChange };
}
