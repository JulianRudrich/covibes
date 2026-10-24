import { describe, expect, it } from 'vitest';

import { aiGlow, aiRing } from './styles';

describe('aiRing', () => {
  it('builds the ring and both glow layers from the agent color token', () => {
    expect(aiRing({ look: 'critic', color: null })).toBe(
      '0 0 0 2px var(--color-agent-critic), 0 0 0 7px color-mix(in srgb, var(--color-agent-critic) 18%, transparent), 0 10px 24px color-mix(in srgb, var(--color-agent-critic) 18%, transparent)',
    );
  });

  it('uses the chosen custom color for a custom agent (spec 19)', () => {
    expect(aiRing({ look: 'custom', color: 3 })).toContain('0 0 0 2px var(--color-agent-custom-3)');
    expect(aiGlow({ look: 'custom', color: 3 })).toContain('var(--color-agent-custom-3) 18%');
  });
});
