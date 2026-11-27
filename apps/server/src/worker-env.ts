import { defineEnv } from '@covibes/shared';
import { z } from 'zod';

import { usageLimitsEnv } from '@server/usage/limits';
import { githubConfigurationComplete, githubEnvFields } from '@server/integrations/github/setup';

/** Environment of the worker process (spec 07); it shares `.env` files with the server. */
export const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** The web app's address; the collaboration server only accepts its origin. */
    APP_URL: z.url().default('http://localhost:5173'),
    /** Role covibes_admin: the job queue, runs and agent messages. */
    DATABASE_ADMIN_URL: z.url(),
    /** Shared secret of server and worker; with it the worker draws on boards for agents. */
    INTERNAL_TOKEN: z.string().min(32),
    /** WebSocket URL of the server's collaboration endpoint. */
    COLLAB_URL: z.url({ protocol: /^wss?$/ }).default('ws://127.0.0.1:3001/api/collab'),
    /**
     * Read by the Claude Agent SDK itself. Unset, Claude runs on the local Claude Code login; an
     * instance other people use needs the key (architecture "AI providers").
     */
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    /** SMTP access for the notification mails (spec 22b), the same as the server's; optional. */
    SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
    MAIL_FROM: z.string().min(3).optional(),
    /** Folder of the file storage (spec 20a), the same as the server's. */
    FILES_DIR: z.string().min(1).optional(),
    /**
     * The settings of GitLab connections (spec 28a), the same as the server's: with them the
     * agents read a project's repository and the worker renews its token. Unset, they read none.
     */
    TOKEN_KEY: z.string().min(32).optional(),
    GITLAB_CLIENT_ID: z.string().min(1).optional(),
    GITLAB_CLIENT_SECRET: z.string().min(1).optional(),
    GITLAB_ISSUER: z.url().optional(),
    ...githubEnvFields,
    /** The limits of the AI (spec 31a), the same as the server's. */
    ...usageLimitsEnv,
  })
  .refine(githubConfigurationComplete, {
    message: 'Set all GITHUB_APP_* values and TOKEN_KEY together',
    path: ['GITHUB_APP_ID'],
  })
  .refine((env) => Boolean(env.GITLAB_CLIENT_ID) === Boolean(env.GITLAB_CLIENT_SECRET), {
    message: 'GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET must be set together',
    path: ['GITLAB_CLIENT_SECRET'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || Boolean(env.FILES_DIR), {
    message: 'Production needs FILES_DIR, the folder for uploaded files (shared with the server)',
    path: ['FILES_DIR'],
  })
  .refine((env) => !env.SMTP_URL || Boolean(env.MAIL_FROM), {
    message: 'MAIL_FROM is required when SMTP_URL is set',
    path: ['MAIL_FROM'],
  });

export type WorkerEnv = z.output<typeof workerEnvSchema>;

export function loadWorkerEnv(source: Record<string, unknown> = process.env): WorkerEnv {
  return defineEnv(workerEnvSchema, source);
}
