import { describe, expect, it } from 'vitest';

import { estimateCostUsd, resolveModel } from '@server/ai-gateway/registry';
import { GatewayConfigError } from '@server/ai-gateway/types';

describe('resolveModel', () => {
  it('knows Claude Opus 5.5 with its list prices', () => {
    expect(resolveModel('claude-opus-5-5')).toEqual({
      id: 'claude-opus-5-5',
      provider: 'anthropic',
      prices: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    });
  });

  it('rejects an unknown model as a configuration error', () => {
    expect(() => resolveModel('claude-opus-9')).toThrow(GatewayConfigError);
    expect(() => resolveModel('claude-opus-9')).toThrow(/claude-opus-9.*claude-opus-5-5/);
  });
});

describe('estimateCostUsd', () => {
  it('prices every kind of token per million', () => {
    const { prices } = resolveModel('claude-opus-5-5');
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 200_000,
    };
    // $4 + $2 + $0.20 + $1
    expect(estimateCostUsd(prices, usage)).toBeCloseTo(7.2, 10);
  });
});
