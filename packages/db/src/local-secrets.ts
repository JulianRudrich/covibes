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
  if (existsSync(file)) {
    return localSecretsSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  }
  const secrets: LocalSecrets = {
    postgresPassword: randomSecret(24),
    adminPassword: randomSecret(24),
    appPassword: randomSecret(24),
    betterAuthSecret: randomSecret(32),
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  return secrets;
}
