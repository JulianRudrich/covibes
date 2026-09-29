import { BLOCK_SIZE, type CanvasNode, type Position } from './model';

// Where new blocks go (spec 05 and 07): the same rule for people and agents.

/** Grid of the canvas background; new blocks snap to it. */
export const GRID_SIZE = 20;
const MAX_RINGS = 12;

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function overlaps(position: Position, node: CanvasNode) {
  const gap = GRID_SIZE;
  return (
    position.x < node.position.x + node.size.width + gap &&
    position.x + BLOCK_SIZE.width + gap > node.position.x &&
    position.y < node.position.y + node.size.height + gap &&
    position.y + BLOCK_SIZE.height + gap > node.position.y
  );
}

/**
 * Top-left position for a new block near `center` (usually the middle of the visible canvas) that
 * does not cover an existing node. Searches outwards on a block-sized grid, nearest spots first;
 * among equally near spots, below and to the right come before above and to the left.
 */
export function findFreeSpot(nodes: readonly CanvasNode[], center: Position): Position {
  const start = {
    x: snap(center.x - BLOCK_SIZE.width / 2),
    y: snap(center.y - BLOCK_SIZE.height / 2),
  };
  const stepX = BLOCK_SIZE.width + GRID_SIZE;
  const stepY = BLOCK_SIZE.height + GRID_SIZE;

  const offsets: { dx: number; dy: number; distance: number }[] = [];
  for (let dy = -MAX_RINGS; dy <= MAX_RINGS; dy += 1) {
    for (let dx = -MAX_RINGS; dx <= MAX_RINGS; dx += 1) {
      offsets.push({ dx, dy, distance: Math.hypot(dx * stepX, dy * stepY) });
    }
  }
  offsets.sort((a, b) => a.distance - b.distance || b.dy - a.dy || b.dx - a.dx);

  for (const { dx, dy } of offsets) {
    const candidate = { x: start.x + dx * stepX, y: start.y + dy * stepY };
    if (!nodes.some((node) => overlaps(candidate, node))) return candidate;
  }
  return start;
}
