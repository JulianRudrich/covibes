import { GatewayConfigError, type AgentReplyUsage } from '@server/ai-gateway/types';

/** List prices in USD per million tokens. */
export type ModelPrices = {
  input: number;
  output: number;
  cacheRead: number;
  /** Writing the prompt cache with the 5-minute lifetime. */
  cacheWrite: number;
};

export type ModelInfo = {
  /** The id agents are configured with and the provider receives, e.g. `claude-opus-5-5`. */
  id: string;
  provider: 'anthropic';
  prices: ModelPrices;
  /** Whether the model takes an effort level; small models answer without one. */
  effort: boolean;
};

// Prices from https://platform.claude.com/docs/en/about-claude/pricing, checked on 2026-09-30.
// They only price a run when the provider reports no cost of its own.
const MODELS: readonly ModelInfo[] = [
  {
    id: 'claude-opus-5-5',
    provider: 'anthropic',
    prices: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    effort: true,
  },
  // An owner's choice for agents (spec 14).
  {
    id: 'claude-sonnet-5-5',
    provider: 'anthropic',
    prices: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    effort: true,
  },
  // Small and fast, for short classifications such as the intent of a message (spec 13).
  {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    prices: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    effort: false,
  },
];

/** The registered model with this id; an unknown id throws `GatewayConfigError`. */
export function resolveModel(id: string): ModelInfo {
  const model = MODELS.find((entry) => entry.id === id);
  if (!model) {
    const known = MODELS.map((entry) => entry.id).join(', ');
    throw new GatewayConfigError(`Unknown model "${id}" (known models: ${known})`);
  }
  return model;
}

/** Cost of the usage at the model's list prices, in USD. */
export function estimateCostUsd(prices: ModelPrices, usage: AgentReplyUsage): number {
  return (
    (usage.inputTokens * prices.input +
      usage.outputTokens * prices.output +
      usage.cacheReadTokens * prices.cacheRead +
      usage.cacheWriteTokens * prices.cacheWrite) /
    1_000_000
  );
}
