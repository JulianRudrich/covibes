import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Plan updates and versions (spec 25c): keeping versions, who reads them, starting an update.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '1c111111-1111-4111-8111-111111111111';
const EDITOR = '1c222222-2222-4222-8222-222222222222';
const VIEWER = '1c333333-3333-4333-8333-333333333333';
const STRANGER = '1c444444-4444-4444-8444-444444444444';

const rejected = { code: '42501' };

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
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Plan', $2)`, [
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

const plan = (text: string) =>
  JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text }] }]);

const keep = (userId: string, projectId: string, text: string, reason = 'generated') =>
  commitAs(userId, async (client) => {
    const { rows } = await client.query<{ id: string | null }>(
      'select public.keep_plan_version($1, $2::jsonb, $3) as id',
      [projectId, plan(text), reason],
    );
    return rows[0]?.id ?? null;
  });

async function versionsOf(projectId: string) {
  const { rows } = await admin.query<{ number: number; reason: string; created_by: string }>(
    'select number, reason, created_by from plan_versions where project_id = $1 order by number',
    [projectId],
  );
  return rows;
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'plan-v-owner@example.com', true),
      ($2, 'Eddie Editor', 'plan-v-editor@example.com', true),
      ($3, 'Vera Viewer', 'plan-v-viewer@example.com', true),
      ($4, 'Sam Stranger', 'plan-v-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('versions of the plan', () => {
  it('are numbered per project and carry who kept them and why', async () => {
    const projectId = await newProject();
    const other = await newProject();

    expect(await keep(EDITOR, projectId, 'Von Hand', 'manual')).toBeTruthy();
    expect(await keep(OWNER, projectId, 'Erzeugt')).toBeTruthy();
    expect(await keep(OWNER, other, 'Anderes Projekt')).toBeTruthy();
    expect(await keep(EDITOR, projectId, 'Aktualisiert', 'updated')).toBeTruthy();

    expect(await versionsOf(projectId)).toEqual([
      { number: 1, reason: 'manual', created_by: EDITOR },
      { number: 2, reason: 'generated', created_by: OWNER },
      { number: 3, reason: 'updated', created_by: EDITOR },
    ]);
    expect(await versionsOf(other)).toEqual([
      { number: 1, reason: 'generated', created_by: OWNER },
    ]);
  });

  it('are not kept twice for the same plan', async () => {
    const projectId = await newProject();
    await keep(OWNER, projectId, 'Gleich');

    expect(await keep(EDITOR, projectId, 'Gleich', 'updated')).toBeNull();
    expect(await versionsOf(projectId)).toHaveLength(1);
    // An earlier state that comes back is a new version: the latest one differs.
    await keep(OWNER, projectId, 'Anders');
    expect(await keep(OWNER, projectId, 'Gleich')).toBeTruthy();
    expect((await versionsOf(projectId)).map((version) => version.number)).toEqual([1, 2, 3]);
  });

  it('are kept by owners and editors only, and for known reasons', async () => {
    const projectId = await newProject();

    await expect(keep(VIEWER, projectId, 'Nein')).rejects.toMatchObject(rejected);
    await expect(keep(STRANGER, projectId, 'Nein')).rejects.toMatchObject(rejected);
    await expect(keep(OWNER, projectId, 'Nein', 'because')).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(
          `insert into plan_versions (project_id, number, content, reason)
           values ($1, 1, '[]', 'manual')`,
          [projectId],
        ),
      ),
    ).rejects.toMatchObject(rejected);
    expect(await versionsOf(projectId)).toEqual([]);
  });

  it('are read by the members of the project', async () => {
    const projectId = await newProject();
    await keep(OWNER, projectId, 'Lesbar');
    const read = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rows } = await client.query<{ number: number }>(
          'select number from plan_versions where project_id = $1',
          [projectId],
        );
        return rows;
      });

    expect(await read(VIEWER)).toEqual([{ number: 1 }]);
    expect(await read(STRANGER)).toEqual([]);
  });
});

describe('starting an update', () => {
  const start = (userId: string, projectId: string, kind?: string) =>
    commitAs(userId, async (client) => {
      const { rows } = await client.query<{ run: string }>(
        kind === undefined
          ? 'select public.start_plan_generation($1) as run'
          : 'select public.start_plan_generation($1, $2) as run',
        kind === undefined ? [projectId] : [projectId, kind],
      );
      return rows[0]?.run ?? '';
    });
  const jobOf = async (runId: string) => {
    const { rows } = await admin.query<{ payload: { kind: string } }>(
      `select payload from graphile_worker._private_jobs where payload ->> 'runId' = $1`,
      [runId],
    );
    return rows[0]?.payload.kind;
  };

  it('queues the same run as a generation, with what kind it is', async () => {
    const first = await newProject();
    const second = await newProject();

    expect(await jobOf(await start(EDITOR, first, 'update'))).toBe('update');
    expect(await jobOf(await start(OWNER, second))).toBe('generate');
    // One run at a time, whatever its kind.
    await expect(start(OWNER, first, 'generate')).rejects.toMatchObject({ code: '55000' });
  });

  it('is for owners and editors, and for the two kinds', async () => {
    const projectId = await newProject();

    await expect(start(VIEWER, projectId, 'update')).rejects.toMatchObject(rejected);
    await expect(start(OWNER, projectId, 'refresh')).rejects.toMatchObject({ code: '22023' });
  });
});

describe('a suggestion', () => {
  it('knows its kind and whether its section was changed by hand', async () => {
    const projectId = await newProject();

    const plain = await admin.query<{ kind: string; hand_edited: boolean }>(
      `insert into plan_suggestions (project_id, section, content) values ($1, 'scope', '[]')
       returning kind, hand_edited`,
      [projectId],
    );
    expect(plain.rows).toEqual([{ kind: 'generate', hand_edited: false }]);
    await expect(
      admin.query(
        `insert into plan_suggestions (project_id, section, content, kind)
         values ($1, 'risks', '[]', 'rewrite')`,
        [projectId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
