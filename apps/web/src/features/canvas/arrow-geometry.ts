// Where arrows start and end (spec 09, handoff "Arrows"): from the bottom edge of the source into
// the top edge of the target as a cubic Bézier; blocks side by side are connected straight from
// the right to the left edge. Several arrows on the same edge of a block are spread evenly.

export type Rect = { x: number; y: number; width: number; height: number };
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Point = { x: number; y: number };

export type ArrowGeometry = {
  path: string;
  /** Middle of the curve, where the label pill sits. */
  label: Point;
  source: Point;
  target: Point;
};

type ArrowEnds = { id: string; source: string; target: string };

const MIN_CURVE = 30;
/** The path stops short of the target, so the tip of the arrowhead touches its edge (handoff). */
export const ARROW_GAP = 4;

function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** The sides an arrow leaves the source and enters the target. */
export function arrowSides(source: Rect, target: Rect): { from: Side; to: Side } {
  const verticalOverlap =
    Math.min(source.y + source.height, target.y + target.height) - Math.max(source.y, target.y);
  if (verticalOverlap > 0) {
    if (target.x >= source.x + source.width) return { from: 'right', to: 'left' };
    if (target.x + target.width <= source.x) return { from: 'left', to: 'right' };
  }
  return center(target).y >= center(source).y
    ? { from: 'bottom', to: 'top' }
    : { from: 'top', to: 'bottom' };
}

/** A point on `side` of `rect`, at `share` (0 to 1) along it, left to right or top to bottom. */
function pointOn(rect: Rect, side: Side, share: number): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width * share, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width * share, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height * share };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height * share };
  }
}

const DIRECTION: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** The curve between two anchors; straight when they lie on one horizontal line. */
export function arrowPath(
  from: Point,
  fromSide: Side,
  to: Point,
  toSide: Side,
): {
  path: string;
  label: Point;
} {
  const horizontal = fromSide === 'left' || fromSide === 'right';
  if (horizontal && Math.abs(from.y - to.y) < 1) {
    return {
      path: `M ${String(from.x)} ${String(from.y)} L ${String(to.x)} ${String(to.y)}`,
      label: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    };
  }
  const distance = horizontal ? Math.abs(to.x - from.x) : Math.abs(to.y - from.y);
  const pull = Math.max(MIN_CURVE, distance / 2);
  const c1 = { x: from.x + DIRECTION[fromSide].x * pull, y: from.y + DIRECTION[fromSide].y * pull };
  const c2 = { x: to.x + DIRECTION[toSide].x * pull, y: to.y + DIRECTION[toSide].y * pull };
  const fmt = (point: Point) => `${String(point.x)} ${String(point.y)}`;
  return {
    path: `M ${fmt(from)} C ${fmt(c1)}, ${fmt(c2)}, ${fmt(to)}`,
    // The point of a cubic Bézier at t = 0.5.
    label: {
      x: (from.x + 3 * c1.x + 3 * c2.x + to.x) / 8,
      y: (from.y + 3 * c1.y + 3 * c2.y + to.y) / 8,
    },
  };
}

/**
 * The geometry of every arrow whose ends are known. Arrows that share an edge of a block are
 * spread evenly along it, ordered by where their other end lies, so they do not cross there.
 */
export function arrowGeometries(
  edges: readonly ArrowEnds[],
  rects: ReadonlyMap<string, Rect>,
): Map<string, ArrowGeometry> {
  type Attachment = { edgeId: string; end: 'source' | 'target'; order: number };
  const attachments = new Map<string, Attachment[]>();
  const sides = new Map<string, { from: Side; to: Side }>();

  for (const edge of edges) {
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (!source || !target) continue;
    const { from, to } = arrowSides(source, target);
    sides.set(edge.id, { from, to });
    const along = (side: Side, other: Rect) =>
      side === 'top' || side === 'bottom' ? center(other).x : center(other).y;
    for (const [nodeId, side, end, other] of [
      [edge.source, from, 'source', target],
      [edge.target, to, 'target', source],
    ] as const) {
      const key = `${nodeId}:${side}`;
      const list = attachments.get(key) ?? [];
      list.push({ edgeId: edge.id, end, order: along(side, other) });
      attachments.set(key, list);
    }
  }

  const anchors = new Map<string, Point>();
  for (const [key, list] of attachments) {
    const [nodeId, side] = key.split(':') as [string, Side];
    const rect = rects.get(nodeId);
    if (!rect) continue;
    list.sort((a, b) => a.order - b.order || (a.edgeId < b.edgeId ? -1 : 1));
    list.forEach((attachment, index) => {
      const share = (index + 1) / (list.length + 1);
      anchors.set(`${attachment.edgeId}:${attachment.end}`, pointOn(rect, side, share));
    });
  }

  const geometries = new Map<string, ArrowGeometry>();
  for (const edge of edges) {
    const edgeSides = sides.get(edge.id);
    const from = anchors.get(`${edge.id}:source`);
    const anchor = anchors.get(`${edge.id}:target`);
    if (!edgeSides || !from || !anchor) continue;
    const away = DIRECTION[edgeSides.to];
    const to = { x: anchor.x + away.x * ARROW_GAP, y: anchor.y + away.y * ARROW_GAP };
    geometries.set(edge.id, {
      ...arrowPath(from, edgeSides.from, to, edgeSides.to),
      source: from,
      target: to,
    });
  }
  return geometries;
}
