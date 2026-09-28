import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

export const paths = {
  repoRoot,
  migrations: join(packageRoot, 'migrations'),
  schemaTypes: join(packageRoot, 'src', 'schema.ts'),
  /** Local, never committed: database files and generated secrets. */
  data: join(repoRoot, '.data'),
  postgres: join(repoRoot, '.data', 'postgres'),
  localSecrets: join(repoRoot, '.data', 'local-secrets.json'),
  backups: join(repoRoot, 'backups'),
};
