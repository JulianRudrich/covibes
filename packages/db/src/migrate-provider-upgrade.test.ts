import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { expect, it } from 'vitest';

import { migrate } from './migrate';
import { paths } from './paths';
import { startTestDatabase } from './testing';

it('attributes past usage when provider funding is migrated after decision links', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'covibes-provider-upgrade-'));
  cpSync(paths.migrations, dir, { recursive: true });
  const migration = '0050_workspace_provider_funding.sql';
  unlinkSync(join(dir, migration));
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
    await admin.query(
      "insert into usage(day,project_id,user_id,agent_key,kind,cost_usd) values('2026-11-01',$1,$2,'moderator','chat',1.25)",
      [projectId, userId],
    );
    cpSync(join(paths.migrations, migration), join(dir, migration));
    expect(await migrate(database.adminUrl, dir)).toEqual([migration]);
    const costs = await admin.query<{ cost_usd: string }>(
      'select c.cost_usd from workspace_legacy_ai_costs c join projects p on p.workspace_id = c.workspace_id where p.id = $1',
      [projectId],
    );
    expect(Number(costs.rows[0]?.cost_usd)).toBe(1.25);
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
