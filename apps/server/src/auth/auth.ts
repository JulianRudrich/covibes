import {
  acceptedLanguages,
  isLanguage,
  languageSchema,
  pickLanguage,
  type Language,
} from '@covibes/shared';
import { passkey } from '@better-auth/passkey';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { emailOTP, magicLink } from 'better-auth/plugins';
import type pg from 'pg';

import { requireBetaAccess } from '@server/auth/beta-access';
import { accountTwoFactor } from '@server/auth/two-factor';
import type { ServerEnv } from '@server/env';
import type { Mailer } from '@server/integrations/mail/mailer';
import {
  accountDeletionMail,
  emailCodeMail,
  magicLinkMail,
} from '@server/integrations/mail/templates';

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
    | 'GITHUB_CLIENT_ID'
    | 'GITHUB_CLIENT_SECRET'
    | 'GOOGLE_CLIENT_ID'
    | 'GOOGLE_CLIENT_SECRET'
    | 'BETA_ALLOWED_EMAILS'
  >;
  /** Admin role: the login tables belong to it and are not reachable for covibes_app. */
  adminPool: pg.Pool;
  /** Without a mailer (production without SMTP) there is no login by mail. */
  mailer: Mailer | undefined;
  /** Read-only preflight. The database deletion transaction preserves ownership and queues file cleanup. */
  beforeDeleteUser?: (userId: string) => Promise<void>;
  /** Runs after the user deletion commits, to close active connections. */
  afterDeleteUser?: (userId: string) => Promise<void>;
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
export function authOptions({
  env,
  adminPool,
  mailer,
  beforeDeleteUser,
  afterDeleteUser,
}: AuthDeps) {
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
      deleteUser: {
        enabled: true,
        deleteTokenExpiresIn: 600,
        ...(mailer
          ? {
              sendDeleteAccountVerification: async ({ user, url }, request) => {
                await mailer.send(
                  accountDeletionMail({
                    to: user.email,
                    url,
                    locale: requestLanguage(request?.headers),
                  }),
                );
              },
            }
          : {}),
        beforeDelete: async (user) => {
          if (beforeDeleteUser) return beforeDeleteUser(user.id);
          // Until the workspace cleanup service is supplied, never orphan a project or its files.
          const owned = await adminPool.query(
            'select 1 from projects where owner_id = $1 limit 1',
            [user.id],
          );
          if (owned.rowCount) {
            throw new APIError('CONFLICT', {
              code: 'LAST_OWNER',
              message: 'Transfer or remove owned projects before deleting the account.',
            });
          }
        },
        afterDelete: async (user) => {
          await afterDeleteUser?.(user.id);
        },
      },
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
      freshAge: 300,
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
          before: async (user, context) => {
            await requireBetaAccess({
              production: env.NODE_ENV === 'production',
              email: user.email,
              verified: user.emailVerified,
              allowed: env.BETA_ALLOWED_EMAILS,
              adminPool,
            });
            const locale = requestLanguage(context?.headers);
            return Promise.resolve({
              data: {
                ...user,
                name: (user.name.trim() || (user.email.split('@')[0] ?? '')).slice(0, 80),
                ...(locale ? { locale } : {}),
              },
            });
          },
        },
        update: {
          before: (user) => {
            if (user.name !== undefined) {
              const name = user.name.trim();
              if (!name || name.length > 80)
                throw new APIError('BAD_REQUEST', {
                  code: 'INVALID_NAME',
                  message: 'The name must contain between 1 and 80 characters.',
                });
              return Promise.resolve({ data: { ...user, name } });
            }
            return Promise.resolve({ data: user });
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
    socialProviders: {
      ...(gitlabLoginEnabled(env)
        ? {
            gitlab: {
              clientId: env.GITLAB_CLIENT_ID ?? '',
              clientSecret: env.GITLAB_CLIENT_SECRET ?? '',
              ...(env.GITLAB_ISSUER ? { issuer: env.GITLAB_ISSUER } : {}),
            },
          }
        : {}),
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
        : {}),
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {}),
    },
    plugins: [
      accountTwoFactor(env.APP_URL),
      passkey({
        rpID: new URL(env.APP_URL).hostname,
        rpName: 'Covibes',
        origin: new URL(env.APP_URL).origin,
        schema: {
          passkey: {
            modelName: 'account_passkeys',
            fields: {
              publicKey: 'public_key',
              userId: 'user_id',
              credentialID: 'credential_id',
              deviceType: 'device_type',
              backedUp: 'backed_up',
              createdAt: 'created_at',
            },
          },
        },
      }),
      ...(mailer
        ? [
            emailOTP({
              expiresIn: MAGIC_LINK_MINUTES * 60,
              allowedAttempts: 3,
              storeOTP: 'hashed',
              sendVerificationOTP: async ({ email, otp }, context) => {
                await mailer.send(
                  emailCodeMail({
                    to: email,
                    code: otp,
                    minutes: MAGIC_LINK_MINUTES,
                    locale: requestLanguage(context?.headers),
                  }),
                );
              },
            }),
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
        : []),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(deps: AuthDeps) {
  return betterAuth(authOptions(deps));
}

export type Auth = ReturnType<typeof createAuth>;
