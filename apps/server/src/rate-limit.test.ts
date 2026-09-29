import { afterEach, describe, expect, it } from 'vitest';

import { createRateLimiter, type RateLimiter } from '@server/rate-limit';

let limiter: RateLimiter | undefined;
afterEach(() => {
  limiter?.stop();
});

describe('createRateLimiter', () => {
  it('allows up to the limit within the window', () => {
    limiter = createRateLimiter({ limit: 2, windowMs: 1_000 });
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 100)).toBe(true);
    expect(limiter.take('a', 200)).toBe(false);
  });

  it('counts every key on its own', () => {
    limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('b', 0)).toBe(true);
    expect(limiter.take('a', 10)).toBe(false);
  });

  it('allows again once old hits left the window', () => {
    limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 999)).toBe(false);
    expect(limiter.take('a', 1_000)).toBe(true);
  });
});
