import { COLLAB_PATH, defineEnv } from '@covibes/shared';
import { z } from 'zod';

import { usageLimitsEnv } from '@server/usage/limits';

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    // Local development stays on this machine; the Docker image sets HOST=0.0.0.0 (spec 02b).
    HOST: z.string().min(1).default('127.0.0.1'),
    /** Public address of the web app; the API is reachable under `${APP_URL}/api`. */
    APP_URL: z.url().default('http://localhost:5173'),
    /** Role covibes_app: every request on behalf of a user (RLS applies). */
    DATABASE_URL: z.url(),
    /** Role covibes_admin: login library, migrations, worker. */
    DATABASE_ADMIN_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    /**
     * WebSocket path of the collaboration server; below `/api`, so the web app's proxy covers it.
     * The web app connects to `COLLAB_PATH` from `@covibes/shared`; only tests use another value.
     */
    COLLAB_PATH: z.string().startsWith('/').default(COLLAB_PATH),
    GITLAB_CLIENT_ID: z.string().min(1).optional(),
    GITLAB_CLIENT_SECRET: z.string().min(1).optional(),
    /** Only for a self-hosted GitLab; defaults to gitlab.com. */
    GITLAB_ISSUER: z.url().optional(),
    /**
     * Key for the tokens of GitLab connections (spec 28a), shared with the worker. Unset, no
     * project can connect a repository. Changing it makes every stored token unreadable.
     */
    TOKEN_KEY: z.string().min(32).optional(),
    /** Mail delivery in production, e.g. `smtps://user:password@mail.example.com:465`. */
    SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
    /** Sender of all mails, e.g. `Covibes <no-reply@example.com>`. */
    MAIL_FROM: z.string().min(3).optional(),
    /** Comma-separated addresses of reverse proxies that append to `X-Forwarded-For`. */
    TRUSTED_PROXIES: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    /** Built web app to serve in production (Docker image); unset while Vite serves it. */
    WEB_DIST_DIR: z.string().min(1).optional(),
    /** Migrations shipped next to the built server in Docker; source development uses the package. */
    MIGRATIONS_DIR: z.string().min(1).optional(),
    /**
     * Shared secret of server and worker (spec 07): with it the worker connects to the canvas of a
     * board to draw for an agent. Unset, the collaboration server accepts no such connection.
     */
    INTERNAL_TOKEN: z.string().min(32).optional(),
    /**
     * Folder of the file storage (spec 20a), shared with the worker. Unset, development uses
     * `.data/files` in the repository; the built server has no repository around it.
     */
    FILES_DIR: z.string().min(1).optional(),
    /**
     * The limits of the AI (spec 31a), shared with the worker, which checks them before every
     * model call; the server says with them whether a limit is reached.
     */
    ...usageLimitsEnv,
  })
  .refine((env) => Boolean(env.GITLAB_CLIENT_ID) === Boolean(env.GITLAB_CLIENT_SECRET), {
    message: 'GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET must be set together',
    path: ['GITLAB_CLIENT_SECRET'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || Boolean(env.FILES_DIR), {
    message: 'Production needs FILES_DIR, the folder for uploaded files (shared with the worker)',
    path: ['FILES_DIR'],
  })
  .refine((env) => !env.SMTP_URL || Boolean(env.MAIL_FROM), {
    message: 'MAIL_FROM is required when SMTP_URL is set',
    path: ['MAIL_FROM'],
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' || Boolean(env.SMTP_URL) || Boolean(env.GITLAB_CLIENT_ID),
    {
      message:
        'Production needs a way to sign in: set SMTP_URL and MAIL_FROM (login link by mail) and/or GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET',
      path: ['SMTP_URL'],
    },
  );

export type ServerEnv = z.output<typeof serverEnvSchema>;

export function loadServerEnv(source: Record<string, unknown> = process.env): ServerEnv {
  return defineEnv(serverEnvSchema, source);
}
