import {
  BLOCK_SIZE,
  FRAME_SIZE,
  type Author,
  type CanvasEdge,
  type CanvasNode,
  type Position,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { computeLayout, loadElk } from '@web/features/canvas/auto-layout';

const AUTHOR: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000001' };
const AT = '2026-09-30T10:00:00.000Z';

function node(id: string, x: number, y: number, fields: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: 'block',
    blockType: null,
    position: { x, y },
    size: BLOCK_SIZE,
    label: id,
    subtitle: '',
    frameId: null,
    createdBy: AUTHOR,
    lastChangedBy: AUTHOR,
    lastChangedAt: AT,
    ...fields,
  };
}

function edge(source: string, target: string): CanvasEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    label: '',
    createdBy: AUTHOR,
    lastChangedBy: AUTHOR,
    lastChangedAt: AT,
  };
}

function overlap(a: Position, b: Position) {
  return (
    a.x < b.x + BLOCK_SIZE.width &&
    b.x < a.x + BLOCK_SIZE.width &&
    a.y < b.y + BLOCK_SIZE.height &&
    b.y < a.y + BLOCK_SIZE.height
  );
}

describe('computeLayout', () => {
  it('arranges a chain top to bottom, on the grid, where the diagram was', async () => {
    const nodes = [node('a', 400, 300), node('b', 420, 310), node('c', 380, 290)];
    const { positions } = await computeLayout(await loadElk(), nodes, [
      edge('a', 'b'),
      edge('b', 'c'),
    ]);

    const [a, b, c] = ['a', 'b', 'c'].map((id) => positions.get(id));
    if (!a || !b || !c) throw new Error('A position is missing');
    expect(b.y).toBeGreaterThanOrEqual(a.y + BLOCK_SIZE.height + 100);
    expect(c.y).toBeGreaterThanOrEqual(b.y + BLOCK_SIZE.height + 100);
    for (const position of [a, b, c]) {
      expect(position.x % 20).toBe(0);
      expect(position.y % 20).toBe(0);
    }
    // The top of the diagram stays where it was (290, on the grid 300).
    expect(Math.min(a.y, b.y, c.y)).toBe(300);
  });

  it('puts unconnected elements side by side without overlaps', async () => {
    const nodes = [node('a', 0, 0), node('b', 0, 0), node('c', 0, 0)];
    const { positions } = await computeLayout(await loadElk(), nodes, []);

    const all = [...positions.values()];
    expect(all).toHaveLength(3);
    for (const [index, position] of all.entries()) {
      for (const other of all.slice(index + 1)) expect(overlap(position, other)).toBe(false);
    }
  });

  it('arranges only the content of a selected frame, which then fits around it', async () => {
    const nodes = [
      node('f', 100, 100, { type: 'frame', size: FRAME_SIZE }),
      node('a', 140, 160, { frameId: 'f' }),
      node('b', 150, 170, { frameId: 'f' }),
      node('x', 900, 900),
    ];
    const { positions, frameSizes } = await computeLayout(
      await loadElk(),
      nodes,
      [edge('a', 'b'), edge('b', 'x')],
      'f',
    );

    expect([...positions.keys()].sort()).toEqual(['a', 'b']);
    const a = positions.get('a');
    const b = positions.get('b');
    expect(a?.y).toBe(160);
    expect(b && a && b.y >= a.y + BLOCK_SIZE.height + 100).toBe(true);
    const size = frameSizes.get('f');
    if (!size || !b) throw new Error('The frame or a block is missing');
    // The frame reaches at least 40 px beyond its lowest block, on the grid.
    const room = 100 + size.height - (b.y + BLOCK_SIZE.height);
    expect(room).toBeGreaterThanOrEqual(40);
    expect(room).toBeLessThan(60);
    expect(size.height % 20).toBe(0);
  });

  it('moves frames on the board as boxes around their content', async () => {
    const nodes = [
      node('f', 0, 0, { type: 'frame', size: FRAME_SIZE }),
      node('a', 40, 60, { frameId: 'f' }),
      node('b', 40, 60, { frameId: 'f' }),
      node('x', 0, 0),
      node('empty', 0, 0, { type: 'frame', size: { width: 300, height: 200 } }),
    ];
    const { positions, frameSizes } = await computeLayout(await loadElk(), nodes, [
      edge('a', 'b'),
      edge('x', 'a'),
    ]);

    const frame = positions.get('f');
    const size = frameSizes.get('f');
    if (!frame || !size) throw new Error('The frame was not laid out');
    for (const id of ['a', 'b']) {
      const member = positions.get(id);
      if (!member) throw new Error(`${id} is missing`);
      expect(member.x).toBeGreaterThanOrEqual(frame.x);
      expect(member.y).toBeGreaterThanOrEqual(frame.y + 60);
      expect(member.x + BLOCK_SIZE.width).toBeLessThanOrEqual(frame.x + size.width);
      expect(member.y + BLOCK_SIZE.height).toBeLessThanOrEqual(frame.y + size.height);
    }
    // An empty frame keeps its size.
    expect(frameSizes.has('empty')).toBe(false);
    expect(positions.has('empty')).toBe(true);
  });
});
