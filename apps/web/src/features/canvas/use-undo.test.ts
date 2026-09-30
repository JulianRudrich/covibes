import { addBlock, moveNode, readNodes, type Author } from '@covibes/shared';
import { fireEvent, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { useUndo } from '@web/features/canvas/use-undo';

const ME: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000001' };
const SAM: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000002' };
const MODERATOR: Author = { kind: 'agent', agentKey: 'moderator' };
const BLOCK = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';

function labels(doc: Y.Doc) {
  return readNodes(doc)
    .map((node) => node.label)
    .sort();
}

async function setup(enabled = true) {
  const doc = new Y.Doc();
  const { result, unmount } = renderHook(() => useUndo(doc, ME, enabled));
  await waitFor(() => {
    expect(result.current).not.toBeNull();
  });
  return { doc, manager: () => result.current, unmount };
}

function press(
  key: string,
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
) {
  fireEvent.keyDown(document, { key, ctrlKey: true, ...modifiers });
}

describe('useUndo', () => {
  it('undoes and redoes the own changes with the keyboard', async () => {
    const { doc } = await setup();
    addBlock(doc, { id: BLOCK, position: { x: 0, y: 0 }, label: 'API' }, ME);

    press('z');
    expect(labels(doc)).toEqual([]);

    press('z', { shiftKey: true });
    expect(labels(doc)).toEqual(['API']);

    press('z');
    press('y');
    expect(labels(doc)).toEqual(['API']);
  });

  it('accepts Cmd on a Mac', async () => {
    const { doc } = await setup();
    addBlock(doc, { id: BLOCK, position: { x: 0, y: 0 }, label: 'API' }, ME);

    fireEvent.keyDown(document, { key: 'z', metaKey: true });

    expect(labels(doc)).toEqual([]);
  });

  it('never undoes changes of other people or of agents', async () => {
    const { doc } = await setup();
    addBlock(doc, { id: BLOCK, position: { x: 0, y: 0 }, label: 'Mine' }, ME);
    addBlock(doc, { id: OTHER, position: { x: 0, y: 200 }, label: 'Sams' }, SAM);
    moveNode(doc, OTHER, { x: 400, y: 200 }, MODERATOR);

    press('z');

    expect(labels(doc)).toEqual(['Sams']);
    expect(readNodes(doc)[0]?.position).toEqual({ x: 400, y: 200 });
  });

  it('makes separate steps once capturing stops, e.g. for a new drag', async () => {
    const { doc, manager } = await setup();
    addBlock(doc, { id: BLOCK, position: { x: 0, y: 0 }, label: 'API' }, ME);
    manager()?.stopCapturing();
    moveNode(doc, BLOCK, { x: 100, y: 0 }, ME);
    moveNode(doc, BLOCK, { x: 200, y: 0 }, ME);

    press('z');

    expect(readNodes(doc)[0]?.position).toEqual({ x: 0, y: 0 });
    expect(labels(doc)).toEqual(['API']);
  });

  it('leaves keys alone while someone types, and for viewers', async () => {
    const { doc } = await setup();
    addBlock(doc, { id: BLOCK, position: { x: 0, y: 0 }, label: 'API' }, ME);
    const input = document.createElement('input');
    document.body.append(input);

    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(labels(doc)).toEqual(['API']);
    input.remove();

    const viewer = await setup(false);
    addBlock(viewer.doc, { id: BLOCK, position: { x: 0, y: 0 }, label: 'API' }, ME);
    press('z');
    expect(labels(viewer.doc)).toEqual(['API']);
  });
});
