import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

import { paths } from './paths';

const localSecretsSchema = z.object({
  postgresPassword: z.string().min(24),
  adminPassword: z.string().min(24),
  appPassword: z.string().min(24),
  betterAuthSecret: z.string().min(32),
  /** Shared by server and worker (spec 07); added to older files on the next start. */
  internalToken: z.string().min(32),
  /** Key for the tokens of GitLab connections (spec 28a); added to older files on the next start. */
  tokenKey: z.string().min(32),
});

export type LocalSecrets = z.infer<typeof localSecretsSchema>;

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Random passwords and secrets for the local database and login, created on the first start.
 * They stay on this machine in `.data/` and are never committed.
 */
export function loadOrCreateLocalSecrets(file = paths.localSecrets): LocalSecrets {
  const stored: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  // Missing secrets (a new machine, or one added by a later spec) are created once and stored;
  // existing ones never change, because the database already uses them.
  const secrets = localSecretsSchema.parse({
    postgresPassword: randomSecret(24),
    adminPassword: randomSecret(24),
    appPassword: randomSecret(24),
    betterAuthSecret: randomSecret(32),
    internalToken: randomSecret(32),
    tokenKey: randomSecret(32),
    ...(typeof stored === 'object' ? stored : {}),
  });
  if (JSON.stringify(secrets) !== JSON.stringify(stored)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  }
  return secrets;
}
