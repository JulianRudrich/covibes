import { describe, expect, it } from 'vitest';

import {
  ARROW_GAP,
  arrowGeometries,
  arrowPath,
  arrowSides,
  type Rect,
} from '@web/features/canvas/arrow-geometry';

const block = (x: number, y: number): Rect => ({ x, y, width: 180, height: 96 });

describe('arrowSides', () => {
  it('goes from the bottom into the top of a block further down', () => {
    expect(arrowSides(block(0, 0), block(300, 200))).toEqual({ from: 'bottom', to: 'top' });
  });

  it('goes from the top into the bottom of a block further up', () => {
    expect(arrowSides(block(0, 300), block(40, 0))).toEqual({ from: 'top', to: 'bottom' });
  });

  it('connects blocks side by side from edge to edge', () => {
    expect(arrowSides(block(0, 0), block(280, 20))).toEqual({ from: 'right', to: 'left' });
    expect(arrowSides(block(280, 20), block(0, 0))).toEqual({ from: 'left', to: 'right' });
  });
});

describe('arrowPath', () => {
  it('uses the sides in diagrams that read from left to right', () => {
    const source = block(0, 0);
    const beside = block(400, 200);
    const below = block(100, 400);
    expect(arrowSides(source, beside)).toEqual({ from: 'bottom', to: 'top' });
    expect(arrowSides(source, beside, true)).toEqual({ from: 'right', to: 'left' });
    expect(arrowSides(beside, source, true)).toEqual({ from: 'left', to: 'right' });
    // A target that lies more below than beside keeps the vertical anchors.
    expect(arrowSides(source, below, true)).toEqual({ from: 'bottom', to: 'top' });
  });

  it('is a straight line between blocks on one line, as "REST" in the handoff', () => {
    expect(arrowPath({ x: 232, y: 132 }, 'right', { x: 326, y: 132 }, 'left')).toEqual({
      path: 'M 232 132 L 326 132',
      label: { x: 279, y: 132 },
    });
  });

  it('is a cubic Bézier that leaves and enters vertically, with the label in its middle', () => {
    const { path, label } = arrowPath({ x: 395, y: 180 }, 'bottom', { x: 142, y: 288 }, 'top');

    expect(path).toBe('M 395 180 C 395 234, 142 234, 142 288');
    expect(label).toEqual({ x: 268.5, y: 234 });
  });

  it('keeps a minimum curve for blocks that are close', () => {
    expect(arrowPath({ x: 0, y: 0 }, 'bottom', { x: 100, y: 20 }, 'top').path).toBe(
      'M 0 0 C 0 30, 100 -10, 100 20',
    );
  });
});

describe('arrowGeometries', () => {
  it('spreads arrows on the same edge of a block, ordered by their other ends', () => {
    const rects = new Map([
      ['server', block(330, 84)],
      ['gitlab', block(52, 292)],
      ['db', block(274, 292)],
      ['gateway', block(496, 292)],
    ]);
    const edges = [
      { id: 'api', source: 'server', target: 'gateway' },
      { id: 'jobs', source: 'server', target: 'gitlab' },
      { id: 'data', source: 'server', target: 'db' },
    ];

    const geometries = arrowGeometries(edges, rects);

    // The bottom edge of the server (330 to 510) at 1/4, 2/4 and 3/4, left to right.
    expect(geometries.get('jobs')?.source).toEqual({ x: 375, y: 180 });
    expect(geometries.get('data')?.source).toEqual({ x: 420, y: 180 });
    expect(geometries.get('api')?.source).toEqual({ x: 465, y: 180 });
  });

  it('stops short of the target, so the tip of the arrowhead touches its edge', () => {
    const rects = new Map([
      ['a', block(0, 0)],
      ['b', block(0, 300)],
    ]);

    const geometry = arrowGeometries([{ id: 'e', source: 'a', target: 'b' }], rects).get('e');

    expect(geometry?.source).toEqual({ x: 90, y: 96 });
    expect(geometry?.target).toEqual({ x: 90, y: 300 - ARROW_GAP });
  });

  it('leaves out arrows whose ends are not known', () => {
    const rects = new Map([['a', block(0, 0)]]);

    expect(arrowGeometries([{ id: 'e', source: 'a', target: 'gone' }], rects).size).toBe(0);
  });
});
