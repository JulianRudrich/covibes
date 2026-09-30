import { describe, expect, it } from 'vitest';

import { findFreeSpot } from './layout';
import { BLOCK_SIZE, type Author, type CanvasNode } from './model';

const AUTHOR: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000001' };

function canvasNode(id: string, x: number, y: number, type: CanvasNode['type'] = 'block') {
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
    lastChangedBy: AUTHOR,
    lastChangedAt: '2026-09-29T10:00:00.000Z',
  };
  return node;
}

function isSeparated(spot: { x: number; y: number }, node: CanvasNode) {
  return (
    spot.x >= node.position.x + node.size.width ||
    spot.x + BLOCK_SIZE.width <= node.position.x ||
    spot.y >= node.position.y + node.size.height ||
    spot.y + BLOCK_SIZE.height <= node.position.y
  );
}

describe('findFreeSpot', () => {
  it('centers the block on the given point, snapped to the grid', () => {
    expect(findFreeSpot([], { x: 390, y: 308 })).toEqual({ x: 300, y: 260 });
  });

  it('moves away from a node that covers the spot', () => {
    const taken = canvasNode('a', 300, 260);
    const spot = findFreeSpot([taken], { x: 400, y: 300 });

    expect(isSeparated(spot, taken)).toBe(true);
  });

  it('puts the next block below the previous one, with room for an arrow in between', () => {
    const first = findFreeSpot([], { x: 390, y: 308 });
    const second = findFreeSpot([canvasNode('a', first.x, first.y)], { x: 390, y: 308 });

    expect(second).toEqual({ x: first.x, y: first.y + BLOCK_SIZE.height + 100 });
  });

  it('keeps the distance of the handoff to blocks side by side', () => {
    // The spots below and above are taken, so the next one is to the right.
    const left = canvasNode('a', 300, 260);
    const below = canvasNode('b', 300, 456);
    const above = canvasNode('c', 300, 64);
    const spot = findFreeSpot([left, below, above], { x: 390, y: 308 });

    expect(spot).toEqual({ x: 300 + BLOCK_SIZE.width + 40, y: 260 });
  });

  it('finds a spot outside a crowded area', () => {
    const crowd = [];
    for (let row = -1; row <= 1; row += 1) {
      for (let column = -1; column <= 1; column += 1) {
        crowd.push(
          canvasNode(`${String(row)}${String(column)}`, 300 + column * 200, 260 + row * 116),
        );
      }
    }
    const spot = findFreeSpot(crowd, { x: 400, y: 300 });

    expect(crowd.every((node) => isSeparated(spot, node))).toBe(true);
  });
});
