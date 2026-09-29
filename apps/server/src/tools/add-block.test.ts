import { randomUUID } from 'node:crypto';

import { addBlock, readNodes, type CanvasNode } from '@covibes/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { BoardAccess } from '@server/collab/board-client';
import { addBlockTool } from '@server/tools/add-block';

const BOARD_ID = randomUUID();
const MODERATOR = { kind: 'agent', agentKey: 'moderator' } as const;

function setup() {
  const doc = new Y.Doc();
  const boards: BoardAccess = {
    withBoard: async (boardId, fn) => {
      expect(boardId).toBe(BOARD_ID);
      return fn(doc);
    },
  };
  return { doc, tool: addBlockTool({ boards, boardId: BOARD_ID, author: MODERATOR }) };
}

function overlap(a: CanvasNode, b: CanvasNode) {
  return (
    a.position.x < b.position.x + b.size.width &&
    b.position.x < a.position.x + a.size.width &&
    a.position.y < b.position.y + b.size.height &&
    b.position.y < a.position.y + a.size.height
  );
}

describe('add_block', () => {
  it('adds a block with the agent as author where the model asked', async () => {
    const { doc, tool } = setup();

    const answer = await tool.run({ title: ' API ', subtitle: 'REST', x: 40, y: 60 });

    expect(answer).toBe('Added the block "API" at 40, 60.');
    expect(readNodes(doc)).toEqual([
      expect.objectContaining({
        label: 'API',
        subtitle: 'REST',
        position: { x: 40, y: 60 },
        createdBy: MODERATOR,
        lastChangedBy: MODERATOR,
      }),
    ]);
  });

  it('puts a block without a position on a free spot next to the others', async () => {
    const { doc, tool } = setup();
    addBlock(
      doc,
      { id: randomUUID(), position: { x: 400, y: 400 }, label: 'Web-App' },
      { kind: 'human', userId: randomUUID() },
    );

    await tool.run({ title: 'API' });
    await tool.run({ title: 'Database' });

    const nodes = readNodes(doc);
    expect(nodes).toHaveLength(3);
    for (const node of nodes) {
      for (const other of nodes) {
        if (node !== other) expect(overlap(node, other)).toBe(false);
      }
      // Next to the others, not somewhere far away.
      expect(Math.abs(node.position.x - 400)).toBeLessThanOrEqual(400);
      expect(Math.abs(node.position.y - 400)).toBeLessThanOrEqual(240);
    }
  });

  it('rejects input the schema does not allow', async () => {
    const { doc, tool } = setup();

    await expect(tool.run({ title: '' })).rejects.toThrow();
    await expect(tool.run({ title: 'x'.repeat(81) })).rejects.toThrow();
    expect(readNodes(doc)).toEqual([]);
  });
});
