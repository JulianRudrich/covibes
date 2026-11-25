import { describe, expect, it } from 'vitest';

import { selectProviderRoute } from '@server/ai-gateway/routing';
import { sealToken } from '@server/integrations/gitlab/crypto';

const workspace = 'fixture-workspace-id';
const tokenKey = 'fixture-sealing-key'.repeat(3);
const key = {
  provider: 'openai',
  ciphertext: sealToken(tokenKey, 'workspace-secret', 'ai:' + workspace + ':openai'),
};
const env = {
  NODE_ENV: 'production' as const,
  TOKEN_KEY: tokenKey,
  ANTHROPIC_API_KEY: 'instance-a',
  OPENAI_API_KEY: 'instance-o',
};

describe('provider and payer selection', () => {
  it('uses the workspace credential and adapts default and small models to its provider', () => {
    expect(selectProviderRoute(env, workspace, [key], { model: 'claude-opus-5-5' })).toMatchObject({
      payer: 'workspace',
      provider: 'openai',
      model: 'gpt-4.1',
      apiKey: 'workspace-secret',
    });
    expect(
      selectProviderRoute(env, workspace, [key], { model: 'claude-haiku-4-5-20251001' }),
    ).toMatchObject({ model: 'gpt-4.1-mini', payer: 'workspace' });
    expect(
      selectProviderRoute(env, workspace, [key], { model: 'gpt-4.1-mini', fixedModel: true }),
    ).toMatchObject({ model: 'gpt-4.1-mini', payer: 'workspace' });
    expect(() =>
      selectProviderRoute(env, workspace, [key], { model: 'claude-sonnet-5-5', fixedModel: true }),
    ).toThrow(/workspace/i);
  });
  it('fails closed on a corrupt or transplanted key; missing keys use instance credit', () => {
    expect(() => selectProviderRoute(env, 'other-workspace', [key], { model: 'gpt-4.1' })).toThrow(
      /credential/i,
    );
    expect(selectProviderRoute(env, workspace, [], { model: 'gpt-4.1' })).toMatchObject({
      payer: 'instance',
      apiKey: 'instance-o',
      mode: 'direct',
    });
    expect(
      selectProviderRoute({ NODE_ENV: 'development' }, workspace, [], { model: 'claude-opus-5-5' }),
    ).toMatchObject({ payer: 'instance', mode: 'sdk' });
    expect(() =>
      selectProviderRoute({ NODE_ENV: 'production' }, workspace, [], { model: 'claude-opus-5-5' }),
    ).toThrow(/credential/i);
  });
});
