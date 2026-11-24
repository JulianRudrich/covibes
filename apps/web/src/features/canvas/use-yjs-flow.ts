import {
  moveNodes,
  moveNodePositions,
  placeNodes,
  readEdges,
  readNodes,
  removeEdges,
  removeNodes,
  type Author,
  type Position,
} from '@covibes/shared';
import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { observeBoardProjection } from '@web/features/canvas/document-projection';

import {
  toFlowEdges,
  toFlowNodes,
  type ArrowFlowEdge,
  type CanvasFlowNode,
  type FlowLocks,
} from '@web/features/canvas/flow-mapping';

type YjsFlowOptions = {
  author: Author;
  readOnly: boolean;
  locks: FlowLocks;
  /** The element the own client edits; it cannot be dragged meanwhile. */
  editingId: string | null;
};

/**
 * React Flow state derived from the Y.Doc of a board. The Y.Doc stays the only source of truth:
 * local changes are written into it, and every change (local or remote) flows back from there.
 * While dragging, positions are written at most once per animation frame; the final position is
 * written as soon as the drag ends, and dropped nodes join or leave frames. Viewers can select,
 * but not move or delete; nobody moves or deletes an element that someone else edits.
 */
export function useYjsFlow(doc: Y.Doc, { author, readOnly, locks, editingId }: YjsFlowOptions) {
  const locksRef = useRef(locks);
  const [nodes, setNodes] = useState<CanvasFlowNode[]>(() =>
    toFlowNodes(readNodes(doc), [], locks),
  );
  const [edges, setEdges] = useState<ArrowFlowEdge[]>(() =>
    toFlowEdges(readEdges(doc), readNodes(doc)),
  );

  const projection = useRef<ReturnType<typeof observeBoardProjection> | null>(null);

  useEffect(() => {
    const view = observeBoardProjection(
      doc,
      ({ nodes: snapshot, edges: arrows, changedNodes, changedEdges }) => {
        setNodes((previous) => {
          const next = toFlowNodes(snapshot, previous, locksRef.current, changedNodes);
          return next.length === previous.length &&
            next.every((node, index) => node === previous[index])
            ? previous
            : next;
        });
        setEdges((previous) => {
          const next = toFlowEdges(arrows, snapshot, previous, changedEdges, changedNodes);
          return next.length === previous.length &&
            next.every((edge, index) => edge === previous[index])
            ? previous
            : next;
        });
      },
    );
    projection.current = view;
    return () => {
      view.stop();
      projection.current = null;
    };
  }, [doc]);

  // Locks live in the awareness, not in the Y.Doc, so they are applied when they change.
  useEffect(() => {
    locksRef.current = locks;
    setNodes((previous) =>
      toFlowNodes(projection.current?.readNodes() ?? readNodes(doc), previous, locks),
    );
  }, [doc, locks]);

  const lockedByOthers = useCallback((id: string) => {
    const lock = locksRef.current.locks.get(id);
    return lock !== undefined && lock.clientId !== locksRef.current.ownClientId;
  }, []);

  const pending = useRef(new Map<string, Position>());
  const dropped = useRef(new Set<string>());
  const dragging = useRef(new Set<string>());
  const frame = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (pending.current.size > 0) {
      const moves = [...pending.current];
      pending.current.clear();
      moveNodePositions(doc, moves, author);
    }
    if (dropped.current.size > 0) {
      const ids = [...dropped.current];
      dropped.current.clear();
      const snapshot = new Map(
        (projection.current?.readNodes() ?? readNodes(doc)).map((node) => [node.id, node]),
      );
      moveNodes(
        doc,
        ids.flatMap((id) => {
          const node = snapshot.get(id);
          return node ? [[id, node.position] as const] : [];
        }),
        author,
      );
      for (const id of ids) dragging.current.delete(id);
      placeNodes(doc, ids, author);
    }
  }, [doc, author]);

  // Nothing may stay unwritten when the board is left in the middle of a drag.
  useLayoutEffect(
    () => () => {
      for (const id of dragging.current) dropped.current.add(id);
      flush();
    },
    [flush],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      const removed = readOnly
        ? []
        : changes.flatMap((change) =>
            change.type === 'remove' && !lockedByOthers(change.id) ? [change.id] : [],
          );
      if (removed.length > 0) removeNodes(doc, removed, author);

      // A frame resized at a top or left corner moves, too; the resize writes that itself.
      const resized = new Set(
        changes.flatMap((change) =>
          change.type === 'dimensions' && change.resizing !== undefined ? [change.id] : [],
        ),
      );
      const allowed = changes.filter(
        (change) =>
          change.type !== 'remove' &&
          !(
            change.type === 'position' &&
            (readOnly || lockedByOthers(change.id) || change.id === editingId)
          ),
      );
      if (allowed.length === 0) return;
      setNodes((previous) => applyNodeChanges(allowed, previous));

      let dragEnded = false;
      for (const change of allowed) {
        if (change.type !== 'position' || resized.has(change.id)) continue;
        if (change.position) pending.current.set(change.id, change.position);
        if (change.dragging) dragging.current.add(change.id);
        if (!change.dragging) {
          dragEnded = true;
          dropped.current.add(change.id);
        }
      }
      if (dragEnded) flush();
      else if (pending.current.size > 0 && frame.current === null) {
        frame.current = requestAnimationFrame(flush);
      }
    },
    [doc, author, readOnly, flush, lockedByOthers, editingId],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<ArrowFlowEdge>[]) => {
      const removed = readOnly
        ? []
        : changes.flatMap((change) => (change.type === 'remove' ? [change.id] : []));
      if (removed.length > 0) removeEdges(doc, removed, author);
      const local = changes.filter((change) => change.type === 'select');
      if (local.length > 0) setEdges((previous) => applyEdgeChanges(local, previous));
    },
    [doc, author, readOnly],
  );

  const shownNodes = useMemo(
    () =>
      editingId === null
        ? nodes
        : nodes.map((node) => (node.id === editingId ? { ...node, draggable: false } : node)),
    [nodes, editingId],
  );

  return { nodes: shownNodes, edges, onNodesChange, onEdgesChange };
}
