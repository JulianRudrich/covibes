import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { migrate, MigrationChangedError, readMigrations } from './migrate';
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
