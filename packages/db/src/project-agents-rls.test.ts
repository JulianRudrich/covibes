import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// The agent team of a project and its rights (spec 14).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '81111111-1111-4111-8111-111111111111';
const EDITOR = '82222222-2222-4222-8222-222222222222';
const VIEWER = '83333333-3333-4333-8333-333333333333';
const STRANGER = '84444444-4444-4444-8444-444444444444';
const PROJECT = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const rejected = { code: '42501' };

async function team(client: pg.PoolClient | pg.Pool = admin, project = PROJECT) {
  const { rows } = await client.query<{ agent_key: string; model: string | null }>(
    'select agent_key, model from project_agents where project_id = $1 order by agent_key',
    [project],
  );
  return rows;
}

const add = (client: pg.PoolClient, agentKey: string, by: string) =>
  client.query(`insert into project_agents (project_id, agent_key, added_by) values ($1, $2, $3)`, [
    PROJECT,
    agentKey,
    by,
  ]);

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'team-owner@example.com', true),
      ($2, 'Eddie Editor', 'team-editor@example.com', true),
      ($3, 'Vera Viewer', 'team-viewer@example.com', true),
      ($4, 'Sam Stranger', 'team-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Team', $2)`, [
    PROJECT,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer')`,
    [PROJECT, OWNER, EDITOR, VIEWER],
  );
  // A specialist the tests remove or change inside their transactions.
  await admin.query(
    `insert into project_agents (project_id, agent_key, added_by) values ($1, 'security', $2)`,
    [PROJECT, EDITOR],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('project_agents', () => {
  it('a new project starts with the moderator only', async () => {
    await asUser(app, OWNER, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "select id from public.create_project('Neues Team')",
      );
      expect(await team(client, rows[0]?.id)).toEqual([{ agent_key: 'moderator', model: null }]);
    });
  });

  it('is read by members only', async () => {
    for (const member of [OWNER, EDITOR, VIEWER]) {
      await asUser(app, member, async (client) => {
        expect((await team(client)).length).toBeGreaterThan(0);
      });
    }
    await asUser(app, STRANGER, async (client) => {
      expect(await team(client)).toEqual([]);
    });
  });

  it('owners and editors add and remove specialists in their own name', async () => {
    for (const member of [OWNER, EDITOR]) {
      await asUser(app, member, async (client) => {
        await add(client, 'critic', member);
        expect((await team(client)).map((agent) => agent.agent_key)).toEqual([
          'critic',
          'moderator',
          'security',
        ]);
        const { rowCount } = await client.query(
          `delete from project_agents where project_id = $1 and agent_key in ('critic', 'security')`,
          [PROJECT],
        );
        expect(rowCount).toBe(2);
      });
    }
    await expect(
      asUser(app, EDITOR, (client) => add(client, 'backend', OWNER)),
    ).rejects.toMatchObject(rejected);
  });

  it('nobody adds or removes the moderator', async () => {
    await asUser(app, OWNER, async (client) => {
      const { rowCount } = await client.query(
        `delete from project_agents where project_id = $1 and agent_key = 'moderator'`,
        [PROJECT],
      );
      expect(rowCount).toBe(0);
    });
    await admin.query(
      `delete from project_agents where project_id = $1 and agent_key = 'moderator'`,
      [PROJECT],
    );
    try {
      await expect(
        asUser(app, OWNER, (client) => add(client, 'moderator', OWNER)),
      ).rejects.toMatchObject(rejected);
    } finally {
      await admin.query(
        `insert into project_agents (project_id, agent_key) values ($1, 'moderator')`,
        [PROJECT],
      );
    }
  });

  it('viewers and strangers neither add nor remove agents', async () => {
    for (const member of [VIEWER, STRANGER]) {
      await expect(
        asUser(app, member, (client) => add(client, 'ml', member)),
      ).rejects.toMatchObject(rejected);
      await asUser(app, member, async (client) => {
        const { rowCount } = await client.query(
          `delete from project_agents where project_id = $1 and agent_key = 'security'`,
          [PROJECT],
        );
        expect(rowCount).toBe(0);
      });
    }
  });

  it('only owners choose the model', async () => {
    const choose = (client: pg.PoolClient, model: string | null) =>
      client.query(
        `update project_agents set model = $2 where project_id = $1 and agent_key = 'security'`,
        [PROJECT, model],
      );
    await asUser(app, EDITOR, async (client) => {
      expect((await choose(client, 'claude-haiku-4-5-20251001')).rowCount).toBe(0);
    });
    await asUser(app, OWNER, async (client) => {
      expect((await choose(client, 'claude-sonnet-5-5')).rowCount).toBe(1);
      expect(await team(client)).toContainEqual({
        agent_key: 'security',
        model: 'claude-sonnet-5-5',
      });
    });

    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`update project_agents set added_by = $2 where project_id = $1`, [
          PROJECT,
          OWNER,
        ]),
      ),
    ).rejects.toMatchObject(rejected);
  });
});

describe('team proposals', () => {
  it('have no board, canvas proposals always have one', async () => {
    await admin.query(
      `insert into proposals (project_id, kind, agent_key, reason, operations)
       values ($1, 'team', 'moderator', 'initiative', '[]'::jsonb)`,
      [PROJECT],
    );
    await expect(
      admin.query(
        `insert into proposals (project_id, kind, agent_key, reason, operations)
         values ($1, 'canvas', 'moderator', 'initiative', '[]'::jsonb)`,
        [PROJECT],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
