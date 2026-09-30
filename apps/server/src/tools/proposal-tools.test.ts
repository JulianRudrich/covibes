import { randomUUID } from 'node:crypto';

import {
  addBlock,
  addFrame,
  applyOperations,
  readEdges,
  readNodes,
  type CanvasNode,
} from '@covibes/shared';
import type * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import type { Intent } from '@server/rules/decide';
import { memoryBoards, memoryRules } from '@server/test-boards';
import { addBlockTool } from '@server/tools/add-block';
import { addFrameTool } from '@server/tools/add-frame';
import { addNoteTool } from '@server/tools/add-note';
import { arrangeFrameTool } from '@server/tools/arrange-frame';
import { connectBlocksTool } from '@server/tools/connect-blocks';

const BOARD_ID = randomUUID();
const OLGA = { kind: 'human', userId: randomUUID() } as const;
const BACKEND = { kind: 'agent', agentKey: 'backend' } as const;

/** A board with the block "API" and the tools of one run with the given rules. */
function setup(intent: Intent, proposalsOnly = false) {
  const { boards, doc } = memoryBoards();
  const board = doc(BOARD_ID);
  const api = randomUUID();
  addBlock(board, { id: api, position: { x: 100, y: 100 }, label: 'API' }, OLGA);
  const { rules, operations, reasons, names } = memoryRules(intent, proposalsOnly);
  const options = { boards, boardId: BOARD_ID, author: BACKEND, rules };
  return {
    board,
    api,
    operations,
    reasons,
    names,
    block: addBlockTool(options),
    connect: connectBlocksTool(options),
    note: addNoteTool(options),
    frame: addFrameTool(options),
    arrange: arrangeFrameTool(options),
  };
}

function idIn(answer: string): string {
  const id = /id ([0-9a-f-]{36})/.exec(answer)?.[1];
  if (!id) throw new Error(`No id in "${answer}"`);
  return id;
}

function labels(board: Y.Doc) {
  return readNodes(board).map((node: CanvasNode) => node.label);
}

describe('canvas tools under the rule engine', () => {
  it('change the canvas directly on an instruction', async () => {
    const { board, block, operations } = setup('instruction');

    const answer = await block.run({ title: 'Queue' });

    expect(answer).toMatch(/^Added the block "Queue"/);
    expect(labels(board)).toEqual(['API', 'Queue']);
    expect(operations).toEqual([]);
  });

  it('propose on a question: a block and an arrow to it, and the board stays as it is', async () => {
    const { board, api, block, connect, operations, reasons, names } = setup('question');

    const answer = await block.run({ title: 'Queue', subtitle: 'Jobs' });
    expect(answer).toMatch(/^Proposed: to add the block "Queue" \(id .+\)\. This is a proposal/);
    const queue = idIn(answer);
    // The arrow may lead to the proposed block.
    expect(await connect.run({ from: api, to: queue, label: 'Jobs' })).toMatch(
      /^Proposed: an arrow from "API" to "Queue" labeled "Jobs"/,
    );

    expect(labels(board)).toEqual(['API']);
    expect(readEdges(board)).toEqual([]);
    expect(operations).toMatchObject([
      { op: 'add_block', block: { id: queue, label: 'Queue', subtitle: 'Jobs' } },
      { op: 'add_edge', edge: { source: api, target: queue, label: 'Jobs' } },
    ]);
    expect(reasons).toEqual(['question', 'question']);
    // The overview names the existing block without loading the board.
    expect(names).toEqual({ [api]: 'API', [queue]: 'Queue' });

    // Applied later, the proposal becomes the agent's block and arrow.
    applyOperations(board, operations, BACKEND);
    expect(readNodes(board).find((node) => node.id === queue)).toMatchObject({
      createdBy: BACKEND,
    });
    expect(readEdges(board)).toHaveLength(1);
  });

  it('place proposed elements next to what the run proposed before', async () => {
    const { block, operations } = setup('question');
    await block.run({ title: 'Queue' });
    await block.run({ title: 'Worker' });

    const [first, second] = operations;
    if (first?.op !== 'add_block' || second?.op !== 'add_block') throw new Error('No blocks');
    expect(second.block.position).not.toEqual(first.block.position);
  });

  it('propose even an instruction in the proposals-only mode', async () => {
    const { board, note, operations, reasons } = setup('instruction', true);

    await note.run({ text: 'Offline-Modus?' });

    expect(labels(board)).toEqual(['API']);
    expect(operations).toMatchObject([{ op: 'add_note', note: { text: 'Offline-Modus?' } }]);
    expect(reasons).toEqual(['proposals_only']);
  });

  it('propose frames and arranging them as own initiative', async () => {
    const { board, api, frame, arrange, operations, reasons } = setup('initiative');
    const existing = randomUUID();
    addFrame(
      board,
      { id: existing, position: { x: 600, y: 0 }, title: 'Ideen', diagramType: 'mindmap' },
      OLGA,
    );

    await frame.run({ title: 'Backend', diagramType: 'architecture', blockIds: [api] });
    await arrange.run({ frameId: existing });

    expect(readNodes(board)).toHaveLength(2);
    expect(operations.map((operation) => operation.op)).toEqual(['add_frame']);
    expect(reasons).toEqual(['initiative']);
  });
});
