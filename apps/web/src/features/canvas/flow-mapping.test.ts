import { BLOCK_SIZE, type Author, type CanvasNode, type NodeLock } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import {
  justDrawnRemainingMs,
  toFlowNodes,
  type BlockFlowNode,
  type BlockNodeData,
  type FlowLocks,
} from '@web/features/canvas/flow-mapping';

const AUTHOR: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000001' };
const CHANGED_AT = '2026-09-29T10:00:00.000Z';
const OWN_CLIENT = 1;
const NO_LOCKS: FlowLocks = { locks: new Map(), ownClientId: OWN_CLIENT };
const LOCAL_DATA: BlockNodeData = {
  label: '',
  subtitle: '',
  blockType: null,
  createdBy: AUTHOR,
  changedByAgent: null,
  lastChangedAt: CHANGED_AT,
  lockedBy: null,
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
    size: BLOCK_SIZE,
    label: `Block ${id}`,
    subtitle: '',
    frameId: null,
    createdBy: AUTHOR,
    lastChangedBy,
    lastChangedAt,
  };
  return node;
}

function lockOf(clientId: number, name: string): NodeLock {
  return { clientId, userId: name.toLowerCase(), name, since: 1 };
}

describe('toFlowNodes', () => {
  it('maps blocks with their position, texts, type and author', () => {
    const [node] = toFlowNodes(
      [{ ...canvasNode('a', 40, 60), blockType: 'database' }],
      [],
      NO_LOCKS,
    );

    expect(node).toEqual({
      id: 'a',
      type: 'block',
      position: { x: 40, y: 60 },
      data: {
        label: 'Block a',
        subtitle: '',
        blockType: 'database',
        createdBy: AUTHOR,
        changedByAgent: null,
        lastChangedAt: CHANGED_AT,
        lockedBy: null,
      },
    });
  });

  it('carries the agent of the last change, so the block can show that it was just drawn', () => {
    const [node] = toFlowNodes(
      [canvasNode('a', 0, 0, 'block', { kind: 'agent', agentKey: 'moderator' })],
      [],
      NO_LOCKS,
    );

    expect(node?.data).toMatchObject({ changedByAgent: 'moderator', lastChangedAt: CHANGED_AT });
  });

  it('shows who else edits a block and keeps it from being dragged or deleted here', () => {
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

  it('stacks the last changed block on top, the same way in every browser', () => {
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

  it('leaves out node types that are not rendered yet', () => {
    expect(
      toFlowNodes([canvasNode('a', 0, 0), canvasNode('f', 0, 0, 'frame')], [], NO_LOCKS),
    ).toHaveLength(1);
  });

  it('keeps selection and measured size from the previous render', () => {
    const previous: BlockFlowNode[] = [
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
    const previous: BlockFlowNode[] = [
      {
        id: 'a',
        type: 'block',
        position: { x: 300, y: 200 },
        data: LOCAL_DATA,
        dragging: true,
      },
    ];
    const [node] = toFlowNodes([canvasNode('a', 100, 100)], previous, NO_LOCKS);

    expect(node?.position).toEqual({ x: 300, y: 200 });
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
