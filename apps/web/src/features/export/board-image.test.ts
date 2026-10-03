import { describe, expect, it } from 'vitest';

import { boardBounds, imageFrame, withBackground } from '@web/features/export/board-image';

/** A viewport as React Flow builds it: nodes placed by a transform, with a size. */
function viewport(nodes: { x: number; y: number; width: number; height: number }[]) {
  const element = document.createElement('div');
  for (const node of nodes) {
    const child = document.createElement('div');
    child.className = 'react-flow__node';
    child.style.transform = `translate(${String(node.x)}px, ${String(node.y)}px)`;
    // jsdom lays nothing out; the size is what the browser would measure.
    Object.defineProperty(child, 'offsetWidth', { value: node.width });
    Object.defineProperty(child, 'offsetHeight', { value: node.height });
    element.append(child);
  }
  // Something that is no element of the board.
  element.append(document.createElement('svg'));
  return element;
}

describe('boardBounds', () => {
  it('covers every element of the board, wherever the view is', () => {
    expect(
      boardBounds(
        viewport([
          { x: 40, y: 60, width: 180, height: 96 },
          { x: -300.5, y: 500, width: 480, height: 320 },
          { x: 900, y: -20, width: 176, height: 124 },
        ]),
      ),
    ).toEqual({ x: -300.5, y: -20, width: 1376.5, height: 840 });
  });

  it('is null for an empty board', () => {
    expect(boardBounds(viewport([]))).toBeNull();
  });
});

describe('imageFrame', () => {
  it('puts the board into the image with room around it', () => {
    expect(imageFrame({ x: -300, y: -20, width: 1400, height: 840 })).toEqual({
      width: 1480,
      height: 920,
      transform: 'translate(340px, 60px) scale(1)',
    });
  });

  it('scales a very large board down to what browsers can draw', () => {
    const frame = imageFrame({ x: 0, y: 0, width: 11920, height: 2920 });

    expect(frame.width).toBe(6000);
    expect(frame.height).toBe(1500);
    expect(frame.transform).toBe('translate(20px, 20px) scale(0.5)');
  });

  it('gives an empty board an image of its own size', () => {
    expect(imageFrame(null)).toEqual({
      width: 560,
      height: 400,
      transform: 'translate(40px, 40px) scale(1)',
    });
  });
});

describe('withBackground', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><foreignObject width="100%" height="100%"><div><foreignObject/></div></foreignObject></svg>';

  it('puts the canvas color behind the whole image, once', () => {
    const result = withBackground(svg, 'white');

    expect(result).toContain(
      '<rect width="100%" height="100%" fill="white"/><foreignObject width="100%"',
    );
    expect(result.match(/<rect/g)).toHaveLength(1);
  });

  it('leaves the image alone when the color is none', () => {
    expect(withBackground(svg, '')).toBe(svg);
    expect(withBackground(svg, 'red"/><script>alert(1)</script>')).toBe(svg);
  });
});
