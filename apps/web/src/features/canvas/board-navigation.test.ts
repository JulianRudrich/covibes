import { addBlock, addEdge, readEdges, readNodes, type Author } from '@covibes/shared';
import { getViewportForBounds } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { toFlowEdges, toFlowNodes } from '@web/features/canvas/flow-mapping';
import { edgesWithGeometry, nodeRects } from '@web/features/canvas/shown-edges';
import { FIT_BOARD_OPTIONS } from '@web/features/canvas/zoom';

const AUTHOR: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000001' };
const idOf = (index: number) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;

describe('large-board navigation and edge identity', () => {
  it('fits even a 500-block row without the former 30-percent clipping floor', () => {
    const bounds = { x: -30_000, y: -1_000, width: 500 * 300, height: 200 };
    const width = 720;
    const height = 640;
    const view = getViewportForBounds(
      bounds,
      width,
      height,
      FIT_BOARD_OPTIONS.minZoom,
      FIT_BOARD_OPTIONS.maxZoom,
      FIT_BOARD_OPTIONS.padding,
    );
    expect(view.zoom).toBeLessThan(0.01);
    expect(bounds.x * view.zoom + view.x).toBeGreaterThanOrEqual(0);
    expect((bounds.x + bounds.width) * view.zoom + view.x).toBeLessThanOrEqual(width);
    expect(bounds.y * view.zoom + view.y).toBeGreaterThanOrEqual(0);
    expect((bounds.y + bounds.height) * view.zoom + view.y).toBeLessThanOrEqual(height);
  });

  it('retains an unrelated rendered edge when another source moves', () => {
    const doc = new Y.Doc();
    for (let index = 1; index <= 4; index++)
      addBlock(
        doc,
        {
          id: idOf(index),
          label: `Service ${String(index)}`,
          position: { x: index * 400, y: index * 200 },
        },
        AUTHOR,
      );
    addEdge(doc, { id: idOf(10), source: idOf(1), target: idOf(2) }, AUTHOR);
    addEdge(doc, { id: idOf(11), source: idOf(3), target: idOf(4) }, AUTHOR);
    const snapshot = readNodes(doc);
    const nodes = toFlowNodes(snapshot, [], { locks: new Map(), ownClientId: 1 });
    const edges = toFlowEdges(readEdges(doc), snapshot);
    const before = edgesWithGeometry(nodes, edges, nodeRects(nodes));
    const moved = nodes.map((node) =>
      node.id === idOf(1) ? { ...node, position: { x: 0, y: 0 } } : node,
    );
    const after = edgesWithGeometry(moved, edges, nodeRects(moved), before);
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    doc.destroy();
  });
});
