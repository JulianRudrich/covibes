import type { DB } from '@covibes/db';
import type { Kysely } from 'kysely';

import { createDirectGateway } from '@server/ai-gateway/direct';
import { selectProviderRoute } from '@server/ai-gateway/routing';
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
    providerEnv?: Parameters<typeof selectProviderRoute>[0];
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
      async (trx, workspaceId) => {
        if (!options.providerEnv) {
          return {
            payer: 'instance' as const,
            provider: 'anthropic' as const,
            model: request.model,
            mode: 'sdk' as const,
          };
        }
        const keys = await trx
          .selectFrom('workspace_provider_keys')
          .select(['provider', 'ciphertext'])
          .where('workspace_id', '=', workspaceId)
          .execute();
        return selectProviderRoute(options.providerEnv, workspaceId, keys, request);
      },
    );
    if (attempt.warning) options.onWarning(attempt.warning);
    let result: AgentReplyResult;
    try {
      const input = { ...request, model: attempt.route.model, maxCostUsd: options.maxCallUsd };
      if (attempt.route.mode === 'direct') {
        if (!attempt.route.apiKey) throw new GatewayConfigError('Provider credential is missing');
        const direct = createDirectGateway(attempt.route.provider, attempt.route.apiKey);
        result =
          'tools' in input
            ? await direct.reply(input as unknown as AgentReplyRequest)
            : await direct.complete(input);
      } else {
        result = await call(input);
      }
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
