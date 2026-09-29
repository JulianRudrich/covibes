/**
 * Sliding-window limit per key (e.g. a user id), kept in memory. Enough for a single server; the
 * limits of spec 31 (per project and user, stored in the database) replace it for money matters.
 */
export function createRateLimiter(options: { limit: number; windowMs: number }) {
  const hits = new Map<string, number[]>();

  /** Counts one hit for `key`; false if the key already used up its limit in the window. */
  function take(key: string, now = Date.now()): boolean {
    const recent = (hits.get(key) ?? []).filter((time) => now - time < options.windowMs);
    if (recent.length >= options.limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  }

  // Forget keys without recent hits, so the map does not grow with every user ever seen.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, times] of hits) {
      if (times.every((time) => now - time >= options.windowMs)) hits.delete(key);
    }
  }, options.windowMs);
  sweep.unref();

  return {
    take,
    stop() {
      clearInterval(sweep);
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
