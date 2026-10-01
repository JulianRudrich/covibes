import { describe, expect, it, vi } from 'vitest';

import type { AgentReplyResult } from '@server/ai-gateway';
import { decide, type Intent } from '@server/rules/decide';
import { classifyIntent, INTENT_MODEL } from '@server/rules/intent';

const plain = { allowed: true, proposalsOnly: false, lockedTarget: false };

describe('decide', () => {
  it('runs an instruction directly', () => {
    expect(decide({ ...plain, intent: 'instruction' })).toEqual({ kind: 'direct' });
  });

  it('turns a question and own initiative into a proposal', () => {
    expect(decide({ ...plain, intent: 'question' })).toEqual({
      kind: 'proposal',
      reason: 'question',
    });
    expect(decide({ ...plain, intent: 'initiative' })).toEqual({
      kind: 'proposal',
      reason: 'initiative',
    });
  });

  it('turns an instruction into a proposal in the proposals-only mode', () => {
    expect(decide({ ...plain, intent: 'instruction', proposalsOnly: true })).toEqual({
      kind: 'proposal',
      reason: 'proposals_only',
    });
  });

  it('turns the change of a block someone edits into a proposal', () => {
    expect(decide({ ...plain, intent: 'instruction', lockedTarget: true })).toEqual({
      kind: 'proposal',
      reason: 'locked',
    });
  });

  it('rejects a tool the agent may not use, whatever it was asked', () => {
    for (const intent of ['instruction', 'question', 'initiative'] satisfies Intent[]) {
      expect(decide({ ...plain, allowed: false, intent })).toEqual({ kind: 'reject' });
    }
  });
});

function answer(text: string): AgentReplyResult {
  return {
    text,
    provider: 'anthropic',
    model: INTENT_MODEL,
    usage: { inputTokens: 120, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0.00013,
    webSearches: 0,
  };
}

describe('classifyIntent', () => {
  it('asks the small model and reads its one-word answer', async () => {
    const complete = vi.fn(() => Promise.resolve(answer('Instruction.')));

    const result = await classifyIntent(complete, '@Moderator zeichne die Architektur');

    expect(result).toEqual({
      intent: 'instruction',
      costUsd: 0.00013,
      inputTokens: 120,
      outputTokens: 2,
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        model: INTENT_MODEL,
        prompt: '@Moderator zeichne die Architektur',
      }),
    );
  });

  it('counts anything unclear or failed as a question', async () => {
    for (const text of ['question', 'I think this is an instruction', '', 'yes']) {
      const result = await classifyIntent(() => Promise.resolve(answer(text)), 'Was fehlt?');
      expect(result.intent).toBe('question');
    }
    const failed = await classifyIntent(() => Promise.reject(new Error('offline')), 'Zeichne');
    expect(failed).toEqual({ intent: 'question', costUsd: 0, inputTokens: 0, outputTokens: 0 });
  });
});
