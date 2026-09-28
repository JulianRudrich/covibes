import { describe, expect, it } from 'vitest';

import { aiRing } from './styles';

describe('aiRing', () => {
  it('builds both shadow layers from the agent color token', () => {
    expect(aiRing('kritiker')).toBe(
      '0 0 0 4px color-mix(in srgb, var(--color-agent-kritiker) 16%, transparent), 0 6px 16px color-mix(in srgb, var(--color-agent-kritiker) 14%, transparent)',
    );
  });
});
