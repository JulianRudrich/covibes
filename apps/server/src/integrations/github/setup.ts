import { z } from 'zod';

import type { GithubSetup } from '@server/integrations/github/client';

export const GITHUB_CALLBACK_PATH = '/api/github/callback';
export const GITHUB_WEBHOOK_PATH = '/api/github/webhook';

export const githubEnvFields = {
  GITHUB_APP_ID: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  GITHUB_APP_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  GITHUB_APP_SLUG: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/)
    .optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().min(32).optional(),
};

export type GithubEnv = Partial<Record<keyof typeof githubEnvFields, string>> & {
  APP_URL: string;
  TOKEN_KEY?: string | undefined;
};

export function githubConfigurationComplete(env: GithubEnv): boolean {
  const values = Object.keys(githubEnvFields).map(
    (name) => env[name as keyof typeof githubEnvFields],
  );
  return values.every((value) => !value) || (values.every(Boolean) && Boolean(env.TOKEN_KEY));
}

export function githubSetup(env: GithubEnv): GithubSetup | undefined {
  if (!env.GITHUB_APP_ID) return undefined;
  if (!githubConfigurationComplete(env))
    throw new Error('GitHub App configuration must be complete and include TOKEN_KEY');
  return {
    appId: env.GITHUB_APP_ID,
    clientId: env.GITHUB_APP_CLIENT_ID ?? '',
    clientSecret: env.GITHUB_APP_CLIENT_SECRET ?? '',
    privateKey: env.GITHUB_APP_PRIVATE_KEY ?? '',
    slug: env.GITHUB_APP_SLUG ?? '',
    webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET ?? '',
    tokenKey: env.TOKEN_KEY ?? '',
    redirectUri: `${env.APP_URL.replace(/\/+$/, '')}${GITHUB_CALLBACK_PATH}`,
  };
}
