import { BLOCK_SIZE, type CanvasNode, type Position, type Size } from './model';

// Where new elements go (spec 05, 07 and 09): the same rule for people and agents.

/** Grid of the canvas background; new elements snap to it. */
export const GRID_SIZE = 20;
const MAX_RINGS = 12;
/**
 * Room between elements, as in the handoff (about 40 px side by side, 110 px one below the
 * other), so arrows and their labels fit in between.
 */
const GAP_X = 2 * GRID_SIZE;
const GAP_Y = 5 * GRID_SIZE;

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function overlaps(position: Position, size: Size, node: CanvasNode) {
  return (
    position.x < node.position.x + node.size.width + GAP_X &&
    position.x + size.width + GAP_X > node.position.x &&
    position.y < node.position.y + node.size.height + GAP_Y &&
    position.y + size.height + GAP_Y > node.position.y
  );
}

/**
 * Top-left position for a new element of `size` (a block by default) near `center`, usually the
 * middle of the visible canvas, that keeps its distance to every existing node. Searches outwards
 * on a grid of the element's size plus that distance, nearest spots first; among equally near
 * spots, below and to the right come before above and to the left.
 */
export function findFreeSpot(
  nodes: readonly CanvasNode[],
  center: Position,
  size: Size = BLOCK_SIZE,
): Position {
  const start = {
    x: snap(center.x - size.width / 2),
    y: snap(center.y - size.height / 2),
  };
  const stepX = size.width + GAP_X;
  const stepY = size.height + GAP_Y;

  const offsets: { dx: number; dy: number; distance: number }[] = [];
  for (let dy = -MAX_RINGS; dy <= MAX_RINGS; dy += 1) {
    for (let dx = -MAX_RINGS; dx <= MAX_RINGS; dx += 1) {
      offsets.push({ dx, dy, distance: Math.hypot(dx * stepX, dy * stepY) });
    }
  }
  offsets.sort((a, b) => a.distance - b.distance || b.dy - a.dy || b.dx - a.dx);

  for (const { dx, dy } of offsets) {
    const candidate = { x: start.x + dx * stepX, y: start.y + dy * stepY };
    if (!nodes.some((node) => overlaps(candidate, size, node))) return candidate;
  }
  return start;
}
