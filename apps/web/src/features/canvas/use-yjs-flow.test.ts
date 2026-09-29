import { addBlock, moveNode, readNodes, type Author } from '@covibes/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { useYjsFlow } from '@web/features/canvas/use-yjs-flow';

const ME: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000001' };
const SAM: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000002' };
const BLOCK_ID = '00000000-0000-4000-8000-0000000000aa';

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
    const { result } = renderHook(() => useYjsFlow(doc, ME, false));
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
    const { result } = renderHook(() => useYjsFlow(doc, SAM, false));

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

  it('does not let a remote move interrupt a drag in progress', () => {
    const doc = docWithBlock();
    const { result } = renderHook(() => useYjsFlow(doc, ME, false));

    act(() => {
      result.current.onNodesChange([
        { type: 'position', id: BLOCK_ID, position: { x: 40, y: 40 }, dragging: true },
      ]);
      moveNode(doc, BLOCK_ID, { x: 500, y: 500 }, SAM);
    });

    expect(result.current.nodes[0]?.position).toEqual({ x: 40, y: 40 });
  });

  it('lets viewers neither move nor delete blocks', () => {
    const doc = docWithBlock();
    const { result } = renderHook(() => useYjsFlow(doc, ME, true));

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
  });

  it('keeps the selection when the Y.Doc changes', () => {
    const doc = docWithBlock();
    const { result } = renderHook(() => useYjsFlow(doc, ME, true));

    act(() => {
      result.current.onNodesChange([{ type: 'select', id: BLOCK_ID, selected: true }]);
      moveNode(doc, BLOCK_ID, { x: 100, y: 0 }, SAM);
    });

    expect(result.current.nodes[0]).toMatchObject({ selected: true, position: { x: 100, y: 0 } });
  });
});
