import { describe, expect, it } from 'vitest';

import { aiRing } from './styles';

describe('aiRing', () => {
  it('builds both shadow layers from the agent color token', () => {
    expect(aiRing({ look: 'critic', color: null })).toBe(
      '0 0 0 4px color-mix(in srgb, var(--color-agent-critic) 16%, transparent), 0 6px 16px color-mix(in srgb, var(--color-agent-critic) 14%, transparent)',
    );
  });

  it('uses the chosen custom color for a custom agent (spec 19)', () => {
    expect(aiRing({ look: 'custom', color: 3 })).toContain('var(--color-agent-custom-3) 16%');
  });
});
