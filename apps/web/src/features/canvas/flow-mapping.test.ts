import {
  BLOCK_SIZE,
  FRAME_SIZE,
  NOTE_SIZE,
  type Author,
  type CanvasEdge,
  type CanvasNode,
  type NodeLock,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import {
  justDrawnRemainingMs,
  LAYER,
  toFlowEdges,
  toFlowNodes,
  type ArrowFlowEdge,
  type BlockNodeData,
  type CanvasFlowNode,
  type FlowLocks,
} from '@web/features/canvas/flow-mapping';

const AUTHOR: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000001' };
const MODERATOR: Author = { kind: 'agent', agentKey: 'moderator' };
const CHANGED_AT = '2026-09-29T10:00:00.000Z';
const OWN_CLIENT = 1;
const NO_LOCKS: FlowLocks = { locks: new Map(), ownClientId: OWN_CLIENT };
const LOCAL_DATA: BlockNodeData = {
  label: '',
  subtitle: '',
  blockType: null,
  fields: [],
  diagramType: null,
  createdBy: AUTHOR,
  changedByAgent: null,
  lastChangedAt: CHANGED_AT,
  lockedBy: null,
  size: BLOCK_SIZE,
};

function canvasNode(
  id: string,
  x: number,
  y: number,
  type: CanvasNode['type'] = 'block',
  lastChangedBy: Author = AUTHOR,
  lastChangedAt = CHANGED_AT,
) {
  const node: CanvasNode = {
    id,
    type,
    blockType: null,
    position: { x, y },
    size: type === 'block' ? BLOCK_SIZE : type === 'sticky' ? NOTE_SIZE : FRAME_SIZE,
    label: `Node ${id}`,
    subtitle: '',
    frameId: null,
    diagramType: null,
    fields: [],
    createdBy: AUTHOR,
    lastChangedBy,
    lastChangedAt,
  };
  return node;
}

function canvasEdge(id: string, source: string, target: string, fields: Partial<CanvasEdge> = {}) {
  const edge: CanvasEdge = {
    id,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    label: 'REST',
    createdBy: AUTHOR,
    lastChangedBy: AUTHOR,
    lastChangedAt: CHANGED_AT,
    ...fields,
  };
  return edge;
}

function lockOf(clientId: number, name: string): NodeLock {
  return { clientId, userId: name.toLowerCase(), name, since: 1 };
}

describe('toFlowNodes', () => {
  it('maps blocks with their position, texts, type, author and size', () => {
    const [node] = toFlowNodes(
      [{ ...canvasNode('a', 40, 60), blockType: 'database' }],
      [],
      NO_LOCKS,
    );

    expect(node).toEqual({
      id: 'a',
      type: 'block',
      position: { x: 40, y: 60 },
      zIndex: LAYER.node,
      data: {
        label: 'Node a',
        subtitle: '',
        blockType: 'database',
        fields: [],
        diagramType: null,
        createdBy: AUTHOR,
        changedByAgent: null,
        lastChangedAt: CHANGED_AT,
        lockedBy: null,
        size: BLOCK_SIZE,
      },
    });
  });

  it('passes the diagram type of a frame to it and to its blocks', () => {
    const fields = [{ name: 'id', type: 'uuid' }];
    const nodes = toFlowNodes(
      [
        { ...canvasNode('f', 0, 0, 'frame'), diagramType: 'datamodel' },
        { ...canvasNode('user', 40, 60), frameId: 'f', blockType: 'entity', fields },
        canvasNode('free', 900, 60),
      ],
      [],
      NO_LOCKS,
    );
    const byId = new Map(nodes.map((node) => [node.id, node]));

    expect(byId.get('f')?.data).toMatchObject({ diagramType: 'datamodel', blockCount: 1 });
    expect(byId.get('user')?.data).toMatchObject({ diagramType: 'datamodel', fields });
    expect(byId.get('free')?.data).toMatchObject({ diagramType: null });
  });

  it('maps notes and frames, frames first and with the number of their blocks', () => {
    const nodes = [
      { ...canvasNode('b', 40, 60), frameId: 'f' },
      { ...canvasNode('c', 300, 60), frameId: 'f' },
      { ...canvasNode('n', 40, 300, 'sticky'), frameId: 'f' },
      canvasNode('f', 0, 0, 'frame'),
    ];

    const flow = toFlowNodes(nodes, [], NO_LOCKS);

    expect(flow.map((node) => [node.id, node.type, node.zIndex])).toEqual([
      ['f', 'frame', LAYER.frame],
      ['b', 'block', LAYER.node],
      ['c', 'block', LAYER.node],
      ['n', 'sticky', LAYER.node],
    ]);
    expect(flow[0]).toMatchObject({ width: 480, height: 320, data: { blockCount: 2 } });
    expect(flow[3]?.data).toMatchObject({ label: 'Node n', size: NOTE_SIZE });
  });

  it('carries the agent of the last change, so the element can show that it was just drawn', () => {
    const [node] = toFlowNodes([canvasNode('a', 0, 0, 'sticky', MODERATOR)], [], NO_LOCKS);

    expect(node?.data).toMatchObject({ changedByAgent: 'moderator', lastChangedAt: CHANGED_AT });
  });

  it('shows who else edits an element and keeps it from being dragged or deleted here', () => {
    const locks: FlowLocks = {
      locks: new Map([
        ['a', lockOf(2, 'Sam')],
        ['b', lockOf(OWN_CLIENT, 'Olga')],
      ]),
      ownClientId: OWN_CLIENT,
    };

    const [a, b] = toFlowNodes([canvasNode('a', 0, 0), canvasNode('b', 0, 200)], [], locks);

    expect(a).toMatchObject({
      draggable: false,
      deletable: false,
      data: { lockedBy: { name: 'Sam' } },
    });
    // The own lock is the own edit, not a lock against oneself.
    expect(b?.data.lockedBy).toBeNull();
    expect(b?.draggable).toBeUndefined();
  });

  it('stacks the last changed element on top, the same way in every browser', () => {
    const nodes = [
      canvasNode('c', 0, 0, 'block', AUTHOR, '2026-09-29T10:00:02.000Z'),
      canvasNode('b', 0, 0, 'block', AUTHOR, '2026-09-29T10:00:01.000Z'),
      canvasNode('a', 0, 0, 'block', AUTHOR, '2026-09-29T10:00:01.000Z'),
    ];

    expect(toFlowNodes(nodes, [], NO_LOCKS).map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(toFlowNodes([...nodes].reverse(), [], NO_LOCKS).map((node) => node.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps selection and measured size from the previous render', () => {
    const previous: CanvasFlowNode[] = [
      {
        id: 'a',
        type: 'block',
        position: { x: 0, y: 0 },
        data: LOCAL_DATA,
        selected: true,
        measured: { width: 180, height: 96 },
      },
    ];
    const [node] = toFlowNodes([canvasNode('a', 100, 100)], previous, NO_LOCKS);

    expect(node?.position).toEqual({ x: 100, y: 100 });
    expect(node?.selected).toBe(true);
    expect(node?.measured).toEqual({ width: 180, height: 96 });
  });

  it('keeps the local position while the node is dragged here', () => {
    const previous: CanvasFlowNode[] = [
      { id: 'a', type: 'block', position: { x: 300, y: 200 }, data: LOCAL_DATA, dragging: true },
    ];
    const [node] = toFlowNodes([canvasNode('a', 100, 100)], previous, NO_LOCKS);

    expect(node?.position).toEqual({ x: 300, y: 200 });
  });

  it('keeps the local bounds while a frame is resized here', () => {
    const [frame] = toFlowNodes([canvasNode('f', 0, 0, 'frame')], [], NO_LOCKS);
    if (!frame) throw new Error('The frame is missing');
    const resizing = {
      ...frame,
      position: { x: -20, y: 0 },
      width: 600,
      height: 400,
      resizing: true,
    };

    const [node] = toFlowNodes([canvasNode('f', 0, 0, 'frame')], [resizing], NO_LOCKS);

    expect(node).toMatchObject({ position: { x: -20, y: 0 }, width: 600, height: 400 });
  });
});

describe('toFlowEdges', () => {
  it('maps arrows with their label above the frames', () => {
    const [edge] = toFlowEdges(
      [canvasEdge('e', 'a', 'b')],
      [canvasNode('a', 0, 0), canvasNode('b', 0, 200)],
    );

    expect(edge).toEqual({
      id: 'e',
      type: 'arrow',
      source: 'a',
      target: 'b',
      zIndex: LAYER.edge,
      selected: false,
      data: { label: 'REST', changedByAgent: null, lastChangedAt: CHANGED_AT },
    });
  });

  it('shows an agent change of the target when it is newer than the arrow', () => {
    const later = '2026-09-29T10:00:05.000Z';
    const nodes = [canvasNode('a', 0, 0), canvasNode('b', 0, 200, 'block', MODERATOR, later)];

    const [edge] = toFlowEdges([canvasEdge('e', 'a', 'b')], nodes);

    expect(edge?.data).toMatchObject({ changedByAgent: 'moderator', lastChangedAt: later });
  });

  it('shows the arrow’s own agent change when the target is older', () => {
    const later = '2026-09-29T10:00:05.000Z';
    const edges = [canvasEdge('e', 'a', 'b', { lastChangedBy: MODERATOR, lastChangedAt: later })];

    const [edge] = toFlowEdges(edges, [canvasNode('a', 0, 0), canvasNode('b', 0, 200)]);

    expect(edge?.data).toMatchObject({ changedByAgent: 'moderator', lastChangedAt: later });
  });

  it('keeps the selection from the previous render', () => {
    const previous: ArrowFlowEdge[] = [
      { id: 'e', type: 'arrow', source: 'a', target: 'b', selected: true },
    ];

    const [edge] = toFlowEdges([canvasEdge('e', 'a', 'b')], [], previous);

    expect(edge?.selected).toBe(true);
  });
});

describe('justDrawnRemainingMs', () => {
  const changedAt = Date.parse(CHANGED_AT);
  const byAgent = { changedByAgent: 'critic', lastChangedAt: CHANGED_AT } as const;

  it('counts down 5 s from an agent change', () => {
    expect(justDrawnRemainingMs(byAgent, changedAt)).toBe(5000);
    expect(justDrawnRemainingMs(byAgent, changedAt + 3000)).toBe(2000);
  });

  it('is over once the agent change is 5 s old', () => {
    expect(justDrawnRemainingMs(byAgent, changedAt + 5000)).toBe(0);
    expect(justDrawnRemainingMs(byAgent, changedAt + 60_000)).toBe(0);
  });

  it('never applies to a human change', () => {
    expect(
      justDrawnRemainingMs({ changedByAgent: null, lastChangedAt: CHANGED_AT }, changedAt),
    ).toBe(0);
  });

  it('treats a change stamped in the future as made right now', () => {
    expect(justDrawnRemainingMs(byAgent, changedAt - 30_000)).toBe(5000);
  });
});
