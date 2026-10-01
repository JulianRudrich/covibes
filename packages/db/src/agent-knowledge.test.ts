import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Web searches of a run and the knowledge of custom agents (spec 20b).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '0a111111-1111-4111-8111-111111111111';
const EDITOR = '0a222222-2222-4222-8222-222222222222';
const VIEWER = '0a333333-3333-4333-8333-333333333333';
const STRANGER = '0a444444-4444-4444-8444-444444444444';
const PROJECT = '0aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** A personal agent of the editor, and one shared in the project. */
const PERSONAL = '0a555555-5555-4555-8555-555555555555';
const SHARED = '0a666666-6666-4666-8666-666666666666';

const rejected = { code: '42501' };

const addLink = (client: pg.PoolClient | pg.Pool, agentId: string, userId: string) =>
  client.query<{ id: string }>(
    `insert into agent_knowledge (agent_id, kind, name, url, note, created_by)
     values ($1, 'link', 'Vereinsrecht', 'https://example.org/vereinsrecht', 'Paragraf 21', $2)
     returning id`,
    [agentId, userId],
  );

const addFile = (client: pg.PoolClient | pg.Pool, agentId: string, userId: string) =>
  client.query<{ id: string }>(
    `insert into agent_knowledge
       (agent_id, kind, name, file_kind, media_type, size_bytes, storage_key, created_by)
     values ($1, 'file', 'satzung.pdf', 'pdf', 'application/pdf', 1200, $3, $2)
     returning id`,
    [agentId, userId, randomUUID()],
  );

const visibleTo = async (userId: string, itemId: string) =>
  (
    await asUser(app, userId, (client) =>
      client.query('select id from agent_knowledge where id = $1', [itemId]),
    )
  ).rows.length === 1;

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'knowledge-owner@example.com', true),
      ($2, 'Eddie Editor', 'knowledge-editor@example.com', true),
      ($3, 'Vera Viewer', 'knowledge-viewer@example.com', true),
      ($4, 'Sam Stranger', 'knowledge-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Wissen', $2)`, [
    PROJECT,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer')`,
    [PROJECT, OWNER, EDITOR, VIEWER],
  );
  await admin.query(
    `insert into custom_agents (id, owner_id, project_id, name, role) values
      ($1, $3, null, 'Wissen Persönlich', 'Rolle'),
      ($2, $3, $4, 'Wissen Geteilt', 'Rolle')`,
    [PERSONAL, SHARED, EDITOR, PROJECT],
  );
  // The personal agent is in the project's team: its knowledge still stays with its creator.
  await admin.query(`insert into project_agents (project_id, agent_key) values ($1, $2)`, [
    PROJECT,
    PERSONAL,
  ]);
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('the knowledge of a personal agent', () => {
  it('is maintained and seen by its creator only', async () => {
    const link = (await addLink(admin, PERSONAL, EDITOR)).rows[0]?.id ?? '';
    await asUser(app, EDITOR, async (client) => {
      expect((await addFile(client, PERSONAL, EDITOR)).rows).toHaveLength(1);
      expect((await addLink(client, PERSONAL, EDITOR)).rows).toHaveLength(1);
    });
    expect(await visibleTo(EDITOR, link)).toBe(true);
    // Not even the owner of a project that uses the agent sees or changes its knowledge.
    expect(await visibleTo(OWNER, link)).toBe(false);
    await expect(
      asUser(app, OWNER, (client) => addLink(client, PERSONAL, OWNER)),
    ).rejects.toMatchObject(rejected);
    const removed = await asUser(app, OWNER, (client) =>
      client.query('delete from agent_knowledge where id = $1', [link]),
    );
    expect(removed.rowCount).toBe(0);
    const byCreator = await asUser(app, EDITOR, (client) =>
      client.query('delete from agent_knowledge where id = $1', [link]),
    );
    expect(byCreator.rowCount).toBe(1);
  });
});

describe('the knowledge of a shared agent', () => {
  it('is seen by the members and maintained by owners and editors', async () => {
    const file = (await addFile(admin, SHARED, EDITOR)).rows[0]?.id ?? '';
    for (const member of [OWNER, EDITOR, VIEWER]) expect(await visibleTo(member, file)).toBe(true);
    expect(await visibleTo(STRANGER, file)).toBe(false);

    await asUser(app, OWNER, async (client) => {
      expect((await addLink(client, SHARED, OWNER)).rows).toHaveLength(1);
    });
    await expect(
      asUser(app, VIEWER, (client) => addLink(client, SHARED, VIEWER)),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, STRANGER, (client) => addLink(client, SHARED, STRANGER)),
    ).rejects.toMatchObject(rejected);
    // Nobody adds in the name of someone else.
    await expect(
      asUser(app, EDITOR, (client) => addLink(client, SHARED, OWNER)),
    ).rejects.toMatchObject(rejected);

    const byViewer = await asUser(app, VIEWER, (client) =>
      client.query('delete from agent_knowledge where id = $1', [file]),
    );
    expect(byViewer.rowCount).toBe(0);
    const byOwner = await asUser(app, OWNER, (client) =>
      client.query('delete from agent_knowledge where id = $1', [file]),
    );
    expect(byOwner.rowCount).toBe(1);
  });

  it('cannot be changed in place', async () => {
    const link = (await addLink(admin, SHARED, EDITOR)).rows[0]?.id ?? '';
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(`update agent_knowledge set url = 'https://evil.example' where id = $1`, [
          link,
        ]),
      ),
    ).rejects.toMatchObject(rejected);
  });
});

describe('entries of the knowledge', () => {
  it('are a link with an address or a file with its content, never a mix', async () => {
    const insert = (columns: string, values: string, parameters: unknown[]) =>
      admin.query(
        `insert into agent_knowledge (agent_id, kind, name, ${columns}) values ($1, $2, 'x', ${values})`,
        [SHARED, ...parameters],
      );
    // A link without an address, a file without content, a link with a file's content.
    await expect(insert('note', "''", ['link'])).rejects.toMatchObject({ code: '23514' });
    await expect(insert('file_kind', "'pdf'", ['file'])).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('url, storage_key', "'https://example.org', $3", ['link', randomUUID()]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('url, note', "'https://example.org', $3", ['link', 'x'.repeat(201)]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert(
        'file_kind, media_type, size_bytes, storage_key',
        "'text', 'text/plain', 10, '../../etc/passwd'",
        ['file'],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('go with their agent, and stay hidden once the agent is deleted', async () => {
    const agent = (
      await admin.query<{ id: string }>(
        `insert into custom_agents (owner_id, name, role) values ($1, 'Wissen Kurz', 'Rolle') returning id`,
        [EDITOR],
      )
    ).rows[0]?.id;
    const link = (await addLink(admin, agent ?? '', EDITOR)).rows[0]?.id ?? '';

    await admin.query('update custom_agents set deleted_at = now() where id = $1', [agent]);
    expect(await visibleTo(EDITOR, link)).toBe(false);

    await admin.query('delete from custom_agents where id = $1', [agent]);
    const { rows } = await admin.query('select id from agent_knowledge where id = $1', [link]);
    expect(rows).toEqual([]);
  });
});

describe('web searches of a run', () => {
  it('are counted, never below zero', async () => {
    const { rows } = await admin.query<{ web_searches: number }>(
      `insert into ai_runs (project_id, agent_key) values ($1, 'moderator') returning web_searches`,
      [PROJECT],
    );
    expect(rows).toEqual([{ web_searches: 0 }]);
    await expect(
      admin.query(
        `insert into ai_runs (project_id, agent_key, web_searches) values ($1, 'moderator', -1)`,
        [PROJECT],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
