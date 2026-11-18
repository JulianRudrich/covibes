import type { DB } from '@covibes/db';
import type { Kysely } from 'kysely';

import {
  GatewayConfigError,
  readGatewayAttemptUsage,
  type AgentReplyRequest,
  type AgentReplyResult,
  type CompleteRequest,
} from '@server/ai-gateway/types';
import { reserveAttempt, settleAttempt, type BudgetWarning } from '@server/usage/attempts';
import type { UsageLimits } from '@server/usage/limits';

/** The provider stays unaware of PostgreSQL; production workers always use this wrapper. */
export function createBudgetGateway(
  options: {
    admin: Kysely<DB>;
    limits: UsageLimits;
    maxCallUsd: number;
    now?: () => Date;
    onWarning: (warning: BudgetWarning) => void;
  },
  provider: {
    reply: (request: AgentReplyRequest) => Promise<AgentReplyResult>;
    complete: (request: CompleteRequest) => Promise<AgentReplyResult>;
  },
) {
  async function invoke<Request extends CompleteRequest>(
    request: Request,
    call: (input: Request) => Promise<AgentReplyResult>,
  ): Promise<AgentReplyResult> {
    request.signal?.throwIfAborted();
    if (!request.billing) throw new GatewayConfigError('A model call needs billing context');
    const attempt = await reserveAttempt(
      options.admin,
      {
        ...request.billing,
        model: request.model,
        maxCostUsd: options.maxCallUsd,
      },
      options.limits,
      options.now?.(),
    );
    if (attempt.warning) options.onWarning(attempt.warning);
    let result: AgentReplyResult;
    try {
      result = await call({ ...request, maxCostUsd: options.maxCallUsd });
    } catch (error) {
      await settleAttempt(
        options.admin,
        attempt.id,
        request.signal?.aborted ? 'cancelled' : 'failed',
        readGatewayAttemptUsage(error),
      );
      throw error;
    }
    await settleAttempt(options.admin, attempt.id, 'succeeded', result);
    return result;
  }
  return {
    reply: (request: AgentReplyRequest) => invoke(request, provider.reply),
    complete: (request: CompleteRequest) => invoke(request, provider.complete),
  };
}
