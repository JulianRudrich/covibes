import Elk from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';

import { computeLayout, layoutPreset, readsLeftToRight } from './auto-layout';
import {
  BLOCK_SIZE,
  FRAME_SIZE,
  type Author,
  type CanvasEdge,
  type CanvasNode,
  type Position,
  type Size,
} from './model';

const AUTHOR: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000001' };
const AT = '2026-09-30T10:00:00.000Z';
const elk = new Elk();

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
    diagramType: null,
    fields: [],
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

function overlap(a: Position, b: Position, size: Size = BLOCK_SIZE) {
  return (
    a.x < b.x + size.width &&
    b.x < a.x + size.width &&
    a.y < b.y + size.height &&
    b.y < a.y + size.height
  );
}

function at(positions: Map<string, Position>, id: string): Position {
  const position = positions.get(id);
  if (!position) throw new Error(`${id} was not laid out`);
  return position;
}

/** A frame of `diagramType` at (0, 0) with a small tree: a → b, a → c, b → d. */
function tree(diagramType: string | null) {
  return {
    nodes: [
      node('f', 0, 0, { type: 'frame', size: FRAME_SIZE, diagramType }),
      ...['a', 'b', 'c', 'd'].map((id) => node(id, 40, 60, { frameId: 'f' })),
    ],
    edges: [edge('a', 'b'), edge('a', 'c'), edge('b', 'd')],
  };
}

describe('computeLayout', () => {
  it('arranges a chain top to bottom, on the grid, where the diagram was', async () => {
    const nodes = [node('a', 400, 300), node('b', 420, 310), node('c', 380, 290)];
    const { positions } = await computeLayout(elk, nodes, [edge('a', 'b'), edge('b', 'c')]);

    const [a, b, c] = ['a', 'b', 'c'].map((id) => at(positions, id));
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
    const { positions } = await computeLayout(elk, nodes, []);

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
      elk,
      nodes,
      [edge('a', 'b'), edge('b', 'x')],
      'f',
    );

    expect([...positions.keys()].sort()).toEqual(['a', 'b']);
    const a = at(positions, 'a');
    const b = at(positions, 'b');
    expect(a.y).toBe(160);
    expect(b.y).toBeGreaterThanOrEqual(a.y + BLOCK_SIZE.height + 100);
    const size = frameSizes.get('f');
    if (!size) throw new Error('The frame has no size');
    // The frame reaches at least 40 px beyond its lowest block, on the grid.
    const room = 100 + size.height - (b.y + BLOCK_SIZE.height);
    expect(room).toBeGreaterThanOrEqual(40);
    expect(room).toBeLessThan(60);
    expect(size.height % 20).toBe(0);
  });

  it('moves a frame that grew over its neighbors to a free spot, with its content', async () => {
    const nodes = [
      node('f', 0, 0, { type: 'frame', size: { width: 260, height: 200 } }),
      ...['a', 'b', 'c'].map((id) => node(id, 40, 60, { frameId: 'f' })),
      node('neighbor', 0, 260),
    ];
    const { positions, frameSizes } = await computeLayout(
      elk,
      nodes,
      [edge('a', 'b'), edge('b', 'c')],
      'f',
    );

    const frame = at(positions, 'f');
    const size = frameSizes.get('f');
    if (!size) throw new Error('The frame has no size');
    const neighbor = { position: { x: 0, y: 260 }, size: BLOCK_SIZE };
    const covers =
      frame.x < neighbor.position.x + neighbor.size.width &&
      neighbor.position.x < frame.x + size.width &&
      frame.y < neighbor.position.y + neighbor.size.height &&
      neighbor.position.y < frame.y + size.height;
    expect(covers).toBe(false);
    for (const id of ['a', 'b', 'c']) {
      const member = at(positions, id);
      expect(member.x).toBeGreaterThanOrEqual(frame.x + 40);
      expect(member.y).toBeGreaterThanOrEqual(frame.y + 60);
      expect(member.y + BLOCK_SIZE.height).toBeLessThanOrEqual(frame.y + size.height - 40);
    }
    // A frame with room stays where it is.
    const roomy = await computeLayout(elk, nodes.slice(0, 4), [edge('a', 'b')], 'f');
    expect(roomy.positions.has('f')).toBe(false);
  });

  it('moves frames on the board as boxes around their content', async () => {
    const nodes = [
      node('f', 0, 0, { type: 'frame', size: FRAME_SIZE }),
      node('a', 40, 60, { frameId: 'f' }),
      node('b', 40, 60, { frameId: 'f' }),
      node('x', 0, 0),
      node('empty', 0, 0, { type: 'frame', size: { width: 300, height: 200 } }),
    ];
    const { positions, frameSizes } = await computeLayout(elk, nodes, [
      edge('a', 'b'),
      edge('x', 'a'),
    ]);

    const frame = at(positions, 'f');
    const size = frameSizes.get('f');
    if (!size) throw new Error('The frame has no size');
    for (const id of ['a', 'b']) {
      const member = at(positions, id);
      expect(member.x).toBeGreaterThanOrEqual(frame.x + 40);
      expect(member.y).toBeGreaterThanOrEqual(frame.y + 60);
      expect(member.x + BLOCK_SIZE.width).toBeLessThanOrEqual(frame.x + size.width - 40);
      expect(member.y + BLOCK_SIZE.height).toBeLessThanOrEqual(frame.y + size.height - 40);
    }
    // The arrow from x into the frame puts the frame below x.
    expect(frame.y).toBeGreaterThan(at(positions, 'x').y);
    // An empty frame keeps its size.
    expect(frameSizes.has('empty')).toBe(false);
    expect(positions.has('empty')).toBe(true);
  });

  it('grows a mind map to the right and a sitemap downwards, a level apart', async () => {
    const mindmap = tree('mindmap');
    const right = await computeLayout(elk, mindmap.nodes, mindmap.edges, 'f');
    expect(at(right.positions, 'b').x).toBeGreaterThanOrEqual(
      at(right.positions, 'a').x + BLOCK_SIZE.width + 100,
    );
    expect(at(right.positions, 'b').x).toBe(at(right.positions, 'c').x);

    const sitemap = tree('sitemap');
    const down = await computeLayout(elk, sitemap.nodes, sitemap.edges, 'f');
    expect(at(down.positions, 'b').y).toBeGreaterThanOrEqual(
      at(down.positions, 'a').y + BLOCK_SIZE.height + 100,
    );
    expect(at(down.positions, 'b').y).toBe(at(down.positions, 'c').y);
  });

  it('arranges a data model from left to right and a flow from top to bottom', async () => {
    const datamodel = tree('datamodel');
    const right = await computeLayout(elk, datamodel.nodes, datamodel.edges, 'f');
    expect(at(right.positions, 'd').x).toBeGreaterThan(at(right.positions, 'b').x);
    expect(at(right.positions, 'b').x).toBeGreaterThan(at(right.positions, 'a').x);

    const flow = tree('flow');
    const down = await computeLayout(elk, flow.nodes, flow.edges, 'f');
    expect(at(down.positions, 'd').y).toBeGreaterThan(at(down.positions, 'b').y);
    expect(at(down.positions, 'b').y).toBeGreaterThan(at(down.positions, 'a').y);
  });

  it('keeps each diagram in its shape when the whole board is arranged', async () => {
    const mindmap = tree('mindmap');
    const sitemap = {
      nodes: [
        node('g', 900, 0, { type: 'frame', size: FRAME_SIZE, diagramType: 'sitemap' }),
        ...['p', 'q', 'r'].map((id) => node(id, 940, 60, { frameId: 'g' })),
      ],
      edges: [edge('p', 'q'), edge('p', 'r')],
    };
    const { positions, frameSizes } = await computeLayout(
      elk,
      [...mindmap.nodes, ...sitemap.nodes],
      [...mindmap.edges, ...sitemap.edges],
    );

    // Inside the mind map, children lie to the right of their parent; in the sitemap below it.
    expect(at(positions, 'b').x).toBeGreaterThan(at(positions, 'a').x);
    expect(at(positions, 'q').y).toBeGreaterThan(at(positions, 'p').y);
    // The two frames do not overlap.
    const f = at(positions, 'f');
    const g = at(positions, 'g');
    const fSize = frameSizes.get('f');
    const gSize = frameSizes.get('g');
    if (!fSize || !gSize) throw new Error('A frame has no size');
    const apart =
      f.x + fSize.width <= g.x ||
      g.x + gSize.width <= f.x ||
      f.y + fSize.height <= g.y ||
      g.y + gSize.height <= f.y;
    expect(apart).toBe(true);
  });

  it('makes room for tall entities', async () => {
    const tall = { width: BLOCK_SIZE.width, height: 302 };
    const nodes = [
      node('f', 0, 0, { type: 'frame', size: FRAME_SIZE, diagramType: 'datamodel' }),
      node('user', 40, 60, { frameId: 'f', blockType: 'entity', size: tall }),
      node('project', 40, 60, { frameId: 'f', blockType: 'entity', size: tall }),
      node('member', 40, 60, { frameId: 'f', blockType: 'entity', size: tall }),
    ];
    const { positions } = await computeLayout(elk, nodes, [], 'f');
    const all = [...positions.values()];
    for (const [index, position] of all.entries()) {
      for (const other of all.slice(index + 1)) expect(overlap(position, other, tall)).toBe(false);
    }
  });
});

describe('layout presets', () => {
  it('follows the diagram type, free frames like an architecture', () => {
    expect(layoutPreset('mindmap')).toEqual({ algorithm: 'mrtree', direction: 'RIGHT' });
    expect(layoutPreset('datamodel')).toEqual({ algorithm: 'layered', direction: 'RIGHT' });
    expect(layoutPreset(null)).toEqual(layoutPreset('architecture'));
    expect(layoutPreset('roadmap')).toEqual(layoutPreset('architecture'));
    expect(readsLeftToRight('mindmap')).toBe(true);
    expect(readsLeftToRight('datamodel')).toBe(true);
    expect(readsLeftToRight('flow')).toBe(false);
    expect(readsLeftToRight(null)).toBe(false);
  });
});
