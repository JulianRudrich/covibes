import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import type pg from 'pg';

import type { ServerEnv } from '@server/env';
import type { Mailer } from '@server/integrations/mail/mailer';
import { magicLinkMail } from '@server/integrations/mail/templates';

export const MAGIC_LINK_MINUTES = 10;
export const AUTH_BASE_PATH = '/api/auth';

type AuthDeps = {
  env: Pick<
    ServerEnv,
    | 'APP_URL'
    | 'BETTER_AUTH_SECRET'
    | 'NODE_ENV'
    | 'GITLAB_CLIENT_ID'
    | 'GITLAB_CLIENT_SECRET'
    | 'GITLAB_ISSUER'
    | 'TRUSTED_PROXIES'
  >;
  /** Admin role: the login tables belong to it and are not reachable for covibes_app. */
  adminPool: pg.Pool;
  /** Without a mailer (production without SMTP) there is no login by mail. */
  mailer: Mailer | undefined;
};

export function gitlabLoginEnabled(env: AuthDeps['env']): boolean {
  return Boolean(env.GITLAB_CLIENT_ID && env.GITLAB_CLIENT_SECRET);
}

/** Better Auth options; table and column names follow our snake_case conventions. */
export function authOptions({ env, adminPool, mailer }: AuthDeps) {
  return {
    appName: 'Covibes',
    baseURL: env.APP_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: adminPool,
    emailAndPassword: { enabled: false },
    user: {
      modelName: 'users',
      fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
      additionalFields: {
        locale: { type: 'string', required: false, defaultValue: 'de', input: false },
      },
    },
    session: {
      modelName: 'sessions',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        userId: 'user_id',
      },
    },
    account: {
      modelName: 'accounts',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'verifications',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    databaseHooks: {
      user: {
        create: {
          // The login link does not ask for a name. Other members see the start of the address
          // until profiles exist; the full address stays hidden from them.
          before: (user) =>
            Promise.resolve({
              data: { ...user, name: user.name.trim() || (user.email.split('@')[0] ?? '') },
            }),
        },
      },
    },
    advanced: {
      database: { generateId: 'uuid' },
      cookiePrefix: 'covibes',
      useSecureCookies: env.NODE_ENV === 'production',
      // Behind a reverse proxy that appends to X-Forwarded-For (spec 02b).
      ...(env.TRUSTED_PROXIES.length ? { ipAddress: { trustedProxies: env.TRUSTED_PROXIES } } : {}),
    },
    rateLimit: { enabled: env.NODE_ENV !== 'test', window: 60, max: 100 },
    socialProviders: gitlabLoginEnabled(env)
      ? {
          gitlab: {
            clientId: env.GITLAB_CLIENT_ID ?? '',
            clientSecret: env.GITLAB_CLIENT_SECRET ?? '',
            ...(env.GITLAB_ISSUER ? { issuer: env.GITLAB_ISSUER } : {}),
          },
        }
      : {},
    plugins: mailer
      ? [
          magicLink({
            expiresIn: MAGIC_LINK_MINUTES * 60,
            sendMagicLink: async ({ email, url }) => {
              await mailer.send(magicLinkMail({ to: email, url, minutes: MAGIC_LINK_MINUTES }));
            },
          }),
        ]
      : [],
  } satisfies BetterAuthOptions;
}

export function createAuth(deps: AuthDeps) {
  return betterAuth(authOptions(deps));
}

export type Auth = ReturnType<typeof createAuth>;
