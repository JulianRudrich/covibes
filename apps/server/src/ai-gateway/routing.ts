import type { AiProvider } from '@covibes/shared';

import { resolveModel } from '@server/ai-gateway/registry';
import { GatewayConfigError, type CompleteRequest } from '@server/ai-gateway/types';
import { openToken } from '@server/integrations/gitlab/crypto';

export type ProviderRoute = {
  payer: 'workspace' | 'instance';
  provider: AiProvider;
  model: string;
  mode: 'sdk' | 'direct';
  apiKey?: string;
};

type ProviderEnv = {
  NODE_ENV: 'production' | 'development' | 'test';
  TOKEN_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
};

export function selectProviderRoute(
  env: ProviderEnv,
  workspaceId: string,
  keys: { provider: string; ciphertext: string }[],
  request: Pick<CompleteRequest, 'model' | 'fixedModel'>,
): ProviderRoute {
  let model = resolveModel(request.model);
  let key = keys.find((entry) => entry.provider === model.provider);
  if (!key && keys.length === 1 && !request.fixedModel) {
    const provider = keys[0]?.provider;
    const small = model.id === 'claude-haiku-4-5-20251001' || model.id === 'gpt-4.1-mini';
    const mapped =
      provider === 'openai'
        ? small
          ? 'gpt-4.1-mini'
          : 'gpt-4.1'
        : provider === 'anthropic'
          ? small
            ? 'claude-haiku-4-5-20251001'
            : 'claude-opus-5-5'
          : undefined;
    if (!mapped) throw new GatewayConfigError('Unknown workspace provider');
    model = resolveModel(mapped);
    key = keys[0];
  }
  if (keys.length && !key)
    throw new GatewayConfigError('The workspace has no credential for the selected model');
  if (key) {
    if (!env.TOKEN_KEY)
      throw new GatewayConfigError('Workspace credential encryption is unavailable');
    try {
      const apiKey = openToken(
        env.TOKEN_KEY,
        key.ciphertext,
        'ai:' + workspaceId + ':' + model.provider,
      );
      if (!apiKey.trim()) throw new Error('Empty credential');
      return {
        payer: 'workspace',
        provider: model.provider,
        model: model.id,
        mode: 'direct',
        apiKey,
      };
    } catch {
      throw new GatewayConfigError('The workspace credential cannot be opened');
    }
  }
  const apiKey = model.provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  if (apiKey)
    return { payer: 'instance', provider: model.provider, model: model.id, mode: 'direct', apiKey };
  if (model.provider === 'anthropic' && env.NODE_ENV !== 'production') {
    return { payer: 'instance', provider: model.provider, model: model.id, mode: 'sdk' };
  }
  throw new GatewayConfigError('The provider credential is not configured');
}
