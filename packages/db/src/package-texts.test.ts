import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// The team's texts for the package for coding agents (spec 27b): who reads, who writes.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '2c111111-1111-4111-8111-111111111111';
const EDITOR = '2c222222-2222-4222-8222-222222222222';
const VIEWER = '2c333333-3333-4333-8333-333333333333';
const STRANGER = '2c444444-4444-4444-8444-444444444444';

const UPSERT = `
  insert into package_texts (project_id, kind, content, updated_by)
  values ($1, $2, $3, $4)
  on conflict (project_id, kind)
  do update set content = excluded.content, updated_by = excluded.updated_by`;

async function commitAs<T>(userId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

async function newProject() {
  const id = randomUUID();
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Vereins-App', $2)`, [
    id,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer')`,
    [id, OWNER, EDITOR, VIEWER],
  );
  return id;
}

const write = (userId: string, projectId: string, kind: string, content: string, as = userId) =>
  commitAs(userId, (client) => client.query(UPSERT, [projectId, kind, content, as]));

const stored = async (projectId: string) => {
  const { rows } = await admin.query<{ kind: string; content: string; updated_by: string }>(
    'select kind, content, updated_by from package_texts where project_id = $1 order by kind',
    [projectId],
  );
  return rows;
};

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'package-owner@example.com', true),
      ($2, 'Eddie Editor', 'package-editor@example.com', true),
      ($3, 'Vera Viewer', 'package-viewer@example.com', true),
      ($4, 'Sam Stranger', 'package-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('package_texts', () => {
  it('lets owners and editors write a text, and the next one replaces it', async () => {
    const projectId = await newProject();

    await write(OWNER, projectId, 'code_standards', 'TypeScript strict.');
    await write(EDITOR, projectId, 'code_standards', 'TypeScript strict, keine any.');
    await write(EDITOR, projectId, 'ui_direction', 'Ruhig und hell.');

    expect(await stored(projectId)).toEqual([
      { kind: 'code_standards', content: 'TypeScript strict, keine any.', updated_by: EDITOR },
      { kind: 'ui_direction', content: 'Ruhig und hell.', updated_by: EDITOR },
    ]);
  });

  it('refuses viewers and people outside of the project', async () => {
    const projectId = await newProject();
    await write(OWNER, projectId, 'code_standards', 'Strict.');

    await expect(write(VIEWER, projectId, 'ui_direction', 'Bunt.')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(write(STRANGER, projectId, 'ui_direction', 'Bunt.')).rejects.toMatchObject({
      code: '42501',
    });
    // Changing a text that exists is refused as well.
    await expect(write(VIEWER, projectId, 'code_standards', 'Locker.')).rejects.toMatchObject({
      code: '42501',
    });
    const removed = await commitAs(VIEWER, (client) =>
      client.query('delete from package_texts where project_id = $1', [projectId]),
    );

    expect(removed.rowCount).toBe(0);
    expect(await stored(projectId)).toEqual([
      { kind: 'code_standards', content: 'Strict.', updated_by: OWNER },
    ]);
  });

  it('refuses a text in the name of someone else', async () => {
    const projectId = await newProject();

    await expect(
      write(EDITOR, projectId, 'code_standards', 'Strict.', OWNER),
    ).rejects.toMatchObject({ code: '42501' });
    await write(OWNER, projectId, 'code_standards', 'Strict.');
    await expect(
      write(EDITOR, projectId, 'code_standards', 'Locker.', OWNER),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('lets every member read, and nobody else', async () => {
    const projectId = await newProject();
    await write(OWNER, projectId, 'ui_direction', 'Ruhig und hell.');
    const read = (userId: string) =>
      asUser(app, userId, (client) =>
        client.query('select content from package_texts where project_id = $1', [projectId]),
      );

    expect((await read(VIEWER)).rows).toEqual([{ content: 'Ruhig und hell.' }]);
    expect((await read(EDITOR)).rows).toEqual([{ content: 'Ruhig und hell.' }]);
    expect((await read(STRANGER)).rows).toEqual([]);
  });

  it('lets owners and editors remove a text', async () => {
    const projectId = await newProject();
    await write(OWNER, projectId, 'code_standards', 'Strict.');

    const removed = await commitAs(EDITOR, (client) =>
      client.query(`delete from package_texts where project_id = $1 and kind = 'code_standards'`, [
        projectId,
      ]),
    );

    expect(removed.rowCount).toBe(1);
    expect(await stored(projectId)).toEqual([]);
  });

  it('takes only the kinds it knows, and no empty or endless text', async () => {
    const projectId = await newProject();

    await expect(write(OWNER, projectId, 'readme', 'Hallo.')).rejects.toMatchObject({
      code: '23514',
    });
    await expect(write(OWNER, projectId, 'code_standards', '')).rejects.toMatchObject({
      code: '23514',
    });
    await expect(write(OWNER, projectId, 'code_standards', 'x'.repeat(8001))).rejects.toMatchObject(
      { code: '23514' },
    );
  });

  it('goes with its project', async () => {
    const projectId = await newProject();
    await write(OWNER, projectId, 'code_standards', 'Strict.');

    await admin.query('delete from projects where id = $1', [projectId]);

    expect(await stored(projectId)).toEqual([]);
  });
});
