import { AGENT_MODELS } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { estimateCostUsd, resolveModel } from '@server/ai-gateway/registry';
import { GatewayConfigError } from '@server/ai-gateway/types';

describe('resolveModel', () => {
  it('knows Claude Opus 5.5 with its list prices', () => {
    expect(resolveModel('claude-opus-5-5')).toEqual({
      id: 'claude-opus-5-5',
      provider: 'anthropic',
      prices: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      effort: true,
    });
  });

  it('knows Claude Haiku 4.5 for short classifications, without an effort level', () => {
    expect(resolveModel('claude-haiku-4-5-20251001')).toEqual({
      id: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
      prices: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      effort: false,
    });
  });

  it('knows Claude Sonnet 5.5 and every model an owner can choose (spec 14)', () => {
    expect(resolveModel('claude-sonnet-5-5')).toMatchObject({
      prices: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      effort: true,
    });
    for (const model of AGENT_MODELS) expect(resolveModel(model).id).toBe(model);
  });

  it('registers direct GPT models with distinct cached token pricing', () => {
    expect(resolveModel('gpt-4.1')).toMatchObject({
      provider: 'openai',
      prices: { input: 2, output: 8, cacheRead: 0.5 },
    });
    expect(resolveModel('gpt-4.1-mini')).toMatchObject({
      provider: 'openai',
      prices: { input: 0.4, output: 1.6, cacheRead: 0.1 },
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
