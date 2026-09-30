import { randomUUID } from 'node:crypto';

import { addBlock, readNodes } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { memoryBoards } from '@server/test-boards';
import { updateBlockTool } from '@server/tools/update-block';

const BOARD_ID = randomUUID();
const OLGA = { kind: 'human', userId: randomUUID() } as const;
const MODERATOR = { kind: 'agent', agentKey: 'moderator' } as const;

function setup() {
  const { boards, doc, lock } = memoryBoards();
  const board = doc(BOARD_ID);
  const blockId = randomUUID();
  addBlock(
    board,
    { id: blockId, position: { x: 0, y: 0 }, label: 'API', subtitle: 'REST', blockType: 'service' },
    OLGA,
  );
  const tool = updateBlockTool({ boards, boardId: BOARD_ID, author: MODERATOR });
  return { board, blockId, tool, lock };
}

describe('update_block', () => {
  it('renames a block and changes its type, with the agent as the last one who changed it', async () => {
    const { board, blockId, tool } = setup();

    const answer = await tool.run({ id: blockId, title: 'Gateway', type: 'server' });

    expect(answer).toBe('Changed the block "Gateway".');
    expect(readNodes(board)[0]).toMatchObject({
      label: 'Gateway',
      subtitle: 'REST',
      blockType: 'server',
      createdBy: OLGA,
      lastChangedBy: MODERATOR,
    });
  });

  it('turns a block into a plain one with the type "none"', async () => {
    const { board, blockId, tool } = setup();

    await tool.run({ id: blockId, type: 'none', subtitle: '' });

    expect(readNodes(board)[0]).toMatchObject({ label: 'API', subtitle: '', blockType: null });
  });

  it('leaves a block alone that someone is editing and says who it is', async () => {
    const { board, blockId, tool, lock } = setup();
    lock(blockId, 'Sam');

    await expect(tool.run({ id: blockId, title: 'Gateway' })).rejects.toThrow(
      'Sam is editing the block "API" right now',
    );
    expect(readNodes(board)[0]).toMatchObject({ label: 'API', lastChangedBy: OLGA });
  });

  it('reports an unknown block and a call without changes', async () => {
    const { tool, blockId } = setup();

    await expect(tool.run({ id: randomUUID(), title: 'Gateway' })).rejects.toThrow(
      'There is no block with the id',
    );
    await expect(tool.run({ id: blockId })).rejects.toThrow('Nothing to change');
    await expect(tool.run({ id: blockId, title: '' })).rejects.toThrow();
  });
});
