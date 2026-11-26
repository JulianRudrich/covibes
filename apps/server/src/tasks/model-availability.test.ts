import { describe, expect, it, vi } from 'vitest';

import { GatewayConfigError } from '@server/ai-gateway/types';
import { createModelAvailability } from '@server/tasks/model-availability';
import { UsageLimitError } from '@server/usage/limits';

describe('model capability circuit breaker (spec 41)', () => {
  it('backs off configuration failures and probes again after the cooldown', async () => {
    let now = 1_000;
    const models = createModelAvailability({ now: () => now, cooldownMs: 100 });
    const provider = vi.fn(() => Promise.reject(new GatewayConfigError('not configured')));
    await expect(models.call(provider)).rejects.toThrow('not configured');
    await expect(models.call(provider)).rejects.toThrow('temporarily unavailable');
    expect(provider).toHaveBeenCalledTimes(1);
    expect(models.state()).toEqual({ available: false, retryAt: new Date(1_100) });
    now = 1_101;
    await expect(models.call(() => Promise.resolve('answer'))).resolves.toBe('answer');
    expect(models.state()).toEqual({ available: true, retryAt: null });
  });

  it('does not turn a person’s budget limit into a provider outage', async () => {
    const models = createModelAvailability();
    await models.call(() => Promise.resolve('available'));
    await expect(
      models.call(() => Promise.reject(new UsageLimitError('user', new Date()))),
    ).rejects.toBeInstanceOf(UsageLimitError);
    await expect(models.call(() => Promise.resolve('another person'))).resolves.toBe(
      'another person',
    );
    expect(models.state()).toEqual({ available: true, retryAt: null });
  });

  it('opens after repeated temporary failures without restricting unrelated work', async () => {
    const models = createModelAvailability();
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(
        models.call(() => Promise.reject(new Error('provider offline'))),
      ).rejects.toThrow('offline');
    }
    const provider = vi.fn(() => Promise.resolve('not called'));
    await expect(models.call(provider)).rejects.toBeInstanceOf(GatewayConfigError);
    expect(provider).not.toHaveBeenCalled();
  });
});
