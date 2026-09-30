import {
  FRAME_MIN_SIZE,
  GRID_SIZE,
  type CanvasEdge,
  type CanvasNode,
  type Position,
  type Size,
} from '@covibes/shared';
import type { ELK, ElkNode } from 'elkjs/lib/elk-api';

// Auto-layout with ELK (spec 10): `layered`, top to bottom as the arrows run, distances on the
// 20 px grid. Only positions and frame sizes are computed here; the board writes them.

/** Room around the content of a frame; the top leaves space for its title. */
const FRAME_PADDING = { top: 60, right: 40, bottom: 40, left: 40 };

const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': String(2 * GRID_SIZE),
  'elk.layered.spacing.nodeNodeBetweenLayers': String(5 * GRID_SIZE),
  'elk.spacing.componentComponent': String(3 * GRID_SIZE),
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  // The result starts exactly where the diagram was, not 12 px further in.
  'elk.padding': '[top=0,left=0,bottom=0,right=0]',
};

const FRAME_OPTIONS = {
  'elk.padding': `[top=${String(FRAME_PADDING.top)},left=${String(FRAME_PADDING.left)},bottom=${String(FRAME_PADDING.bottom)},right=${String(FRAME_PADDING.right)}]`,
};

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

function snapped(position: Position): Position {
  return { x: snap(position.x), y: snap(position.y) };
}

function leaf(node: CanvasNode): ElkNode {
  return { id: node.id, width: node.size.width, height: node.size.height };
}

/** The top-left corner of a set of nodes; the layout stays where the diagram was. */
function origin(nodes: readonly CanvasNode[]): Position {
  return {
    x: Math.min(...nodes.map((node) => node.position.x)),
    y: Math.min(...nodes.map((node) => node.position.y)),
  };
}

/**
 * Arranges the whole board (frames as boxes that move with their content) or, with `frameId`,
 * only the content of that frame, which then grows or shrinks to fit. Arrows only count between
 * nodes that are laid out together.
 */
export async function computeLayout(
  elk: ELK,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  frameId: string | null = null,
): Promise<LayoutResult> {
  const result: LayoutResult = { positions: new Map(), frameSizes: new Map() };
  const frame = frameId ? nodes.find((node) => node.id === frameId && node.type === 'frame') : null;
  if (frameId && !frame) return result;

  const members = (id: string) =>
    nodes.filter((node) => node.frameId === id && node.type !== 'frame');
  const topLevel = frame
    ? members(frame.id)
    : nodes.filter((node) => node.type === 'frame' || !node.frameId);
  if (topLevel.length === 0) return result;

  // A frame with content is a box around it; an empty frame keeps its size like any element.
  const children: ElkNode[] = topLevel.map((node) => {
    const content = node.type === 'frame' && !frame ? members(node.id) : [];
    return content.length > 0
      ? { id: node.id, layoutOptions: FRAME_OPTIONS, children: content.map(leaf) }
      : leaf(node);
  });
  const included = new Set(
    children.flatMap((child) => [child.id, ...(child.children ?? []).map((inner) => inner.id)]),
  );
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: LAYOUT_OPTIONS,
    children,
    edges: edges
      .filter((edge) => included.has(edge.source) && included.has(edge.target))
      .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };

  const laidOut = await elk.layout(graph);

  // Inside a frame the content starts below its title; on the board where the diagram was.
  const start = frame
    ? { x: frame.position.x + FRAME_PADDING.left, y: frame.position.y + FRAME_PADDING.top }
    : snapped(origin(topLevel));
  for (const child of laidOut.children ?? []) {
    const x = snap(start.x + (child.x ?? 0));
    const y = snap(start.y + (child.y ?? 0));
    result.positions.set(child.id, { x, y });
    const inner = child.children ?? [];
    if (inner.length > 0) {
      for (const member of inner) {
        result.positions.set(member.id, {
          x: snap(x + (member.x ?? 0)),
          y: snap(y + (member.y ?? 0)),
        });
      }
    }
    if (nodes.find((node) => node.id === child.id)?.type === 'frame' && inner.length > 0) {
      result.frameSizes.set(child.id, {
        width: Math.max(FRAME_MIN_SIZE.width, snapUp(child.width ?? 0)),
        height: Math.max(FRAME_MIN_SIZE.height, snapUp(child.height ?? 0)),
      });
    }
  }

  if (frame) {
    const right = Math.max(
      ...topLevel.map((node) => (result.positions.get(node.id)?.x ?? 0) + node.size.width),
    );
    const bottom = Math.max(
      ...topLevel.map((node) => (result.positions.get(node.id)?.y ?? 0) + node.size.height),
    );
    result.frameSizes.set(frame.id, {
      width: Math.max(FRAME_MIN_SIZE.width, snapUp(right + FRAME_PADDING.right - frame.position.x)),
      height: Math.max(
        FRAME_MIN_SIZE.height,
        snapUp(bottom + FRAME_PADDING.bottom - frame.position.y),
      ),
    });
  }
  return result;
}

let elkInstance: Promise<ELK> | null = null;

/** ELK is large, so it is only loaded when auto-layout is used for the first time. */
export function loadElk(): Promise<ELK> {
  elkInstance ??= import('elkjs/lib/elk.bundled.js').then(({ default: Elk }) => new Elk());
  return elkInstance;
}
