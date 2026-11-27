import type { Node } from '@xyflow/react';

/**
 * The board overview of spec 48 in the Studio look (spec 56): token colors only, so it follows
 * the theme. Outside the view the overview is dimmed with the subtle surface; the view is outlined.
 */
export const MINIMAP_COLORS = {
  background: 'var(--color-bg-panel)',
  mask: 'color-mix(in srgb, var(--color-bg-subtle) 72%, transparent)',
  view: 'var(--color-text-3)',
} as const;

/** Smaller than React Flow's default, so it fits above the toolbar on a narrow canvas. */
export const MINIMAP_SIZE = { width: 168, height: 112 } as const;

/** Blocks as quiet shapes, frames in their own color and notes in the note color. */
export function minimapNodeColor(node: Pick<Node, 'type'>): string {
  switch (node.type) {
    case 'frame':
      return 'var(--color-bg-frame)';
    case 'sticky':
      return 'var(--color-note)';
    default:
      return 'var(--color-border-strong)';
  }
}

/** Only frames have an outline, as on the board. */
export function minimapNodeStroke(node: Pick<Node, 'type'>): string {
  return node.type === 'frame' ? 'var(--color-frame-border)' : 'transparent';
}
