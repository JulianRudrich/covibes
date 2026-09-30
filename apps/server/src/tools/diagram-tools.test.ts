import { randomUUID } from 'node:crypto';

import { addBlock, addEdge, readEdges, readNodes, type CanvasNode } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { memoryBoards } from '@server/test-boards';
import { addFrameTool } from '@server/tools/add-frame';
import { addNoteTool } from '@server/tools/add-note';
import { connectBlocksTool } from '@server/tools/connect-blocks';

const BOARD_ID = randomUUID();
const OLGA = { kind: 'human', userId: randomUUID() } as const;
const MODERATOR = { kind: 'agent', agentKey: 'moderator' } as const;

/** A board with the blocks "API" and "DB", and the tools as the moderator uses them. */
function setup() {
  const { boards, doc, lock } = memoryBoards();
  const board = doc(BOARD_ID);
  const api = randomUUID();
  const db = randomUUID();
  addBlock(board, { id: api, position: { x: 100, y: 100 }, label: 'API' }, OLGA);
  addBlock(board, { id: db, position: { x: 100, y: 300 }, label: 'DB' }, OLGA);
  const options = { boards, boardId: BOARD_ID, author: MODERATOR };
  return {
    board,
    api,
    db,
    lock,
    connect: connectBlocksTool(options),
    note: addNoteTool(options),
    frame: addFrameTool(options),
  };
}

function nodeOf(board: ReturnType<typeof setup>['board'], id: string): CanvasNode {
  const node = readNodes(board).find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Node ${id} is missing`);
  return node;
}

describe('connect_blocks', () => {
  it('draws a labeled arrow with the agent as author', async () => {
    const { board, api, db, connect } = setup();

    const answer = await connect.run({ from: api, to: db, label: 'SQL' });

    expect(answer).toBe('Drew an arrow from "API" to "DB" labeled "SQL".');
    expect(readEdges(board)).toMatchObject([
      { source: api, target: db, label: 'SQL', createdBy: MODERATOR },
    ]);
  });

  it('reports the rules to the model instead of breaking them', async () => {
    const { board, api, db, connect } = setup();
    addEdge(board, { id: randomUUID(), source: api, target: db }, OLGA);

    await expect(connect.run({ from: api, to: db })).rejects.toThrow(
      'These blocks are already connected in this direction.',
    );
    await expect(connect.run({ from: api, to: api })).rejects.toThrow('to itself');
    await expect(connect.run({ from: api, to: 'nope' })).rejects.toThrow(
      'There is no element with the id nope.',
    );
    await expect(connect.run({ from: api, to: db, label: 'x'.repeat(41) })).rejects.toThrow();
    expect(readEdges(board)).toHaveLength(1);
  });
});

describe('add_note', () => {
  it('puts a note next to the other elements', async () => {
    const { board, note } = setup();

    const answer = await note.run({ text: 'Offline-Modus?' });

    const added = readNodes(board).find((node) => node.type === 'sticky');
    expect(answer).toMatch(/^Added the note "Offline-Modus\?" \(id [0-9a-f-]{36}\) at /);
    expect(added).toMatchObject({ label: 'Offline-Modus?', createdBy: MODERATOR });
    // Not on top of the blocks.
    for (const block of readNodes(board).filter((node) => node.type === 'block')) {
      const apart =
        (added?.position.x ?? 0) >= block.position.x + block.size.width ||
        (added?.position.x ?? 0) + (added?.size.width ?? 0) <= block.position.x ||
        (added?.position.y ?? 0) >= block.position.y + block.size.height ||
        (added?.position.y ?? 0) + (added?.size.height ?? 0) <= block.position.y;
      expect(apart).toBe(true);
    }
  });
});

describe('add_frame', () => {
  it('encloses the given blocks with padding and makes them its members', async () => {
    const { board, api, db, frame } = setup();

    const answer = await frame.run({ title: 'Architektur', blockIds: [api, db] });

    const added = readNodes(board).find((node) => node.type === 'frame');
    expect(answer).toMatch(
      /^Added the frame "Architektur" \(id [0-9a-f-]{36}\) around 2 blocks\.$/,
    );
    expect(added).toMatchObject({
      label: 'Architektur',
      position: { x: 60, y: 60 },
      size: { width: 260, height: 376 },
      createdBy: MODERATOR,
    });
    expect(nodeOf(board, api).frameId).toBe(added?.id);
    expect(nodeOf(board, db).frameId).toBe(added?.id);
  });

  it('leaves out a block that someone is editing and says so', async () => {
    const { board, api, db, frame, lock } = setup();
    lock(db, 'Sam');

    const answer = await frame.run({ title: 'Architektur', blockIds: [api, db] });

    expect(answer).toContain('around 1 block. Left out "DB" (Sam is editing it).');
    expect(nodeOf(board, db).frameId).toBeNull();
  });

  it('adds an empty frame at a free spot without blocks', async () => {
    const { board, frame } = setup();

    await frame.run({ title: 'Daten' });

    expect(readNodes(board).find((node) => node.type === 'frame')).toMatchObject({
      label: 'Daten',
      size: { width: 480, height: 320 },
    });
  });

  it('refuses unknown blocks', async () => {
    const { board, api, frame } = setup();

    await expect(frame.run({ title: 'X', blockIds: [api, 'nope'] })).rejects.toThrow(
      'There is no block with the id nope.',
    );
    expect(readNodes(board).some((node) => node.type === 'frame')).toBe(false);
  });
});
