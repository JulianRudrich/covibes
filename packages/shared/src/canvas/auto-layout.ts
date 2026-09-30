import type { ELK, ElkNode } from 'elkjs/lib/elk-api';

import { findFreeSpot, GRID_SIZE } from './layout';
import {
  FRAME_MIN_SIZE,
  isDiagramType,
  type CanvasEdge,
  type CanvasNode,
  type DiagramType,
  type Position,
  type Size,
} from './model';

// Auto-layout with ELK (specs 10 and 12). Every diagram type has its preset; distances follow the
// 20 px grid. Only positions and frame sizes are computed here; the caller writes them in one
// change. The caller also passes the ELK instance, so the web app loads ELK only when needed.

/** Room around the content of a frame; the top leaves space for its title. */
export const FRAME_PADDING = { top: 60, right: 40, bottom: 40, left: 40 };

/** Distance between neighbors, and between the levels of a diagram. */
const NODE_SPACING = 2 * GRID_SIZE;
const LEVEL_SPACING = 5 * GRID_SIZE;

export type LayoutPreset = { algorithm: 'layered' | 'mrtree'; direction: 'DOWN' | 'RIGHT' };

/** Free frames and the board itself are arranged like an architecture: top to bottom. */
const FREE_PRESET: LayoutPreset = { algorithm: 'layered', direction: 'DOWN' };

/** How each diagram is arranged (spec 12). */
export const LAYOUT_PRESETS: Readonly<Record<DiagramType, LayoutPreset>> = {
  // A tree that grows to the right from the central topic.
  mindmap: { algorithm: 'mrtree', direction: 'RIGHT' },
  architecture: FREE_PRESET,
  datamodel: { algorithm: 'layered', direction: 'RIGHT' },
  flow: FREE_PRESET,
  sitemap: { algorithm: 'mrtree', direction: 'DOWN' },
};

export function layoutPreset(diagramType: string | null): LayoutPreset {
  return isDiagramType(diagramType) ? LAYOUT_PRESETS[diagramType] : FREE_PRESET;
}

/** Whether the diagram reads from left to right, so its arrows leave and enter at the sides. */
export function readsLeftToRight(diagramType: string | null): boolean {
  return layoutPreset(diagramType).direction === 'RIGHT';
}

export type LayoutResult = {
  positions: Map<string, Position>;
  /** New sizes of frames that grew or shrank around their content. */
  frameSizes: Map<string, Size>;
};

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

/** Frame sizes round up, so the padding around the content never gets smaller. */
function snapUp(value: number) {
  return Math.ceil(value / GRID_SIZE) * GRID_SIZE;
}

type Box = { id: string; size: Size };
type Arrangement = { positions: Map<string, Position>; width: number; height: number };

/**
 * Arranges boxes with a preset, relative to (0, 0) and on the grid. `mrtree` keeps its levels only
 * the neighbor distance apart, so boxes are passed longer in the direction the tree grows.
 */
async function arrange(
  elk: ELK,
  boxes: readonly Box[],
  links: readonly (readonly [string, string])[],
  preset: LayoutPreset,
): Promise<Arrangement> {
  const extra = preset.algorithm === 'mrtree' ? LEVEL_SPACING - NODE_SPACING : 0;
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': preset.algorithm,
      'elk.direction': preset.direction,
      'elk.spacing.nodeNode': String(NODE_SPACING),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(LEVEL_SPACING),
      'elk.spacing.componentComponent': String(3 * GRID_SIZE),
      // The result starts exactly at the origin, not 12 or 20 px further in.
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
    },
    children: boxes.map((box) => ({
      id: box.id,
      width: box.size.width + (preset.direction === 'RIGHT' ? extra : 0),
      height: box.size.height + (preset.direction === 'DOWN' ? extra : 0),
    })),
    edges: links.map(([source, target], index) => ({
      id: `link-${String(index)}`,
      sources: [source],
      targets: [target],
    })),
  };
  const laidOut = await elk.layout(graph);

  const sizes = new Map(boxes.map((box) => [box.id, box.size]));
  const arrangement: Arrangement = { positions: new Map(), width: 0, height: 0 };
  for (const child of laidOut.children ?? []) {
    const size = sizes.get(child.id);
    if (!size) continue;
    const position = { x: snap(child.x ?? 0), y: snap(child.y ?? 0) };
    arrangement.positions.set(child.id, position);
    arrangement.width = Math.max(arrangement.width, position.x + size.width);
    arrangement.height = Math.max(arrangement.height, position.y + size.height);
  }
  return arrangement;
}

/** Arrows between boxes, each pair once; `boxOf` names the box an end belongs to, if any. */
function links(
  edges: readonly CanvasEdge[],
  boxOf: (nodeId: string) => string | undefined,
): [string, string][] {
  const seen = new Set<string>();
  const result: [string, string][] = [];
  for (const edge of edges) {
    const source = boxOf(edge.source);
    const target = boxOf(edge.target);
    if (!source || !target || source === target) continue;
    const key = `${source}>${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push([source, target]);
  }
  return result;
}

function overlap(a: { position: Position; size: Size }, b: { position: Position; size: Size }) {
  return (
    a.position.x < b.position.x + b.size.width &&
    b.position.x < a.position.x + a.size.width &&
    a.position.y < b.position.y + b.size.height &&
    b.position.y < a.position.y + a.size.height
  );
}

/** The size of a frame around content arranged at (0, 0), with the padding. */
function sizeAround(content: Pick<Arrangement, 'width' | 'height'>): Size {
  return {
    width: Math.max(
      FRAME_MIN_SIZE.width,
      snapUp(FRAME_PADDING.left + content.width + FRAME_PADDING.right),
    ),
    height: Math.max(
      FRAME_MIN_SIZE.height,
      snapUp(FRAME_PADDING.top + content.height + FRAME_PADDING.bottom),
    ),
  };
}

/**
 * Arranges the whole board or, with `frameId`, only the content of that frame, which then grows
 * or shrinks to fit (and moves to a free spot if it would cover other elements). Each frame's content follows the preset of its diagram type; on the board,
 * frames move as boxes around their content, so the diagrams inside keep their shape. Arrows only
 * count between elements that are arranged together; on the board an arrow into a frame counts
 * for the frame.
 */
export async function computeLayout(
  elk: ELK,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  frameId: string | null = null,
): Promise<LayoutResult> {
  const result: LayoutResult = { positions: new Map(), frameSizes: new Map() };
  const frames = new Map(
    nodes.filter((node) => node.type === 'frame').map((frame) => [frame.id, frame]),
  );
  const members = (id: string) =>
    nodes.filter((node) => node.frameId === id && node.type !== 'frame');
  const boxOf = (ids: ReadonlySet<string>) => (nodeId: string) =>
    ids.has(nodeId) ? nodeId : undefined;

  /** Arranges a frame's content with its preset. */
  const arrangeFrame = async (frame: CanvasNode) => {
    const content = members(frame.id);
    if (content.length === 0) return null;
    const ids = new Set(content.map((node) => node.id));
    const boxes = content.map((node) => ({ id: node.id, size: node.size }));
    return {
      content,
      arrangement: await arrange(
        elk,
        boxes,
        links(edges, boxOf(ids)),
        layoutPreset(frame.diagramType),
      ),
    };
  };

  /** Places a frame's arranged content below its title and fits the frame around it. */
  const placeContent = (
    frame: CanvasNode,
    at: Position,
    content: readonly CanvasNode[],
    arrangement: Arrangement,
  ) => {
    let right = at.x;
    let bottom = at.y;
    for (const node of content) {
      const relative = arrangement.positions.get(node.id);
      if (!relative) continue;
      const position = {
        x: snap(at.x + FRAME_PADDING.left + relative.x),
        y: snap(at.y + FRAME_PADDING.top + relative.y),
      };
      result.positions.set(node.id, position);
      right = Math.max(right, position.x + node.size.width);
      bottom = Math.max(bottom, position.y + node.size.height);
    }
    result.frameSizes.set(frame.id, {
      width: Math.max(FRAME_MIN_SIZE.width, snapUp(right + FRAME_PADDING.right - at.x)),
      height: Math.max(FRAME_MIN_SIZE.height, snapUp(bottom + FRAME_PADDING.bottom - at.y)),
    });
  };

  /**
   * A frame that grew over its neighbors moves with its content to the nearest free spot, so a
   * diagram never covers another one.
   */
  const keepApart = (frame: CanvasNode, content: readonly CanvasNode[]) => {
    const size = result.frameSizes.get(frame.id);
    if (!size) return;
    const own = new Set([frame.id, ...content.map((node) => node.id)]);
    const others = nodes.filter((node) => !own.has(node.id) && node.frameId !== frame.id);
    if (!others.some((node) => overlap({ position: frame.position, size }, node))) return;
    const spot = findFreeSpot(
      others,
      { x: frame.position.x + size.width / 2, y: frame.position.y + size.height / 2 },
      size,
    );
    const dx = spot.x - frame.position.x;
    const dy = spot.y - frame.position.y;
    for (const [id, position] of result.positions) {
      result.positions.set(id, { x: position.x + dx, y: position.y + dy });
    }
    result.positions.set(frame.id, spot);
  };

  if (frameId) {
    const frame = frames.get(frameId);
    const arranged = frame ? await arrangeFrame(frame) : null;
    if (frame && arranged) {
      placeContent(frame, frame.position, arranged.content, arranged.arrangement);
      keepApart(frame, arranged.content);
    }
    return result;
  }

  // First every diagram inside its frame, then the frames and free elements on the board.
  const contents = new Map<string, NonNullable<Awaited<ReturnType<typeof arrangeFrame>>>>();
  for (const frame of frames.values()) {
    const arranged = await arrangeFrame(frame);
    if (arranged) contents.set(frame.id, arranged);
  }
  const topLevel = nodes.filter(
    (node) => node.type === 'frame' || !node.frameId || !frames.has(node.frameId),
  );
  if (topLevel.length === 0) return result;
  const topIds = new Set(topLevel.map((node) => node.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const board = await arrange(
    elk,
    topLevel.map((node) => {
      const content = contents.get(node.id);
      return { id: node.id, size: content ? sizeAround(content.arrangement) : node.size };
    }),
    links(edges, (nodeId) => {
      const frameOfNode = byId.get(nodeId)?.frameId;
      if (frameOfNode && contents.has(frameOfNode)) return frameOfNode;
      return topIds.has(nodeId) ? nodeId : undefined;
    }),
    FREE_PRESET,
  );

  // The board stays where it was: its top left corner, on the grid.
  const start = {
    x: snap(Math.min(...topLevel.map((node) => node.position.x))),
    y: snap(Math.min(...topLevel.map((node) => node.position.y))),
  };
  for (const node of topLevel) {
    const relative = board.positions.get(node.id);
    if (!relative) continue;
    const position = { x: start.x + relative.x, y: start.y + relative.y };
    result.positions.set(node.id, position);
    const content = contents.get(node.id);
    if (content) placeContent(node, position, content.content, content.arrangement);
  }
  return result;
}
