import {
  addBlock,
  addEdge,
  addFrame,
  getNodesMap,
  moveNode,
  placeNodes,
  readEdges,
  readNodes,
  type Author,
  type NodeLock,
} from '@covibes/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type { FlowLocks } from '@web/features/canvas/flow-mapping';
import { useYjsFlow } from '@web/features/canvas/use-yjs-flow';

const ME: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000001' };
const SAM_ID = '00000000-0000-4000-8000-000000000002';
const SAM: Author = { kind: 'human', userId: SAM_ID };
const BLOCK_ID = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ID = '00000000-0000-4000-8000-0000000000bb';
const EDGE_ID = '00000000-0000-4000-8000-0000000000cc';
const FRAME_ID = '00000000-0000-4000-8000-0000000000dd';
const OWN_CLIENT = 1;

// Created once per test, like the memoized locks of the board.
const NO_LOCKS: FlowLocks = { locks: new Map(), ownClientId: OWN_CLIENT };
const SAM_EDITS_BLOCK: FlowLocks = {
  locks: new Map<string, NodeLock>([
    [BLOCK_ID, { clientId: 2, userId: SAM_ID, name: 'Sam', since: 1 }],
  ]),
  ownClientId: OWN_CLIENT,
};

function options(
  author: Author,
  readOnly: boolean,
  locks: FlowLocks = NO_LOCKS,
  editingId: string | null = null,
) {
  return { author, readOnly, locks, editingId };
}

function docWithBlock() {
  const doc = new Y.Doc();
  addBlock(doc, { id: BLOCK_ID, position: { x: 0, y: 0 }, label: 'API' }, ME);
  return doc;
}

function storedPosition(doc: Y.Doc) {
  return readNodes(doc)[0]?.position;
}

describe('useYjsFlow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows blocks that someone else adds to the Y.Doc', () => {
    const doc = new Y.Doc();
    const settings = options(ME, false);
    const { result } = renderHook(() => useYjsFlow(doc, settings));
    expect(result.current.nodes).toEqual([]);

    act(() => {
      addBlock(doc, { id: BLOCK_ID, position: { x: 20, y: 40 }, label: 'API' }, SAM);
    });

    expect(result.current.nodes).toMatchObject([
      { id: BLOCK_ID, type: 'block', position: { x: 20, y: 40 }, data: { label: 'API' } },
    ]);
  });

  it('writes drag positions at most once per frame and the final one right away', () => {
    const doc = docWithBlock();
    const settings = options(SAM, false);
    const { result } = renderHook(() => useYjsFlow(doc, settings));

    act(() => {
      result.current.onNodesChange([
        { type: 'position', id: BLOCK_ID, position: { x: 10, y: 10 }, dragging: true },
      ]);
      result.current.onNodesChange([
        { type: 'position', id: BLOCK_ID, position: { x: 30, y: 30 }, dragging: true },
      ]);
    });
    expect(result.current.nodes[0]?.position).toEqual({ x: 30, y: 30 });
    expect(storedPosition(doc)).toEqual({ x: 0, y: 0 });

    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(storedPosition(doc)).toEqual({ x: 30, y: 30 });

    act(() => {
      result.current.onNodesChange([
        { type: 'position', id: BLOCK_ID, position: { x: 50, y: 60 }, dragging: false },
      ]);
    });
    expect(storedPosition(doc)).toEqual({ x: 50, y: 60 });
    expect(readNodes(doc)[0]?.lastChangedBy).toEqual(SAM);
  });

  it('attributes a drag only when it ends and finalizes one left during a drag', () => {
    const doc = docWithBlock();
    let stamps = 0;
    getNodesMap(doc)
      .get(BLOCK_ID)
      ?.observe((event) => {
        if (event.keysChanged.has('lastChangedAt')) stamps++;
      });
    const { result, unmount } = renderHook(() => useYjsFlow(doc, options(SAM, false)));
    act(() => {
      result.current.onNodesChange([
        { type: 'position', id: BLOCK_ID, position: { x: 10, y: 20 }, dragging: true },
      ]);
      vi.advanceTimersToNextFrame();
    });
    expect(storedPosition(doc)).toEqual({ x: 10, y: 20 });
    expect(readNodes(doc)[0]?.lastChangedBy).toEqual(ME);
    expect(stamps).toBe(0);
    unmount();
    expect(readNodes(doc)[0]?.lastChangedBy).toEqual(SAM);
    expect(stamps).toBe(1);
  });

  it('does not accept a programmatic position change of a locked or locally edited node', () => {
    const doc = docWithBlock();
    const { result, rerender } = renderHook(
      ({ lock, editing }) => useYjsFlow(doc, options(ME, false, lock, editing)),
      { initialProps: { lock: SAM_EDITS_BLOCK, editing: null as string | null } },
    );
    act(() => {
      result.current.onNodesChange([
        { type: 'position', id: BLOCK_ID, position: { x: 50, y: 50 }, dragging: false },
      ]);
    });
    expect(storedPosition(doc)).toEqual({ x: 0, y: 0 });
    rerender({ lock: NO_LOCKS, editing: BLOCK_ID });
    act(() => {
      result.current.onNodesChange([
        { type: 'position', id: BLOCK_ID, position: { x: 70, y: 70 }, dragging: false },
      ]);
    });
    expect(storedPosition(doc)).toEqual({ x: 0, y: 0 });
  });

  it('does not let a remote move interrupt a drag in progress', () => {
    const doc = docWithBlock();
    const settings = options(ME, false);
    const { result } = renderHook(() => useYjsFlow(doc, settings));

    act(() => {
      result.current.onNodesChange([
        { type: 'position', id: BLOCK_ID, position: { x: 40, y: 40 }, dragging: true },
      ]);
      moveNode(doc, BLOCK_ID, { x: 500, y: 500 }, SAM);
    });

    expect(result.current.nodes[0]?.position).toEqual({ x: 40, y: 40 });
  });

  it('deletes blocks in the Y.Doc', () => {
    const doc = docWithBlock();
    addBlock(doc, { id: OTHER_ID, position: { x: 0, y: 200 }, label: 'DB' }, SAM);
    const settings = options(ME, false);
    const { result } = renderHook(() => useYjsFlow(doc, settings));

    act(() => {
      result.current.onNodesChange([{ type: 'remove', id: OTHER_ID }]);
    });

    expect(readNodes(doc).map((node) => node.id)).toEqual([BLOCK_ID]);
    expect(result.current.nodes.map((node) => node.id)).toEqual([BLOCK_ID]);
  });

  it('never deletes a block that someone else edits', () => {
    const doc = docWithBlock();
    const settings = options(ME, false, SAM_EDITS_BLOCK);
    const { result } = renderHook(() => useYjsFlow(doc, settings));

    expect(result.current.nodes[0]).toMatchObject({
      draggable: false,
      deletable: false,
      data: { lockedBy: { name: 'Sam' } },
    });

    act(() => {
      result.current.onNodesChange([{ type: 'remove', id: BLOCK_ID }]);
    });

    expect(readNodes(doc)).toHaveLength(1);
  });

  it('shows a lock that starts or ends while the board is open', () => {
    const doc = docWithBlock();
    let settings = options(ME, false);
    const { result, rerender } = renderHook(() => useYjsFlow(doc, settings));
    expect(result.current.nodes[0]?.data.lockedBy).toBeNull();

    settings = options(ME, false, SAM_EDITS_BLOCK);
    rerender();
    expect(result.current.nodes[0]?.data.lockedBy).toEqual({ name: 'Sam' });

    settings = options(ME, false);
    rerender();
    expect(result.current.nodes[0]?.data.lockedBy).toBeNull();
  });

  it('keeps the block that is being edited here from being dragged', () => {
    const doc = docWithBlock();
    const settings = options(ME, false, NO_LOCKS, BLOCK_ID);
    const { result } = renderHook(() => useYjsFlow(doc, settings));

    expect(result.current.nodes[0]?.draggable).toBe(false);
  });

  it('lets viewers neither move nor delete blocks', () => {
    const doc = docWithBlock();
    const settings = options(ME, true);
    const { result } = renderHook(() => useYjsFlow(doc, settings));

    act(() => {
      result.current.onNodesChange([
        { type: 'position', id: BLOCK_ID, position: { x: 80, y: 80 }, dragging: false },
        { type: 'remove', id: BLOCK_ID },
      ]);
      vi.advanceTimersToNextFrame();
    });

    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0]?.position).toEqual({ x: 0, y: 0 });
    expect(storedPosition(doc)).toEqual({ x: 0, y: 0 });
    expect(readNodes(doc)).toHaveLength(1);
  });

  it('keeps the selection when the Y.Doc changes', () => {
    const doc = docWithBlock();
    const settings = options(ME, true);
    const { result } = renderHook(() => useYjsFlow(doc, settings));

    act(() => {
      result.current.onNodesChange([{ type: 'select', id: BLOCK_ID, selected: true }]);
      moveNode(doc, BLOCK_ID, { x: 100, y: 0 }, SAM);
    });

    expect(result.current.nodes[0]).toMatchObject({ selected: true, position: { x: 100, y: 0 } });
  });

  it('selects and deletes arrows', () => {
    const doc = docWithBlock();
    addBlock(doc, { id: OTHER_ID, position: { x: 0, y: 200 }, label: 'DB' }, ME);
    addEdge(doc, { id: EDGE_ID, source: BLOCK_ID, target: OTHER_ID, label: 'SQL' }, ME);
    const settings = options(ME, false);
    const { result } = renderHook(() => useYjsFlow(doc, settings));
    expect(result.current.edges).toMatchObject([{ id: EDGE_ID, data: { label: 'SQL' } }]);

    act(() => {
      result.current.onEdgesChange([{ type: 'select', id: EDGE_ID, selected: true }]);
    });
    expect(result.current.edges[0]?.selected).toBe(true);

    act(() => {
      result.current.onEdgesChange([{ type: 'remove', id: EDGE_ID }]);
    });
    expect(readEdges(doc)).toEqual([]);
    expect(result.current.edges).toEqual([]);
  });

  it('lets viewers not delete arrows', () => {
    const doc = docWithBlock();
    addBlock(doc, { id: OTHER_ID, position: { x: 0, y: 200 }, label: 'DB' }, ME);
    addEdge(doc, { id: EDGE_ID, source: BLOCK_ID, target: OTHER_ID }, ME);
    const settings = options(ME, true);
    const { result } = renderHook(() => useYjsFlow(doc, settings));

    act(() => {
      result.current.onEdgesChange([{ type: 'remove', id: EDGE_ID }]);
    });

    expect(readEdges(doc)).toHaveLength(1);
  });

  it('puts a block dropped into a frame into it', () => {
    const doc = docWithBlock();
    addFrame(doc, { id: FRAME_ID, position: { x: 400, y: 0 }, title: 'Architektur' }, ME);
    const settings = options(ME, false);
    const { result } = renderHook(() => useYjsFlow(doc, settings));

    act(() => {
      result.current.onNodesChange([
        { type: 'position', id: BLOCK_ID, position: { x: 500, y: 100 }, dragging: true },
      ]);
      result.current.onNodesChange([
        { type: 'position', id: BLOCK_ID, position: { x: 500, y: 100 }, dragging: false },
      ]);
    });

    expect(readNodes(doc).find((node) => node.id === BLOCK_ID)?.frameId).toBe(FRAME_ID);
    expect(result.current.nodes.find((node) => node.id === FRAME_ID)?.data).toMatchObject({
      blockCount: 1,
    });
  });

  it('does not treat the move of a frame resized at a corner as a drag', () => {
    const doc = docWithBlock();
    addFrame(doc, { id: FRAME_ID, position: { x: 0, y: 0 }, title: 'Architektur' }, ME);
    placeNodes(doc, [BLOCK_ID], ME);
    expect(readNodes(doc).find((node) => node.id === BLOCK_ID)?.frameId).toBe(FRAME_ID);
    const settings = options(ME, false);
    const { result } = renderHook(() => useYjsFlow(doc, settings));

    act(() => {
      result.current.onNodesChange([
        { type: 'position', id: FRAME_ID, position: { x: -100, y: 0 } },
        {
          type: 'dimensions',
          id: FRAME_ID,
          dimensions: { width: 580, height: 320 },
          resizing: true,
          setAttributes: true,
        },
      ]);
    });

    // The block inside did not move along; the resize writes the frame's bounds itself.
    expect(readNodes(doc).find((node) => node.id === BLOCK_ID)?.position).toEqual({ x: 0, y: 0 });
    expect(readNodes(doc).find((node) => node.id === FRAME_ID)?.position).toEqual({ x: 0, y: 0 });
  });
});
