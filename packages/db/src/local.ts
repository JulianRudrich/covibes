import { startEmbeddedPostgres, type RunningPostgres } from './embedded';
import { loadOrCreateLocalSecrets, type LocalSecrets } from './local-secrets';
import { migrate } from './migrate';
import { paths } from './paths';

export const LOCAL_PORT = 54320;

export type LocalDatabase = RunningPostgres & { secrets: LocalSecrets; applied: string[] };

/**
 * The development database: data in `.data/postgres`, listening on localhost only, migrations
 * applied. Used by `pnpm dev` and the `db:*` commands.
 */
export async function startLocalDatabase(): Promise<LocalDatabase> {
  const secrets = loadOrCreateLocalSecrets();
  const running = await startEmbeddedPostgres({
    dataDir: paths.postgres,
    port: LOCAL_PORT,
    postgresPassword: secrets.postgresPassword,
    adminPassword: secrets.adminPassword,
    appPassword: secrets.appPassword,
  });
  try {
    const applied = await migrate(running.adminUrl);
    return { ...running, secrets, applied };
  } catch (error) {
    await running.stop();
    throw error;
  }
}
