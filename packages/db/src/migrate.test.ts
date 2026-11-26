import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { migrate, MigrationChangedError, readMigrations } from './migrate';
import { startEmbeddedPostgres } from './embedded';
import { paths } from './paths';

const { adminUrl } = inject('database');
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function copyOfMigrations(): string {
  const dir = mkdtempSync(join(tmpdir(), 'covibes-migrations-'));
  tempDirs.push(dir);
  cpSync(paths.migrations, dir, { recursive: true });
  return dir;
}

describe('migrate', () => {
  it('reads the migrations in numeric order', () => {
    const names = readMigrations().map((migration) => migration.name);
    expect(names).toEqual([...names].sort());
    expect(names[0]).toBe('0000_base.sql');
  });

  it('applies nothing when the database is up to date', async () => {
    expect(await migrate(adminUrl)).toEqual([]);
  });

  it('applies a missing earlier migration after a later migration was already applied', async () => {
    const dir = copyOfMigrations();
    rmSync(join(dir, '0045_safe_recovery.sql'));
    const dataDir = mkdtempSync(join(tmpdir(), 'covibes-migration-upgrade-'));
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Could not allocate a PostgreSQL port'));
          server.close();
          return;
        }
        server.close(() => {
          resolve(address.port);
        });
      });
    });
    const database = await startEmbeddedPostgres({
      dataDir,
      port,
      postgresPassword: 'postgres-upgrade-test',
      adminPassword: 'admin-upgrade-test',
      appPassword: 'app-upgrade-test',
    });
    try {
      const initial = await migrate(database.adminUrl, dir);
      expect(initial).toContain('0052_decision_links.sql');
      expect(initial).not.toContain('0045_safe_recovery.sql');
      expect(await migrate(database.adminUrl)).toEqual(['0045_safe_recovery.sql']);
      expect(await migrate(database.adminUrl)).toEqual([]);
    } finally {
      await database.stop();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(`${dataDir}.log`, { force: true });
    }
  }, 90_000);

  it('records every migration with its checksum', async () => {
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    try {
      const result = await client.query<{ name: string; checksum: string }>(
        'select name, checksum from public.schema_migrations order by name',
      );
      expect(result.rows).toEqual(
        readMigrations().map(({ name, checksum }) => ({ name, checksum })),
      );
    } finally {
      await client.end();
    }
  });

  it('refuses to run when an applied migration was changed', async () => {
    const dir = copyOfMigrations();
    writeFileSync(join(dir, '0000_base.sql'), '-- changed\n', { flag: 'a' });

    await expect(migrate(adminUrl, dir)).rejects.toThrow(MigrationChangedError);
  });

  it('treats CRLF line endings like LF', async () => {
    const dir = copyOfMigrations();
    for (const { name, sql } of readMigrations(dir)) {
      writeFileSync(join(dir, name), sql.replace(/\n/g, '\r\n'));
    }

    expect(await migrate(adminUrl, dir)).toEqual([]);
  });
});
