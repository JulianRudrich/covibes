// A board as an image (spec 27a): the whole board as the browser draws it, whatever is in view.

/**
 * An element with this attribute stays out of the image: it is no part of the board, e.g. the
 * cursor of someone else or a proposal that nobody applied.
 */
export const NO_EXPORT = 'data-no-export';

/** Room around the board, in pixels of the canvas. */
const PADDING = 40;
/** The longest side of the image in pixels of the canvas; browsers refuse to draw much more. */
const MAX_SIDE = 6000;
/** An empty board still gives an image. */
const EMPTY = { x: 0, y: 0, width: 480, height: 320 };

export type Bounds = { x: number; y: number; width: number; height: number };

/**
 * The area the elements of a board cover, in the coordinates of the canvas. It is read from where
 * React Flow put the elements, so it does not depend on zoom or on what is in view. Null for an
 * empty board.
 */
export function boardBounds(viewport: HTMLElement): Bounds | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of viewport.querySelectorAll<HTMLElement>('.react-flow__node')) {
    const moved = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(node.style.transform);
    if (!moved) continue;
    const x = Number(moved[1]);
    const y = Number(moved[2]);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + node.offsetWidth);
    bottom = Math.max(bottom, y + node.offsetHeight);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Where the board goes in an image: its size, and how the canvas is moved and scaled into it. */
export function imageFrame(bounds: Bounds | null): {
  width: number;
  height: number;
  transform: string;
} {
  const area = bounds ?? EMPTY;
  const width = area.width + 2 * PADDING;
  const height = area.height + 2 * PADDING;
  // A very large board is scaled down, so the image stays within what browsers can draw.
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  return {
    width: Math.ceil(width * scale),
    height: Math.ceil(height * scale),
    transform: `translate(${String((PADDING - area.x) * scale)}px, ${String((PADDING - area.y) * scale)}px) scale(${String(scale)})`,
  };
}

/**
 * Draws the board into a PNG (twice the resolution of the screen) or an SVG. `viewport` is React
 * Flow's viewport element, which holds every element of the board. The library is loaded when the
 * first image is asked for.
 */
export async function boardImage(viewport: HTMLElement, format: 'png' | 'svg'): Promise<Blob> {
  const { toBlob, toSvg } = await import('html-to-image');
  const frame = imageFrame(boardBounds(viewport));
  const background = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-bg-canvas')
    .trim();
  const options = {
    width: frame.width,
    height: frame.height,
    filter: (node: Node) => !(node instanceof Element && node.hasAttribute(NO_EXPORT)),
    style: {
      width: `${String(frame.width)}px`,
      height: `${String(frame.height)}px`,
      transform: frame.transform,
      transformOrigin: '0 0',
    },
  };

  if (format === 'png') {
    const blob = await toBlob(viewport, {
      ...options,
      pixelRatio: 2,
      ...(background ? { backgroundColor: background } : {}),
    });
    if (!blob) throw new Error('The board could not be drawn');
    return blob;
  }
  // The library gives the SVG as a data address; the file holds what follows its comma.
  const address = await toSvg(viewport, options);
  const svg = decodeURIComponent(address.slice(address.indexOf(',') + 1));
  return new Blob([withBackground(svg, background)], { type: 'image/svg+xml;charset=utf-8' });
}

/**
 * The SVG with the canvas color behind everything. The library would put the color on the canvas
 * element itself, which is moved inside the image and so covers only a part of it.
 */
export function withBackground(svg: string, color: string): string {
  // Only what a color is written with; the value goes into markup.
  if (!/^[#\w(),.%\s-]+$/.test(color)) return svg;
  return svg.replace(
    '<foreignObject',
    `<rect width="100%" height="100%" fill="${color}"/><foreignObject`,
  );
}
