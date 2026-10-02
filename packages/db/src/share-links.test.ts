import { createHash, randomBytes, randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Read-only links (spec 21b): what a link reads of its project, and nothing else.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '0c111111-1111-4111-8111-111111111111';
const EDITOR = '0c222222-2222-4222-8222-222222222222';
const STRANGER = '0c333333-3333-4333-8333-333333333333';
const PROJECT = '0ccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_PROJECT = '0cdddddd-dddd-4ddd-8ddd-dddddddddddd';
const AGENT = '0c444444-4444-4444-8444-444444444444';
const FOREIGN_AGENT = '0c555555-5555-4555-8555-555555555555';

const rejected = { code: '42501' };

const newToken = () => randomBytes(32).toString('base64url');
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** Runs `fn` like a request with a read-only link: no user, the token set for the transaction. */
async function withLink<T>(token: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.share_token', $1, true)", [token]);
    return await fn(client);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

const count = async (token: string, table: string) =>
  withLink(token, async (client) => {
    const { rows } = await client.query<{ count: string }>(`select count(*) from ${table}`);
    return Number(rows[0]?.count);
  });

let token = '';

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'share-owner@example.com', true),
      ($2, 'Eddie Editor', 'share-editor@example.com', true),
      ($3, 'Sam Stranger', 'share-stranger@example.com', true)`,
    [OWNER, EDITOR, STRANGER],
  );
  for (const [id, name] of [
    [PROJECT, 'Geteilt'],
    [OTHER_PROJECT, 'Geheim'],
  ]) {
    await admin.query(`insert into projects (id, name, owner_id) values ($1, $2, $3)`, [
      id,
      name,
      OWNER,
    ]);
    await admin.query(
      `insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`,
      [id, OWNER],
    );
    await admin.query(
      `insert into boards (project_id, title, kind) values ($1, 'Haupt-Canvas', 'main')`,
      [id],
    );
    await admin.query(`insert into criteria (project_id, text, created_by) values ($1, $2, $3)`, [
      id,
      `Kriterium ${String(name)}`,
      OWNER,
    ]);
    await admin.query(
      `insert into decisions (project_id, topic, status, value, decided_by, decided_at)
       values ($1, 'Datenbank', 'decided', $2, $3, now())`,
      [id, `Wahl ${String(name)}`, OWNER],
    );
    await admin.query(
      `insert into messages (project_id, author_kind, author_user_id, content)
       values ($1, 'human', $2, 'Intern')`,
      [id, OWNER],
    );
  }
  await admin.query(
    `insert into project_members (project_id, user_id, role) values ($1, $2, 'editor')`,
    [PROJECT, EDITOR],
  );
  await admin.query(
    `insert into custom_agents (id, owner_id, project_id, name, role, instructions) values
      ($1, $3, $4, 'Teilen Jurist', 'Rolle', 'Geheime Anweisung'),
      ($2, $3, $5, 'Teilen Fremd', 'Rolle', '')`,
    [AGENT, FOREIGN_AGENT, OWNER, PROJECT, OTHER_PROJECT],
  );
  token = newToken();
  await admin.query(
    `insert into share_links (project_id, token_hash, created_by) values ($1, $2, $3)`,
    [PROJECT, hashOf(token), OWNER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('a read-only link', () => {
  it('reads the project it belongs to, its boards, criteria and decisions', async () => {
    await withLink(token, async (client) => {
      const projects = await client.query('select id, name from projects');
      expect(projects.rows).toEqual([{ id: PROJECT, name: 'Geteilt' }]);
      const boards = await client.query('select project_id, title from boards');
      expect(boards.rows).toEqual([{ project_id: PROJECT, title: 'Haupt-Canvas' }]);
      const criteria = await client.query('select text from criteria');
      expect(criteria.rows).toEqual([{ text: 'Kriterium Geteilt' }]);
      const decisions = await client.query('select topic, value from decisions');
      expect(decisions.rows).toEqual([{ topic: 'Datenbank', value: 'Wahl Geteilt' }]);
    });
  });

  it('reads no people, no chat and nothing else of the project', async () => {
    for (const table of [
      'users',
      'project_members',
      'messages',
      'files',
      'ai_runs',
      'decision_log',
      'vote_ballots',
      'hand_raises',
      'offers',
      'debates',
      'custom_agents',
      'agent_knowledge',
      'project_agents',
      'invitations',
      'share_links',
    ]) {
      expect(await count(token, table), table).toBe(0);
    }
    // Who decided is a person: the join the API makes finds no name.
    await withLink(token, async (client) => {
      const { rows } = await client.query(
        `select u.name from decisions d left join users u on u.id = d.decided_by`,
      );
      expect(rows).toEqual([{ name: null }]);
    });
    // The login tables are closed to the app role altogether.
    await expect(count(token, 'sessions')).rejects.toMatchObject(rejected);
  });

  it('changes nothing', async () => {
    const attempts = [
      `update projects set name = 'Gekapert'`,
      `update boards set title = 'Gekapert'`,
      `update criteria set text = 'Gekapert'`,
      `delete from criteria`,
      `delete from boards`,
      `delete from projects`,
    ];
    for (const statement of attempts) {
      const result = await withLink(token, (client) => client.query(statement));
      expect(result.rowCount, statement).toBe(0);
    }
    await expect(
      withLink(token, (client) =>
        client.query(`insert into criteria (project_id, text) values ($1, 'Neu')`, [PROJECT]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      withLink(token, (client) =>
        client.query(
          `insert into messages (project_id, author_kind, content) values ($1, 'human', 'Hi')`,
          [PROJECT],
        ),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('names the custom agents of its project, without their instructions or creator', async () => {
    await withLink(token, async (client) => {
      const { rows } = await client.query('select * from public.shared_agent_directory()');
      expect(rows).toEqual([{ id: AGENT, name: 'Teilen Jurist', color: 1, deleted: false }]);
    });
    // Without a link the directory is empty, also for a member.
    const forMember = await asUser(app, OWNER, (client) =>
      client.query('select * from public.shared_agent_directory()'),
    );
    expect(forMember.rows).toEqual([]);
  });

  it('reads nothing with a token nobody issued, or with none', async () => {
    for (const wrong of [newToken(), '', 'kurz', `${'a'.repeat(42)}'`]) {
      for (const table of ['projects', 'boards', 'criteria', 'decisions', 'votes', 'proposals']) {
        expect(await count(wrong, table), `${table} with "${wrong.slice(0, 8)}"`).toBe(0);
      }
    }
    // A member without a link reads only as a member; a stranger nothing.
    const projects = await asUser(app, STRANGER, (client) =>
      client.query('select id from projects'),
    );
    expect(projects.rows).toEqual([]);
  });

  it('stops working when it is replaced or removed', async () => {
    const projectId = randomUUID();
    await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Wechsel', $2)`, [
      projectId,
      OWNER,
    ]);
    const first = newToken();
    const second = newToken();
    await admin.query(`insert into share_links (project_id, token_hash) values ($1, $2)`, [
      projectId,
      hashOf(first),
    ]);
    expect(await count(first, 'projects')).toBe(1);

    await admin.query(`update share_links set token_hash = $2 where project_id = $1`, [
      projectId,
      hashOf(second),
    ]);
    expect(await count(first, 'projects')).toBe(0);
    expect(await count(second, 'projects')).toBe(1);

    await admin.query(`delete from share_links where project_id = $1`, [projectId]);
    expect(await count(second, 'projects')).toBe(0);
    // One link per project.
    await admin.query(`insert into share_links (project_id, token_hash) values ($1, $2)`, [
      projectId,
      hashOf(first),
    ]);
    await expect(
      admin.query(`insert into share_links (project_id, token_hash) values ($1, $2)`, [
        projectId,
        hashOf(second),
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('the link of a project', () => {
  const insert = (client: pg.PoolClient, userId: string, projectId = OTHER_PROJECT) =>
    client.query(
      `insert into share_links (project_id, token_hash, created_by) values ($1, $2, $3)`,
      [projectId, hashOf(newToken()), userId],
    );

  it('is seen by the members, without its hash', async () => {
    for (const userId of [OWNER, EDITOR]) {
      const { rows } = await asUser(app, userId, (client) =>
        client.query('select project_id from share_links where project_id = $1', [PROJECT]),
      );
      expect(rows).toHaveLength(1);
    }
    const stranger = await asUser(app, STRANGER, (client) =>
      client.query('select project_id from share_links'),
    );
    expect(stranger.rows).toEqual([]);
    await expect(
      asUser(app, OWNER, (client) => client.query('select token_hash from share_links')),
    ).rejects.toMatchObject(rejected);
  });

  it('is created, replaced and removed by owners only', async () => {
    await asUser(app, OWNER, async (client) => {
      expect((await insert(client, OWNER)).rowCount).toBe(1);
    });
    await expect(
      asUser(app, EDITOR, (client) => insert(client, EDITOR, PROJECT)),
    ).rejects.toMatchObject(rejected);
    await expect(asUser(app, STRANGER, (client) => insert(client, STRANGER))).rejects.toMatchObject(
      rejected,
    );
    // Nobody creates a link in the name of someone else.
    await expect(asUser(app, OWNER, (client) => insert(client, EDITOR))).rejects.toMatchObject(
      rejected,
    );

    const replace = (userId: string) =>
      asUser(app, userId, (client) =>
        client.query(
          `update share_links set token_hash = $2, created_by = $3, created_at = now()
           where project_id = $1`,
          [PROJECT, hashOf(newToken()), userId],
        ),
      );
    expect((await replace(EDITOR)).rowCount).toBe(0);
    expect((await replace(OWNER)).rowCount).toBe(1);

    const remove = (userId: string) =>
      asUser(app, userId, (client) =>
        client.query('delete from share_links where project_id = $1', [PROJECT]),
      );
    expect((await remove(EDITOR)).rowCount).toBe(0);
    expect((await remove(OWNER)).rowCount).toBe(1);
  });
});
