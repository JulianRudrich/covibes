import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { expect, it } from 'vitest';

import { startEmbeddedPostgres } from './embedded';
import { randomSecret } from './local-secrets';
import { migrate } from './migrate';
import { paths } from './paths';

it('adds GitHub support to a database that already applied decision links', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'covibes-github-upgrade-'));
  const migrations = join(dir, 'migrations');
  const dataDir = join(dir, 'postgres');
  cpSync(paths.migrations, migrations, { recursive: true });
  rmSync(join(migrations, '0048_github_integration.sql'));
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const selected = typeof address === 'object' && address ? address.port : 0;
      server.close(() => {
        resolve(selected);
      });
    });
  });
  const db = await startEmbeddedPostgres({
    dataDir,
    port,
    postgresPassword: randomSecret(24),
    adminPassword: randomSecret(24),
    appPassword: randomSecret(24),
  });
  try {
    const initial = await migrate(db.adminUrl, migrations);
    expect(initial).toContain('0052_decision_links.sql');
    expect(initial).not.toContain('0048_github_integration.sql');
    const client = new pg.Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      const userId = randomUUID();
      const projectId = randomUUID();
      const decisionId = randomUUID();
      const targetId = randomUUID();
      await client.query(
        'insert into users(id, email, name, email_verified) values ($1, $2, $3, true)',
        [userId, 'upgrade@example.test', 'User'],
      );
      await client.query('insert into projects(id, name, owner_id) values ($1, $2, $3)', [
        projectId,
        'Project',
        userId,
      ]);
      await client.query('insert into decisions(id, project_id, topic) values ($1, $2, $3)', [
        decisionId,
        projectId,
        'Topic',
      ]);
      await client.query(
        "insert into decision_links(project_id, decision_id, target_kind, target_id, target_label) values ($1, $2, 'task', $3, 'Task')",
        [projectId, decisionId, targetId],
      );
      expect(await migrate(db.adminUrl)).toEqual(['0048_github_integration.sql']);
      expect(
        (
          await client.query('select target_id from decision_links where project_id = $1', [
            projectId,
          ])
        ).rows,
      ).toEqual([{ target_id: targetId }]);
      expect(
        (
          await client.query<{ name: string | null }>(
            "select to_regclass('public.github_accounts') as name",
          )
        ).rows[0]?.name,
      ).toBe('github_accounts');
      expect(await migrate(db.adminUrl)).toEqual([]);
    } finally {
      await client.end();
    }
  } finally {
    await db.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(`${dataDir}.log`, { force: true });
  }
}, 30000);
