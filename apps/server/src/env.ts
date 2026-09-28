import { defineEnv } from '@covibes/shared';
import { z } from 'zod';

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    // Local development stays on this machine; deployment sets HOST=0.0.0.0 (spec 02b).
    HOST: z.string().min(1).default('127.0.0.1'),
    /** Public address of the web app; the API is reachable under `${APP_URL}/api`. */
    APP_URL: z.url().default('http://localhost:5173'),
    /** Role covibes_app: every request on behalf of a user (RLS applies). */
    DATABASE_URL: z.url(),
    /** Role covibes_admin: login library, migrations, worker. */
    DATABASE_ADMIN_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    GITLAB_CLIENT_ID: z.string().min(1).optional(),
    GITLAB_CLIENT_SECRET: z.string().min(1).optional(),
    /** Only for a self-hosted GitLab; defaults to gitlab.com. */
    GITLAB_ISSUER: z.url().optional(),
  })
  .refine((env) => Boolean(env.GITLAB_CLIENT_ID) === Boolean(env.GITLAB_CLIENT_SECRET), {
    message: 'GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET must be set together',
    path: ['GITLAB_CLIENT_SECRET'],
  });

export type ServerEnv = z.output<typeof serverEnvSchema>;

export function loadServerEnv(source: Record<string, unknown> = process.env): ServerEnv {
  return defineEnv(serverEnvSchema, source);
}
