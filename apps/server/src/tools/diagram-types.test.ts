import { randomUUID } from 'node:crypto';

import {
  addBlock,
  addEdge,
  addFrame,
  readNodes,
  ROADMAP_DIAGRAM,
  type CanvasNode,
} from '@covibes/shared';
import type * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { memoryBoards } from '@server/test-boards';
import { addBlockTool } from '@server/tools/add-block';
import { addFrameTool } from '@server/tools/add-frame';
import { arrangeFrameTool } from '@server/tools/arrange-frame';
import { updateBlockTool } from '@server/tools/update-block';

const BOARD_ID = randomUUID();
const OLGA = { kind: 'human', userId: randomUUID() } as const;
const MODERATOR = { kind: 'agent', agentKey: 'moderator' } as const;

function setup() {
  const { boards, doc, lock } = memoryBoards();
  const options = { boards, boardId: BOARD_ID, author: MODERATOR };
  return {
    board: doc(BOARD_ID),
    lock,
    frame: addFrameTool(options),
    block: addBlockTool(options),
    update: updateBlockTool(options),
    arrange: arrangeFrameTool(options),
  };
}

function nodeOf(board: Y.Doc, id: string): CanvasNode {
  const node = readNodes(board).find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Node ${id} is missing`);
  return node;
}

function idIn(answer: string): string {
  const id = /id ([0-9a-f-]{36})/.exec(answer)?.[1];
  if (!id) throw new Error(`No id in "${answer}"`);
  return id;
}

function inside(node: CanvasNode, frame: CanvasNode) {
  return (
    node.position.x >= frame.position.x &&
    node.position.y >= frame.position.y &&
    node.position.x + node.size.width <= frame.position.x + frame.size.width &&
    node.position.y + node.size.height <= frame.position.y + frame.size.height
  );
}

describe('diagram types for agents', () => {
  it('adds a typed frame and blocks of its diagram inside it', async () => {
    const { board, frame, block } = setup();

    const frameAnswer = await frame.run({ title: 'Ideen', diagramType: 'mindmap' });
    expect(frameAnswer).toMatch(/^Added the frame "Ideen" of type mindmap \(id /);
    const frameId = idIn(frameAnswer);

    const topic = idIn(await block.run({ title: 'Covibes', frameId }));
    const ideas = [];
    for (const title of ['Chat', 'Canvas', 'Agents', 'Plan', 'GitLab', 'Export']) {
      ideas.push(idIn(await block.run({ title, frameId })));
    }

    expect(nodeOf(board, topic)).toMatchObject({ blockType: 'topic', frameId });
    const theFrame = nodeOf(board, frameId);
    for (const id of ideas) {
      const idea = nodeOf(board, id);
      expect(idea).toMatchObject({ blockType: 'idea', frameId, createdBy: MODERATOR });
      // The frame grew around blocks that did not fit.
      expect(inside(idea, theFrame)).toBe(true);
    }
  });

  it('keeps the blocks of neighboring diagrams apart while both grow', async () => {
    const { board, frame, block } = setup();
    const mindmap = idIn(await frame.run({ title: 'Ideen', diagramType: 'mindmap' }));
    const datamodel = idIn(await frame.run({ title: 'Daten', diagramType: 'datamodel' }));

    // Drawn in turns, as a model calls the tools for two diagrams at once.
    const ideas: string[] = [];
    const entities: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      ideas.push(idIn(await block.run({ title: `Idee ${String(index)}`, frameId: mindmap })));
      entities.push(
        idIn(await block.run({ title: `Tabelle ${String(index)}`, frameId: datamodel })),
      );
    }

    for (const id of ideas) expect(nodeOf(board, id).frameId).toBe(mindmap);
    for (const id of entities)
      expect(nodeOf(board, id)).toMatchObject({ frameId: datamodel, blockType: 'entity' });
    // No block lies on another one.
    const blocks = readNodes(board).filter((node) => node.type === 'block');
    for (const [index, a] of blocks.entries()) {
      for (const b of blocks.slice(index + 1)) {
        const overlapping =
          a.position.x < b.position.x + b.size.width &&
          b.position.x < a.position.x + a.size.width &&
          a.position.y < b.position.y + b.size.height &&
          b.position.y < a.position.y + a.size.height;
        expect(overlapping).toBe(false);
      }
    }
  });

  it('gives entities their fields and refuses fields on other blocks', async () => {
    const { board, frame, block } = setup();
    const frameId = idIn(await frame.run({ title: 'Daten', diagramType: 'datamodel' }));

    const answer = await block.run({
      title: 'Nutzer',
      frameId,
      fields: [{ name: 'id', type: 'uuid' }, { name: 'email' }],
    });

    expect(answer).toMatch(/^Added the block "Nutzer" of type entity \(id .+ in the frame "Daten"/);
    expect(nodeOf(board, idIn(answer))).toMatchObject({
      blockType: 'entity',
      fields: [
        { name: 'id', type: 'uuid' },
        { name: 'email', type: '' },
      ],
      size: { width: 180, height: 96 + 8 + 2 * 22 },
    });
    await expect(
      block.run({ title: 'API', type: 'service', fields: [{ name: 'id' }] }),
    ).rejects.toThrow('Only entities have fields');
    await expect(block.run({ title: 'X', frameId: randomUUID() })).rejects.toThrow(
      'There is no frame with the id',
    );
  });

  it('changes the fields of an entity', async () => {
    const { board, update } = setup();
    const id = randomUUID();
    addBlock(board, { id, position: { x: 0, y: 0 }, label: 'Projekt', blockType: 'entity' }, OLGA);

    await update.run({ id, fields: [{ name: 'id', type: 'uuid' }] });

    expect(nodeOf(board, id)).toMatchObject({
      fields: [{ name: 'id', type: 'uuid' }],
      size: { height: 96 + 8 + 22 },
      lastChangedBy: MODERATOR,
    });
    await expect(update.run({ id, type: 'service', fields: [{ name: 'id' }] })).rejects.toThrow(
      'Only entities have fields',
    );
  });

  it('arranges a frame with the preset of its type and fits the frame', async () => {
    const { board, arrange } = setup();
    const frameId = randomUUID();
    addFrame(
      board,
      { id: frameId, position: { x: 0, y: 0 }, title: 'Ideen', diagramType: 'mindmap' },
      OLGA,
    );
    const [root, a, b] = [randomUUID(), randomUUID(), randomUUID()] as const;
    for (const id of [root, a, b]) {
      addBlock(board, { id, position: { x: 40, y: 60 }, label: id.slice(0, 4) }, OLGA);
    }
    for (const id of [root, a, b]) {
      board.getMap<Y.Map<unknown>>('nodes').get(id)?.set('frameId', frameId);
    }
    addEdge(board, { id: randomUUID(), source: root, target: a }, OLGA);
    addEdge(board, { id: randomUUID(), source: root, target: b }, OLGA);

    const answer = await arrange.run({ frameId });

    expect(answer).toBe('Arranged the frame "Ideen" as a tree to the right.');
    const [r, first, second] = [root, a, b].map((id) => nodeOf(board, id));
    if (!r || !first || !second) throw new Error('A block is missing');
    expect(first.position.x).toBeGreaterThanOrEqual(r.position.x + 180 + 100);
    expect(second.position.x).toBe(first.position.x);
    const theFrame = nodeOf(board, frameId);
    for (const node of [r, first, second]) expect(inside(node, theFrame)).toBe(true);
    expect(first.lastChangedBy).toEqual(MODERATOR);
  });

  it('leaves what someone edits in place and reports empty and unknown frames', async () => {
    const { board, arrange, lock } = setup();
    const frameId = randomUUID();
    addFrame(
      board,
      { id: frameId, position: { x: 0, y: 0 }, title: 'Ablauf', diagramType: 'flow' },
      OLGA,
    );
    expect(await arrange.run({ frameId })).toBe(
      'The frame "Ablauf" is empty, so there was nothing to arrange.',
    );

    const [start, step] = [randomUUID(), randomUUID()] as const;
    addBlock(board, { id: start, position: { x: 40, y: 60 }, label: 'Start' }, OLGA);
    addBlock(board, { id: step, position: { x: 60, y: 80 }, label: 'Schritt' }, OLGA);
    for (const id of [start, step]) {
      board.getMap<Y.Map<unknown>>('nodes').get(id)?.set('frameId', frameId);
    }
    addEdge(board, { id: randomUUID(), source: start, target: step }, OLGA);
    lock(step, 'Sam');

    const answer = await arrange.run({ frameId });

    expect(answer).toContain('1 element kept its place because someone is editing it.');
    expect(nodeOf(board, step).position).toEqual({ x: 60, y: 80 });
    await expect(arrange.run({ frameId: randomUUID() })).rejects.toThrow(
      'There is no frame with the id',
    );
  });

  it('leaves a roadmap as it is, since it arranges itself', async () => {
    const { board, arrange } = setup();
    const frameId = randomUUID();
    const size = { width: 900, height: 320 };
    addFrame(
      board,
      {
        id: frameId,
        position: { x: 0, y: 0 },
        title: 'Roadmap',
        diagramType: ROADMAP_DIAGRAM,
        size,
      },
      OLGA,
    );

    expect(await arrange.run({ frameId })).toBe(
      'The frame "Roadmap" is the roadmap: it arranges itself from the plan, so there was nothing to arrange.',
    );
    expect(nodeOf(board, frameId)).toMatchObject({ size, lastChangedBy: OLGA });
  });
});
