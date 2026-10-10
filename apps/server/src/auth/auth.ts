import {
  acceptedLanguages,
  isLanguage,
  languageSchema,
  pickLanguage,
  type Language,
} from '@covibes/shared';
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

/**
 * The language the browser of a request prefers (spec 32a): German or English, English for
 * someone who prefers neither. Undefined when the request names no language at all, e.g. a
 * script; then the default of the accounts holds.
 */
export function requestLanguage(headers: Headers | undefined): Language | undefined {
  const preferred = acceptedLanguages(headers?.get('accept-language') ?? '');
  return preferred.length > 0 ? pickLanguage(preferred) : undefined;
}

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
        // The person's language (spec 32a): they set it themselves, to a language Covibes speaks.
        locale: {
          type: 'string',
          required: false,
          defaultValue: 'de',
          input: true,
          validator: { input: languageSchema },
        },
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
          // A new account starts in the language its browser prefers (spec 32a).
          before: (user, context) => {
            const locale = requestLanguage(context?.headers);
            return Promise.resolve({
              data: {
                ...user,
                name: user.name.trim() || (user.email.split('@')[0] ?? ''),
                ...(locale ? { locale } : {}),
              },
            });
          },
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
            // The page that asks for the link names its language (spec 32a); the mail is
            // written in it, else in the language the browser prefers.
            sendMagicLink: async ({ email, url, metadata }, context) => {
              const named: unknown = metadata?.language;
              const locale = isLanguage(named) ? named : requestLanguage(context?.headers);
              await mailer.send(
                magicLinkMail({ to: email, url, minutes: MAGIC_LINK_MINUTES, locale }),
              );
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
