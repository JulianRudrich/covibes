import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Custom agents (spec 19).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = 'e1111111-1111-4111-8111-111111111111';
const EDITOR = 'e2222222-2222-4222-8222-222222222222';
const VIEWER = 'e3333333-3333-4333-8333-333333333333';
const STRANGER = 'e4444444-4444-4444-8444-444444444444';
const PROJECT = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** A second project of the editor alone. */
const OTHER = 'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const rejected = { code: '42501' };
let names = 0;

/** A custom agent with a fresh name, stored by the admin. */
async function createAgent(
  owner: string,
  projectId: string | null = null,
  name?: string,
): Promise<string> {
  names += 1;
  const { rows } = await admin.query<{ id: string }>(
    `insert into custom_agents (owner_id, project_id, name, role, instructions)
     values ($1, $2, $3, 'Prüft Verträge', 'Achte auf Haftung.') returning id`,
    [owner, projectId, name ?? `Jurist ${String(names)}`],
  );
  return rows[0]?.id ?? '';
}

/** Runs `fn` as the user and commits, for changes that later statements build on. */
async function committed<T>(userId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

const visibleTo = async (userId: string, agentId: string) =>
  (
    await asUser(app, userId, (client) =>
      client.query('select id from custom_agents where id = $1', [agentId]),
    )
  ).rows.length === 1;

const addToTeam = (client: pg.PoolClient, projectId: string, agentKey: string, userId: string) =>
  client.query('insert into project_agents (project_id, agent_key, added_by) values ($1, $2, $3)', [
    projectId,
    agentKey,
    userId,
  ]);

const teamOf = async (projectId: string) =>
  (
    await admin.query<{ agent_key: string }>(
      'select agent_key from project_agents where project_id = $1',
      [projectId],
    )
  ).rows.map((row) => row.agent_key);

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'custom-owner@example.com', true),
      ($2, 'Eddie Editor', 'custom-editor@example.com', true),
      ($3, 'Vera Viewer', 'custom-viewer@example.com', true),
      ($4, 'Sam Stranger', 'custom-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
  await admin.query(
    `insert into projects (id, name, owner_id) values ($1, 'Eigene Agenten', $2), ($3, 'Anderes', $4)`,
    [PROJECT, OWNER, OTHER, EDITOR],
  );
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer'), ($5, $3, 'owner')`,
    [PROJECT, OWNER, EDITOR, VIEWER, OTHER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('personal agents', () => {
  it('are created by their owner and visible to nobody else', async () => {
    const id = await committed(EDITOR, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into custom_agents (owner_id, name, role, instructions, can_draw, model, color, template)
         values ($1, 'Persönlich Eins', 'Prüft Texte', 'Sei knapp.', false, 'claude-sonnet-5-5', 3, 'critic')
         returning id`,
        [EDITOR],
      );
      return rows[0]?.id ?? '';
    });

    expect(await visibleTo(EDITOR, id)).toBe(true);
    // Not even the owner of a project the creator works in sees a personal agent.
    expect(await visibleTo(OWNER, id)).toBe(false);
    expect(await visibleTo(STRANGER, id)).toBe(false);
  });

  it('cannot be created in the name of someone else', async () => {
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(
          `insert into custom_agents (owner_id, name, role) values ($1, 'Fremd', 'Rolle')`,
          [OWNER],
        ),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('are changed by their owner only, and not in what the server sets', async () => {
    const id = await createAgent(EDITOR);
    await asUser(app, EDITOR, async (client) => {
      const updated = await client.query(
        `update custom_agents set role = 'Neue Rolle', color = 4 where id = $1 returning updated_at > created_at as touched`,
        [id],
      );
      expect(updated.rows).toEqual([{ touched: true }]);
    });
    const byOwner = await asUser(app, OWNER, (client) =>
      client.query(`update custom_agents set role = 'Gekapert' where id = $1`, [id]),
    );
    expect(byOwner.rowCount).toBe(0);
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(`update custom_agents set owner_id = $2 where id = $1`, [id, OWNER]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(`update custom_agents set deleted_at = now() where id = $1`, [id]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(`delete from custom_agents where id = $1`, [id]),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('have a unique name per owner, whatever the case, and keep their limits', async () => {
    await createAgent(EDITOR, null, 'Doppelt');
    await expect(createAgent(EDITOR, null, 'doppelt')).rejects.toMatchObject({ code: '23505' });
    // Someone else may use the name, and so may a shared agent.
    await expect(createAgent(OWNER, null, 'Doppelt')).resolves.toBeTruthy();
    await expect(createAgent(EDITOR, PROJECT, 'Doppelt')).resolves.toBeTruthy();

    await expect(createAgent(EDITOR, null, 'X')).rejects.toMatchObject({ code: '23514' });
    await expect(
      admin.query(
        `insert into custom_agents (owner_id, name, role, color) values ($1, 'Farbe', 'Rolle', 7)`,
        [EDITOR],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('shared agents', () => {
  it('are visible to the members of their project and created by owners and editors', async () => {
    const id = await committed(EDITOR, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into custom_agents (owner_id, project_id, name, role)
         values ($1, $2, 'Geteilt Eins', 'Prüft Texte') returning id`,
        [EDITOR, PROJECT],
      );
      return rows[0]?.id ?? '';
    });
    for (const member of [OWNER, EDITOR, VIEWER]) expect(await visibleTo(member, id)).toBe(true);
    expect(await visibleTo(STRANGER, id)).toBe(false);

    await expect(
      asUser(app, VIEWER, (client) =>
        client.query(
          `insert into custom_agents (owner_id, project_id, name, role) values ($1, $2, 'Zuschauer', 'Rolle')`,
          [VIEWER, PROJECT],
        ),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, STRANGER, (client) =>
        client.query(
          `insert into custom_agents (owner_id, project_id, name, role) values ($1, $2, 'Fremd', 'Rolle')`,
          [STRANGER, PROJECT],
        ),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('are changed by owners and editors, not by viewers', async () => {
    const id = await createAgent(EDITOR, PROJECT);
    const byOwner = await asUser(app, OWNER, (client) =>
      client.query(`update custom_agents set role = 'Vom Owner' where id = $1`, [id]),
    );
    expect(byOwner.rowCount).toBe(1);
    const byViewer = await asUser(app, VIEWER, (client) =>
      client.query(`update custom_agents set role = 'Vom Viewer' where id = $1`, [id]),
    );
    expect(byViewer.rowCount).toBe(0);
  });

  it('are shared by their creator where they are owner or editor, and taken back by them only', async () => {
    const id = await createAgent(EDITOR);
    // Not into a project the creator is no part of, and not by someone else.
    const foreign = 'eccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Fremd', $2)`, [
      foreign,
      STRANGER,
    ]);
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(`update custom_agents set project_id = $2 where id = $1`, [id, foreign]),
      ),
    ).rejects.toMatchObject(rejected);

    await committed(EDITOR, (client) =>
      client.query(`update custom_agents set project_id = $2 where id = $1`, [id, PROJECT]),
    );
    expect(await visibleTo(OWNER, id)).toBe(true);

    // The owner of the project edits it, but cannot make it their own personal agent.
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`update custom_agents set project_id = null where id = $1`, [id]),
      ),
    ).rejects.toMatchObject(rejected);
    await committed(EDITOR, (client) =>
      client.query(`update custom_agents set project_id = null where id = $1`, [id]),
    );
    expect(await visibleTo(OWNER, id)).toBe(false);
    expect(await visibleTo(EDITOR, id)).toBe(true);
  });
});

describe('custom agents in a team', () => {
  it('are added by whoever may use them', async () => {
    const personal = await createAgent(EDITOR);
    const shared = await createAgent(EDITOR, PROJECT);
    const foreign = await createAgent(STRANGER);
    const elsewhere = await createAgent(EDITOR, OTHER);

    await asUser(app, EDITOR, async (client) => {
      await addToTeam(client, PROJECT, personal, EDITOR);
      await addToTeam(client, PROJECT, shared, EDITOR);
      // Catalog agents as before.
      await addToTeam(client, PROJECT, 'critic', EDITOR);
    });
    // The owner may add the shared agent, but not the editor's personal one.
    await asUser(app, OWNER, (client) => addToTeam(client, PROJECT, shared, OWNER));
    await expect(
      asUser(app, OWNER, (client) => addToTeam(client, PROJECT, personal, OWNER)),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, EDITOR, (client) => addToTeam(client, PROJECT, foreign, EDITOR)),
    ).rejects.toMatchObject(rejected);
    // An agent shared in another project stays there.
    await expect(
      asUser(app, EDITOR, (client) => addToTeam(client, PROJECT, elsewhere, EDITOR)),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, VIEWER, (client) => addToTeam(client, PROJECT, shared, VIEWER)),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, EDITOR, (client) =>
        addToTeam(client, PROJECT, 'e9999999-9999-4999-8999-999999999999', EDITOR),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('leave the other teams when they are shared in one project', async () => {
    const id = await createAgent(EDITOR);
    await committed(EDITOR, async (client) => {
      await addToTeam(client, PROJECT, id, EDITOR);
      await addToTeam(client, OTHER, id, EDITOR);
    });

    await committed(EDITOR, (client) =>
      client.query(`update custom_agents set project_id = $2 where id = $1`, [id, OTHER]),
    );

    expect(await teamOf(PROJECT)).not.toContain(id);
    expect(await teamOf(OTHER)).toContain(id);
  });
});

describe('the directory of a project', () => {
  it('lists shared agents, agents of the team and authors of runs, without instructions', async () => {
    const shared = await createAgent(EDITOR, PROJECT);
    const inTeam = await createAgent(EDITOR);
    const former = await createAgent(EDITOR);
    const unrelated = await createAgent(EDITOR);
    await admin.query(`insert into project_agents (project_id, agent_key) values ($1, $2)`, [
      PROJECT,
      inTeam,
    ]);
    await admin.query(
      `insert into ai_runs (project_id, agent_key, status) values ($1, $2, 'done')`,
      [PROJECT, former],
    );
    // Deleted in the meantime; its messages keep its name.
    await admin.query(`update custom_agents set deleted_at = now() where id = $1`, [former]);

    const { rows, fields } = await asUser(app, VIEWER, (client) =>
      client.query<{ id: string; scope: string; owner_name: string; deleted: boolean }>(
        'select * from public.project_agent_directory($1)',
        [PROJECT],
      ),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(shared)).toMatchObject({ scope: 'project', deleted: false });
    expect(byId.get(inTeam)).toMatchObject({
      scope: 'personal',
      owner_name: 'Eddie Editor',
      deleted: false,
    });
    expect(byId.get(former)).toMatchObject({ deleted: true });
    expect(byId.has(unrelated)).toBe(false);
    expect(fields.map((field) => field.name)).not.toContain('instructions');

    await expect(
      asUser(app, STRANGER, (client) =>
        client.query('select * from public.project_agent_directory($1)', [PROJECT]),
      ),
    ).rejects.toMatchObject({ code: 'P0002' });
  });
});

describe('deleting a custom agent', () => {
  const remove = (userId: string, agentId: string) =>
    committed(userId, (client) => client.query('select public.delete_custom_agent($1)', [agentId]));

  it('removes it from every team and frees its name', async () => {
    const id = await createAgent(EDITOR, null, 'Einmalig');
    await admin.query(
      `insert into project_agents (project_id, agent_key) values ($1, $3), ($2, $3)`,
      [PROJECT, OTHER, id],
    );
    const listener = new pg.Client({ connectionString: adminUrl });
    await listener.connect();
    const announced: string[] = [];
    listener.on('notification', (notification) => {
      const event = JSON.parse(notification.payload ?? '{}') as { kind: string; projectId: string };
      if (event.kind === 'project') announced.push(event.projectId);
    });
    await listener.query('listen covibes_live');
    try {
      await remove(EDITOR, id);
      await listener.query('select 1');
    } finally {
      await listener.end();
    }

    expect(await teamOf(PROJECT)).not.toContain(id);
    expect(await teamOf(OTHER)).not.toContain(id);
    expect(announced).toEqual(expect.arrayContaining([PROJECT, OTHER]));
    expect(await visibleTo(EDITOR, id)).toBe(false);
    const kept = await admin.query(
      'select deleted_at is not null as deleted from custom_agents where id = $1',
      [id],
    );
    expect(kept.rows).toEqual([{ deleted: true }]);
    await expect(createAgent(EDITOR, null, 'Einmalig')).resolves.toBeTruthy();
    await expect(remove(EDITOR, id)).rejects.toMatchObject({ code: 'P0002' });
  });

  it('is for the creator of a personal agent, and for owners and editors of a shared one', async () => {
    const personal = await createAgent(EDITOR);
    await expect(remove(OWNER, personal)).rejects.toMatchObject({ code: 'P0002' });

    const shared = await createAgent(EDITOR, PROJECT);
    await expect(remove(VIEWER, shared)).rejects.toMatchObject(rejected);
    await expect(remove(STRANGER, shared)).rejects.toMatchObject({ code: 'P0002' });
    await remove(OWNER, shared);
    expect(await visibleTo(EDITOR, shared)).toBe(false);
  });
});
