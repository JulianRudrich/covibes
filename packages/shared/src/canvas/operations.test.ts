import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { addEdge } from './edges';
import { addBlock, addFrame, readEdges, readNodes, type Author } from './model';
import {
  applyOperations,
  changedNodeIds,
  withOperations,
  type CanvasOperationInput,
} from './operations';

const OLGA: Author = { kind: 'human', userId: '11111111-1111-4111-8111-111111111111' };
const BACKEND: Author = { kind: 'agent', agentKey: 'backend' };
const API = '22222222-2222-4222-8222-222222222222';
const QUEUE = '33333333-3333-4333-8333-333333333333';
const EDGE = '44444444-4444-4444-8444-444444444444';
const NOTE = '55555555-5555-4555-8555-555555555555';
const FRAME = '66666666-6666-4666-8666-666666666666';

function boardWithApi() {
  const doc = new Y.Doc();
  addBlock(doc, { id: API, position: { x: 0, y: 0 }, label: 'API' }, OLGA);
  return doc;
}

const QUEUE_WITH_ARROW: CanvasOperationInput[] = [
  { op: 'add_block', block: { id: QUEUE, position: { x: 0, y: 200 }, label: 'Queue' } },
  { op: 'add_edge', edge: { id: EDGE, source: API, target: QUEUE, label: 'Jobs' } },
];

describe('applyOperations', () => {
  it('adds a block and an arrow to it, with the agent as author, in one change', () => {
    const doc = boardWithApi();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => {
      origins.push(transaction.origin);
    });

    expect(applyOperations(doc, QUEUE_WITH_ARROW, BACKEND)).toEqual({ applied: 2, skipped: 0 });

    expect(readNodes(doc).find((node) => node.id === QUEUE)).toMatchObject({
      label: 'Queue',
      createdBy: BACKEND,
    });
    expect(readEdges(doc)).toMatchObject([{ source: API, target: QUEUE, label: 'Jobs' }]);
    expect(origins).toEqual(['agent:backend']);
  });

  it('adds notes and frames around blocks, changes nodes and arranges', () => {
    const doc = boardWithApi();
    applyOperations(
      doc,
      [
        { op: 'add_note', note: { id: NOTE, position: { x: 400, y: 0 }, text: 'Offline?' } },
        {
          op: 'add_frame',
          frame: { id: FRAME, position: { x: -40, y: -60 }, title: 'Backend' },
          members: [API],
        },
        { op: 'update_node', id: API, changes: { label: 'Gateway', blockType: 'service' } },
        {
          op: 'arrange',
          moves: [{ id: API, position: { x: 0, y: 20 } }],
          frame: { id: FRAME, position: { x: -40, y: -40 }, size: { width: 260, height: 180 } },
        },
      ],
      BACKEND,
    );

    const byId = new Map(readNodes(doc).map((node) => [node.id, node]));
    expect(byId.get(NOTE)).toMatchObject({ type: 'sticky', label: 'Offline?' });
    expect(byId.get(API)).toMatchObject({
      label: 'Gateway',
      blockType: 'service',
      frameId: FRAME,
      position: { x: 0, y: 20 },
      lastChangedBy: BACKEND,
    });
    expect(byId.get(FRAME)).toMatchObject({
      position: { x: -40, y: -40 },
      size: { width: 260, height: 180 },
    });
  });

  it('skips what no longer fits, and adds nothing twice when applied again', () => {
    const doc = boardWithApi();
    const operations: CanvasOperationInput[] = [
      ...QUEUE_WITH_ARROW,
      // The note to change does not exist; the frame of the last block neither.
      { op: 'update_node', id: NOTE, changes: { label: 'Weg' } },
      {
        op: 'add_block',
        block: { id: FRAME, position: { x: 400, y: 0 }, label: 'Cache', frameId: NOTE },
      },
    ];

    expect(applyOperations(doc, operations, BACKEND)).toEqual({ applied: 3, skipped: 1 });
    expect(readNodes(doc).find((node) => node.id === FRAME)?.frameId).toBeNull();
    expect(applyOperations(doc, operations, BACKEND)).toEqual({ applied: 0, skipped: 4 });
    expect(readNodes(doc)).toHaveLength(3);
    expect(readEdges(doc)).toHaveLength(1);
  });

  it('skips an arrow whose block was removed or that exists in this direction', () => {
    const doc = boardWithApi();
    addBlock(doc, { id: QUEUE, position: { x: 0, y: 200 }, label: 'Queue' }, OLGA);
    addEdge(doc, { id: '77777777-7777-4777-8777-777777777777', source: API, target: QUEUE }, OLGA);

    expect(applyOperations(doc, [QUEUE_WITH_ARROW[1] ?? []].flat(), BACKEND)).toEqual({
      applied: 0,
      skipped: 1,
    });
  });

  it('refuses operations that the model would refuse', () => {
    const doc = boardWithApi();
    expect(() =>
      applyOperations(
        doc,
        [{ op: 'add_block', block: { id: QUEUE, position: { x: 0, y: 0 }, label: '' } }],
        BACKEND,
      ),
    ).toThrow();
    expect(readNodes(doc)).toHaveLength(1);
  });
});

describe('applyOperations with a roadmap (spec 26a)', () => {
  it('adds a roadmap with its size, and a block meant for it stays free', () => {
    const doc = new Y.Doc();
    const roadmap = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';
    const block = '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b';

    const result = applyOperations(
      doc,
      [
        {
          op: 'add_frame',
          frame: {
            id: roadmap,
            position: { x: 0, y: 0 },
            title: 'Roadmap',
            diagramType: 'roadmap',
            size: { width: 960, height: 420 },
          },
        },
        {
          op: 'add_block',
          block: { id: block, position: { x: 40, y: 80 }, label: 'Login', frameId: roadmap },
        },
      ],
      { kind: 'agent', agentKey: 'moderator' },
    );

    expect(result).toEqual({ applied: 2, skipped: 0 });
    const nodes = readNodes(doc);
    expect(nodes.find((node) => node.id === roadmap)).toMatchObject({
      diagramType: 'roadmap',
      size: { width: 960, height: 420 },
    });
    expect(nodes.find((node) => node.id === block)?.frameId).toBeNull();
  });

  it('adds no second roadmap, e.g. when a proposal for one is applied late', () => {
    const doc = new Y.Doc();
    const roadmap = (id: string) => ({
      op: 'add_frame' as const,
      frame: {
        id,
        position: { x: 0, y: 0 },
        title: 'Roadmap',
        diagramType: 'roadmap' as const,
        size: { width: 960, height: 420 },
      },
    });
    const author: Author = { kind: 'agent', agentKey: 'moderator' };
    applyOperations(doc, [roadmap('7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a')], author);

    const result = applyOperations(
      doc,
      [
        roadmap('7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c'),
        // Another frame still comes.
        {
          op: 'add_frame',
          frame: {
            id: '7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d',
            position: { x: 0, y: 600 },
            title: 'Ablauf',
            diagramType: 'flow',
          },
        },
      ],
      author,
    );

    expect(result).toEqual({ applied: 1, skipped: 1 });
    expect(readNodes(doc).filter((node) => node.diagramType === 'roadmap')).toHaveLength(1);
  });
});

describe('withOperations', () => {
  it('shows the canvas with operations applied and leaves the board alone', () => {
    const doc = boardWithApi();
    addFrame(doc, { id: FRAME, position: { x: 400, y: 0 }, title: 'Leer' }, OLGA);

    const preview = withOperations(doc, QUEUE_WITH_ARROW, BACKEND);

    expect(
      readNodes(preview)
        .map((node) => node.label)
        .sort(),
    ).toEqual(['API', 'Leer', 'Queue']);
    expect(readEdges(preview)).toHaveLength(1);
    expect(readNodes(doc)).toHaveLength(2);
    expect(readEdges(doc)).toHaveLength(0);
  });
});

describe('changedNodeIds', () => {
  it('names the existing nodes an operation changes or moves', () => {
    expect(changedNodeIds({ op: 'update_node', id: API, changes: { label: 'X' } })).toEqual([API]);
    expect(
      changedNodeIds({
        op: 'arrange',
        moves: [{ id: API, position: { x: 0, y: 0 } }],
        frame: { id: FRAME, position: { x: 0, y: 0 }, size: { width: 300, height: 200 } },
      }),
    ).toEqual([API, FRAME]);
    expect(
      changedNodeIds({
        op: 'add_note',
        note: { id: NOTE, position: { x: 0, y: 0 }, text: 'Idee' },
      }),
    ).toEqual([]);
  });
});
