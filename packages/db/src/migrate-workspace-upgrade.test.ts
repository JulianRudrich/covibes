import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { expect, it } from 'vitest';

import { migrate } from './migrate';
import { paths } from './paths';
import { startTestDatabase } from './testing';

it('backfills workspaces after decision links were already migrated', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'covibes-upgrade-'));
  cpSync(paths.migrations, dir, { recursive: true });
  const migration = '0047_workspaces.sql';
  // Provider funding depends on workspaces. An instance without the workspace migration
  // cannot have applied it yet, even if a higher-numbered independent migration exists.
  const providerMigration = '0050_workspace_provider_funding.sql';
  unlinkSync(join(dir, migration));
  unlinkSync(join(dir, providerMigration));
  const database = await startTestDatabase(dir);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  try {
    const [userId, projectId, decisionId, targetId] = Array.from({ length: 4 }, () => randomUUID());
    await admin.query(
      "insert into users(id,name,email,email_verified) values($1,'Owner','owner@example.com',true)",
      [userId],
    );
    await admin.query("insert into projects(id,name,owner_id) values($1,'Existing project',$2)", [
      projectId,
      userId,
    ]);
    await admin.query("insert into decisions(id,project_id,topic) values($1,$2,'Choice')", [
      decisionId,
      projectId,
    ]);
    await admin.query(
      "insert into decision_links(project_id,decision_id,target_kind,target_id,target_label,created_by) values($1,$2,'task',$3,'Task',$4)",
      [projectId, decisionId, targetId, userId],
    );
    cpSync(join(paths.migrations, migration), join(dir, migration));
    cpSync(join(paths.migrations, providerMigration), join(dir, providerMigration));
    expect(await migrate(database.adminUrl, dir)).toEqual([migration, providerMigration]);
    const project = await admin.query<{ kind: string; personal_owner_id: string }>(
      'select w.kind,w.personal_owner_id from projects p join workspaces w on w.id = p.workspace_id where p.id = $1',
      [projectId],
    );
    expect(project.rows).toEqual([{ kind: 'personal', personal_owner_id: userId }]);
    const links = await admin.query<{ target_id: string }>(
      'select target_id from decision_links where project_id = $1',
      [projectId],
    );
    expect(links.rows).toEqual([{ target_id: targetId }]);
    expect(await migrate(database.adminUrl, dir)).toEqual([]);
  } finally {
    await admin.end();
    await database.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);
