import { GatewayConfigError, GatewayLimitError } from '@server/ai-gateway/types';
import { UsageLimitError } from '@server/usage/limits';

/** A provider outage pauses model calls, not the runner which also sends mail and handles Git. */
export function createModelAvailability(options: { cooldownMs?: number; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? 60_000;
  let retryAt: number | null = null;
  let available = false;
  let failures = 0;
  let probe: Promise<unknown> | undefined;

  async function call<T>(perform: () => Promise<T>): Promise<T> {
    if (retryAt !== null && now() < retryAt) {
      throw new GatewayConfigError(
        'AI access is temporarily unavailable; background jobs continue',
      );
    }
    // After an outage one call probes the provider; other calls wait instead of stampeding it.
    if (retryAt !== null && probe) {
      await probe.catch(() => undefined);
      return call(perform);
    }
    const attempt = Promise.resolve().then(perform);
    if (retryAt !== null) probe = attempt;
    try {
      const result = await attempt;
      available = true;
      failures = 0;
      retryAt = null;
      return result;
    } catch (error) {
      if (
        error instanceof UsageLimitError ||
        (error instanceof Error && error.name === 'AbortError')
      )
        throw error;
      failures++;
      if (
        error instanceof GatewayConfigError ||
        error instanceof GatewayLimitError ||
        failures >= 3
      ) {
        available = false;
        retryAt = Math.max(
          now() + cooldownMs,
          error instanceof GatewayLimitError ? (error.resetsAt?.getTime() ?? 0) : 0,
        );
      }
      throw error;
    } finally {
      if (probe === attempt) probe = undefined;
    }
  }

  return {
    call,
    state: () => ({ available, retryAt: retryAt === null ? null : new Date(retryAt) }),
  };
}
