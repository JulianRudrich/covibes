import { describe, expect, it } from 'vitest';

import { MINIMAP_COLORS, minimapNodeColor, minimapNodeStroke } from '@web/features/canvas/minimap';

describe('board overview colors (spec 56)', () => {
  it('draws blocks, frames and notes in their Studio colors', () => {
    expect(minimapNodeColor({ type: 'block' })).toBe('var(--color-border-strong)');
    expect(minimapNodeColor({ type: 'frame' })).toBe('var(--color-bg-frame)');
    expect(minimapNodeColor({ type: 'sticky' })).toBe('var(--color-note)');
    expect(minimapNodeColor({ type: undefined })).toBe('var(--color-border-strong)');
  });

  it('outlines only frames', () => {
    expect(minimapNodeStroke({ type: 'frame' })).toBe('var(--color-frame-border)');
    expect(minimapNodeStroke({ type: 'block' })).toBe('transparent');
  });

  it('uses tokens only, so both themes follow', () => {
    for (const color of Object.values(MINIMAP_COLORS)) expect(color).toContain('var(--color-');
  });
});
